"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Camera, FileDown, Recycle, UploadCloud } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { MetricCard } from "@/components/metric-card";
import { QrScanner } from "@/components/qr-scanner";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch } from "@/lib/api-client";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import type { WasteBatch } from "@/lib/types";
import { uploadEvidenceImages } from "@/lib/uploads";
import { formatKg } from "@/lib/utils";
import { getWasteCategoryLabel } from "@/lib/waste-categories";

export default function RecyclerDashboard() {
  const [batches, setBatches] = useState<WasteBatch[]>([]);
  const [selected, setSelected] = useState<WasteBatch | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [deliveryPhoto, setDeliveryPhoto] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState("");

  const loadBatches = useCallback(async () => {
    const data = await apiFetch<{ batches: WasteBatch[] }>("/api/batches", {
      role: "recycler"
    });
    setBatches(data.batches);
    setSelected((current) => current || data.batches[0] || null);
  }, []);

  useEffect(() => {
    loadBatches().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Unable to load recycler batches")
    );
    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      ?.channel("recycler-waste-batches")
      .on("postgres_changes", { event: "*", schema: "public", table: "waste_batches" }, () => {
        loadBatches().catch(() => undefined);
      })
      .subscribe();
    const interval = window.setInterval(() => loadBatches().catch(() => undefined), 5000);
    return () => {
      window.clearInterval(interval);
      if (channel) {
        supabase?.removeChannel(channel);
      }
    };
  }, [loadBatches]);

  async function scanDelivery(token: string) {
    setUploadStatus("");
    setError("");

    if (!deliveryPhoto) {
      setError("Attach delivery photo proof before scanning the QR.");
      return;
    }

    const photoUrl = await uploadCustodyPhoto(deliveryPhoto);

    await apiFetch("/api/scans", {
      method: "POST",
      body: JSON.stringify({
        qr_token: token,
        qr_identifier: token,
        event_type: "delivered",
        photo_url: photoUrl,
        weight_verified_kg: selected?.weight_kg,
        notes: "Recycler scanned signed QR at delivery."
      }),
      role: "recycler"
    });
    setMessage("Delivery custody event written.");
    setDeliveryPhoto(null);
    setUploadStatus("");
    await loadBatches();
  }

  async function uploadCustodyPhoto(file: File | null) {
    if (!file) {
      return null;
    }

    setUploadStatus("Uploading delivery photo proof...");
    const [photoUrl] = await uploadEvidenceImages({
      files: [file],
      purpose: "custody-photo",
      role: "recycler"
    });
    setUploadStatus("Delivery photo proof uploaded.");
    return photoUrl;
  }

  async function markRecycled(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) {
      return;
    }

    const form = new FormData(event.currentTarget);
    await apiFetch("/api/recycling", {
      method: "POST",
      body: JSON.stringify({
        batch_id: selected.id,
        material_type: form.get("material_type"),
        quantity_kg: Number(form.get("quantity_kg")),
        recycling_method: form.get("recycling_method"),
        epr_credits_claimed: Number(form.get("epr_credits_claimed")),
        report_url: form.get("report_url")
      }),
      role: "recycler"
    });
    setMessage("Recycling log created, batch recycled, EPR webhook fired if configured.");
    await loadBatches();
  }

  return (
    <AppShell role="Recycler">
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <p className="text-sm font-black uppercase tracking-[0.16em] text-primary">
            Recycler Dashboard
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-normal">
            Verify delivery and convert material to EPR credit evidence
          </h1>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard label="Incoming waste" value={batches.filter((batch) => batch.status === "in_transit").length} />
          <MetricCard label="Delivered" value={batches.filter((batch) => batch.status === "delivered").length} />
          <MetricCard label="Total kg" value={formatKg(batches.reduce((sum, batch) => sum + Number(batch.weight_kg), 0))} />
        </div>

        {message ? <p className="mt-5 rounded-md bg-primary/10 p-3 text-sm font-bold text-primary">{message}</p> : null}
        {error ? <p className="mt-5 rounded-md bg-destructive/10 p-3 text-sm font-bold text-destructive">{error}</p> : null}

        <div className="mt-8 grid gap-6 lg:grid-cols-[0.9fr_0.9fr_1.1fr]">
          <section className="rounded-lg border border-border bg-card p-5 shadow-operational">
            <h2 className="text-xl font-black">Incoming Waste</h2>
            <div className="mt-4 grid gap-3">
              {batches.map((batch) => (
                <button className="rounded-md border border-border p-4 text-left" key={batch.id} onClick={() => setSelected(batch)} type="button">
                  <div className="flex items-center justify-between gap-3">
                    <strong>{batch.batch_code}</strong>
                    <StatusBadge status={batch.status} />
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{getWasteCategoryLabel(batch.category)} · {formatKg(batch.weight_kg)}</p>
                </button>
              ))}
            </div>
          </section>

          <div className="grid gap-4">
            <section className="rounded-lg border border-border bg-card p-4 shadow-operational">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-black">Delivery Evidence</h2>
                <Camera className="h-5 w-5 text-primary" />
              </div>
              <label>
                Photo proof required
                <span className="mt-2 flex min-h-20 items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted text-sm font-bold text-muted-foreground">
                  <UploadCloud className="h-5 w-5" />
                  {deliveryPhoto ? deliveryPhoto.name : "Attach delivery photo"}
                </span>
                <input
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(event) => setDeliveryPhoto(event.target.files?.[0] || null)}
                  type="file"
                />
              </label>
              {uploadStatus ? <p className="mt-3 text-sm font-bold text-muted-foreground">{uploadStatus}</p> : null}
            </section>
            <QrScanner title="Delivery QR Scanner" onScan={(token) => scanDelivery(token).catch((caught) => setError(caught instanceof Error ? caught.message : "Delivery scan failed"))} />
          </div>

          <section className="rounded-lg border border-border bg-card p-5 shadow-operational">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black">Mark as Recycled</h2>
              <Recycle className="h-6 w-6 text-primary" />
            </div>
            {selected ? (
              <form className="mt-5 grid gap-4" onSubmit={markRecycled}>
                <div className="rounded-md bg-muted p-3 text-sm">
                  <strong>{selected.batch_code}</strong>
                  <p className="text-muted-foreground">{getWasteCategoryLabel(selected.category)}</p>
                </div>
                <label>
                  Material type
                  <input name="material_type" defaultValue={selected.waste_type} />
                </label>
                <label>
                  Quantity kg
                  <input min="0.1" name="quantity_kg" step="0.1" type="number" defaultValue={selected.weight_kg} />
                </label>
                <label>
                  Recycling method
                  <input name="recycling_method" defaultValue="Mechanical recycling and baled material recovery" />
                </label>
                <label>
                  EPR credits claimed
                  <input min="0" name="epr_credits_claimed" step="0.1" type="number" defaultValue={selected.weight_kg} />
                </label>
                <label>
                  Report URL
                  <input name="report_url" placeholder="Supabase Storage report URL" />
                </label>
                <button className="min-h-11 rounded-md bg-primary px-4 font-black text-primary-foreground" disabled={selected.status === "recycled"} type="submit">
                  Create recycling log
                </button>
              </form>
            ) : null}
          </section>
        </div>

        <section className="mt-8 rounded-lg border border-border bg-card p-5 shadow-operational">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black">Recycling Reports</h2>
            <button className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-bold" type="button">
              <FileDown className="h-4 w-4" />
              CSV
            </button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="p-3">Batch</th>
                  <th className="p-3">Material</th>
                  <th className="p-3">Quantity</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr className="border-t border-border" key={batch.id}>
                    <td className="p-3 font-black">{batch.batch_code}</td>
                    <td className="p-3">{batch.waste_type}</td>
                    <td className="p-3">{formatKg(batch.weight_kg)}</td>
                    <td className="p-3"><StatusBadge status={batch.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </AppShell>
  );
}
