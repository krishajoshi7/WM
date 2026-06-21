"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Download, Printer, QrCode, UploadCloud } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch } from "@/lib/api-client";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import type { WasteBatch, WasteType } from "@/lib/types";
import { uploadEvidenceImages } from "@/lib/uploads";
import { formatKg } from "@/lib/utils";
import {
  getDefaultCategoryCode,
  getWasteCategoryLabel,
  wasteCategoryOptions
} from "@/lib/waste-categories";

export default function GeneratorDashboard() {
  const [batches, setBatches] = useState<WasteBatch[]>([]);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrBatch, setQrBatch] = useState<WasteBatch | null>(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedImageCount, setSelectedImageCount] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("");
  const [selectedWasteType, setSelectedWasteType] = useState<WasteType>("plastic");
  const [selectedCategory, setSelectedCategory] = useState(getDefaultCategoryCode("plastic"));

  const loadBatches = useCallback(async () => {
    const data = await apiFetch<{ batches: WasteBatch[] }>("/api/batches", {
      role: "generator"
    });
    setBatches(data.batches);
  }, []);

  useEffect(() => {
    loadBatches().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Unable to load batches")
    );

    // Realtime gives instant updates after collector/recycler actions; polling
    // remains as a fallback for local dev or disabled realtime.
    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      ?.channel("generator-waste-batches")
      .on("postgres_changes", { event: "*", schema: "public", table: "waste_batches" }, () => {
        loadBatches().catch(() => undefined);
      })
      .subscribe();
    const interval = window.setInterval(() => {
      loadBatches().catch(() => undefined);
    }, 5000);
    return () => {
      window.clearInterval(interval);
      if (channel) {
        supabase?.removeChannel(channel);
      }
    };
  }, [loadBatches]);

  const analytics = useMemo(() => {
    const totalKg = batches.reduce((sum, batch) => sum + Number(batch.weight_kg), 0);
    const recycledKg = batches
      .filter((batch) => batch.status === "recycled")
      .reduce((sum, batch) => sum + Number(batch.weight_kg), 0);
    return {
      totalBatches: batches.length,
      totalKg,
      recycledPercent: totalKg ? Math.round((recycledKg / totalKg) * 100) : 0,
      pending: batches.filter((batch) => ["pending", "assigned"].includes(batch.status)).length
    };
  }, [batches]);

  async function createBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    setUploadStatus("");

    try {
      const formElement = event.currentTarget;
      const form = new FormData(formElement);
      const imageFiles = form
        .getAll("images")
        .filter((value): value is File => value instanceof File && value.size > 0);

      form.delete("images");

      if (imageFiles.length > 0) {
        setUploadStatus(`Uploading ${imageFiles.length} evidence image${imageFiles.length === 1 ? "" : "s"}...`);
        const imageUrls = await uploadEvidenceImages({
          files: imageFiles,
          purpose: "batch-image",
          role: "generator"
        });

        imageUrls.forEach((url) => form.append("image_urls", url));
        setUploadStatus("Evidence images uploaded.");
      }

      const data = await apiFetch<{ batch: WasteBatch; qrDataUrl: string }>("/api/batches", {
        method: "POST",
        body: form,
        role: "generator"
      });
      setQrBatch(data.batch);
      setQrDataUrl(data.qrDataUrl);
      await loadBatches();
      formElement.reset();
      setSelectedWasteType("plastic");
      setSelectedCategory(getDefaultCategoryCode("plastic"));
      setSelectedImageCount(0);
      setUploadStatus("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Batch creation failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AppShell role="Generator">
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <p className="text-sm font-black uppercase tracking-[0.16em] text-primary">
            Generator Dashboard
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-normal">
            Create waste batches and print custody QR labels
          </h1>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard label="Total batches" value={analytics.totalBatches} />
          <MetricCard label="Total waste" value={formatKg(analytics.totalKg)} />
          <MetricCard label="Recycled" value={`${analytics.recycledPercent}%`} />
          <MetricCard label="Pending pickups" value={analytics.pending} />
        </div>

        {error ? (
          <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm font-bold text-destructive">
            {error}
          </div>
        ) : null}

        <div className="mt-8 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <form className="rounded-lg border border-border bg-card p-5 shadow-operational" onSubmit={createBatch}>
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black">Create Waste Batch</h2>
                <p className="text-sm text-muted-foreground">Generates batch code, signed JWT, and printable QR.</p>
              </div>
              <QrCode className="h-6 w-6 text-primary" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                Waste type
                <select
                  name="waste_type"
                  onChange={(event) => {
                    const nextType = event.target.value as WasteType;
                    setSelectedWasteType(nextType);
                    setSelectedCategory(getDefaultCategoryCode(nextType));
                  }}
                  required
                  value={selectedWasteType}
                >
                  <option value="plastic">Plastic</option>
                  <option value="e-waste">E-waste</option>
                  <option value="metal">Metal</option>
                  <option value="glass">Glass</option>
                  <option value="organic">Organic</option>
                </select>
              </label>
              <label>
                Compliance category
                <select
                  name="category"
                  onChange={(event) => setSelectedCategory(event.target.value)}
                  required
                  value={selectedCategory}
                >
                  {wasteCategoryOptions[selectedWasteType].map((category) => (
                    <option key={category.code} value={category.code}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground sm:col-span-2">
                {
                  wasteCategoryOptions[selectedWasteType].find(
                    (category) => category.code === selectedCategory
                  )?.description
                }
              </div>
              <label>
                Weight kg
                <input min="0.1" name="weight_kg" required step="0.1" type="number" defaultValue="240" />
              </label>
              <label>
                Pickup date
                <input name="pickup_date" required type="date" defaultValue="2026-05-15" />
              </label>
              <label className="sm:col-span-2">
                Pickup address
                <textarea name="pickup_address" required defaultValue="Plot 42, Peenya Industrial Area, Bengaluru, Karnataka" />
              </label>
              <label className="sm:col-span-2">
                Waste images
                <span className="flex min-h-24 items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted text-sm font-bold text-muted-foreground">
                  <UploadCloud className="h-5 w-5" />
                  {selectedImageCount > 0
                    ? `${selectedImageCount} image${selectedImageCount === 1 ? "" : "s"} selected`
                    : "Upload images"}
                </span>
                <input
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  multiple
                  name="images"
                  onChange={(event) => {
                    setSelectedImageCount(event.target.files?.length || 0);
                    setUploadStatus("");
                  }}
                  type="file"
                />
              </label>
            </div>
            {uploadStatus ? (
              <p className="mt-3 text-sm font-bold text-muted-foreground">{uploadStatus}</p>
            ) : null}
            <button
              className="mt-5 min-h-11 w-full rounded-md bg-primary px-4 font-black text-primary-foreground"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? "Creating batch..." : "Generate QR batch"}
            </button>
          </form>

          <section className="rounded-lg border border-border bg-card shadow-operational">
            <div className="border-b border-border p-5">
              <h2 className="text-xl font-black">Waste Listings</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="p-3">Batch</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Category</th>
                    <th className="p-3">Weight</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Date</th>
                    <th className="p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch) => (
                    <tr className="border-t border-border" key={batch.id}>
                      <td className="p-3 font-black">{batch.batch_code}</td>
                      <td className="p-3 capitalize">{batch.waste_type}</td>
                      <td className="p-3">{getWasteCategoryLabel(batch.category)}</td>
                      <td className="p-3">{formatKg(batch.weight_kg)}</td>
                      <td className="p-3"><StatusBadge status={batch.status} /></td>
                      <td className="p-3">{batch.pickup_date}</td>
                      <td className="p-3">
                        <button
                          className="rounded-md border border-border px-3 py-2 font-bold"
                          onClick={() => {
                            setQrBatch(batch);
                            setQrDataUrl("");
                          }}
                          type="button"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>

      {qrBatch ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <section className="w-full max-w-md rounded-lg bg-card p-6 shadow-operational">
            <h2 className="text-2xl font-black">Printable QR label</h2>
            <p className="mt-1 text-sm text-muted-foreground">{qrBatch.batch_code}</p>
            {qrDataUrl ? (
              <img alt={`QR code for ${qrBatch.batch_code}`} className="mx-auto mt-5 h-72 w-72" src={qrDataUrl} />
            ) : (
              <div className="mt-5 rounded-md bg-muted p-4 text-sm text-muted-foreground">
                QR image is generated during creation. The printed QR encodes only the short batch code.
              </div>
            )}
            <div className="mt-4 rounded-md border border-border bg-muted p-3 text-center">
              <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">QR payload</span>
              <strong className="mt-1 block text-lg">{qrBatch.batch_code}</strong>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <button className="rounded-md border border-border px-3 py-2 font-bold" onClick={() => window.print()} type="button">
                <Printer className="mx-auto h-4 w-4" />
              </button>
              <a className="inline-flex items-center justify-center rounded-md border border-border px-3 py-2 font-bold" href={qrDataUrl || "#"} download={`${qrBatch.batch_code}.png`}>
                <Download className="h-4 w-4" />
              </a>
              <button className="rounded-md bg-primary px-3 py-2 font-bold text-primary-foreground" onClick={() => setQrBatch(null)} type="button">
                Close
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
