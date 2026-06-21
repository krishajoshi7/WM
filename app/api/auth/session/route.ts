import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { authCookieMaxAgeSeconds, authCookieNames } from "@/lib/auth/cookies";
import { assertProfileAccess } from "@/lib/auth/server";
import { jsonError } from "@/lib/api-errors";
import { hasSupabaseConfig, requireServerEnv } from "@/lib/env";
import { enforceRateLimit, rateLimits } from "@/lib/rate-limit";
import type { Profile, UserRole } from "@/lib/types";

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: authCookieMaxAgeSeconds
};

export async function POST(request: NextRequest) {
  try {
    enforceRateLimit(request, rateLimits.auth);
    const body = (await request.json()) as {
      access_token?: string;
      refresh_token?: string;
      expected_role?: UserRole;
    };

    if (!hasSupabaseConfig()) {
      return new NextResponse("Supabase is not configured", { status: 400 });
    }

    if (!body.access_token || !body.refresh_token || !body.expected_role) {
      return new NextResponse("Missing session tokens", { status: 400 });
    }

    const supabase = createClient(
      requireServerEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireServerEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      {
        global: {
          headers: {
            Authorization: `Bearer ${body.access_token}`
          }
        }
      }
    );

    const { data: userResult, error: userError } = await supabase.auth.getUser(body.access_token);

    if (userError || !userResult.user) {
      return new NextResponse("Invalid session", { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userResult.user.id)
      .single();

    if (profileError || !profile) {
      return new NextResponse("Profile is missing", { status: 403 });
    }

    assertProfileAccess(profile as Profile, [body.expected_role]);

    const response = NextResponse.json({
      ok: true,
      profile
    });

    response.cookies.set(authCookieNames.accessToken, body.access_token, cookieOptions);
    response.cookies.set(authCookieNames.refreshToken, body.refresh_token, cookieOptions);
    response.cookies.delete(authCookieNames.devRole);

    return response;
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    enforceRateLimit(request, rateLimits.auth);
    const response = NextResponse.json({ ok: true });

    response.cookies.delete(authCookieNames.accessToken);
    response.cookies.delete(authCookieNames.refreshToken);
    response.cookies.delete(authCookieNames.devRole);

    return response;
  } catch (error) {
    return jsonError(error);
  }
}
