import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

loadDotEnv(".env.local");
loadDotEnv(".env");

const options = parseArgs(process.argv.slice(2));
const email = options.email || process.env.ADMIN_EMAIL;
const password = options.password || process.env.ADMIN_PASSWORD;
const companyName =
  options.company || process.env.ADMIN_COMPANY_NAME || "Sustainable ECG Operations";
const phone = options.phone || process.env.ADMIN_PHONE || null;
const gstNumber = options.gst || process.env.ADMIN_GST_NUMBER || null;
const shouldResetPassword = options["reset-password"] === "true";
const dryRun = options["dry-run"] === "true";

assertRequired("ADMIN_EMAIL or --email", email);

if (!password && shouldResetPassword) {
  throw new Error("ADMIN_PASSWORD or --password is required when --reset-password=true");
}

if (!password && !options["allow-existing"]) {
  throw new Error(
    "ADMIN_PASSWORD or --password is required for new admins. Use --allow-existing=true only when repairing an existing Auth user profile."
  );
}

if (dryRun) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        dry_run: true,
        email,
        role: "admin",
        status: "approved",
        company_name: companyName,
        would_reset_password: Boolean(password && shouldResetPassword),
        would_allow_existing_user: options["allow-existing"] === "true"
      },
      null,
      2
    )
  );
  process.exit(0);
}

assertRequired("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
assertRequired("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const user = await findOrCreateUser();
await upsertAdminProfile(user.id);

console.log(
  JSON.stringify(
    {
      ok: true,
      user_id: user.id,
      email: user.email,
      role: "admin",
      status: "approved",
      password_updated: Boolean(password && (shouldResetPassword || user.created)),
      profile_upserted: true
    },
    null,
    2
  )
);

async function findOrCreateUser() {
  const existing = await findUserByEmail(email);

  if (existing) {
    if (password && shouldResetPassword) {
      const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        user_metadata: {
          ...existing.user_metadata,
          role: "admin",
          company_name: companyName
        }
      });

      if (error || !data.user) {
        throw error || new Error("Unable to update existing admin password");
      }

      return { ...data.user, created: false };
    }

    return { ...existing, created: false };
  }

  if (!password) {
    throw new Error("No existing Auth user found; ADMIN_PASSWORD or --password is required");
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      role: "admin",
      company_name: companyName
    }
  });

  if (error || !data.user) {
    throw error || new Error("Supabase Auth did not return a user");
  }

  return { ...data.user, created: true };
}

async function upsertAdminProfile(userId) {
  const { error } = await supabase.from("profiles").upsert(
    {
      id: userId,
      role: "admin",
      company_name: companyName,
      phone,
      gst_number: gstNumber,
      status: "approved"
    },
    {
      onConflict: "id"
    }
  );

  if (error) {
    throw error;
  }
}

async function findUserByEmail(targetEmail) {
  let page = 1;
  const perPage = 100;

  while (page <= 100) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage
    });

    if (error) {
      throw error;
    }

    const match = data.users.find(
      (user) => user.email?.toLowerCase() === targetEmail.toLowerCase()
    );

    if (match) {
      return match;
    }

    if (data.users.length < perPage) {
      return null;
    }

    page += 1;
  }

  throw new Error("Scanned 10,000 Auth users without finding a match; narrow the setup manually.");
}

function parseArgs(args) {
  return Object.fromEntries(
    args
      .filter((arg) => arg.startsWith("--"))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=") || "true"];
      })
  );
}

function loadDotEnv(fileName) {
  const path = resolve(fileName);

  if (!existsSync(path)) {
    return;
  }

  const lines = readFileSync(path, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const [key, ...valueParts] = trimmed.split("=");

    if (Object.prototype.hasOwnProperty.call(process.env, key)) {
      continue;
    }

    process.env[key] = valueParts.join("=").replace(/^['"]|['"]$/g, "");
  }
}

function assertRequired(name, value) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
}
