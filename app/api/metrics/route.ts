import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { getAuthContext } from "@/lib/auth/server";
import { hasSupabaseConfig } from "@/lib/env";
import { computeMetrics } from "@/lib/demo-store";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { WasteBatch } from "@/lib/types";

export async function GET(request: NextRequest) {
  try {
    await getAuthContext(request, ["admin"]);

    if (!hasSupabaseConfig()) {
      return NextResponse.json(computeMetrics());
    }

    const supabase = createSupabaseAdminClient();
    const [{ data: batches }, { count: collectors }, { count: approvals }] =
      await Promise.all([
        supabase.from("waste_batches").select("*"),
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "collector")
          .eq("status", "approved"),
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .in("role", ["collector", "recycler"])
          .eq("status", "pending")
      ]);

    const metrics = computeMetrics((batches || []) as WasteBatch[]);
    metrics.activeCollectors = collectors || 0;
    metrics.pendingApprovals = approvals || 0;

    return NextResponse.json(metrics);
  } catch (error) {
    return jsonError(error);
  }
}
