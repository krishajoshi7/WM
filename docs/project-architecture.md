# Sustainable ECG Project Architecture

This document explains the current Sustainable ECG application architecture, the production MVP flow, the data model, and the technical stack. It reflects the system that is implemented in this repository today.

## Executive Summary

Sustainable ECG is a waste traceability and EPR compliance platform for the Indian market. It tracks waste batches from generator creation through collector pickup, recycler delivery, recycling completion, admin audit review, and EPR webhook reporting.

The legal backbone of the product is the custody chain. Every operational transition writes an append-only `custody_events` row before the visible batch status changes. The `waste_batches.status` field is used for fast dashboard display, while custody events remain the audit source of truth.

## Tech Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Frontend | Next.js 14 App Router | Role dashboards, landing page, auth, scanner UI |
| Language | TypeScript | Type-safe frontend, API routes, domain helpers |
| Styling | Tailwind CSS, shadcn-style primitives | Responsive production UI |
| Backend | Next.js API routes | MVP API layer hosted with the frontend |
| Auth | Supabase Auth | Email/password sessions and user identity |
| Database | Supabase Postgres | Batch, custody, pickup, recycling, webhook, audit records |
| Realtime | Supabase Realtime | Live dashboard status updates where enabled |
| Storage | Supabase Storage | Generator images, pickup proof, delivery proof |
| QR Rendering | `qrcode` | Printable QR image generation |
| QR Scanning | `html5-qrcode` | Browser/device camera scanning |
| QR Integrity | `jsonwebtoken` | Signed server-side QR token verification |
| Icons | `lucide-react` | Dashboard and control icons |
| Deployment Target | Vercel | Next.js frontend and API routes |
| External Integrations | EPR webhook endpoint, ops alert webhook | Compliance reporting and operational alerts |

## System Architecture

```mermaid
flowchart TB
  subgraph Users["Operational Users"]
    G["Generator"]
    C["Collector"]
    R["Recycler"]
    A["Admin"]
  end

  subgraph Web["Next.js 14 App on Vercel"]
    UI["App Router Pages and Dashboards"]
    API["Next.js API Routes"]
    MW["middleware.ts Session Guard"]
  end

  subgraph Supabase["Supabase"]
    AUTH["Auth"]
    DB["Postgres + RLS"]
    RT["Realtime"]
    ST["Storage"]
    RPC["Transactional RPC Functions"]
  end

  subgraph External["External Services"]
    EPR["Configured EPR Portal Webhook"]
    ALERTS["Ops Alert Webhook"]
  end

  G --> UI
  C --> UI
  R --> UI
  A --> UI
  UI --> API
  MW --> AUTH
  API --> AUTH
  API --> DB
  API --> ST
  API --> RPC
  DB --> RT
  UI --> RT
  API --> EPR
  API --> ALERTS
```

## Runtime Components

| Component | Main Files | Responsibility |
| --- | --- | --- |
| Landing and public UI | `app/page.tsx` | Product overview, role CTAs, demo metrics |
| Auth UI | `app/auth/page.tsx` | Login/register with role selection |
| Generator dashboard | `app/dashboard/generator/page.tsx` | Create batch, upload images, display QR, list batches |
| Collector dashboard | `app/dashboard/collector/page.tsx` | Available pickups, accept jobs, scan pickup QR, mark transit |
| Recycler dashboard | `app/dashboard/recycler/page.tsx` | Delivery scan, evidence upload, recycling completion |
| Admin dashboard | `app/dashboard/admin/page.tsx` | Approvals, metrics, audit trail, batch evidence, webhook review |
| API client | `lib/api-client.ts` | Browser fetch wrapper with JSON and blob support |
| Server auth | `lib/auth/server.ts` | Session and role checks for API routes |
| QR helpers | `lib/qr.ts` | Short QR payload handling and JWT verification helpers |
| Upload helpers | `lib/uploads.ts` | Signed upload URL validation and storage paths |
| EPR webhooks | `lib/epr-webhooks.ts` | Durable webhook delivery, retry, and abandonment alerting |
| Observability | `lib/observability.ts` | Structured server logs and alert dispatching |
| Rate limit | `lib/rate-limit.ts` | In-runtime request throttling for sensitive endpoints |

## Role Dashboards

