"use client";

import { apiFetch } from "@/lib/api-client";
import {
  createBrowserSupabaseClient,
  isSupabaseBrowserConfigured
} from "@/lib/supabase/client";
import type { UserRole } from "@/lib/types";

export type UploadPurpose = "batch-image" | "custody-photo";

type SignedUploadResponse = {
  path: string;
  token: string | null;
  publicUrl: string;
  skipped?: boolean;
};

const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxImageBytes = 8 * 1024 * 1024;

export function validateEvidenceImage(file: File) {
  if (!acceptedImageTypes.has(file.type)) {
    throw new Error(`${file.name} must be a JPG, PNG, or WebP image.`);
  }

  if (file.size <= 0) {
    throw new Error(`${file.name} is empty.`);
  }

  if (file.size > maxImageBytes) {
    throw new Error(`${file.name} is larger than 8 MB.`);
  }
}

export async function uploadEvidenceImages({
  files,
  purpose,
  role
}: {
  files: File[];
  purpose: UploadPurpose;
  role: UserRole;
}) {
  if (files.length === 0) {
    return [];
  }

  const supabase = createBrowserSupabaseClient();
  const urls: string[] = [];

  for (const file of files) {
    validateEvidenceImage(file);

    const signedUpload = await apiFetch<SignedUploadResponse>("/api/uploads/signed-url", {
      method: "POST",
      role,
      body: JSON.stringify({
        file_name: file.name,
        content_type: file.type,
        file_size: file.size,
        purpose
      })
    });

    if (!signedUpload.skipped) {
      if (!isSupabaseBrowserConfigured || !supabase || !signedUpload.token) {
        throw new Error("Supabase Storage is not configured for browser uploads.");
      }

      const { error } = await supabase.storage
        .from("batch-images")
        .uploadToSignedUrl(signedUpload.path, signedUpload.token, file);

      if (error) {
        throw new Error(error.message);
      }
    }

    urls.push(signedUpload.publicUrl);
  }

  return urls;
}
