import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { getAuthContext } from "@/lib/auth/server";
import { processEprWebhookDeliveries } from "@/lib/epr-webhooks";
import { enforceRateLimit, rateLimits } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    enforceRateLimit(request, rateLimits.webhookRetry);
    await authorizeProcessor(request);

    const body = await readJsonBody(request);
    const limit = clampLimit(Number(body?.limit || 10));
    const result = await processEprWebhookDeliveries(limit);

    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}

async function authorizeProcessor(request: NextRequest) {
  const expectedSecret = process.env.WEBHOOK_CRON_SECRET || process.env.CRON_SECRET;
  const providedSecret =
    request.headers.get("x-webhook-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (expectedSecret && providedSecret === expectedSecret) {
    return;
  }

  await getAuthContext(request, ["admin"]);
}

async function readJsonBody(request: NextRequest) {
  try {
    return (await request.json()) as { limit?: number };
  } catch {
    return null;
  }
}

function clampLimit(limit: number) {
  if (!Number.isFinite(limit)) {
    return 10;
  }

  return Math.min(50, Math.max(1, Math.trunc(limit)));
}