| Role | Main Capabilities |
| --- | --- |
| Generator | Register/login, create waste batch, upload generator photos, receive printable QR, monitor status live, view batch list |
| Collector | View pending pickups, accept/reject pickup, upload pickup proof, scan QR at pickup, move accepted batch to transit |
| Recycler | View in-transit waste, upload delivery proof, scan QR at delivery, mark batch as recycled, create recycling log |
| Admin | Approve/suspend users, view pipeline metrics, inspect custody events, export CSV, download evidence PDF, retry webhook deliveries |

## Golden Custody Flow

```mermaid
sequenceDiagram
  participant Gen as Generator
  participant App as Next.js App/API
  participant Supa as Supabase
  participant Col as Collector
  participant Rec as Recycler
  participant Admin as Admin
  participant EPR as EPR Portal

  Gen->>App: Register or login
  App->>Supa: Validate Supabase session and profile
  Gen->>App: Create batch with category, weight, address, date, images
  App->>Supa: Store images through signed Storage upload
  App->>Supa: create_waste_batch_with_event RPC
  Supa-->>App: Batch code and short QR identifier
  App-->>Gen: Printable QR modal

  Col->>App: View available pending batches
  Col->>App: Accept pickup
  App->>Supa: accept_pickup_request RPC
  Col->>App: Upload pickup proof and scan QR
  App->>Supa: record_custody_scan RPC with pickup_scanned
  App->>Supa: record_custody_scan RPC with in_transit

  Rec->>App: View incoming in-transit batch
  Rec->>App: Upload delivery proof and scan QR
  App->>Supa: record_custody_scan RPC with delivered
  Rec->>App: Submit recycling quantity and method
  App->>Supa: complete_recycling RPC
  App->>EPR: POST compliance payload when configured

  Admin->>App: Review metrics, audit trail, evidence PDF
  App->>Supa: Query batches, custody events, webhook deliveries
```

## Data Model

```mermaid
erDiagram
  profiles ||--o{ waste_batches : creates
  profiles ||--o{ custody_events : performs
  profiles ||--o{ pickup_requests : accepts
  profiles ||--o{ recycling_logs : processes
  waste_batches ||--o{ custody_events : has
  waste_batches ||--o{ pickup_requests : assigned_by
  waste_batches ||--o{ recycling_logs : recycled_as
  waste_batches ||--o{ webhook_deliveries : reports
  profiles ||--o{ admin_audit_logs : admin_actor

  profiles {
    uuid id PK
    text role
    text company_name
    text phone
    text gst_number
    text status
    timestamptz created_at
  }

  waste_batches {
    uuid id PK
    text batch_code
    uuid generator_id FK
    text waste_type
    text category
    numeric weight_kg
    text pickup_address
    date pickup_date
    text[] images
    text qr_token
    text status
    timestamptz created_at
  }

  custody_events {
    uuid id PK
    uuid batch_id FK
    uuid actor_id FK
    text event_type
    numeric location_lat
    numeric location_lng
    text photo_url
    numeric weight_verified_kg
    text notes
    timestamptz created_at
  }

  pickup_requests {
    uuid id PK
    uuid batch_id FK
    uuid collector_id FK
    text status
    timestamptz accepted_at
    timestamptz estimated_pickup
    timestamptz created_at
  }

  recycling_logs {
    uuid id PK
    uuid batch_id FK
    uuid recycler_id FK
    text material_type
    numeric quantity_kg
    text recycling_method
    numeric epr_credits_claimed
    text report_url
    timestamptz created_at
  }

  webhook_deliveries {
    uuid id PK
    uuid batch_id FK
    text delivery_type
    text status
    text idempotency_key
    integer attempts
    timestamptz next_attempt_at
    timestamptz created_at
  }

  admin_audit_logs {
    uuid id PK
    uuid actor_id FK
    text action
    text target_type
    uuid target_id
    jsonb metadata
    timestamptz created_at
  }
```

## QR and Scan Architecture

The QR system intentionally keeps the printed QR payload short. The QR should not contain full batch JSON, images, or custody data.

Current design:

1. Generator creates a batch.
2. API creates a stable batch code such as `WM-2026-00004`.
3. API stores a signed `qr_token` server-side for authenticity.
4. The generated QR contains only the short identifier used by the scanner flow.
5. Scanner decodes the short identifier.
6. API fetches the full batch details from Supabase.
7. API verifies expected actor role, batch state, and QR authenticity.
8. API inserts the custody event before moving the batch to the next status.

