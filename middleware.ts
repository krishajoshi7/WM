import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { authCookieMaxAgeSeconds, authCookieNames } from "@/lib/auth/cookies";
import { hasSupabaseConfig } from "@/lib/env";
import type { Profile, UserRole } from "@/lib/types";

const dashboardRoles = ["generator", "collector", "recycler", "admin"] as const;
const publicDashboardRedirects = new Set(["/dashboard"]);

export async function middleware(request: NextRequest) {
  const role = roleFromDashboardPath(request.nextUrl.pathname);

  if (!role) {
    return NextResponse.next();
  }

  if (!hasSupabaseConfig()) {
    return guardDevDashboard(request, role);
  }

  return guardSupabaseDashboard(request, role);
}

export const config = {
  matcher: ["/dashboard/:path*"]
};

function roleFromDashboardPath(pathname: string): UserRole | null {
  if (publicDashboardRedirects.has(pathname)) {
    return null;
  }

  const [, root, maybeRole] = pathname.split("/");

  if (root !== "dashboard" || !dashboardRoles.includes(maybeRole as UserRole)) {
    return null;
  }

  return maybeRole as UserRole;
}

function guardDevDashboard(request: NextRequest, role: UserRole) {
  const devRole = request.cookies.get(authCookieNames.devRole)?.value;

  if (devRole === role) {
    return NextResponse.next();
  }

  return redirectToAuth(request, role, "dev-role-required");
}

async function guardSupabaseDashboard(request: NextRequest, role: UserRole) {
  const accessToken = request.cookies.get(authCookieNames.accessToken)?.value;
  const refreshToken = request.cookies.get(authCookieNames.refreshToken)?.value;

  if (!accessToken && !refreshToken) {
    return redirectToAuth(request, role, "session-required");
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
  );

  let token = accessToken;
  let refreshedSession:
    | {
        access_token: string;
        refresh_token: string;
      }
    | null = null;

  if (token) {
    const { data, error } = await supabase.auth.getUser(token);

    if (!error && data.user) {
      return await authorizeProfile(request, role, data.user.id, token, null);
    }
  }

  if (!refreshToken) {
    return redirectToAuth(request, role, "session-expired");
  }

  const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession({
    refresh_token: refreshToken
  });

  if (refreshError || !refreshData.session?.access_token || !refreshData.user) {
    return redirectToAuth(request, role, "session-expired");
  }

  refreshedSession = {
    access_token: refreshData.session.access_token,
    refresh_token: refreshData.session.refresh_token
  };
  token = refreshedSession.access_token;

  return authorizeProfile(request, role, refreshData.user.id, token, refreshedSession);
}

async function authorizeProfile(
  request: NextRequest,
  role: UserRole,
  userId: string,
  accessToken: string,
  refreshedSession: { access_token: string; refresh_token: string } | null
) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    }
  );

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error || !profile) {
    return redirectToAuth(request, role, "profile-required");
  }

  const typedProfile = profile as Profile;

  if (typedProfile.role !== role) {
    return redirectToAuth(request, role, "wrong-role");
  }

  if (typedProfile.status !== "approved") {
    return redirectToAuth(request, role, typedProfile.status);
  }

  const response = NextResponse.next();

  if (refreshedSession) {
    response.cookies.set(authCookieNames.accessToken, refreshedSession.access_token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: authCookieMaxAgeSeconds
    });
    response.cookies.set(authCookieNames.refreshToken, refreshedSession.refresh_token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: authCookieMaxAgeSeconds
    });
  }

  return response;
}

function redirectToAuth(request: NextRequest, role: UserRole, reason: string) {
  const url = request.nextUrl.clone();
  url.pathname = "/auth";
  url.search = new URLSearchParams({
    role,
    reason
  }).toString();

  const response = NextResponse.redirect(url);

  if (reason !== "dev-role-required") {
    response.cookies.delete(authCookieNames.accessToken);
    response.cookies.delete(authCookieNames.refreshToken);
  }

  return response;
}
