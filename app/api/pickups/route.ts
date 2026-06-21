import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { getAuthContext } from "@/lib/auth/server";
import { demoBatches, demoEvents, demoPickups } from "@/lib/demo-store";
import { hasSupabaseConfig } from "@/lib/env";
import { enforceRateLimit, rateLimits } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    enforceRateLimit(request, rateLimits.pickups);
    const auth = await getAuthContext(request, ["collector"]);
    const body = (await request.json()) as {
      batch_id: string;
      status: "accepted" | "rejected";
      estimated_pickup?: string;
    };

    if (!body.batch_id || !["accepted", "rejected"].includes(body.status)) {
      return new NextResponse("Invalid pickup request", { status: 400 });
    }

    if (!hasSupabaseConfig()) {
      demoPickups.push({
        id: crypto.randomUUID(),
        batch_id: body.batch_id,
        collector_id: auth.userId,
        status: body.status,
        accepted_at: body.status === "accepted" ? new Date().toISOString() : null,
        estimated_pickup: body.estimated_pickup || null,
        created_at: new Date().toISOString()
      });
      const batch = demoBatches.find((item) => item.id === body.batch_id);
      if (batch && body.status === "accepted") {
        batch.status = "assigned";
      }
      demoEvents.unshift({
        id: crypto.randomUUID(),
        batch_id: body.batch_id,
        actor_id: auth.userId,
        event_type: body.status === "accepted" ? "pickup_accepted" : "rejected",
        location_lat: null,
        location_lng: null,
        photo_url: null,
        weight_verified_kg: null,
        notes:
          body.status === "accepted"
            ? "Collector accepted pickup assignment."
            : "Collector rejected pickup assignment.",
        created_at: new Date().toISOString(),
        actor: {
          company_name: auth.profile.company_name,
          role: auth.profile.role
        }
      });
      return NextResponse.json({ ok: true });
    }

    const supabase = createSupabaseAdminClient();

    // The RPC writes pickup_requests, custody_events, and status in one DB transaction.
    const { data: batch, error } = await supabase.rpc("accept_pickup_request", {
      p_batch_id: body.batch_id,
      p_collector_id: auth.userId,
      p_status: body.status,
      p_estimated_pickup: body.estimated_pickup || null
    });

    if (error) {
      throw error;
    }

    return NextResponse.json({ ok: true, batch });
  } catch (error) {
    return jsonError(error);
  }
}