```mermaid
flowchart LR
  B["Batch Created"] --> Q["Short QR Payload"]
  Q --> P["Printed QR Attached to Waste"]
  P --> S["Collector or Recycler Scans"]
  S --> API["/api/scans"]
  API --> V["Verify Role, State, Token"]
  V --> CE["Insert custody_events"]
  CE --> ST["Update waste_batches.status"]
```

This design makes QR codes visually cleaner, easier for cameras to decode, and more reliable during uploads or low-light scanning.

## API Surface

| API Route | Role Access | Purpose |
| --- | --- | --- |
| `POST /api/auth/register` | Public | Create Supabase Auth user and profile row |
| `GET /api/auth/session` | Authenticated | Resolve current user and profile status |
| `GET /api/metrics` | Public/dashboard | Aggregate landing and dashboard metrics |
| `GET /api/batches` | Role-based | List batches visible to the current user |
| `POST /api/batches` | Generator | Create batch, QR token, and initial custody event |
| `POST /api/pickups` | Collector | Accept/reject pickup requests and assign jobs |
| `POST /api/scans` | Collector, recycler | Verify QR scan and create custody events |
| `POST /api/recycling` | Recycler | Create recycling log, update recycled status, enqueue webhook |
| `GET /api/audit` | Admin | Full custody audit trail |
| `POST /api/admin/approvals` | Admin | Approve or suspend users |
| `GET /api/admin/audit-logs` | Admin | Inspect admin actions |
| `GET /api/admin/batches/[id]/evidence.pdf` | Admin | Download compliance evidence PDF |
| `POST /api/uploads/signed-url` | Authenticated roles | Create signed Supabase Storage upload URL |
| `GET /api/webhooks/epr/deliveries` | Admin | View webhook delivery queue |
| `POST /api/webhooks/epr/process` | Cron secret or admin retry | Retry pending/failed EPR webhook deliveries |
| `GET /api/health` | Monitoring | Validate environment, Supabase, tables, and storage |

## Database Integrity and RPC Layer

The most important state transitions are implemented through Supabase/Postgres functions so that custody writes and status changes happen atomically.

| RPC / Migration Area | Purpose |
| --- | --- |
| `create_waste_batch_with_event` | Creates a batch and its first `qr_generated` custody event together |
| `accept_pickup_request` | Assigns a collector and moves a batch from pending to assigned |
| `record_custody_scan` | Records pickup, transit, or delivery event before status update |
| `complete_recycling` | Creates recycling log, records recycled event, updates status |
| `enqueue_epr_webhook_delivery` | Stores an outbound compliance delivery with idempotency |
| `claim_webhook_deliveries` | Locks due webhook records for retry processing |
| `mark_webhook_delivery_result` | Marks webhook success, failure retry, or abandoned state |

The database also includes append-only enforcement for custody events and evidence integrity constraints for required pickup and delivery proof.

## Security Model

```mermaid
flowchart TB
  U["User Session"] --> SA["Supabase Auth"]
  SA --> P["profiles row: role + status"]
  P --> RBAC["API Route RBAC"]
  RBAC --> RLS["Supabase RLS Policies"]
  RLS --> DATA["Allowed Domain Data"]

  QR["Scanned QR Identifier"] --> JWT["Server-side QR Token Verification"]
  JWT --> STATE["Expected Role and Status Check"]
  STATE --> EVENT["Append-only Custody Event"]
  EVENT --> STATUS["Derived Batch Status Update"]
```

Controls currently implemented:

- Supabase Auth owns identity.
- `profiles.role` controls dashboard access and API authorization.
- `profiles.status` blocks pending or suspended operational users.
- API routes check role before returning or mutating data.
- Supabase Row Level Security protects table access.
- Custody events are append-only.
- Scan actions verify QR signature, expected role, and expected batch status.
- Pickup and delivery scans require evidence photo URLs.
- Uploads use signed Supabase Storage URLs rather than raw service key exposure.
- Sensitive endpoints have rate-limit checks.
- Admin actions are written to `admin_audit_logs`.

## Storage and Evidence

Supabase Storage is used for:

- Generator batch images.
- Collector pickup proof photos.
- Recycler delivery proof photos.

