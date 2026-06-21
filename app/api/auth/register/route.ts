import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { hasSupabaseConfig } from "@/lib/env";
import { enforceRateLimit, rateLimits } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/types";

const roles = ["generator", "collector", "recycler", "admin"] as const;

export async function POST(request: NextRequest) {
  try {
    enforceRateLimit(request, rateLimits.auth);
    const body = (await request.json()) as {
      email: string;
      password: string;
      role: UserRole;
      company_name: string;
      phone?: string;
      gst_number?: string;
    };

    if (!roles.includes(body.role) || !body.email || !body.password || !body.company_name) {
      return new NextResponse("Missing registration fields", { status: 400 });
    }

    if (!hasSupabaseConfig()) {
      return NextResponse.json({
        id: crypto.randomUUID(),
        status: body.role === "generator" ? "approved" : "pending"
      });
    }

    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: false,
      user_metadata: {
        role: body.role,
        company_name: body.company_name
      }
    });

    if (error || !data.user) {
      throw error || new Error("Supabase Auth did not return a user");
    }

    const status = body.role === "generator" ? "approved" : "pending";
    const { error: profileError } = await supabase.from("profiles").insert({
      id: data.user.id,
      role: body.role,
      company_name: body.company_name,
      phone: body.phone || null,
      gst_number: body.gst_number || null,
      status
    });

    if (profileError) {
      throw profileError;
    }

    return NextResponse.json({ id: data.user.id, status });
  } catch (error) {
    return jsonError(error);
  }
}
