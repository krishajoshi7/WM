import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const port = Number(process.env.HEALTH_SMOKE_PORT || 3212);
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
      JWT_SECRET: "health-smoke-secret",
      EPR_WEBHOOK_URL: "",
      WEBHOOK_CRON_SECRET: "",
      NEXT_PUBLIC_APP_URL: "http://localhost:3212"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  server.stdout.on("data", (chunk) => process.stdout.write(`[next] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));

  await waitForServer();

  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.json();

  assert(response.status === 503, `Expected health smoke to return 503 without Supabase, received ${response.status}`);
  assert(body.service === "sustainable-ecg", "Health response should identify the service");
  assert(body.ready === false, "Health response should mark readiness false when Supabase env is missing");
  assert(
    body.checks.some((check) => check.name === "supabase" && check.status === "fail"),
    "Health response should include failed Supabase check"
  );

  const headResponse = await fetch(`${baseUrl}/api/health`, { method: "HEAD" });
  assert(headResponse.status === 503, `Expected health HEAD to return 503, received ${headResponse.status}`);

  console.log("\nHealth smoke test passed");
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
