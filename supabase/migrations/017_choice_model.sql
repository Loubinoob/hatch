-- ─── Migration 017 — Multinomial Logit Choice Model ────────────────────────────
--
-- Adds joint paywall revenue optimisation: a per-paywall multinomial logit model
-- that captures substitution effects between plans and optimises total RPI.
--
-- Changes:
--   1. pricing_choice_models — stores the per-paywall choice model state
--   2. paywall_impressions.menu_shown_cents — full price vector per impression

-- 1. Choice model table (one row per paywall)
create table if not exists public.pricing_choice_models (
  id          uuid primary key default gen_random_uuid(),
  paywall_id  uuid not null references public.paywalls(id) on delete cascade,
  account_id  uuid not null,
  -- Per-plan Bayesian parameters:
  -- { plan_id: { a_mean, a_prec, b_mean, b_prec, anchor_cents } }
  plan_params jsonb not null default '{}',
  -- Total number of observations (paywall impressions with outcome)
  n_obs       integer not null default 0,
  updated_at  timestamptz default now()
);

-- Unique: one model per paywall
create unique index if not exists pricing_choice_models_paywall_id
  on public.pricing_choice_models (paywall_id);

-- Index by account for dashboard queries
create index if not exists pricing_choice_models_account_id
  on public.pricing_choice_models (account_id);

-- RLS: each account can only see its own models
alter table public.pricing_choice_models enable row level security;

create policy "account_isolation" on public.pricing_choice_models
  for all
  using (
    account_id = (
      select account_id from public.users where id = auth.uid()
    )
  );

-- 2. Add full menu tracking to paywall_impressions
--    (which prices were shown for ALL plans in the paywall at this impression)
alter table public.paywall_impressions
  add column if not exists menu_shown_cents jsonb;
-- Example: { "plan_id_1": 2900, "plan_id_2": 4900 }
