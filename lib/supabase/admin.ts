import { createClient } from "@supabase/supabase-js";
import { requireServerEnv } from "@/lib/env";

export function createSupabaseAdminClient() {
  const url = requireServerEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireServerEnv("SUPABASE_SERVICE_ROLE_KEY");

  console.log("NEXT_PUBLIC_SUPABASE_URL:", url);
  console.log("URL valid:", url.startsWith("https://"));
  console.log("SERVICE_ROLE_KEY exists:", !!key);
  console.log("SERVICE_ROLE_KEY length:", key.length);

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}