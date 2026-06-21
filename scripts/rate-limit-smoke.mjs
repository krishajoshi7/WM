import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const port = Number(process.env.RATE_LIMIT_SMOKE_PORT || 3213);
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
      JWT_SECRET: "rate-limit-smoke-secret",
      EPR_WEBHOOK_URL: "",
      WEBHOOK_CRON_SECRET: "",
      NEXT_PUBLIC_APP_URL: "http://localhost:3213"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  server.stdout.on("data", (chunk) => process.stdout.write(`[next] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));

  await waitForServer();

  let limitedResponse = null;

  for (let index = 0; index < 31; index += 1) {
    const response = await fetch(`${baseUrl}/api/uploads/signed-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-dev-role": "generator"
      },
      body: JSON.stringify({
        file_name: `rate-limit-${index}.jpg`,
        content_type: "image/jpeg",
        file_size: 1024,
        purpose: "batch-image"
      })
    });

    if (response.status === 429) {
      limitedResponse = response;
      break;
    }

    assert(response.ok, `Expected upload signing request to pass before limit, received ${response.status}`);
  }

  assert(limitedResponse, "Expected upload signing endpoint to return 429 after the configured limit");
  assert(limitedResponse.headers.get("retry-after"), "429 response should include Retry-After");
  assert(limitedResponse.headers.get("x-ratelimit-limit") === "30", "429 response should expose the route limit");

  console.log("\nRate limit smoke test passed");
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
