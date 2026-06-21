import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type HealthStatus = "pass" | "warn" | "fail";

type HealthCheck = {
  name: string;
  status: HealthStatus;
  message: string;
  durationMs?: number;
};

const requiredEnvVars = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "JWT_SECRET",
  "NEXT_PUBLIC_APP_URL"
];

const optionalEnvVars = ["EPR_WEBHOOK_URL", "WEBHOOK_CRON_SECRET", "OPS_ALERT_WEBHOOK_URL"];

const criticalTables = [
  "profiles",
  "waste_batches",
  "custody_events",
  "pickup_requests",
  "recycling_logs",
  "webhook_deliveries",
  "admin_audit_logs"
];

const storageBucket = "batch-images";

export async function GET() {
  const startedAt = Date.now();
  const checks: HealthCheck[] = [];

  checks.push(...checkEnvironment());

  if (hasRequiredEnv()) {
    const supabase = createHealthSupabaseClient();

    checks.push(await checkSupabaseDatabase(supabase));
    checks.push(...(await checkCriticalTables(supabase)));
    checks.push(await checkCustodyEvidenceConstraints(supabase));
    checks.push(await checkStorageBucket(supabase));
  } else {
    checks.push({
      name: "supabase",
      status: "fail",
      message: "Skipped because required Supabase environment variables are missing"
    });
  }

  const failed = checks.some((check) => check.status === "fail");
  const warned = checks.some((check) => check.status === "warn");
  const status = failed ? "fail" : warned ? "warn" : "pass";

  return NextResponse.json(
    {
      service: "sustainable-ecg",
      status,
      ready: !failed,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      checks
    },
    { status: failed ? 503 : 200 }
  );
}

export async function HEAD() {
  const response = await GET();
  return new NextResponse(null, { status: response.status });
}

function checkEnvironment() {
  const checks: HealthCheck[] = requiredEnvVars.map((name) => ({
    name: `env:${name}`,
    status: process.env[name] ? "pass" : "fail",
    message: process.env[name] ? "Configured" : "Missing required environment variable"
  }));

  checks.push(
    ...optionalEnvVars.map((name): HealthCheck => {
      const configured = Boolean(process.env[name]);

      return {
        name: `env:${name}`,
        status: configured ? "pass" : "warn",
        message: configured
          ? "Configured"
          : "Optional; required only when EPR webhook delivery is enabled"
      };
    })
  );

  if (process.env.EPR_WEBHOOK_URL && !process.env.WEBHOOK_CRON_SECRET) {
    checks.push({
      name: "env:webhook-retry-secret",
      status: "fail",
      message: "WEBHOOK_CRON_SECRET is required when EPR_WEBHOOK_URL is configured"
    });
  }

  if (process.env.SUSTAINABLE_ECG_SMOKE_MODE === "true") {
    checks.push({
      name: "env:smoke-mode",
      status: process.env.NODE_ENV === "production" ? "fail" : "warn",
      message: "Smoke mode bypasses Supabase and must not be enabled in production"
    });
  }

  return checks;
}

function hasRequiredEnv() {
  return requiredEnvVars.every((name) => Boolean(process.env[name]));
}

function createHealthSupabaseClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

async function checkSupabaseDatabase(
  supabase: ReturnType<typeof createHealthSupabaseClient>
): Promise<HealthCheck> {
  const startedAt = Date.now();
  const { error } = await supabase.from("profiles").select("id", { head: true, count: "exact" });

  return {
    name: "supabase:database",
    status: error ? "fail" : "pass",
    message: error ? error.message : "Connected with service role",
    durationMs: Date.now() - startedAt
  };
}

async function checkCriticalTables(supabase: ReturnType<typeof createHealthSupabaseClient>) {
  return Promise.all(
    criticalTables.map(async (tableName): Promise<HealthCheck> => {
      const startedAt = Date.now();
      const { error } = await supabase
        .from(tableName)
        .select("id", { head: true, count: "exact" });

      return {
        name: `table:${tableName}`,
        status: error ? "fail" : "pass",
        message: error ? error.message : "Available",
        durationMs: Date.now() - startedAt
      };
    })
  );
}

async function checkStorageBucket(
  supabase: ReturnType<typeof createHealthSupabaseClient>
): Promise<HealthCheck> {
  const startedAt = Date.now();
  const { data, error } = await supabase.storage.getBucket(storageBucket);

  return {
    name: `storage:${storageBucket}`,
    status: error || !data ? "fail" : "pass",
    message: error ? error.message : data?.public ? "Bucket available and public" : "Bucket available",
    durationMs: Date.now() - startedAt
  };
}

async function checkCustodyEvidenceConstraints(
  supabase: ReturnType<typeof createHealthSupabaseClient>
): Promise<HealthCheck> {
  const startedAt = Date.now();
  const { data, error } = await supabase.rpc("health_check_custody_evidence_constraints");

  if (error) {
    return {
      name: "constraints:custody-evidence",
      status: "fail",
      message: error.message,
      durationMs: Date.now() - startedAt
    };
  }

  const found = new Set((data || []) as string[]);
  const missing = [
    "custody_events_photo_required_for_handoff",
    "custody_events_weight_verified_positive",
    "custody_events_gps_pair"
  ].filter((name) => !found.has(name));

  return {
    name: "constraints:custody-evidence",
    status: missing.length ? "fail" : "pass",
    message: missing.length ? `Missing constraints: ${missing.join(", ")}` : "Evidence constraints available",
    durationMs: Date.now() - startedAt
  };
}
