-- 010_tracking.sql
-- Experiment record: one row per paywall impression (session Ã— paywall), denormalised.
-- Enables fast dashboard queries and is the future training table for AI optimisation.

create table if not exists public.paywall_impressions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts on delete cascade not null,
  paywall_id uuid references public.paywalls on delete cascade,
  session_id text not null,
  user_id_external text,

  -- CONTEXT: who + where + when
  device_type text,
  os text,
  browser text,
  viewport_w integer,
  viewport_h integer,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  referrer text,
  referrer_domain text,
  landing_page text,
  country text,
  region text,
  city text,
  timezone text,
  language text,
  hour_of_day integer,
  day_of_week integer,
  is_weekend boolean,
  is_returning boolean,
  session_count integer,
  segment_hash text,

  -- EXPOSITION: what was shown
  trigger_type text,
  variant_id uuid,
  quiz_id uuid,
  quiz_completed boolean default false,
  quiz_answers jsonb default '{}'::jsonb,
  price_shown_cents integer,
  interval_shown text,

  -- BEHAVIOUR: aggregated as events come in
  shown_at timestamptz default now(),
  dwell_ms integer,
  scroll_depth_max integer default 0,
  toggled_billing boolean default false,
  hovered_plans jsonb default '[]'::jsonb,
  reached_checkout boolean default false,
  dismissed boolean default false,
  dismiss_method text,
  exit_reason text,

  -- RESULT: outcome
  converted boolean default false,
  converted_at timestamptz,
  revenue_cents integer,
  plan_id uuid,
  churned boolean default false,
  refunded boolean default false,

  updated_at timestamptz default now() not null,
  unique (paywall_id, session_id)
);

-- Performance indexes
create index if not exists pi_account_time on public.paywall_impressions (account_id, shown_at desc);
create index if not exists pi_paywall_converted on public.paywall_impressions (paywall_id, converted);
create index if not exists pi_account_segment on public.paywall_impressions (account_id, segment_hash);
create index if not exists pi_session on public.paywall_impressions (session_id);

-- Events table indexes for fast dashboard queries
create index if not exists events_account_type_time
  on public.events (account_id, event_type, created_at desc);
create index if not exists events_paywall_type
  on public.events (paywall_id, event_type);

-- Row-level security
alter table public.paywall_impressions enable row level security;

create policy "impressions_select" on public.paywall_impressions
  for select to authenticated
  using (account_id in (
    select account_id from public.users where id = auth.uid()
  ));

-- Anon inserts allowed so the SDK (service key) can write
create policy "impressions_write" on public.paywall_impressions
  for all to anon, authenticated
  using (true)
  with check (true);

-- Add churned/refunded to subscribers if not present
alter table public.subscribers
  add column if not exists churned_at timestamptz,
  add column if not exists refunded_at timestamptz;

-- Track trial_end warning and refunds in events (no schema change needed, just docs)
-- event_type values: trial_ending, payment_failed, subscription_canceled, refund_issued

