"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Camera, ClipboardList, FileDown, ImageIcon, RefreshCw, Search, ShieldCheck, Users, Webhook } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch, apiFetchBlob } from "@/lib/api-client";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import type { AdminAuditLog, CustodyEvent, Metrics, Profile, WasteBatch, WebhookDelivery } from "@/lib/types";
import { formatKg, statusLabel } from "@/lib/utils";
import { getWasteCategoryLabel } from "@/lib/waste-categories";

export default function AdminDashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [batches, setBatches] = useState<WasteBatch[]>([]);
  const [events, setEvents] = useState<CustodyEvent[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [adminLogs, setAdminLogs] = useState<AdminAuditLog[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [webhookMessage, setWebhookMessage] = useState("");
  const [retryingDeliveryId, setRetryingDeliveryId] = useState("");
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const loadAll = useCallback(async () => {
    const [metricData, batchData, eventData, profileData, deliveryData, adminLogData] = await Promise.all([
      apiFetch<Metrics>("/api/metrics", { role: "admin" }),
      apiFetch<{ batches: WasteBatch[] }>("/api/batches", { role: "admin" }),
      apiFetch<{ events: CustodyEvent[] }>("/api/audit", { role: "admin" }),
      apiFetch<{ profiles: Profile[] }>("/api/admin/approvals", { role: "admin" }),
      apiFetch<{ deliveries: WebhookDelivery[] }>("/api/webhooks/epr/deliveries", {
        role: "admin"
      }),
      apiFetch<{ logs: AdminAuditLog[] }>("/api/admin/audit-logs", { role: "admin" })
    ]);
    setMetrics(metricData);
    setBatches(batchData.batches);
    setEvents(eventData.events);
    setProfiles(profileData.profiles);
    setDeliveries(deliveryData.deliveries);
    setAdminLogs(adminLogData.logs);
    setSelectedBatchId((current) => current || batchData.batches[0]?.id || "");
  }, []);

  useEffect(() => {
    loadAll().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Unable to load admin dashboard")
    );
    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      ?.channel("admin-pipeline")
      .on("postgres_changes", { event: "*", schema: "public", table: "waste_batches" }, () => {
        loadAll().catch(() => undefined);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "custody_events" }, () => {
        loadAll().catch(() => undefined);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "webhook_deliveries" }, () => {
        loadAll().catch(() => undefined);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "admin_audit_logs" }, () => {
        loadAll().catch(() => undefined);
      })
      .subscribe();
    const interval = window.setInterval(() => loadAll().catch(() => undefined), 5000);
    return () => {
      window.clearInterval(interval);
      if (channel) {
        supabase?.removeChannel(channel);
      }
    };
  }, [loadAll]);

  const filteredBatches = useMemo(
    () =>
      batches.filter((batch) =>
        `${batch.batch_code} ${batch.category} ${batch.waste_type}`
          .toLowerCase()
          .includes(query.toLowerCase())
      ),
    [batches, query]
  );
  const selectedBatch = useMemo(
    () => batches.find((batch) => batch.id === selectedBatchId) || filteredBatches[0] || null,
    [batches, filteredBatches, selectedBatchId]
  );
  const selectedBatchEvents = useMemo(
    () => events.filter((event) => event.batch_id === selectedBatch?.id),
    [events, selectedBatch?.id]
  );

  async function updateApproval(id: string, status: "approved" | "suspended") {
    await apiFetch("/api/admin/approvals", {
      method: "PATCH",
      body: JSON.stringify({ id, status }),
      role: "admin"
    });
    await loadAll();
  }

  async function retryDelivery(deliveryId: string) {
    setRetryingDeliveryId(deliveryId);
    setWebhookMessage("");

    try {
      const result = await apiFetch<{ delivery: WebhookDelivery | null }>("/api/webhooks/epr/deliveries", {
        method: "POST",
        body: JSON.stringify({ delivery_id: deliveryId }),
        role: "admin"
      });
      setWebhookMessage(
        result.delivery
          ? `Delivery ${result.delivery.status} after retry attempt ${result.delivery.attempts}.`
          : "Webhook delivery is not configured in this environment."
      );
      await loadAll();
    } catch (caught) {
      setWebhookMessage(caught instanceof Error ? caught.message : "Retry failed");
    } finally {
      setRetryingDeliveryId("");
    }
  }

  function downloadSelectedBatchCsv() {
    if (!selectedBatch) {
      return;
    }

    const rows = [
      ["batch_code", "event_type", "actor", "actor_role", "created_at", "notes", "weight_verified_kg", "location_lat", "location_lng", "photo_url"],
      ...selectedBatchEvents
        .slice()
        .reverse()
        .map((event) => [
          selectedBatch.batch_code,
          event.event_type,
          event.actor?.company_name || event.actor_id,
          event.actor?.role || "system",
          event.created_at,
          event.notes || "",
          event.weight_verified_kg?.toString() || "",
          event.location_lat?.toString() || "",
          event.location_lng?.toString() || "",
          event.photo_url || ""
        ])
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `${selectedBatch.batch_code}-custody-timeline.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function downloadSelectedBatchPdf() {
    if (!selectedBatch) {
      return;
    }

    setIsDownloadingPdf(true);
    setError("");

    try {
      const blob = await apiFetchBlob(`/api/admin/batches/${selectedBatch.id}/evidence.pdf`, {
        role: "admin"
      });
      downloadBlob(blob, `${selectedBatch.batch_code}-custody-evidence.pdf`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "PDF download failed");
    } finally {
      setIsDownloadingPdf(false);
    }
  }

  return (
    <AppShell role="Admin">
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <p className="text-sm font-black uppercase tracking-[0.16em] text-primary">
            Admin Dashboard
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-normal">
            Monitor EPR compliance from batch creation to recycled proof
          </h1>
        </div>

        {error ? <p className="mb-5 rounded-md bg-destructive/10 p-3 text-sm font-bold text-destructive">{error}</p> : null}

        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard label="Total waste" value={formatKg(metrics?.totalKg || 0)} icon={<Activity className="h-5 w-5" />} />
          <MetricCard label="Active collectors" value={metrics?.activeCollectors || 0} icon={<Users className="h-5 w-5" />} />
          <MetricCard label="Recycling rate" value={`${metrics?.totalKg ? Math.round(((metrics.recycledKg || 0) / metrics.totalKg) * 100) : 0}%`} icon={<ShieldCheck className="h-5 w-5" />} />
          <MetricCard label="Pending approvals" value={metrics?.pendingApprovals || 0} />
        </div>

        <section className="mt-8 rounded-lg border border-border bg-card p-5 shadow-operational">
          <h2 className="text-xl font-black">Live Pipeline Visualization</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-6">
            {[
              ["Generator", metrics?.totalBatches || 0],
              ["QR", metrics?.totalBatches || 0],
              ["Pickup", (metrics?.byStatus.assigned || 0) + (metrics?.byStatus.picked_up || 0)],
              ["Transit", metrics?.byStatus.in_transit || 0],
              ["Delivered", metrics?.byStatus.delivered || 0],
              ["Recycled", metrics?.byStatus.recycled || 0]
            ].map(([label, value]) => (
              <article className="rounded-md bg-muted p-4" key={label as string}>
                <span className="text-sm font-bold text-muted-foreground">{label as string}</span>
                <strong className="mt-2 block text-3xl font-black">{value as number}</strong>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-8 rounded-lg border border-border bg-card p-5 shadow-operational">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">Admin Action Audit</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Operator actions such as approvals, suspensions, and manual retries.
              </p>
            </div>
            <ClipboardList className="h-6 w-6 text-primary" />
          </div>
          <div className="mt-5 grid gap-3">
            {adminLogs.map((log) => (
              <article
                className="grid gap-3 rounded-md border border-border p-4 md:grid-cols-[0.8fr_0.8fr_1.2fr_1fr]"
                key={log.id}
              >
                <div>
                  <strong>{log.action}</strong>
                  <p className="mt-1 text-xs text-muted-foreground">{log.target_type}</p>
                </div>
                <span className="text-sm text-muted-foreground">{log.target_id}</span>
                <span className="text-sm text-muted-foreground">{formatAuditMetadata(log.metadata)}</span>
                <span className="text-sm font-bold">{new Date(log.created_at).toLocaleString("en-IN")}</span>
              </article>
            ))}
            {adminLogs.length === 0 ? (
              <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
                No admin actions recorded yet.
              </p>
            ) : null}
          </div>
        </section>

        <section className="mt-8 rounded-lg border border-border bg-card p-5 shadow-operational">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">EPR Webhook Deliveries</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Monitor portal submissions, response errors, and retry failed deliveries.
              </p>
            </div>
            <Webhook className="h-6 w-6 text-primary" />
          </div>
          {webhookMessage ? (
            <p className="mt-4 rounded-md bg-muted p-3 text-sm font-bold text-muted-foreground">
              {webhookMessage}
            </p>
          ) : null}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="p-3">Delivery</th>
                  <th className="p-3">Batch</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Attempts</th>
                  <th className="p-3">Next attempt</th>
                  <th className="p-3">Response</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((delivery) => (
                  <tr className="border-t border-border" key={delivery.id}>
                    <td className="p-3">
                      <strong>{delivery.delivery_type}</strong>
                      <p className="mt-1 max-w-[220px] truncate text-xs text-muted-foreground">
                        {delivery.idempotency_key}
                      </p>
                    </td>
                    <td className="p-3">{delivery.payload.batch_code as string || delivery.batch_id}</td>
                    <td className="p-3">
                      <WebhookStatusBadge status={delivery.status} />
                    </td>
                    <td className="p-3">
                      {delivery.attempts}/{delivery.max_attempts}
                    </td>
                    <td className="p-3">{new Date(delivery.next_attempt_at).toLocaleString("en-IN")}</td>
                    <td className="p-3">
                      <span className="font-bold">{delivery.last_status_code || "No response"}</span>
                      <p className="mt-1 max-w-[260px] truncate text-xs text-muted-foreground">
                        {delivery.last_error || delivery.last_response_body || "Waiting for first attempt"}
                      </p>
                    </td>
                    <td className="p-3">
                      <button
                        className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-black"
                        disabled={delivery.status === "delivered" || retryingDeliveryId === delivery.id}
                        onClick={() => retryDelivery(delivery.id)}
                        type="button"
                      >
                        <RefreshCw className="h-4 w-4" />
                        Retry
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {deliveries.length === 0 ? (
              <p className="mt-4 rounded-md bg-muted p-4 text-sm text-muted-foreground">
                No webhook deliveries yet. They will appear here after a recycled batch is queued for the EPR portal.
              </p>
            ) : null}
          </div>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <section className="rounded-lg border border-border bg-card p-5 shadow-operational">
            <h2 className="text-xl font-black">User Management</h2>
            <div className="mt-4 grid gap-3">
              {profiles.map((profile) => (
                <article className="rounded-md border border-border p-3" key={profile.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <strong>{profile.company_name}</strong>
                      <p className="text-sm capitalize text-muted-foreground">{profile.role} · {profile.gst_number}</p>
                    </div>
                    <span className="rounded-md bg-muted px-2 py-1 text-xs font-bold">{profile.status}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button className="rounded-md bg-primary px-3 py-2 text-sm font-black text-primary-foreground" onClick={() => updateApproval(profile.id, "approved")} type="button">
                      Approve
                    </button>
                    <button className="rounded-md border border-border px-3 py-2 text-sm font-black" onClick={() => updateApproval(profile.id, "suspended")} type="button">
                      Suspend
                    </button>
                  </div>
                </article>
              ))}
              {profiles.length === 0 ? <p className="text-sm text-muted-foreground">No pending approvals.</p> : null}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-operational">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-black">Batch Explorer</h2>
              <label className="w-full max-w-sm">
                <span className="sr-only">Search batch</span>
                <span className="flex items-center gap-2 rounded-md border border-input bg-background px-3">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <input className="border-0 px-0 focus:outline-none" onChange={(event) => setQuery(event.target.value)} placeholder="Search batch code" value={query} />
                </span>
              </label>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="p-3">Batch</th>
                    <th className="p-3">Category</th>
                    <th className="p-3">Weight</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBatches.map((batch) => (
                    <tr
                      className={`cursor-pointer border-t border-border ${selectedBatch?.id === batch.id ? "bg-primary/5" : ""}`}
                      key={batch.id}
                      onClick={() => setSelectedBatchId(batch.id)}
                    >
                      <td className="p-3 font-black">{batch.batch_code}</td>
                      <td className="p-3">{getWasteCategoryLabel(batch.category)}</td>
                      <td className="p-3">{formatKg(batch.weight_kg)}</td>
                      <td className="p-3"><StatusBadge status={batch.status} /></td>
                      <td className="p-3">{new Date(batch.created_at).toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {selectedBatch ? (
          <section className="mt-8 rounded-lg border border-border bg-card p-5 shadow-operational">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black">Batch Custody Timeline</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedBatch.batch_code} | {getWasteCategoryLabel(selectedBatch.category)} | {formatKg(selectedBatch.weight_kg)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-black"
                  onClick={downloadSelectedBatchCsv}
                  type="button"
                >
                  <FileDown className="h-4 w-4" />
                  CSV
                </button>
                <button
                  className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-black"
                  disabled={isDownloadingPdf}
                  onClick={() => downloadSelectedBatchPdf()}
                  type="button"
                >
                  <FileDown className="h-4 w-4" />
                  {isDownloadingPdf ? "PDF..." : "PDF"}
                </button>
                <StatusBadge status={selectedBatch.status} />
              </div>
            </div>

            {selectedBatch.images?.length ? (
              <div className="mt-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-black text-muted-foreground">
                  <ImageIcon className="h-4 w-4" />
                  Generator batch images
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {selectedBatch.images.map((imageUrl) => (
                    <EvidenceImage alt={`Batch image for ${selectedBatch.batch_code}`} key={imageUrl} src={imageUrl} />
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-5 grid gap-3">
              {selectedBatchEvents.map((event) => (
                <article
                  className="grid gap-4 rounded-md border border-border p-4 lg:grid-cols-[0.7fr_0.9fr_1.1fr_0.9fr]"
                  key={event.id}
                >
                  <div>
                    <strong>{statusLabel(event.event_type)}</strong>
                    <p className="mt-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {new Date(event.created_at).toLocaleString("en-IN")}
                    </p>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <strong className="block text-foreground">{event.actor?.company_name || event.actor_id}</strong>
                    <span className="capitalize">{event.actor?.role || "System"}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <p>{event.notes || "No notes recorded"}</p>
                    <p className="mt-2 font-bold">
                      {event.weight_verified_kg ? `Verified: ${formatKg(event.weight_verified_kg)}` : "Weight not verified"}
                    </p>
                    {event.location_lat && event.location_lng ? (
                      <p className="mt-1">
                        GPS: {Number(event.location_lat).toFixed(5)}, {Number(event.location_lng).toFixed(5)}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    {event.photo_url ? (
                      <EvidenceImage alt={`${statusLabel(event.event_type)} proof for ${selectedBatch.batch_code}`} src={event.photo_url} />
                    ) : (
                      <div className="flex min-h-28 items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted text-sm font-bold text-muted-foreground">
                        <Camera className="h-4 w-4" />
                        No photo proof
                      </div>
                    )}
                  </div>
                </article>
              ))}
              {selectedBatchEvents.length === 0 ? (
                <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
                  No custody events recorded for this batch yet.
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="mt-8 rounded-lg border border-border bg-card p-5 shadow-operational">
          <h2 className="text-xl font-black">Full Audit Trail</h2>
          <div className="mt-5 grid gap-3">
            {events.map((event) => (
              <article className="grid gap-3 rounded-md border border-border p-4 md:grid-cols-[0.8fr_1fr_1fr_1fr]" key={event.id}>
                <strong>{statusLabel(event.event_type)}</strong>
                <span className="text-sm text-muted-foreground">{event.actor?.company_name || event.actor_id}</span>
                <span className="text-sm text-muted-foreground">{event.notes || "No notes"}</span>
                <span className="text-sm font-bold">{new Date(event.created_at).toLocaleString("en-IN")}</span>
              </article>
            ))}
          </div>
        </section>
      </section>
    </AppShell>
  );
}

function formatAuditMetadata(metadata: Record<string, unknown>) {
  const parts = Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`);

  return parts.length ? parts.join(" | ") : "No metadata";
}

function WebhookStatusBadge({ status }: { status: WebhookDelivery["status"] }) {
  const colors: Record<WebhookDelivery["status"], string> = {
    pending: "bg-slate-100 text-slate-700 border-slate-200",
    processing: "bg-sky-100 text-sky-800 border-sky-200",
    delivered: "bg-green-100 text-green-800 border-green-200",
    failed: "bg-amber-100 text-amber-900 border-amber-200",
    abandoned: "bg-red-100 text-red-800 border-red-200"
  };

  return (
    <span className={`inline-flex rounded-md border px-2.5 py-1 text-xs font-black capitalize ${colors[status]}`}>
      {status}
    </span>
  );
}

function EvidenceImage({ alt, src }: { alt: string; src: string }) {
  return (
    <a
      className="group block overflow-hidden rounded-md border border-border bg-muted"
      href={src}
      rel="noreferrer"
      target="_blank"
    >
      <img
        alt={alt}
        className="aspect-[4/3] w-full object-cover transition duration-200 group-hover:scale-[1.02]"
        loading="lazy"
        src={src}
      />
    </a>
  );
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderCustodyPacketHtml({
  batch,
  events
}: {
  batch: WasteBatch;
  events: CustodyEvent[];
}) {
  const batchImages = batch.images?.length
    ? batch.images
        .map(
          (imageUrl) => `
            <figure>
              <img src="${escapeAttribute(imageUrl)}" alt="Batch evidence image" />
              <figcaption>${escapeHtml(imageUrl)}</figcaption>
            </figure>
          `
        )
        .join("")
    : `<p class="muted">No generator batch images attached.</p>`;

  const eventRows = events
    .map(
      (event) => `
        <article class="event">
          <div>
            <strong>${escapeHtml(statusLabel(event.event_type))}</strong>
            <span>${escapeHtml(new Date(event.created_at).toLocaleString("en-IN"))}</span>
          </div>
          <p><b>Actor:</b> ${escapeHtml(event.actor?.company_name || event.actor_id)} (${escapeHtml(event.actor?.role || "system")})</p>
          <p><b>Notes:</b> ${escapeHtml(event.notes || "No notes recorded")}</p>
          <p><b>Weight:</b> ${escapeHtml(event.weight_verified_kg ? formatKg(event.weight_verified_kg) : "Not verified")}</p>
          <p><b>GPS:</b> ${escapeHtml(formatEventGps(event))}</p>
          ${
            event.photo_url
              ? `<figure><img src="${escapeAttribute(event.photo_url)}" alt="Custody proof" /><figcaption>${escapeHtml(event.photo_url)}</figcaption></figure>`
              : `<p class="muted">No photo proof attached.</p>`
          }
        </article>
      `
    )
    .join("");

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(batch.batch_code)} custody packet</title>
        <style>
          body { color: #111827; font-family: Arial, sans-serif; margin: 32px; }
          header { border-bottom: 2px solid #111827; margin-bottom: 24px; padding-bottom: 16px; }
          h1 { font-size: 26px; margin: 0 0 8px; }
          h2 { font-size: 18px; margin: 24px 0 12px; }
          .summary { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .summary div, .event { border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; }
          .event { break-inside: avoid; margin-bottom: 12px; }
          .event div { display: flex; justify-content: space-between; gap: 16px; }
          p { font-size: 13px; margin: 8px 0; overflow-wrap: anywhere; }
          span, .muted, figcaption { color: #6b7280; font-size: 12px; overflow-wrap: anywhere; }
          figure { margin: 12px 0 0; }
          img { border: 1px solid #d1d5db; border-radius: 6px; max-height: 240px; max-width: 100%; object-fit: contain; }
          @media print { body { margin: 18mm; } button { display: none; } }
        </style>
      </head>
      <body>
        <header>
          <h1>Sustainable ECG Custody Evidence Packet</h1>
          <p>${escapeHtml(batch.batch_code)} | Generated ${escapeHtml(new Date().toLocaleString("en-IN"))}</p>
        </header>
        <section class="summary">
          <div><b>Category</b><p>${escapeHtml(getWasteCategoryLabel(batch.category))}</p></div>
          <div><b>Status</b><p>${escapeHtml(batch.status)}</p></div>
          <div><b>Waste type</b><p>${escapeHtml(batch.waste_type)}</p></div>
          <div><b>Weight</b><p>${escapeHtml(formatKg(batch.weight_kg))}</p></div>
          <div><b>Pickup date</b><p>${escapeHtml(batch.pickup_date)}</p></div>
          <div><b>Pickup address</b><p>${escapeHtml(batch.pickup_address)}</p></div>
        </section>
        <h2>Generator Batch Images</h2>
        <section>${batchImages}</section>
        <h2>Custody Timeline</h2>
        <section>${eventRows || `<p class="muted">No custody events recorded.</p>`}</section>
      </body>
    </html>`;
}

function formatEventGps(event: CustodyEvent) {
  if (!event.location_lat || !event.location_lng) {
    return "Not captured";
  }

  return `${Number(event.location_lat).toFixed(5)}, ${Number(event.location_lng).toFixed(5)}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
