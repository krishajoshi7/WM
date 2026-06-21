import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { getAuthContext } from "@/lib/auth/server";
import { demoBatches, demoEvents, demoRecyclingLogs } from "@/lib/demo-store";
import { enqueueEprWebhookDelivery, processEprWebhookDeliveries } from "@/lib/epr-webhooks";
import { hasSupabaseConfig } from "@/lib/env";
import { enforceRateLimit, rateLimits } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    enforceRateLimit(request, rateLimits.recycling);
    const auth = await getAuthContext(request, ["recycler"]);
    const body = (await request.json()) as {
      batch_id: string;
      material_type: string;
      quantity_kg: number;
      recycling_method: string;
      epr_credits_claimed: number;
      report_url?: string;
    };

    if (!body.batch_id || !body.quantity_kg || !body.recycling_method) {
      return new NextResponse("Missing recycling fields", { status: 400 });
    }

    if (!hasSupabaseConfig()) {
      const batch = demoBatches.find((item) => item.id === body.batch_id);
      if (!batch) {
        return new NextResponse("Batch not found", { status: 404 });
      }
      if (batch.status !== "delivered") {
        return new NextResponse("Batch must be delivered before recycling", {
          status: 409
        });
      }
      demoEvents.unshift({
        id: crypto.randomUUID(),
        batch_id: body.batch_id,
        actor_id: auth.userId,
        event_type: "recycled",
        location_lat: null,
        location_lng: null,
        photo_url: null,
        weight_verified_kg: body.quantity_kg,
        notes: body.recycling_method,
        created_at: new Date().toISOString(),
        actor: {
          company_name: auth.profile.company_name,
          role: auth.profile.role
        }
      });
      demoRecyclingLogs.unshift({
        id: crypto.randomUUID(),
        batch_id: body.batch_id,
        recycler_id: auth.userId,
        material_type: body.material_type,
        quantity_kg: body.quantity_kg,
        recycling_method: body.recycling_method,
        epr_credits_claimed: body.epr_credits_claimed,
        report_url: body.report_url || null,
        created_at: new Date().toISOString()
      });
      batch.status = "recycled";
      return NextResponse.json({ batch });
    }

    const supabase = createSupabaseAdminClient();

    // The RPC writes the recycled custody event, recycling log, and final status atomically.
    const { data, error } = await supabase.rpc("complete_recycling", {
      p_batch_id: body.batch_id,
      p_recycler_id: auth.userId,
      p_material_type: body.material_type,
      p_quantity_kg: body.quantity_kg,
      p_recycling_method: body.recycling_method,
      p_epr_credits_claimed: body.epr_credits_claimed,
      p_report_url: body.report_url || null
    });

    if (error) {
      throw error;
    }

    await enqueueEprWebhookDelivery(body.batch_id);

    // Try one delivery immediately, but do not roll back recycling if the portal is down.
    await processEprWebhookDeliveries(1).catch(() => undefined);

    return NextResponse.json(data);
  } catch (error) {
    return jsonError(error);
  }
}
