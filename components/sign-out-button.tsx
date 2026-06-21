"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { clearDevRole } from "@/lib/api-client";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut() {
    setIsSigningOut(true);

    try {
      const supabase = createBrowserSupabaseClient();
      await supabase?.auth.signOut();
      clearDevRole();

      await fetch("/api/auth/session", {
        method: "DELETE"
      });

      router.push("/auth?reason=signed-out");
      router.refresh();
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <button
      className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-black text-muted-foreground"
      disabled={isSigningOut}
      onClick={signOut}
      type="button"
    >
      <LogOut className="h-4 w-4" />
      {isSigningOut ? "Signing out" : "Sign out"}
    </button>
  );
}
