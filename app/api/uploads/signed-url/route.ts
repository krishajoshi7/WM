import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { getAuthContext } from "@/lib/auth/server";
import { hasSupabaseConfig } from "@/lib/env";
import { enforceRateLimit, rateLimits } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type UploadPurpose = "batch-image" | "custody-photo";

const storageBucket = "batch-images";
const acceptedContentTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxFileBytes = 8 * 1024 * 1024;

const purposeFolder: Record<UploadPurpose, string> = {
  "batch-image": "batch-images",
  "custody-photo": "custody-photos"
};

export async function POST(request: NextRequest) {
  try {
    enforceRateLimit(request, rateLimits.uploads);
    const auth = await getAuthContext(request, ["generator", "collector", "recycler"]);
    const body = (await request.json()) as {
      file_name?: string;
      content_type?: string;
      file_size?: number;
      purpose?: UploadPurpose;
    };

    const validationError = validateUploadRequest(body);

    if (validationError) {
      return new NextResponse(validationError, { status: 400 });
    }

    const safeName = sanitizeFileName(body.file_name!);
    const path = `${purposeFolder[body.purpose!]}/${auth.userId}/${crypto.randomUUID()}-${safeName}`;

    if (!hasSupabaseConfig()) {
      return NextResponse.json({
        path,
        token: null,
        publicUrl: `/local-uploads/${path}`,
        skipped: true
      });
    }

    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.storage.from(storageBucket).createSignedUploadUrl(path);

    if (error) {
      throw error;
    }

    const { data: publicData } = supabase.storage.from(storageBucket).getPublicUrl(path);

    return NextResponse.json({
      path,
      token: data.token,
      signedUrl: data.signedUrl,
      publicUrl: publicData.publicUrl
    });
  } catch (error) {
    return jsonError(error);
  }
}

function validateUploadRequest(body: {
  file_name?: string;
  content_type?: string;
  file_size?: number;
  purpose?: UploadPurpose;
}) {
  if (!body.file_name || !body.content_type || !body.purpose) {
    return "Missing upload metadata";
  }

  if (!Object.hasOwn(purposeFolder, body.purpose)) {
    return "Unsupported upload purpose";
  }

  if (!acceptedContentTypes.has(body.content_type)) {
    return "Only JPG, PNG, and WebP images are supported";
  }

  if (!Number.isFinite(body.file_size) || !body.file_size || body.file_size <= 0) {
    return "File size is required";
  }

  if (body.file_size > maxFileBytes) {
    return "Evidence images must be 8 MB or smaller";
  }

  return null;
}

function sanitizeFileName(fileName: string) {
  const cleaned = fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleaned || "evidence-image";
}
