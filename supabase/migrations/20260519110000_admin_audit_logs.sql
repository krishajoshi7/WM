-- Admin action audit trail.
-- Custody events track waste movement; this table tracks operator/admin actions
-- such as approvals, suspensions, retries, and future destructive operations.

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  target_type text not null,
  target_id text not null,
  metadata jsonb not null default '{}',
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_actor_id_idx
on public.admin_audit_logs(actor_id);

create index if not exists admin_audit_logs_action_created_at_idx
on public.admin_audit_logs(action, created_at desc);

create index if not exists admin_audit_logs_target_idx
on public.admin_audit_logs(target_type, target_id);

alter table public.admin_audit_logs enable row level security;

create policy "admins read admin audit logs"
on public.admin_audit_logs for select
using (public.current_role() = 'admin');

create policy "service role manages admin audit logs"
on public.admin_audit_logs for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
