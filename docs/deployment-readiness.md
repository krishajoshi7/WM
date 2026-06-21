# Sustainable ECG Deployment Readiness

Use this checklist before moving a new environment to production. The goal is to prove the full legal custody path works with real Supabase Auth, Postgres, Realtime, Storage, QR scans, and EPR webhook retries.

## 1. Required Services

- Vercel project for the Next.js app.
- Supabase project with Postgres, Auth, Realtime, and Storage enabled.
- EPR webhook endpoint, if portal submission should run automatically.
- A scheduler for webhook retries, such as Vercel Cron or another trusted cron runner.

The current MVP is a single Next.js app. No separate Express or Render backend is required unless the product later grows long-running workers or non-Vercel services.

## 2. Environment Variables

Create these variables in `.env.local` for local development and in Vercel project settings for production:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
JWT_SECRET=
EPR_WEBHOOK_URL=
WEBHOOK_CRON_SECRET=
OPS_ALERT_WEBHOOK_URL=
NEXT_PUBLIC_APP_URL=
```

Production notes:

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon public key.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only service role key. Never expose it in browser code.
- `JWT_SECRET`: long random secret used to sign stored QR JWTs. Keep stable; rotating it invalidates existing QR token verification unless a rotation strategy is added.
- `EPR_WEBHOOK_URL`: optional. If empty, recycled batches still complete but external portal delivery is skipped.
- `WEBHOOK_CRON_SECRET`: long random bearer token for `POST /api/webhooks/epr/process`.
- `OPS_ALERT_WEBHOOK_URL`: optional alert target for abandoned EPR webhook deliveries.
- `NEXT_PUBLIC_APP_URL`: production origin, for example `https://your-domain.example`.

Do not set `SUSTAINABLE_ECG_SMOKE_MODE=true` in production. That flag intentionally disables Supabase for local smoke tests.

## 3. Supabase Database Setup

Apply migrations in this exact order:

```text
supabase/migrations/20260512193000_initial_schema.sql
supabase/migrations/20260519090000_transactional_custody_rpc.sql
supabase/migrations/20260519100000_epr_webhook_deliveries.sql
supabase/migrations/20260519110000_admin_audit_logs.sql
supabase/migrations/20260519120000_custody_evidence_integrity.sql
```

If using Supabase CLI, run the equivalent of:

```bash
supabase db push
```

If applying manually through SQL editor, paste each migration in order and confirm it completes with no errors.

## 4. Database Verification

Confirm these objects exist:

- Tables: `profiles`, `waste_batches`, `custody_events`, `pickup_requests`, `recycling_logs`, `webhook_deliveries`, `admin_audit_logs`.
- Sequence: `waste_batch_code_seq`.
- Functions: `next_batch_code`, `create_waste_batch_with_event`, `accept_pickup_request`, `record_custody_scan`, `complete_recycling`.
- Trigger behavior: `custody_events` rejects update and delete.
- Evidence constraints: pickup and delivery custody events require `photo_url`; verified weights must be positive; GPS latitude and longitude must be stored together.
- RLS enabled on operational tables.
- Realtime publication includes `waste_batches` and `custody_events`.

Run a direct database check for append-only custody before launch:

```sql
select relrowsecurity
from pg_class
where relname in (
  'profiles',
  'waste_batches',
  'custody_events',
  'pickup_requests',
  'recycling_logs'
);
```

Every returned row should have `relrowsecurity = true`.

## 5. Supabase Auth Setup

In Supabase Auth settings:

- Enable email/password signups.
- Configure the production site URL to match `NEXT_PUBLIC_APP_URL`.
- Add any local callback URL needed for development, such as `http://localhost:3000`.
- Configure email confirmation according to launch policy.

Operational account flow:

- New users register from `/auth`.
- Their profile starts as `pending`.
- Admin approves collectors and recyclers before they can operate.
- Suspended users are blocked by API auth checks.

Create the first admin carefully:

1. Set these variables locally, either in the shell or `.env.local`:

```bash
ADMIN_EMAIL=ops@example.com
ADMIN_PASSWORD=<temporary-strong-password>
ADMIN_COMPANY_NAME=Sustainable ECG Operations
ADMIN_PHONE=
ADMIN_GST_NUMBER=
```

2. Run:

```bash
npm run setup:admin
```

The script uses `SUPABASE_SERVICE_ROLE_KEY` to create the Auth user if needed and upsert its `profiles` row with `role = 'admin'` and `status = 'approved'`.

You can also pass values as CLI flags:

```bash
npm run setup:admin -- --email=ops@example.com --password=<temporary-strong-password> --company="Sustainable ECG Operations"
```

To verify inputs without touching Supabase, add `--dry-run=true`:

```bash
npm run setup:admin -- --email=ops@example.com --password=<temporary-strong-password> --dry-run=true
```

For an existing Auth user, use:

```bash
npm run setup:admin -- --email=ops@example.com --allow-existing=true
```

To intentionally reset the password for an existing admin:

```bash
npm run setup:admin -- --email=ops@example.com --password=<new-strong-password> --reset-password=true
```

3. Sign in as admin and approve other users from `/dashboard/admin`.

## 6. Supabase Storage Setup

The initial migration creates a public bucket:

```text
batch-images
```

It stores:

- Generator batch images under `batch-images/<user-id>/...`.
- Pickup and delivery custody photos under `custody-photos/<user-id>/...`.

Verify in Supabase Storage:

- Bucket `batch-images` exists.
- Bucket is public, because admin packets and timeline thumbnails render stored evidence URLs.
- Insert policy allows authenticated uploads.
- Select policy allows reading bucket objects.

