# Sustainable ECG

Waste traceability and EPR compliance platform for the Indian market.

## Stack

- Next.js 14 App Router, TypeScript, Tailwind CSS, shadcn-style UI primitives
- Supabase Postgres, Auth, Realtime, Storage
- JWT-signed QR tokens with `jsonwebtoken`
- QR rendering with `qrcode`
- Camera scanning with `html5-qrcode`

## Core routes

- `/` landing page and pipeline overview
- `/auth` role-based login/register
- `/dashboard/generator` create batch, generate QR, list batches
- `/dashboard/collector` accept pickup, scan pickup QR, mark in transit
- `/dashboard/recycler` scan delivery QR, create recycling log, fire EPR webhook
- `/dashboard/admin` approvals, pipeline metrics, audit trail, batch explorer
- `/api/health` production readiness check for env, Supabase, tables, and storage

Dashboard headers include sign-out. The auth page also has **Clear current session** for clean role/account switching during demos and QA.

## Environment

Copy `.env.example` to `.env.local` and fill values:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
JWT_SECRET=
EPR_WEBHOOK_URL=
WEBHOOK_CRON_SECRET=
OPS_ALERT_WEBHOOK_URL=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

If Supabase env vars are not present, the UI runs in local development mode so the screens remain inspectable. Production custody, auth, storage, and realtime behavior requires Supabase.

## Database

Apply the migration in:

```text
supabase/migrations/20260512193000_initial_schema.sql
```

It creates profiles, waste batches, custody events, recycling logs, pickup requests, RLS policies, append-only custody triggers, storage bucket policies, and realtime publication entries.

Also apply the follow-up migrations in order:

```text
supabase/migrations/20260519090000_transactional_custody_rpc.sql
supabase/migrations/20260519100000_epr_webhook_deliveries.sql
supabase/migrations/20260519110000_admin_audit_logs.sql
supabase/migrations/20260519120000_custody_evidence_integrity.sql
```

For production setup, storage verification, Vercel deployment, and go/no-go checks, use:

```text
docs/deployment-readiness.md
```

For Vercel-specific import settings, environment variables, cron setup, and post-deploy checks, use:

```text
docs/vercel-deployment.md
```

For a full current architecture explanation with diagrams, runtime components, data model, QR flow, security model, deployment topology, and smoke-test coverage, see:

```text
docs/project-architecture.md
```

Deployment monitors can call `GET /api/health` or `HEAD /api/health`. A `200` response means readiness checks passed; `503` means at least one required production dependency is missing or unavailable.

## EPR Webhook Retries

When `EPR_WEBHOOK_URL` is set, recycling a batch creates a durable `webhook_deliveries` record with an idempotency key. The app tries one immediate delivery, and failed deliveries can be retried by calling:

```text
POST /api/webhooks/epr/process
Authorization: Bearer <WEBHOOK_CRON_SECRET>
```

Schedule that endpoint from Vercel Cron, Render Cron, or any trusted scheduler.

Admins can also inspect and manually retry failed/abandoned deliveries from `/dashboard/admin` under **EPR Webhook Deliveries**.

Set `OPS_ALERT_WEBHOOK_URL` to a Slack, Teams, Discord, or custom webhook endpoint to receive alerts when an EPR webhook delivery is abandoned after its retry budget.

## Admin Audit Logs

Admin approvals, suspensions, and manual webhook retries are recorded in `admin_audit_logs` and shown on `/dashboard/admin` under **Admin Action Audit**.

## First Admin Setup

After applying Supabase migrations, create or repair the first approved admin account with:

```bash
npm run setup:admin -- --email=ops@example.com --password=<temporary-strong-password> --company="Sustainable ECG Operations"
```

The script uses `SUPABASE_SERVICE_ROLE_KEY`, creates the Auth user if needed, and upserts the matching `profiles` row as `role='admin'` and `status='approved'`.

Use `--dry-run=true` to validate inputs without contacting Supabase.

## Compliance Evidence Packets

Admins can select a batch in `/dashboard/admin` to view its custody timeline with generator images, pickup photos, delivery photos, GPS, verified weights, and actor timestamps. The selected timeline can be exported as CSV or printed to a PDF evidence packet.

## Run

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Smoke Test

Run the golden custody flow against a temporary local Next server:

```bash
npm run smoke:golden
```

The test creates a batch, accepts pickup, scans pickup, marks transit, scans delivery, recycles the batch, and verifies the admin audit trail.

Run negative security checks:

```bash
npm run smoke:security
```

That test verifies wrong-role access, invalid QR, invalid status transitions, and suspended-user rejection.

Run readiness endpoint checks:

```bash
npm run smoke:health
```

That test verifies `/api/health` returns structured readiness data and reports missing Supabase configuration as `503` in smoke mode.

Run the real Supabase production smoke test:

```bash
npm run smoke:production
```

That test uses configured Supabase credentials, creates temporary approved users, uploads evidence images to Storage through signed URLs, runs the full custody flow through real Auth/API/DB paths, verifies audit evidence, then removes the temporary users and batch records.

Run rate-limit checks:

```bash
npm run smoke:rate-limit
```

That test verifies sensitive endpoints return `429` with retry headers after the configured request budget.

## Continuous Integration

GitHub Actions runs `.github/workflows/ci.yml` for every push and pull request. A change must pass:

- ESLint
- TypeScript type checking
- Next.js production build
- Golden custody flow smoke test
- Security smoke test
- Health endpoint smoke test
- Rate-limit smoke test

The real Supabase production smoke test is intentionally excluded from automatic pull-request CI because it creates temporary Auth, Storage, and database records. Run `npm run smoke:production` manually against the intended environment before a production release.
