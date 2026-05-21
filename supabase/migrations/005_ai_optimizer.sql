-- ─── L1/L2/L3 AI Optimizer schema ────────────────────────────────────────────

-- Extend paywall_variants for Thompson bandit + AI hypotheses
alter table public.paywall_variants
  add column if not exists account_id uuid references public.accounts on delete cascade,
  add column if not exists hypothesis text,
  add column if not exists generated_by text default 'human'
    check (generated_by in ('human','ai')),
  add column if not exists is_control boolean default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archive_reason text,
  add column if not exists cta_copy text,
  add column if not exists body_copy text,
  add column if not exists accent_color text,
  add column if not exists posterior_alpha integer default 1,
  add column if not exists posterior_beta integer default 1;

-- Back-fill account_id from parent paywall
update public.paywall_variants pv
set account_id = p.account_id
from public.paywalls p
where pv.paywall_id = p.id and pv.account_id is null;

-- ─── Variant assignments ──────────────────────────────────────────────────────
create table if not exists public.variant_assignments (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references public.accounts on delete cascade not null,
  paywall_id uuid references public.paywalls on delete cascade not null,
  variant_id uuid references public.paywall_variants on delete set null,
  session_id text,
  user_id_external text,
  context jsonb default '{}'::jsonb,
  exposed_at timestamptz default now() not null,
  converted_at timestamptz,
  unique (paywall_id, session_id)
);
create index if not exists variant_assignments_paywall_variant
  on public.variant_assignments (paywall_id, variant_id);
create index if not exists variant_assignments_account_exposed
  on public.variant_assignments (account_id, exposed_at desc);

-- ─── Agent insights (L4 memory) ───────────────────────────────────────────────
create table if not exists public.agent_insights (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references public.accounts on delete cascade not null,
  paywall_id uuid references public.paywalls,
  insight text not null,
  evidence jsonb default '{}'::jsonb,
  importance integer default 5 check (importance between 1 and 10),
  category text check (category in (
    'pricing','copy','timing','audience','design','cta','social_proof','other'
  )),
  generated_at timestamptz default now() not null
);
create index if not exists agent_insights_account
  on public.agent_insights (account_id, importance desc, generated_at desc);

-- ─── Agent runs (audit trail) ─────────────────────────────────────────────────
create table if not exists public.agent_runs (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references public.accounts on delete cascade not null,
  paywall_id uuid references public.paywalls,
  run_type text not null check (run_type in ('generation','reflection','manual_trigger')),
  status text default 'pending' check (status in ('pending','running','succeeded','failed')),
  input_summary jsonb,
  output_summary jsonb,
  reasoning text,
  model_used text,
  tokens_in integer,
  tokens_out integer,
  duration_ms integer,
  error_message text,
  created_at timestamptz default now() not null
);
create index if not exists agent_runs_account
  on public.agent_runs (account_id, created_at desc);
create index if not exists agent_runs_paywall
  on public.agent_runs (paywall_id, created_at desc);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.variant_assignments enable row level security;
alter table public.agent_insights enable row level security;
alter table public.agent_runs enable row level security;

create policy "va_account_select" on public.variant_assignments
  for select to authenticated
  using (account_id in (select account_id from public.users where id = auth.uid()));

create policy "va_public_insert" on public.variant_assignments
  for insert to anon, authenticated with check (true);

create policy "va_public_update" on public.variant_assignments
  for update to anon, authenticated using (true);

create policy "insights_account" on public.agent_insights
  for all to authenticated
  using (account_id in (select account_id from public.users where id = auth.uid()));

create policy "runs_account_select" on public.agent_runs
  for select to authenticated
  using (account_id in (select account_id from public.users where id = auth.uid()));

create policy "runs_service_insert" on public.agent_runs
  for insert to authenticated, service_role with check (true);

create policy "runs_service_update" on public.agent_runs
  for update to authenticated, service_role using (true);
