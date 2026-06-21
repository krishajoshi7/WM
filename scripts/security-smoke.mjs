import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const port = Number(process.env.SECURITY_SMOKE_PORT || 3211);
const baseUrl = `http://127.0.0.1:${port}`;
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const timeoutMs = 45_000;

let server;

try {
  server = spawn(process.execPath, [nextBin, "dev", "-p", String(port)], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "development",
      SUSTAINABLE_ECG_SMOKE_MODE: "true",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      JWT_SECRET: "security-smoke-secret",
      EPR_WEBHOOK_URL: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  server.stdout.on("data", (chunk) => process.stdout.write(`[next] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));

  await waitForServer();

  const batch = await createBatch();

  await expectFailure(
    () =>
      api("/api/pickups", {
        method: "POST",
        role: "generator",
        body: {
          batch_id: batch.id,
          status: "accepted"
        }
      }),
    403,
    "wrong role cannot accept pickup"
  );

  await expectFailure(
    () =>
      api("/api/scans", {
        method: "POST",
        role: "collector",
        body: {
          qr_token: "WM-DOES-NOT-EXIST",
          qr_identifier: "WM-DOES-NOT-EXIST",
          event_type: "pickup_scanned"
        }
      }),
    404,
    "invalid QR identifier is rejected"
  );

  await expectFailure(
    () =>
      api("/api/scans", {
        method: "POST",
        role: "collector",
        body: {
          qr_token: batch.batch_code,
          qr_identifier: batch.batch_code,
          event_type: "pickup_scanned"
        }
      }),
    409,
    "pickup scan before accepted pickup is rejected"
  );

  await expectFailure(
    () =>
      api("/api/recycling", {
        method: "POST",
        role: "recycler",
        body: {
          batch_id: batch.id,
          material_type: "plastic",
          quantity_kg: batch.weight_kg,
          recycling_method: "Invalid direct recycle attempt",
          epr_credits_claimed: batch.weight_kg
        }
      }),
    409,
    "recycling before delivery is rejected"
  );

  await expectFailure(
    () =>
      api("/api/batches", {
        method: "GET",
        role: "collector",
        status: "suspended"
      }),
    403,
    "suspended user is rejected"
  );

  await api("/api/pickups", {
    method: "POST",
    role: "collector",
    body: {
      batch_id: batch.id,
      status: "accepted",
      estimated_pickup: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    }
  });
  await expectFailure(
    () =>
      api("/api/scans", {
        method: "POST",
        role: "collector",
        body: {
          qr_token: batch.batch_code,
          qr_identifier: batch.batch_code,
          event_type: "pickup_scanned"
        }
      }),
    400,
    "pickup scan without photo proof is rejected"
  );

  await api("/api/scans", {
    method: "POST",
    role: "collector",
    body: {
      qr_token: batch.batch_code,
      qr_identifier: batch.batch_code,
      event_type: "pickup_scanned",
      photo_url: "/local-uploads/security-pickup-proof.jpg"
    }
  });

  await expectFailure(
    () =>
      api("/api/scans", {
        method: "POST",
        role: "recycler",
        body: {
          qr_token: batch.batch_code,
          qr_identifier: batch.batch_code,
          event_type: "delivered"
        }
      }),
    409,
    "delivery before in_transit is rejected"
  );

  console.log("\nSecurity smoke test passed");
} finally {
  await stopServer();
}

async function waitForServer() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (server.exitCode !== null) {
      throw new Error(`Next server exited early with code ${server.exitCode}`);
    }

    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        return;
      }
    } catch {
      await delay(750);
    }
  }

  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function createBatch() {
  const form = new FormData();
  form.set("waste_type", "plastic");
  form.set("category", "PWM-CAT-I");
  form.set("weight_kg", "72");
  form.set("pickup_address", "Security Smoke Facility, Bengaluru");
  form.set("pickup_date", new Date().toISOString().slice(0, 10));

  const result = await api("/api/batches", {
    method: "POST",
    role: "generator",
    body: form
  });

  return result.batch;
}

async function expectFailure(operation, expectedStatus, label) {
  try {
    await operation();
  } catch (error) {
    if (error?.status === expectedStatus) {
      console.log(`✓ ${label}`);
      return;
    }

    throw new Error(`${label}: expected ${expectedStatus}, received ${error?.status || error}`);
  }

  throw new Error(`${label}: expected request to fail`);
}

async function api(path, options = {}) {
  const headers = new Headers();

  if (options.role) {
    headers.set("x-dev-role", options.role);
  }

  if (options.status) {
    headers.set("x-dev-status", options.status);
  }

  let body = options.body;

  if (body && !(body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
    body
  });

  if (!response.ok) {
    const error = new Error(await response.text());
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function stopServer() {
  if (!server || server.exitCode !== null) {
    return;
  }

  server.kill("SIGTERM");

  try {
    await once(server, "exit");
  } catch {
    server.kill("SIGKILL");
  }
}
