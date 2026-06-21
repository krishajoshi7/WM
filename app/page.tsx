import Link from "next/link";
import { ArrowRight, BadgeCheck, Factory, QrCode, Recycle, ShieldCheck, Truck, type LucideIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { MetricCard } from "@/components/metric-card";
import { computeMetrics } from "@/lib/demo-store";
import { hasSupabaseConfig } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { WasteBatch } from "@/lib/types";
import { formatKg } from "@/lib/utils";

const stakeholders = [
  ["Generator", "Create waste batches, upload proof, print signed QR labels, and track custody live."],
  ["Collector", "Accept pickups, scan QR at source, capture GPS/photo evidence, and move batches into transit."],
  ["Recycler", "Verify delivery, record recycling outputs, claim EPR credits, and trigger portal webhooks."],
  ["Admin", "Approve operators, inspect custody trails, search batches, and monitor compliance risk."]
];

const pipeline: Array<[string, LucideIcon]> = [
  ["Generator", Factory],
  ["Signed QR", QrCode],
  ["Collector", Truck],
  ["Recycler", Recycle],
  ["EPR Compliance", ShieldCheck]
];

export default async function Home() {
  const metrics = await getLandingMetrics();

  return (
    <AppShell>
      <section className="hero-image">
        <div className="mx-auto grid min-h-[82vh] max-w-7xl items-center gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1.08fr_0.92fr] lg:px-8">
          <div className="max-w-3xl text-white">
            <p className="text-sm font-black uppercase tracking-[0.16em] text-emerald-200">
              Indian EPR traceability platform
            </p>
            <h1 className="mt-4 text-5xl font-black leading-none tracking-normal sm:text-7xl">
              Digitizing Waste Traceability & EPR Compliance
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-white/85">
              Sustainable ECG creates signed QR identities for every waste batch,
              records custody evidence at each handoff, and turns recycling logs
              into an auditable EPR compliance trail.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {["generator", "collector", "recycler", "admin"].map((role) => (
                <Link
                  className="inline-flex min-h-11 items-center gap-2 rounded-md bg-white px-4 text-sm font-black capitalize text-primary"
                  href={`/auth?role=${role}`}
                  key={role}
                >
                  Login as {role}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-white/20 bg-white/14 p-5 text-white shadow-operational backdrop-blur">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 animate-pulse rounded-full bg-emerald-300" />
              <strong>Live compliance metrics</strong>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <MetricCard label="Batches" value={metrics.totalBatches} />
              <MetricCard label="Waste traced" value={formatKg(metrics.totalKg)} />
              <MetricCard label="Recycled" value={formatKg(metrics.recycledKg)} />
              <MetricCard label="Pending pickup" value={metrics.pendingPickups} />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-4 md:grid-cols-5">
          {pipeline.map(([label, Icon]) => (
            <article className="pipeline-node relative rounded-lg border border-border bg-card p-4 shadow-operational" key={label}>
              <Icon className="mb-4 h-8 w-8 text-primary" />
              <strong>{label}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-muted py-14">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 sm:px-6 md:grid-cols-4 lg:px-8">
          {stakeholders.map(([title, body]) => (
            <article className="rounded-lg border border-border bg-card p-5 shadow-operational" key={title}>
              <BadgeCheck className="mb-4 h-6 w-6 text-primary" />
              <h2 className="text-xl font-black">{title}</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <p className="text-sm font-black uppercase tracking-[0.16em] text-primary">
            How it works
          </p>
          <h2 className="mt-3 text-4xl font-black tracking-normal">
            The custody chain is the legal backbone.
          </h2>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-5">
          {[
            "Generator submits batch",
            "JWT-signed QR is printed",
            "Collector scans at pickup",
            "Recycler verifies delivery",
            "Recycling log posts EPR payload"
          ].map((step, index) => (
            <article className="rounded-lg border border-border bg-card p-4" key={step}>
              <span className="text-sm font-black text-accent">0{index + 1}</span>
              <h3 className="mt-3 font-black">{step}</h3>
            </article>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

async function getLandingMetrics() {
  if (!hasSupabaseConfig() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return computeMetrics();
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase.from("waste_batches").select("*");
    return computeMetrics((data || []) as WasteBatch[]);
  } catch {
    return computeMetrics();
  }
}
