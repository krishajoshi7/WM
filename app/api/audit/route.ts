import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { getAuthContext } from "@/lib/auth/server";
import { demoEvents } from "@/lib/demo-store";
import { hasSupabaseConfig } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    await getAuthContext(request, ["admin"]);

    if (!hasSupabaseConfig()) {
      return NextResponse.json({ events: demoEvents });
    }

    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("custody_events")
      .select("*, actor:profiles!custody_events_actor_id_fkey(company_name, role)")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      throw error;
    }

    return NextResponse.json({ events: data || [] });
  } catch (error) {
    return jsonError(error);
  }
}
