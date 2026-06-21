import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { authCookieNames } from "@/lib/auth/cookies";
import { hasSupabaseConfig, requireServerEnv } from "@/lib/env";
import type { Profile, ProfileStatus, UserRole } from "@/lib/types";

export type AuthContext = {
  userId: string;
  profile: Profile;
  accessToken: string;
};

const devProfiles: Record<UserRole, Profile> = {
  generator: {
    id: "11111111-1111-4111-8111-111111111111",
    role: "generator",
    company_name: "Aarav Packaging Pvt Ltd",
    phone: "+91 98765 43210",
    gst_number: "29AAICA3918J1ZE",
    status: "approved",
    created_at: new Date().toISOString()
  },
  collector: {
    id: "22222222-2222-4222-8222-222222222222",
    role: "collector",
    company_name: "GreenLoop Collection Services",
    phone: "+91 98111 22445",
    gst_number: "07BBBCG2271K1Z2",
    status: "approved",
    created_at: new Date().toISOString()
  },
  recycler: {
    id: "33333333-3333-4333-8333-333333333333",
    role: "recycler",
    company_name: "Prakriti Recyclers LLP",
    phone: "+91 98700 11009",
    gst_number: "27AACCP9821F1Z8",
    status: "approved",
    created_at: new Date().toISOString()
  },
  admin: {
    id: "44444444-4444-4444-8444-444444444444",
    role: "admin",
    company_name: "Sustainable ECG Operations",
    phone: "+91 90000 11122",
    gst_number: null,
    status: "approved",
    created_at: new Date().toISOString()
  }
};

export async function getAuthContext(
  request: NextRequest,
  allowedRoles: UserRole[]
): Promise<AuthContext> {
  const authHeader = request.headers.get("authorization");
  const devRole = (
    request.headers.get("x-dev-role") || request.cookies.get(authCookieNames.devRole)?.value
  ) as UserRole | null;

  if (!hasSupabaseConfig() && devRole && devProfiles[devRole]) {
    const devStatus = request.headers.get("x-dev-status") as ProfileStatus | null;
    const profile = {
      ...devProfiles[devRole],
      status: devStatus || devProfiles[devRole].status
    };
    assertProfileAccess(profile, allowedRoles);
    return {
      userId: profile.id,
      profile,
      accessToken: "development"
    };
  }

  const token =
    authHeader?.replace(/^Bearer\s+/i, "") ||
    request.cookies.get(authCookieNames.accessToken)?.value;

  if (!token) {
    throw new Response("Missing bearer token", { status: 401 });
  }

  const supabase = createClient(
    requireServerEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireServerEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    }
  );

  const { data: userResult, error: userError } = await supabase.auth.getUser(token);

  if (userError || !userResult.user) {
    throw new Response("Invalid or expired session", { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userResult.user.id)
    .single();

  if (profileError || !profile) {
    throw new Response("Profile is missing", { status: 403 });
  }

  assertProfileAccess(profile as Profile, allowedRoles);

  return {
    userId: userResult.user.id,
    profile: profile as Profile,
    accessToken: token
  };
}

export function assertProfileAccess(profile: Profile, allowedRoles: UserRole[]) {
  if (!allowedRoles.includes(profile.role)) {
    throw new Response("Role is not allowed for this action", { status: 403 });
  }

  if (profile.status !== "approved") {
    throw new Response("Account is pending approval or suspended", { status: 403 });
  }
}

export function isResponseError(error: unknown): error is Response {
  return error instanceof Response;
}