The browser requests a signed upload URL from `POST /api/uploads/signed-url`, uploads directly to Supabase Storage, then submits the returned URL to the relevant batch, scan, or recycling API. This avoids routing large image files through the Next.js API layer.

Admin evidence tools include:

- Batch custody timeline.
- Actor, timestamp, GPS, weight, notes, and evidence photo URL review.
- CSV export.
- PDF evidence packet download.

Current PDF packets include custody details and evidence URLs. Embedding binary image thumbnails directly into the PDF is a future hardening option.

## EPR Webhook Architecture

When a recycler marks a batch as recycled, the system creates a recycling log and prepares a compliance payload:

```json
{
  "batch_code": "WM-2026-00004",
  "recycler_id": "uuid",
  "quantity_kg": 120,
  "category": "PWM-CAT-II",
  "timestamp": "2026-05-19T00:00:00.000Z",
  "custody_chain": []
}
```

Delivery behavior:

1. If `EPR_WEBHOOK_URL` is configured, enqueue a durable `webhook_deliveries` row.
2. Try immediate delivery once.
3. Allow retries through `POST /api/webhooks/epr/process`.
4. Use `WEBHOOK_CRON_SECRET` for trusted scheduler calls.
5. Mark abandoned deliveries after retry budget is exhausted.
6. Send ops alerts through `OPS_ALERT_WEBHOOK_URL` when configured.

## Deployment Topology

```mermaid
flowchart LR
  Browser["User Browser / Mobile Camera"] --> Vercel["Vercel: Next.js App + API Routes"]
  Vercel --> Supabase["Supabase: Auth, Postgres, Realtime, Storage"]
  Vercel --> EPR["EPR Portal Webhook"]
  Scheduler["Vercel Cron or Trusted Scheduler"] --> Process["/api/webhooks/epr/process"]
  Process --> Supabase
  Process --> EPR
  Vercel --> Alerts["Ops Alert Webhook"]
```

Required environment variables:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
JWT_SECRET=
EPR_WEBHOOK_URL=
WEBHOOK_CRON_SECRET=
OPS_ALERT_WEBHOOK_URL=
NEXT_PUBLIC_APP_URL=
```

## Smoke Tests and Production Readiness

| Script | Purpose |
| --- | --- |
| `npm run smoke:golden` | Runs the full local custody pipeline through the app APIs |
| `npm run smoke:security` | Checks wrong-role access, invalid QR, invalid status transitions, suspended users |
| `npm run smoke:health` | Checks structured `/api/health` readiness behavior |
| `npm run smoke:rate-limit` | Verifies sensitive endpoint throttling |
| `npm run smoke:production` | Runs the real Supabase/Auth/Storage/API custody flow and cleans up temporary data |

The production smoke test passing means the MVP custody pipeline is working end to end against the connected database and storage:

Generator creates batch -> QR generated -> collector accepts -> pickup scan -> transit -> recycler delivery scan -> recycled -> admin audit visible.

## Current Production Notes

- The MVP is ready for pilot/investor demo when migrations, environment variables, admin user setup, storage bucket policy, and production smoke tests are complete.
- Application-level rate limits are per warm runtime. For internet production, add platform or edge throttling through Vercel, a WAF, or API gateway rules.
- Real-device QA should be done on Android and iOS camera scanning before field launch.
- The PDF evidence packet is useful for compliance review but does not yet embed the original image binaries.
- `EPR_WEBHOOK_URL` and `OPS_ALERT_WEBHOOK_URL` can be left empty for demo environments, but should be configured for production operations.
- Post-MVP items such as AI prediction, blockchain verification, credit trading, GPS live maps, IoT, and regulator portals are intentionally outside the current build.

## File Map

| Path | What it contains |
| --- | --- |
| `app/` | Next.js App Router pages and API routes |
| `app/dashboard/` | Role-specific dashboards |
| `app/api/` | Backend API routes for auth, batches, pickups, scans, recycling, admin, uploads, webhooks, health |
| `components/` | Shared UI primitives |
| `lib/` | Domain logic, Supabase clients, auth helpers, QR, uploads, webhooks, rate limits |
| `supabase/migrations/` | Database schema, RLS, RPCs, webhook queue, admin audit, evidence constraints |
| `scripts/` | Admin setup and smoke tests |
| `docs/` | Architecture, data model, deployment readiness, screens, scope |

