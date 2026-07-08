"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient, isSupabaseBrowserConfigured } from "@/lib/supabase/client";
import { clearDevRole, setDevRole } from "@/lib/api-client";
import type { UserRole } from "@/lib/types";

const roles: UserRole[] = ["generator", "collector", "recycler", "admin"];

export default function AuthPage() {
  const router = useRouter();
  const [role, setRole] = useState<UserRole>("generator");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("generator@sustainable.ecg");
  const [password, setPassword] = useState("password123");
  const [companyName, setCompanyName] = useState("Aarav Packaging Pvt Ltd");
  const [phone, setPhone] = useState("+91 98765 43210");
  const [gstNumber, setGstNumber] = useState("29AAICA3918J1ZE");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedRole = params.get("role") as UserRole | null;
    const reason = params.get("reason");

    if (requestedRole && roles.includes(requestedRole)) {
      chooseRole(requestedRole);
    }

    if (reason) {
      setMessage(authReasonMessage(reason));
    }
  }, []);

  function chooseRole(nextRole: UserRole) {
    setRole(nextRole);
    setEmail(`${nextRole}@sustainable.ecg`);
    setCompanyName(defaultCompany(nextRole));
    setError("");
    setMessage("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      if (!isSupabaseBrowserConfigured) {
        setDevRole(role);
        router.push(`/dashboard/${role}`);
        return;
      }

      const supabase = createBrowserSupabaseClient();
      if (!supabase) {
        throw new Error("Supabase is not configured");
      }

      if (mode === "register") {
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            role,
            company_name: companyName,
            phone,
            gst_number: gstNumber
          })
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        await supabase.auth.resend({
          type: "signup",
          email
        });

        setMessage(
          role === "generator"
            ? "Registration created. Check your email verification, then sign in."
            : "Registration created and sent to admin approval."
        );
        setMode("login");
        return;
      }

      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (authError) {
        throw authError;
      }

      if (!authData.session) {
        throw new Error("Supabase did not return a session");
      }

      const sessionResponse = await fetch("/api/auth/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          access_token: authData.session.access_token,
          refresh_token: authData.session.refresh_token,
          expected_role: role
        })
      });

      if (!sessionResponse.ok) {
        await supabase.auth.signOut();
        throw new Error(await sessionResponse.text());
      }

      router.push(`/dashboard/${role}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication failed");
    }
  }

  async function clearSession() {
    const supabase = createBrowserSupabaseClient();
    await supabase?.auth.signOut();
    clearDevRole();
    await fetch("/api/auth/session", {
      method: "DELETE"
    });
    setMessage("Session cleared. Choose a role and sign in.");
    setError("");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-muted px-4 py-10">
      <section className="w-full max-w-2xl rounded-lg border border-border bg-card p-6 shadow-operational">
        <a className="font-bold text-primary" href="/">
          Curtail and Sustain Enterprise LLP
        </a>
        <p className="mt-6 text-sm font-black uppercase tracking-[0.16em] text-primary">
          hiii
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-normal">
          Role-based access for waste custody
        </h1>
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {roles.map((item) => (
            <button
              className={`rounded-md border px-3 py-3 text-sm font-black capitalize ${
                item === role
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background"
              }`}
              key={item}
              onClick={() => chooseRole(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 rounded-lg bg-muted p-1">
          {(["login", "register"] as const).map((item) => (
            <button
              className={`rounded-md py-2 text-sm font-black capitalize ${mode === item ? "bg-card shadow" : ""}`}
              key={item}
              onClick={() => setMode(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>

        <button
          className="mt-3 min-h-10 w-full rounded-md border border-border px-4 text-sm font-black text-muted-foreground"
          onClick={clearSession}
          type="button"
        >
          Clear current session
        </button>

        {!isSupabaseBrowserConfigured ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
            Supabase env vars are not set, so this runs in local development mode.
          </div>
        ) : null}

        <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
          {mode === "register" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                Company name
                <input onChange={(event) => setCompanyName(event.target.value)} value={companyName} />
              </label>
              <label>
                Phone
                <input onChange={(event) => setPhone(event.target.value)} value={phone} />
              </label>
              <label className="sm:col-span-2">
                GST number
                <input onChange={(event) => setGstNumber(event.target.value)} value={gstNumber} />
              </label>
            </div>
          ) : null}
          <label>
            Email
            <input onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
          </label>
          <label>
            Password
            <input onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
          </label>
          {role !== "generator" ? (
            <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              Collectors and recyclers can register immediately, but operational access is enabled only after admin approval.
            </div>
          ) : null}
          {message ? <p className="text-sm font-bold text-primary">{message}</p> : null}
          {error ? <p className="text-sm font-bold text-destructive">{error}</p> : null}
          <button className="min-h-11 rounded-md bg-primary px-4 font-black text-primary-foreground" type="submit">
            {mode === "login" ? `Login as ${role}` : `Register ${role}`}
          </button>
        </form>
      </section>
    </main>
  );
}

function defaultCompany(role: UserRole) {
  return {
    generator: "Aarav Packaging Pvt Ltd",
    collector: "GreenLoop Collection Services",
    recycler: "Prakriti Recyclers LLP",
    admin: "Sustainable ECG Operations"
  }[role];
}

function authReasonMessage(reason: string) {
  const messages: Record<string, string> = {
    "session-required": "Please sign in to access that dashboard.",
    "session-expired": "Your session expired. Please sign in again.",
    "profile-required": "Your account profile is missing. Contact an admin.",
    "wrong-role": "That dashboard is not available for your current role.",
    pending: "Your account is pending admin approval.",
    suspended: "Your account has been suspended. Contact an admin.",
    "dev-role-required": "Choose a role to open the local development dashboard.",
    "signed-out": "You have been signed out."
  };

  return messages[reason] || "Please sign in to continue.";
}
