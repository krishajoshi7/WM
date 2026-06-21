import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const port = Number(process.env.SMOKE_PORT || 3210);
const baseUrl = `http://127.0.0.1:${port}`;
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const timeoutMs = 45_000;

let server;

try {
  // Start a temporary Next server so the test exercises real HTTP routes.
  server = spawn(process.execPath, [nextBin, "dev", "-p", String(port)], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "development",
      SUSTAINABLE_ECG_SMOKE_MODE: "true",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      JWT_SECRET: "golden-flow-smoke-secret",
      EPR_WEBHOOK_URL: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  server.stdout.on("data", (chunk) => process.stdout.write(`[next] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));

  await waitForServer();

  // This is the investor-demo path compressed into assertions.
  const batch = await createBatch();
  assert(batch.batch_code.startsWith("WM-"), "Batch code should be generated");
  assert(batch.qr_token, "Server-side signed QR token should be stored");

  await acceptPickup(batch.id);
  await assertBatchStatus(batch.id, "assigned");

  const pickupPhoto = await createSignedUploadUrl("collector", "custody-photo", "pickup-proof.jpg");
  await scan(batch.batch_code, "pickup_scanned", "collector", pickupPhoto.publicUrl);
  await assertBatchStatus(batch.id, "picked_up");

  await scan(batch.batch_code, "in_transit", "collector");
  await assertBatchStatus(batch.id, "in_transit");

  const deliveryPhoto = await createSignedUploadUrl("recycler", "custody-photo", "delivery-proof.jpg");
  await scan(batch.batch_code, "delivered", "recycler", deliveryPhoto.publicUrl);
  await assertBatchStatus(batch.id, "delivered");

  await recycle(batch.id, batch.weight_kg);
  await assertBatchStatus(batch.id, "recycled");

  const audit = await api("/api/audit", { role: "admin" });
  const eventTypes = audit.events
    .filter((event) => event.batch_id === batch.id)
    .map((event) => event.event_type);

  for (const expected of ["qr_generated", "pickup_accepted", "pickup_scanned", "in_transit", "delivered", "recycled"]) {
    assert(eventTypes.includes(expected), `Audit trail should include ${expected}`);
  }

  assert(
    audit.events.some((event) => event.batch_id === batch.id && event.photo_url === pickupPhoto.publicUrl),
    "Pickup custody event should include photo proof"
  );
  assert(
    audit.events.some((event) => event.batch_id === batch.id && event.photo_url === deliveryPhoto.publicUrl),
    "Delivery custody event should include photo proof"
  );
  await assertEvidencePdf(batch.id);

  console.log(`\nGolden flow smoke test passed for ${batch.batch_code}`);
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
  const evidenceImage = await createSignedUploadUrl("generator", "batch-image", "smoke-evidence.jpg");

  form.set("waste_type", "plastic");
  form.set("category", "PWM-CAT-I");
  form.set("weight_kg", "128.5");
  form.set("pickup_address", "Smoke Test Facility, Peenya Industrial Area, Bengaluru");
  form.set("pickup_date", new Date().toISOString().slice(0, 10));
  form.append("image_urls", evidenceImage.publicUrl);

  const result = await api("/api/batches", {
    method: "POST",
    role: "generator",
    body: form
  });

  assert(result.qrDataUrl?.startsWith("data:image/png;base64,"), "QR image should be rendered as a PNG data URL");
  assert(result.batch.images?.includes(evidenceImage.publicUrl), "Batch should persist signed upload public URLs");

  return result.batch;
}

async function createSignedUploadUrl(role, purpose, fileName) {
  const upload = await api("/api/uploads/signed-url", {
    method: "POST",
    role,
    body: {
      file_name: fileName,
      content_type: "image/jpeg",
      file_size: 1024,
      purpose
    }
  });

  assert(upload.skipped === true, "Smoke mode should skip real Supabase Storage upload");
  assert(upload.publicUrl?.includes("/local-uploads/"), "Signed upload endpoint should return a durable URL placeholder");

  return upload;
}

async function acceptPickup(batchId) {
  await api("/api/pickups", {
    method: "POST",
    role: "collector",
    body: {
      batch_id: batchId,
      status: "accepted",
      estimated_pickup: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    }
  });
}

async function scan(identifier, eventType, role, photoUrl = null) {
  await api("/api/scans", {
    method: "POST",
    role,
    body: {
      qr_token: identifier,
      qr_identifier: identifier,
      event_type: eventType,
      location_lat: 12.9716,
      location_lng: 77.5946,
      photo_url: photoUrl,
      notes: `Golden flow ${eventType}`
    }
  });
}

async function recycle(batchId, quantityKg) {
  await api("/api/recycling", {
    method: "POST",
    role: "recycler",
    body: {
      batch_id: batchId,
      material_type: "plastic",
      quantity_kg: quantityKg,
      recycling_method: "Golden flow mechanical recycling",
      epr_credits_claimed: quantityKg,
      report_url: ""
    }
  });
}

async function assertBatchStatus(batchId, status) {
  const result = await api("/api/batches", { role: "admin" });
  const batch = result.batches.find((item) => item.id === batchId);

  assert(batch, `Batch ${batchId} should be visible to admin`);
  assert(batch.status === status, `Expected ${status}, received ${batch.status}`);
}

async function assertEvidencePdf(batchId) {
  const response = await fetch(`${baseUrl}/api/admin/batches/${batchId}/evidence.pdf`, {
    headers: {
      "x-dev-role": "admin"
    }
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const header = new TextDecoder().decode(bytes.slice(0, 8));

  assert(response.ok, `Evidence PDF should download, received ${response.status}`);
  assert(response.headers.get("content-type")?.includes("application/pdf"), "Evidence PDF should use application/pdf");
  assert(header.startsWith("%PDF-"), "Evidence PDF should have a PDF header");
}

async function api(path, options = {}) {
  const headers = new Headers();

  if (options.role) {
    headers.set("x-dev-role", options.role);
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
    throw new Error(`${options.method || "GET"} ${path} failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
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
