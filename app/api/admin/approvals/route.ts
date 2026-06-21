import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { writeAdminAuditLog } from "@/lib/admin-audit";
import { getAuthContext } from "@/lib/auth/server";
import { demoProfiles } from "@/lib/demo-store";
import { hasSupabaseConfig } from "@/lib/env";
import { enforceRateLimit, rateLimits } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    await getAuthContext(request, ["admin"]);

    if (!hasSupabaseConfig()) {
      return NextResponse.json({ profiles: demoProfiles });
    }

    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .in("role", ["collector", "recycler"])
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return NextResponse.json({ profiles: data || [] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    enforceRateLimit(request, rateLimits.adminMutation);
    const auth = await getAuthContext(request, ["admin"]);
    const body = (await request.json()) as {
      id: string;
      status: "approved" | "suspended";
    };

    if (!body.id || !["approved", "suspended"].includes(body.status)) {
      return new NextResponse("Invalid approval update", { status: 400 });
    }

    if (!hasSupabaseConfig()) {
      const profile = demoProfiles.find((item) => item.id === body.id);
      if (profile) {
        profile.status = body.status;
      }
      return NextResponse.json({ profile });
    }

    const supabase = createSupabaseAdminClient();
    const { data: previous } = await supabase
      .from("profiles")
      .select("id, role, company_name, status")
      .eq("id", body.id)
      .single();

    const { data, error } = await supabase
      .from("profiles")
      .update({ status: body.status })
      .eq("id", body.id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    await writeAdminAuditLog({
      request,
      actorId: auth.userId,
      action: `profile.${body.status}`,
      targetType: "profile",
      targetId: body.id,
      metadata: {
        previous_status: previous?.status || null,
        next_status: body.status,
        target_role: previous?.role || data.role,
        company_name: previous?.company_name || data.company_name
      }
    });

    return NextResponse.json({ profile: data });
  } catch (error) {
    return jsonError(error);
  }
}
