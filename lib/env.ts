export function hasSupabaseConfig() {
  // Smoke tests exercise real API routes without requiring live Supabase credentials.
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.SUSTAINABLE_ECG_SMOKE_MODE === "true"
  ) {
    return false;
  }

  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function requireServerEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required for this server action`);
  }

  return value;
}
