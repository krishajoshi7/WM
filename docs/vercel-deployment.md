# Vercel Deployment Guide

This project is a Next.js 14 App Router application, so Vercel can host both the frontend pages and the API routes.

## Before Deploying

Make sure these are complete:

- The project is pushed to GitHub.
- Supabase migrations have been applied.
- Supabase Storage bucket and policies are configured.
- A production admin user has been created with `npm run setup:admin`.
- Local checks pass with `npm run build` and the smoke tests.

## Import Project

1. Open Vercel.
2. Select **Add New Project**.
3. Import the GitHub repository.
4. Use the **Next.js** framework preset.
5. If the repository root contains this app directly, keep the root directory unchanged.
6. If the repository root contains an outer folder and the app is inside `Waste-management-main`, set Vercel's root directory to:

```text
Waste-management-main
```

## Build Settings

Use the defaults:

| Setting | Value |
| --- | --- |
| Install command | `npm install` or Vercel default |
| Build command | `npm run build` |
| Output directory | Next.js default |

## Environment Variables

Add these in Vercel Project Settings -> Environment Variables for Production and Preview as needed:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
JWT_SECRET=
EPR_WEBHOOK_URL=
CRON_SECRET=
WEBHOOK_CRON_SECRET=
OPS_ALERT_WEBHOOK_URL=
NEXT_PUBLIC_APP_URL=
```

Notes:

- `NEXT_PUBLIC_APP_URL` should be the final Vercel production URL or custom domain.
- `JWT_SECRET`, `CRON_SECRET`, and `WEBHOOK_CRON_SECRET` should be long random strings.
- `WEBHOOK_CRON_SECRET` can match `CRON_SECRET`. The app accepts either name so Vercel Cron and manual processors both work.
- `EPR_WEBHOOK_URL` and `OPS_ALERT_WEBHOOK_URL` can stay empty for demo environments.

## Cron Job

`vercel.json` configures this daily cron job:

```text
0 2 * * * -> /api/webhooks/epr/process
```

The time is UTC. This schedule runs at 07:30 IST.

The job processes queued EPR webhook deliveries. The daily schedule is safe for Vercel Hobby. If the project is on Vercel Pro and webhook retry speed matters, change the schedule to a more frequent expression such as:

```text
*/15 * * * *
```

## Supabase Auth URLs

In Supabase Auth settings, add the Vercel production URL to the allowed site/redirect URLs. Include:

```text
https://your-vercel-app.vercel.app
https://your-vercel-app.vercel.app/auth
```

Add the custom domain too if you use one.

## After Deploy

1. Open the deployed site.
2. Check:

```text
/api/health
```

3. Confirm the response is `200`.
4. Sign in as admin.
5. Run:

```bash
npm run smoke:production
```

against the deployed environment after setting local env values to the production project.

## Common Issues

| Symptom | Likely Cause |
| --- | --- |
| Login says failed to fetch | Missing env vars, blocked Supabase URL, or wrong Supabase redirect URL |
| `/api/health` returns `503` | Supabase env/storage/table check failed |
| Cron returns unauthorized | Missing `CRON_SECRET` or mismatched `WEBHOOK_CRON_SECRET` |
| Upload fails | Supabase Storage bucket or policy not configured |
| Build fails | Wrong Vercel root directory or missing dependencies |

