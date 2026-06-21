import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { getAuthContext } from "@/lib/auth/server";
import { demoBatches, demoEvents, demoPickups } from "@/lib/demo-store";
import { hasSupabaseConfig } from "@/lib/env";
import { normalizeScannedQr, verifyWasteQr } from "@/lib/qr";
import { enforceRateLimit, rateLimits } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { BatchStatus, CustodyEventType, UserRole, WasteBatch } from "@/lib/types";

// Each scan event is intentionally tied to one operational role.
const eventRole: Partial<Record<CustodyEventType, UserRole>> = {
  pickup_scanned: "collector",
  in_transit: "collector",
  delivered: "recycler"
};

// Batch status is derived from the custody event that was just accepted.
const eventStatus: Partial<Record<CustodyEventType, BatchStatus>> = {
  pickup_scanned: "picked_up",
  in_transit: "in_transit",
  delivered: "delivered"
};

export async function POST(request: NextRequest) {
  try {
    enforceRateLimit(request, rateLimits.scans);
    const body = (await request.json()) as {
      qr_token: string;
      qr_identifier?: string;
      event_type: CustodyEventType;
      location_lat?: number;
      location_lng?: number;
      photo_url?: string;
      weight_verified_kg?: number;
      notes?: string;
    };
    const expectedRole = eventRole[body.event_type];

    // New QR labels scan to batch_code. Older full-token labels still work.
    const scannedIdentifier = normalizeScannedQr(body.qr_identifier || body.qr_token || "");

    if (!scannedIdentifier || !expectedRole || !eventStatus[body.event_type]) {
      return new NextResponse("Unsupported QR scan action", { status: 400 });
    }

    const auth = await getAuthContext(request, [expectedRole]);
    const resolved = await resolveScannedBatch(scannedIdentifier);

    // The QR payload is short; authenticity comes from the stored signed JWT.
    const claims = verifyWasteQr(resolved.batch.qr_token);

    if (!hasSupabaseConfig()) {
      const batch = resolved.batch;

      if (!batch) {
        return new NextResponse("Batch not found", { status: 404 });
      }

      const transitionError = validateLocalTransition(batch, body.event_type, auth.userId);

      if (transitionError) {
        return new NextResponse(transitionError, { status: 409 });
      }

      const evidenceError = validateScanEvidence(body);

      if (evidenceError) {
        return new NextResponse(evidenceError, { status: 400 });
      }

      demoEvents.unshift({
        id: crypto.randomUUID(),
        batch_id: batch.id,
        actor_id: auth.userId,
        event_type: body.event_type,
        location_lat: body.location_lat || null,
        location_lng: body.location_lng || null,
        photo_url: body.photo_url || null,
        weight_verified_kg: body.weight_verified_kg || null,
        notes: body.notes || null,
        created_at: new Date().toISOString(),
        actor: {
          company_name: auth.profile.company_name,
          role: auth.profile.role
        }
      });
      batch.status = eventStatus[body.event_type]!;
      return NextResponse.json({ batch });
    }

    const supabase = createSupabaseAdminClient();
    const batch = resolved.batch;

    // Reject any stored token that does not cryptographically bind to this row.
    if (claims.batch_id !== batch.id || claims.batch_code !== batch.batch_code) {
      return new NextResponse("Stored QR signature does not match this batch", {
        status: 409
      });
    }

    const transitionError = validateBatchStatusForEvent(batch, body.event_type);

    if (transitionError) {
      return new NextResponse(transitionError, { status: 409 });
    }

    const evidenceError = validateScanEvidence(body);

    if (evidenceError) {
      return new NextResponse(evidenceError, { status: 400 });
    }

    // The RPC writes custody evidence and updates status atomically.
    const { data: updated, error } = await supabase.rpc("record_custody_scan", {
      p_batch_id: claims.batch_id,
      p_actor_id: auth.userId,
      p_event_type: body.event_type,
      p_location_lat: body.location_lat || null,
      p_location_lng: body.location_lng || null,
      p_photo_url: body.photo_url || null,
      p_weight_verified_kg: body.weight_verified_kg || null,
      p_notes: body.notes || null
    });

    if (error) {
      throw error;
    }

    return NextResponse.json({ batch: updated });
  } catch (error) {
    return jsonError(error);
  }
}

async function resolveScannedBatch(identifier: string): Promise<{ batch: WasteBatch }> {
  // Prefer human-readable batch codes, but support batch IDs and legacy JWTs.
  if (!hasSupabaseConfig()) {
    const jwtClaims = tryVerifyJwt(identifier);
    const batch = demoBatches.find((item) =>
      jwtClaims
        ? item.id === jwtClaims.batch_id
        : item.batch_code === identifier || item.id === identifier || item.qr_token === identifier
    );

    if (!batch) {
      throw new Response("No batch found for scanned QR identifier", { status: 404 });
    }

    return { batch };
  }

  const jwtClaims = tryVerifyJwt(identifier);
  const supabase = createSupabaseAdminClient();
  let query = supabase.from("waste_batches").select("*").limit(1);

  if (jwtClaims) {
    query = query.eq("id", jwtClaims.batch_id);
  } else if (identifier.startsWith("WM-")) {
    query = query.eq("batch_code", identifier);
  } else if (isUuid(identifier)) {
    query = query.eq("id", identifier);
  } else {
    query = query.eq("qr_token", identifier);
  }

  const { data, error } = await query.single();

  if (error || !data) {
    throw new Response("No batch found for scanned QR identifier", { status: 404 });
  }

  return { batch: data as WasteBatch };
}

function tryVerifyJwt(identifier: string) {
  try {
    return verifyWasteQr(identifier);
  } catch {
    return null;
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validateLocalTransition(
  batch: WasteBatch,
  eventType: CustodyEventType,
  actorId: string
) {
  const requiredStatus: Partial<Record<CustodyEventType, BatchStatus>> = {
    pickup_scanned: "assigned",
    in_transit: "picked_up",
    delivered: "in_transit"
  };
  const expected = requiredStatus[eventType];

  if (expected && batch.status !== expected) {
    return `Invalid transition from ${batch.status} using ${eventType}`;
  }

  if (
    (eventType === "pickup_scanned" || eventType === "in_transit") &&
    !demoPickups.some(
      (pickup) =>
        pickup.batch_id === batch.id &&
        pickup.collector_id === actorId &&
        pickup.status === "accepted"
    )
  ) {
    return "Collector has not accepted this pickup";
  }

  return null;
}

function validateBatchStatusForEvent(batch: WasteBatch, eventType: CustodyEventType) {
  const requiredStatus: Partial<Record<CustodyEventType, BatchStatus>> = {
    pickup_scanned: "assigned",
    in_transit: "picked_up",
    delivered: "in_transit"
  };
  const expected = requiredStatus[eventType];

  if (expected && batch.status !== expected) {
    return `Invalid transition from ${batch.status} using ${eventType}`;
  }

  return null;
}

function validateScanEvidence(body: {
  event_type: CustodyEventType;
  location_lat?: number;
  location_lng?: number;
  photo_url?: string;
  weight_verified_kg?: number;
}) {
  if (
    ["pickup_scanned", "delivered"].includes(body.event_type) &&
    !body.photo_url?.trim()
  ) {
    return "Photo proof is required for pickup and delivery scans";
  }

  if ((body.location_lat === undefined) !== (body.location_lng === undefined)) {
    return "GPS latitude and longitude must be provided together";
  }

  if (body.weight_verified_kg !== undefined && body.weight_verified_kg <= 0) {
    return "Verified weight must be greater than zero";
  }

  return null;
}
