import { NextResponse } from "next/server";
import { isResponseError } from "@/lib/auth/server";
import { logError, logWarn } from "@/lib/observability";

export function jsonError(error: unknown) {
  if (isResponseError(error)) {
    if (error.status >= 500) {
      logError("API response error", new Error(error.statusText), {
        status: error.status
      });
    } else if (error.status === 429) {
      logWarn("API request rate limited", {
        status: error.status
      });
    }
    return error;
  }

  const message = error instanceof Error ? error.message : "Unexpected server error";
  const status = message.includes("required") ? 503 : 500;

  if (!isNextDynamicRouteSignal(message)) {
    logError("Unhandled API error", error, { status });
  }

  return new NextResponse(message, { status });
}

function isNextDynamicRouteSignal(message: string) {
  return message.includes("Dynamic server usage");
}
