"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, Clock, MapPin, PackageCheck, Truck, UploadCloud } from "lucide-react";
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

export default function CollectorDashboard() {
  const [batches, setBatches] = useState<WasteBatch[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<WasteBatch | null>(null);
  const [pickupPhoto, setPickupPhoto] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState("");

  const loadBatches = useCallback(async () => {
    const data = await apiFetch<{ batches: WasteBatch[] }>("/api/batches", {
      role: "collector"
    });
    setBatches(data.batches);
    setSelected((current) => current || data.batches[0] || null);
  }, []);

  useEffect(() => {
    loadBatches().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Unable to load collector jobs")
    );

    // Keep field jobs fresh when another actor changes batch status.
    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      ?.channel("collector-waste-batches")
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

  const available = batches.filter((batch) => batch.status === "pending");
  const activeJobs = batches.filter((batch) => batch.status !== "pending");
  const totals = useMemo(
    () => ({
      available: available.length,
      active: activeJobs.length,
      kg: batches.reduce((sum, batch) => sum + Number(batch.weight_kg), 0)
    }),
    [activeJobs.length, available.length, batches]
  );

  async function acceptPickup(batchId: string) {
    await apiFetch("/api/pickups", {
      method: "POST",
      body: JSON.stringify({
        batch_id: batchId,
        status: "accepted",
        estimated_pickup: new Date(Date.now() + 90 * 60 * 1000).toISOString()
      }),
      role: "collector"
    });
    setMessage("Pickup accepted and custody event written.");
    await loadBatches();
  }

  async function scanPickup(token: string) {
    setUploadStatus("");
    setError("");

    if (!pickupPhoto) {
      setError("Attach pickup photo proof before scanning the QR.");
      return;
    }

    const position = await currentPosition();
    const photoUrl = await uploadCustodyPhoto(pickupPhoto);

    await apiFetch("/api/scans", {
      method: "POST",
      body: JSON.stringify({
        qr_token: token,
        qr_identifier: token,
        event_type: "pickup_scanned",
        location_lat: position?.coords.latitude,
        location_lng: position?.coords.longitude,
        photo_url: photoUrl,
        weight_verified_kg: selected?.weight_kg,
        notes: "Collector scanned signed QR at pickup."
      }),
      role: "collector"
    });
    setMessage("Pickup scan accepted. Batch moved to picked up.");
    setPickupPhoto(null);
    setUploadStatus("");
    await loadBatches();
  }

  async function uploadCustodyPhoto(file: File | null) {
    if (!file) {
      return null;
    }

    setUploadStatus("Uploading pickup photo proof...");
    const [photoUrl] = await uploadEvidenceImages({
      files: [file],
      purpose: "custody-photo",
      role: "collector"
    });
    setUploadStatus("Pickup photo proof uploaded.");
    return photoUrl;
  }

  async function markInTransit(batch: WasteBatch) {
    await apiFetch("/api/scans", {
      method: "POST",
      body: JSON.stringify({
        qr_token: batch.qr_token,
        qr_identifier: batch.id,
        event_type: "in_transit",
        notes: "Collector marked batch in transit to recycler."
      }),
      role: "collector"
    });
    setMessage("Batch marked in transit.");
    await loadBatches();
  }

  return (
    <AppShell role="Collector">
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <p className="text-sm font-black uppercase tracking-[0.16em] text-primary">
            Collector Dashboard
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-normal">
            Accept pickups and scan QR at source
          </h1>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard label="Available pickups" value={totals.available} icon={<PackageCheck className="h-5 w-5" />} />
          <MetricCard label="Active jobs" value={totals.active} icon={<Truck className="h-5 w-5" />} />
          <MetricCard label="Route load" value={formatKg(totals.kg)} icon={<Clock className="h-5 w-5" />} />
        </div>

        {message ? <p className="mt-5 rounded-md bg-primary/10 p-3 text-sm font-bold text-primary">{message}</p> : null}
        {error ? <p className="mt-5 rounded-md bg-destructive/10 p-3 text-sm font-bold text-destructive">{error}</p> : null}

        <div className="mt-8 grid gap-6 lg:grid-cols-[0.8fr_1.2fr_0.9fr]">
          <section className="rounded-lg border border-border bg-card p-5 shadow-operational">
            <h2 className="text-xl font-black">Available Pickups</h2>
            <div className="mt-4 grid gap-3">
              {available.map((batch) => (
                <article className="rounded-md border border-border p-3" key={batch.id}>
                  <strong>{batch.batch_code}</strong>
                  <p className="mt-1 text-sm text-muted-foreground">{batch.pickup_address}</p>
                  <p className="mt-2 text-sm font-bold">{formatKg(batch.weight_kg)} · {getWasteCategoryLabel(batch.category)}</p>
                  <button className="mt-3 min-h-10 w-full rounded-md bg-primary text-sm font-black text-primary-foreground" onClick={() => acceptPickup(batch.id)} type="button">
                    Accept
                  </button>
                </article>
              ))}
              {available.length === 0 ? <p className="text-sm text-muted-foreground">No pending pickups right now.</p> : null}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-operational">
            <h2 className="text-xl font-black">My Active Jobs</h2>
            <div className="mt-4 grid gap-3">
              {activeJobs.map((batch) => (
                <button
                  className="rounded-md border border-border p-4 text-left"
                  key={batch.id}
                  onClick={() => setSelected(batch)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <strong>{batch.batch_code}</strong>
                    <StatusBadge status={batch.status} />
                  </div>
                  <p className="mt-2 flex gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4 shrink-0" />
                    {batch.pickup_address}
                  </p>
                  <RouteStepper status={batch.status} />
                  {batch.status === "picked_up" ? (
                    <span
                      className="mt-3 inline-flex rounded-md bg-secondary px-3 py-2 text-sm font-black text-secondary-foreground"
                      onClick={(event) => {
                        event.stopPropagation();
                        markInTransit(batch).catch((caught) =>
                          setError(caught instanceof Error ? caught.message : "Transit update failed")
                        );
                      }}
                    >
                      Mark in transit
                    </span>
                  ) : null}
                </button>
              ))}
              {activeJobs.length === 0 ? <p className="text-sm text-muted-foreground">Accept a pickup to start a job.</p> : null}
            </div>
          </section>

          <div className="grid gap-4">
            <section className="rounded-lg border border-border bg-card p-4 shadow-operational">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-black">Pickup Evidence</h2>
                <Camera className="h-5 w-5 text-primary" />
              </div>
              <label>
                Photo proof required
                <span className="mt-2 flex min-h-20 items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted text-sm font-bold text-muted-foreground">
                  <UploadCloud className="h-5 w-5" />
                  {pickupPhoto ? pickupPhoto.name : "Attach pickup photo"}
                </span>
                <input
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(event) => setPickupPhoto(event.target.files?.[0] || null)}
                  type="file"
                />
              </label>
              {uploadStatus ? <p className="mt-3 text-sm font-bold text-muted-foreground">{uploadStatus}</p> : null}
            </section>
            <QrScanner title="Pickup QR Scanner" onScan={(token) => scanPickup(token).catch((caught) => setError(caught instanceof Error ? caught.message : "Scan failed"))} />
          </div>
        </div>
      </section>
    </AppShell>
  );
}

function RouteStepper({ status }: { status: WasteBatch["status"] }) {
  const steps = ["assigned", "picked_up", "in_transit", "delivered"];
  const index = steps.indexOf(status);
  return (
    <div className="mt-3 grid grid-cols-4 gap-2 text-xs font-bold">
      {["Pickup", "Scanned", "Transit", "Delivered"].map((label, stepIndex) => (
        <span className={`rounded-md px-2 py-1 text-center ${stepIndex <= index ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`} key={label}>
          {label}
        </span>
      ))}
    </div>
  );
}

function currentPosition(): Promise<GeolocationPosition | null> {
  if (!navigator.geolocation) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
      enableHighAccuracy: true,
      timeout: 6000
    });
  });
}
