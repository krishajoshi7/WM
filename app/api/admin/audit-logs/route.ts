import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { listAdminAuditLogs } from "@/lib/admin-audit";
import { getAuthContext } from "@/lib/auth/server";

export async function GET(request: NextRequest) {
  try {
    await getAuthContext(request, ["admin"]);

    const limit = Number(request.nextUrl.searchParams.get("limit") || 50);
    const logs = await listAdminAuditLogs(clampLimit(limit));

    return NextResponse.json({ logs });
  } catch (error) {
    return jsonError(error);
  }
}

function clampLimit(limit: number) {
  if (!Number.isFinite(limit)) {
    return 50;
  }

  return Math.min(100, Math.max(1, Math.trunc(limit)));
}
