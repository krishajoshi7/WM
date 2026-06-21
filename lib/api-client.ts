"use client";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { authCookieNames, authCookieMaxAgeSeconds } from "@/lib/auth/cookies";
import type { UserRole } from "@/lib/types";

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { role?: UserRole } = {}
): Promise<T> {
  const response = await authenticatedFetch(path, options);

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<T>;
}

export async function apiFetchBlob(
  path: string,
  options: RequestInit & { role?: UserRole } = {}
): Promise<Blob> {
  const response = await authenticatedFetch(path, options);

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.blob();
}

async function authenticatedFetch(
  path: string,
  options: RequestInit & { role?: UserRole } = {}
) {
  const headers = new Headers(options.headers);
  const supabase = createBrowserSupabaseClient();
  const session = supabase ? await supabase.auth.getSession() : null;
  const accessToken = session?.data.session?.access_token;
  const devRole = options.role || getDevRole();

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  } else if (devRole) {
    headers.set("x-dev-role", devRole);
  }

  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(path, {
    ...options,
    headers
  });
}

export function setDevRole(role: UserRole) {
  localStorage.setItem("sustainable-ecg-role", role);
  document.cookie = `${authCookieNames.devRole}=${role}; path=/; max-age=${authCookieMaxAgeSeconds}; samesite=lax`;
}

export function clearDevRole() {
  localStorage.removeItem("sustainable-ecg-role");
  document.cookie = `${authCookieNames.devRole}=; path=/; max-age=0; samesite=lax`;
}

export function getDevRole() {
  if (typeof window === "undefined") {
    return null;
  }

  return localStorage.getItem("sustainable-ecg-role") as UserRole | null;
}
