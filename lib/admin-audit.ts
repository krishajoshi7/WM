import { NextRequest } from "next/server";
import { hasSupabaseConfig } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AdminAuditLog } from "@/lib/types";

export async function listAdminAuditLogs(limit = 50) {
  if (!hasSupabaseConfig()) {
    return [];
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("admin_audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data || []) as AdminAuditLog[];
}

export async function writeAdminAuditLog({
  request,
  actorId,
  action,
  targetType,
  targetId,
  metadata
}: {
  request: NextRequest;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}) {
  if (!hasSupabaseConfig()) {
    return null;
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("admin_audit_logs")
    .insert({
      actor_id: actorId,
      action,
      target_type: targetType,
      target_id: targetId,
      metadata: metadata || {},
      ip_address: getClientIp(request),
      user_agent: request.headers.get("user-agent")
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data as AdminAuditLog;
}

function getClientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null
  );
}
