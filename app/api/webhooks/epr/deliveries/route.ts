import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { writeAdminAuditLog } from "@/lib/admin-audit";
import { getAuthContext } from "@/lib/auth/server";
import { listEprWebhookDeliveries, retryEprWebhookDelivery } from "@/lib/epr-webhooks";
import { enforceRateLimit, rateLimits } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  try {
    await getAuthContext(request, ["admin"]);

    const limit = Number(request.nextUrl.searchParams.get("limit") || 25);
    const deliveries = await listEprWebhookDeliveries(clampLimit(limit));

    return NextResponse.json({ deliveries });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    enforceRateLimit(request, rateLimits.webhookRetry);
    const auth = await getAuthContext(request, ["admin"]);

    const body = (await request.json()) as {
      delivery_id?: string;
    };

    if (!body.delivery_id) {
      return new NextResponse("delivery_id is required", { status: 400 });
    }

    const delivery = await retryEprWebhookDelivery(body.delivery_id);

    await writeAdminAuditLog({
      request,
      actorId: auth.userId,
      action: "webhook.retry",
      targetType: "webhook_delivery",
      targetId: body.delivery_id,
      metadata: {
        resulting_status: delivery?.status || null,
        attempts: delivery?.attempts || null,
        last_status_code: delivery?.last_status_code || null,
        last_error: delivery?.last_error || null
      }
    });

    return NextResponse.json({ delivery });
  } catch (error) {
    return jsonError(error);
  }
}

function clampLimit(limit: number) {
  if (!Number.isFinite(limit)) {
    return 25;
  }

  return Math.min(100, Math.max(1, Math.trunc(limit)));
}
