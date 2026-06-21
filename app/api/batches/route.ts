import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { getAuthContext } from "@/lib/auth/server";
import { demoBatches, demoEvents } from "@/lib/demo-store";
import { hasSupabaseConfig } from "@/lib/env";
import { signWasteQr, renderQrDataUrl } from "@/lib/qr";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { BatchStatus, UserRole, WasteBatch, WasteType } from "@/lib/types";
import { isValidWasteCategory } from "@/lib/waste-categories";

const roleStatuses: Record<UserRole, BatchStatus[]> = {
  generator: ["pending", "assigned", "picked_up", "in_transit", "delivered", "recycled"],
  collector: ["pending", "assigned", "picked_up", "in_transit"],
  recycler: ["in_transit", "delivered", "recycled"],
  admin: ["pending", "assigned", "picked_up", "in_transit", "delivered", "recycled"]
};

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext(request, ["generator", "collector", "recycler", "admin"]);

    if (!hasSupabaseConfig()) {
      return NextResponse.json({
        batches: demoBatches.filter((batch) =>
          auth.profile.role === "generator"
            ? batch.generator_id === auth.userId
            : roleStatuses[auth.profile.role].includes(batch.status)
        )
      });
    }

    const supabase = createSupabaseAdminClient();
    let query = supabase
      .from("waste_batches")
      .select("*, generator:profiles!waste_batches_generator_id_fkey(company_name, phone)")
      .order("created_at", { ascending: false });

    if (auth.profile.role === "generator") {
      query = query.eq("generator_id", auth.userId);
    } else if (auth.profile.role !== "admin") {
      query = query.in("status", roleStatuses[auth.profile.role]);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return NextResponse.json({ batches: data || [] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request, ["generator"]);
    const form = await request.formData();
    const wasteType = form.get("waste_type")?.toString() as WasteType;
    const category = form.get("category")?.toString();
    const weightKg = Number(form.get("weight_kg"));
    const pickupAddress = form.get("pickup_address")?.toString();
    const pickupDate = form.get("pickup_date")?.toString();

    if (!wasteType || !category || !weightKg || !pickupAddress || !pickupDate) {
      return new NextResponse("Missing batch fields", { status: 400 });
    }

    if (!isValidWasteCategory(wasteType, category)) {
      return new NextResponse("Category does not match selected waste type", {
        status: 400
      });
    }

    const batchId = crypto.randomUUID();
    const batchCode = await nextBatchCode();
    const createdAt = new Date().toISOString();

    // Store the signed JWT for verification, but render only the short batch
    // code in the printable QR so camera scans stay reliable.
    const qrToken = signWasteQr({
      batch_id: batchId,
      batch_code: batchCode,
      generator_id: auth.userId,
      created_at: createdAt,
      type: "waste_qr"
    });
    const qrDataUrl = await renderQrDataUrl(batchCode);

    if (!hasSupabaseConfig()) {
      const batch: WasteBatch = {
        id: batchId,
        batch_code: batchCode,
        generator_id: auth.userId,
        waste_type: wasteType,
        category,
        weight_kg: weightKg,
        pickup_address: pickupAddress,
        pickup_date: pickupDate,
        images: readPreuploadedImageUrls(form),
        qr_token: qrToken,
        status: "pending",
        created_at: createdAt,
        generator: {
          company_name: auth.profile.company_name,
          phone: auth.profile.phone
        }
      };

      demoBatches.unshift(batch);
      demoEvents.unshift({
        id: crypto.randomUUID(),
        batch_id: batchId,
        actor_id: auth.userId,
        event_type: "qr_generated",
        location_lat: null,
        location_lng: null,
        photo_url: null,
        weight_verified_kg: null,
        notes: "Short batch code QR generated; signed JWT stored server-side for scan verification.",
        created_at: new Date().toISOString(),
        actor: {
          company_name: auth.profile.company_name,
          role: auth.profile.role
        }
      });

      return NextResponse.json({ batch, qrDataUrl });
    }

    const supabase = createSupabaseAdminClient();
    const imageUrls = await uploadImages(form, batchId);

    // The RPC inserts the batch and its first custody event in one transaction.
    const { data: batch, error } = await supabase.rpc("create_waste_batch_with_event", {
      p_id: batchId,
      p_batch_code: batchCode,
      p_generator_id: auth.userId,
      p_waste_type: wasteType,
      p_category: category,
      p_weight_kg: weightKg,
      p_pickup_address: pickupAddress,
      p_pickup_date: pickupDate,
      p_images: imageUrls,
      p_qr_token: qrToken
    });

    if (error) {
      throw error;
    }

    return NextResponse.json({ batch, qrDataUrl });
  } catch (error) {
    return jsonError(error);
  }
}

async function nextBatchCode() {
  const year = new Date().getFullYear();

  if (!hasSupabaseConfig()) {
    return `WM-${year}-${String(126 + demoBatches.length).padStart(5, "0")}`;
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("next_batch_code");

  if (error) {
    throw error;
  }

  return data as string;
}

async function uploadImages(form: FormData, batchId: string) {
  const preuploadedUrls = readPreuploadedImageUrls(form);

  if (preuploadedUrls.length > 0) {
    return preuploadedUrls;
  }

  // Keep photo evidence in Supabase Storage and only persist durable URLs.
  const files = form
    .getAll("images")
    .filter((value): value is File => value instanceof File && value.size > 0);

  if (files.length === 0) {
    return [];
  }

  const supabase = createSupabaseAdminClient();
  const urls: string[] = [];

  for (const [index, file] of files.entries()) {
    const extension = file.name.split(".").pop() || "jpg";
    const path = `${batchId}/${index + 1}.${extension}`;
    const { error } = await supabase.storage
      .from("batch-images")
      .upload(path, file, {
        cacheControl: "3600",
        upsert: true,
        contentType: file.type || "image/jpeg"
      });

    if (error) {
      throw error;
    }

    const { data } = supabase.storage.from("batch-images").getPublicUrl(path);
    urls.push(data.publicUrl);
  }

  return urls;
}

function readPreuploadedImageUrls(form: FormData) {
  return form
    .getAll("image_urls")
    .map((value) => value.toString().trim())
    .filter(Boolean)
    .slice(0, 8);
}
