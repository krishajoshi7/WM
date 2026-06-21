import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

loadDotEnv(".env.local");
loadDotEnv(".env");

const port = Number(process.env.PRODUCTION_SMOKE_PORT || 3220);
const baseUrl = `http://127.0.0.1:${port}`;
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const timeoutMs = 60_000;
const runId = `prod-smoke-${Date.now()}`;
const password = `Smoke-${crypto.randomUUID()}-Aa1!`;
const createdUserIds = [];
let batchId = null;
let server = null;

requireEnv("NEXT_PUBLIC_SUPABASE_URL");
requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");
requireEnv("JWT_SECRET");
requireEnv("NEXT_PUBLIC_APP_URL");

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const anonSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

try {
  server = spawn(process.execPath, [nextBin, "dev", "-p", String(port)], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "development",
      SUSTAINABLE_ECG_SMOKE_MODE: "",
      NEXT_PUBLIC_APP_URL: baseUrl
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  server.stdout.on("data", (chunk) => process.stdout.write(`[next] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));

  await waitForServer();

  const health = await fetch(`${baseUrl}/api/health`);
  assert(health.ok, `Health check should pass with real Supabase config, received ${health.status}: ${await health.text()}`);

  const users = {
    generator: await createSmokeUser("generator"),
    collector: await createSmokeUser("collector"),
    recycler: await createSmokeUser("recycler"),
    admin: await createSmokeUser("admin")
  };

  const batchImage = await uploadEvidence(users.generator.token, "batch-image", "batch-image.jpg");
  const batch = await createBatch(users.generator.token, batchImage.publicUrl);
  batchId = batch.id;

  await acceptPickup(users.collector.token, batch.id);
  await assertBatchStatus(users.admin.token, batch.id, "assigned");

  const pickupPhoto = await uploadEvidence(users.collector.token, "custody-photo", "pickup-proof.jpg");
  await scan(users.collector.token, batch.batch_code, "pickup_scanned", pickupPhoto.publicUrl);
  await assertBatchStatus(users.admin.token, batch.id, "picked_up");

  await scan(users.collector.token, batch.batch_code, "in_transit");
  await assertBatchStatus(users.admin.token, batch.id, "in_transit");

  const deliveryPhoto = await uploadEvidence(users.recycler.token, "custody-photo", "delivery-proof.jpg");
  await scan(users.recycler.token, batch.batch_code, "delivered", deliveryPhoto.publicUrl);
  await assertBatchStatus(users.admin.token, batch.id, "delivered");

  await recycle(users.recycler.token, batch.id, batch.weight_kg);
  await assertBatchStatus(users.admin.token, batch.id, "recycled");

  const audit = await api("/api/audit", users.admin.token);
  const batchEvents = audit.events.filter((event) => event.batch_id === batch.id);
  const eventTypes = batchEvents.map((event) => event.event_type);

  for (const expected of ["qr_generated", "pickup_accepted", "pickup_scanned", "in_transit", "delivered", "recycled"]) {
    assert(eventTypes.includes(expected), `Audit trail should include ${expected}`);
  }

  assert(
    batchEvents.some((event) => event.photo_url === pickupPhoto.publicUrl),
    "Pickup custody event should include real Supabase photo URL"
  );
  assert(
    batchEvents.some((event) => event.photo_url === deliveryPhoto.publicUrl),
    "Delivery custody event should include real Supabase photo URL"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        run_id: runId,
        batch_code: batch.batch_code,
        batch_id: batch.id,
        users_created: createdUserIds.length,
        storage_checked: true,
        health_checked: true
      },
      null,
      2
    )
  );
} finally {
  await stopServer();
  await cleanup();
}

async function createSmokeUser(role) {
  const email = `${runId}-${role}@example.com`;
  const company = `Sustainable ECG ${role} smoke`;
  const { data, error } = await adminSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      role,
      company_name: company
    }
  });

  if (error || !data.user) {
    throw error || new Error(`Unable to create ${role} smoke user`);
  }

  createdUserIds.push(data.user.id);

  const { error: profileError } = await adminSupabase.from("profiles").upsert({
    id: data.user.id,
    role,
    company_name: company,
    phone: "+91 90000 00000",
    gst_number: null,
    status: "approved"
  });

  if (profileError) {
    throw profileError;
  }

  const { data: session, error: signInError } = await anonSupabase.auth.signInWithPassword({
    email,
    password
  });

  if (signInError || !session.session?.access_token) {
    throw signInError || new Error(`Unable to sign in ${role} smoke user`);
  }

  return {
    id: data.user.id,
    email,
    token: session.session.access_token
  };
}

async function uploadEvidence(token, purpose, fileName) {
  const signed = await api(
    "/api/uploads/signed-url",
    token,
    {
      method: "POST",
      body: {
        file_name: fileName,
        content_type: "image/jpeg",
        file_size: 633,
        purpose
      }
    }
  );
  const imageBlob = new Blob([tinyJpegBytes()], { type: "image/jpeg" });
  const { error } = await anonSupabase.storage
    .from("batch-images")
    .uploadToSignedUrl(signed.path, signed.token, imageBlob);

  if (error) {
    throw error;
  }

  return signed;
}

async function createBatch(token, imageUrl) {
  const form = new FormData();
  form.set("waste_type", "plastic");
  form.set("category", "PWM-CAT-I");
  form.set("weight_kg", "12.5");
  form.set("pickup_address", `Production smoke facility ${runId}, Bengaluru`);
  form.set("pickup_date", new Date().toISOString().slice(0, 10));
  form.append("image_urls", imageUrl);

  const result = await api("/api/batches", token, {
    method: "POST",
    body: form
  });

  assert(result.qrDataUrl?.startsWith("data:image/png;base64,"), "QR image should be returned");
  assert(result.batch.images?.includes(imageUrl), "Batch should persist storage image URL");

  return result.batch;
}

async function acceptPickup(token, id) {
  await api("/api/pickups", token, {
    method: "POST",
    body: {
      batch_id: id,
      status: "accepted",
      estimated_pickup: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    }
  });
}

async function scan(token, identifier, eventType, photoUrl = null) {
  await api("/api/scans", token, {
    method: "POST",
    body: {
      qr_token: identifier,
      qr_identifier: identifier,
      event_type: eventType,
      location_lat: 12.9716,
      location_lng: 77.5946,
      photo_url: photoUrl,
      notes: `Production smoke ${eventType}`
    }
  });
}

async function recycle(token, id, quantityKg) {
  await api("/api/recycling", token, {
    method: "POST",
    body: {
      batch_id: id,
      material_type: "plastic",
      quantity_kg: quantityKg,
      recycling_method: "Production smoke mechanical recycling",
      epr_credits_claimed: quantityKg,
      report_url: ""
    }
  });
}

async function assertBatchStatus(token, id, status) {
  const result = await api("/api/batches", token);
  const batch = result.batches.find((item) => item.id === id);

  assert(batch, `Batch ${id} should be visible`);
  assert(batch.status === status, `Expected ${status}, received ${batch.status}`);
}

async function api(path, token, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);

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
    throw new Error(`${options.method || "GET"} ${path} failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
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

async function cleanup() {
  if (batchId) {
    await adminSupabase.from("recycling_logs").delete().eq("batch_id", batchId);
    await adminSupabase.from("pickup_requests").delete().eq("batch_id", batchId);
    await adminSupabase.from("custody_events").delete().eq("batch_id", batchId);
    await adminSupabase.from("webhook_deliveries").delete().eq("batch_id", batchId);
    await adminSupabase.from("waste_batches").delete().eq("id", batchId);
  }

  for (const userId of createdUserIds.reverse()) {
    await adminSupabase.from("profiles").delete().eq("id", userId);
    await adminSupabase.auth.admin.deleteUser(userId);
  }
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

function loadDotEnv(fileName) {
  if (!existsSync(fileName)) {
    return;
  }

  for (const line of readFileSync(fileName, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const [key, ...valueParts] = trimmed.split("=");

    if (Object.prototype.hasOwnProperty.call(process.env, key)) {
      continue;
    }

    process.env[key] = valueParts.join("=").replace(/^['"]|['"]$/g, "");
  }
}

function requireEnv(name) {
  if (!process.env[name]) {
    throw new Error(`${name} is required for production smoke`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function tinyJpegBytes() {
  return Uint8Array.from([
    255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1, 0, 72, 0, 72, 0, 0,
    255, 219, 0, 67, 0, 8, 6, 6, 7, 6, 5, 8, 7, 7, 7, 9, 9, 8, 10, 12, 20,
    13, 12, 11, 11, 12, 25, 18, 19, 15, 20, 29, 26, 31, 30, 29, 26, 28, 28,
    32, 36, 46, 39, 32, 34, 44, 35, 28, 28, 40, 55, 41, 44, 48, 49, 52, 52,
    52, 31, 39, 57, 61, 56, 50, 60, 46, 51, 52, 50, 255, 192, 0, 17, 8, 0,
    1, 0, 1, 3, 1, 34, 0, 2, 17, 1, 3, 17, 1, 255, 196, 0, 20, 0, 1, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 255, 196, 0, 20, 16, 1, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 218, 0, 12, 3, 1,
    0, 2, 17, 3, 17, 0, 63, 0, 170, 255, 217
  ]);
}