The app uses signed upload URLs through:

```text
POST /api/uploads/signed-url
```

The endpoint validates file name, MIME type, file size, actor role, and upload purpose before issuing a signed upload token.

Current accepted file types:

```text
image/jpeg
image/png
image/webp
```

Current maximum file size:

```text
8 MB
```

## 7. Vercel Deployment

Set the production environment variables in Vercel, then deploy the main branch.

Recommended project settings:

- Framework preset: Next.js.
- Build command: `npm run build`.
- Install command: `npm install`.
- Output directory: keep default for Next.js.
- Node.js version: use a supported current LTS version.

After deployment:

- Open `/`.
- Open `/auth`.
- Sign in as admin.
- Confirm `/dashboard/admin` loads metrics without auth errors.

## 8. Webhook Retry Cron

If `EPR_WEBHOOK_URL` is configured, schedule this endpoint:

```text
POST /api/webhooks/epr/process
Authorization: Bearer <WEBHOOK_CRON_SECRET>
```

Suggested interval:

```text
Every 5 minutes
```

Manual admin retries are available under `/dashboard/admin` in **EPR Webhook Deliveries**.

## 9. Observability

The app writes structured JSON logs for server-side errors and EPR webhook delivery lifecycle events. Logs include service name, environment, timestamp, event message, and non-secret metadata.

Set this optional environment variable to receive an alert when an EPR webhook delivery is abandoned after all retry attempts:

```bash
OPS_ALERT_WEBHOOK_URL=
```

The alert payload is JSON and also includes a `text` field for Slack/Teams/Discord-style webhook receivers. Secret-looking fields are redacted in structured logs.

## 10. Health Check

Use this endpoint for deployment readiness monitoring:

```text
GET /api/health
HEAD /api/health
```

The endpoint verifies:

- Required environment variables are present.
- Optional webhook variables are reported as warnings when absent.
- Supabase can be reached with the service role key.
- Critical migration tables are available.
- Storage bucket `batch-images` is available.
- `SUSTAINABLE_ECG_SMOKE_MODE` is not accidentally enabled in production.

Response behavior:

- `200` means no failing checks.
- `503` means at least one required readiness check failed.
- Secret values are never returned.

Example:

```bash
curl https://your-domain.example/api/health
```

Use `HEAD /api/health` for simple uptime monitors that only need the HTTP status code.

## 11. Rate Limiting

Sensitive mutation routes include per-runtime rate limits:

- Auth session and registration.
- Signed upload URL creation.
- Pickup acceptance/rejection.
- QR scan custody events.
- Recycling completion.
- Admin approval/suspension actions.
- EPR webhook retry processing.

Limited responses return:

```text
429 Too Many Requests
Retry-After: <seconds>
X-RateLimit-Limit: <limit>
X-RateLimit-Remaining: 0
X-RateLimit-Reset: <timestamp>
```

This app-level limiter protects each warm server runtime. For production, also configure platform or WAF limits at Vercel/edge level because serverless instances do not share in-memory counters globally.

## 12. Production Smoke Test

Run this in the deployed environment with real users:

1. Register or sign in as generator, collector, recycler, and admin.
2. Admin approves collector and recycler.
3. Generator creates a waste batch with a batch image.
4. Generator downloads or prints the QR label.
5. Collector accepts the pickup.
6. Collector attaches pickup photo proof and scans the QR.
7. Collector marks the batch in transit.
8. Recycler attaches delivery photo proof and scans the QR.
9. Recycler creates the recycling log.
10. Admin opens the selected batch in `/dashboard/admin`.
11. Verify timeline includes `qr_generated`, `pickup_accepted`, `pickup_scanned`, `in_transit`, `delivered`, and `recycled`.
12. Verify batch images and custody photos render inline.
13. Download CSV and print the PDF evidence packet.
14. If webhook is configured, verify an EPR webhook delivery record exists and is delivered or retryable.

## 13. Local Verification Commands

Before pushing a release, run:

```bash
npm run smoke:golden
npm run smoke:health
npm run smoke:rate-limit
npm run smoke:security
npm run build
```

Against a real Supabase project, run:

```bash
npm run smoke:production
```

This creates temporary approved generator, collector, recycler, and admin users; uploads evidence files through signed Storage URLs; completes the full custody path; verifies admin audit evidence; and deletes the temporary smoke data afterward.

For TypeScript-only verification:

```bash
.\node_modules\.bin\tsc.cmd --noEmit
```

If `next dev` and `next build` are run at the same time and `.next` cache errors appear, stop both processes, remove only the generated `.next` directory, and rerun the command sequentially.

## 14. Go/No-Go Checklist

- All migrations applied in order.
- Production env vars are set in Vercel.
- `GET /api/health` returns `200`.
- `OPS_ALERT_WEBHOOK_URL` is configured if portal-delivery alerts are required.
- App-level rate-limit smoke test passes.
- Vercel or edge-level rate limiting is configured for production abuse protection.
- `JWT_SECRET` and `WEBHOOK_CRON_SECRET` are strong and private.
- Supabase Auth site URL matches production domain.
- First admin account exists and is approved.
- Storage bucket `batch-images` exists and signed uploads work.
- Realtime updates are visible on dashboards.
- `npm run smoke:production` passes against the production Supabase project.
- Golden operational flow passes manually with real Supabase users.
- Admin timeline shows custody photos.
- CSV and PDF evidence packet exports work.
- Webhook retry cron is configured if EPR portal integration is enabled.
- Suspended and pending accounts cannot operate.
