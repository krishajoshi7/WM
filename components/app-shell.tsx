import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/sign-out-button";

export function AppShell({
  children,
  role
}: {
  children: ReactNode;
  role?: string;
}) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link className="font-black text-primary" href="/">
            Curtail and Sustain Enterprise LLP
          </Link>
          {/*  
          <nav className="flex flex-wrap items-center gap-3 text-sm font-semibold text-muted-foreground">
            <Link href="/auth">Auth</Link>
            <Link href="/dashboard/generator">Generator</Link>
            <Link href="/dashboard/collector">Collector</Link>
            <Link href="/dashboard/recycler">Recycler</Link>
            <Link href="/dashboard/admin">Admin</Link>
          </nav> */}
          <div className="flex items-center gap-2">
            {role ? (
              <span className="hidden rounded-md border border-border px-3 py-1 text-xs font-bold uppercase tracking-wide text-muted-foreground sm:inline-flex">
                {role}
              </span>
            ) : null}
            {role ? <SignOutButton /> : null}
          </div>
        </div>
      </header>
      {children}
    </main>
  );
}
