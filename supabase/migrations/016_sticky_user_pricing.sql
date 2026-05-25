-- ── Migration 016: Sticky user price assignments + pricing_frozen flag ───────
--
-- 1. Absorb migration 015 (pricing_aggressiveness) safely — idempotent.
-- 2. Add user_key + all_plan_prices to variant_assignments for sticky prices.
-- 3. Add pricing_frozen flag to plans.

-- ── 015 absorb (safe if already applied) ──────────────────────────────────────
alter table public.plans
  add column if not exists pricing_aggressiveness text
    default 'balanced'
    check (pricing_aggressiveness in ('conservative', 'balanced', 'aggressive'));

-- ── Sticky user price assignment ──────────────────────────────────────────────
-- user_key: persistent anonymous id from SDK localStorage (never changes per browser)
-- all_plan_prices: { plan_id → price_cents } map — the prices this user was assigned
alter table public.variant_assignments
  add column if not exists user_key text,
  add column if not exists all_plan_prices jsonb default '{}';

-- Fast lookup by (paywall, user) — only index rows that have a user_key
create index if not exists va_paywall_user_key
  on public.variant_assignments (paywall_id, user_key)
  where user_key is not null;

-- ── Pricing frozen flag ───────────────────────────────────────────────────────
-- When true: bandit and scientist stop adjusting.
-- All users (even new ones) receive the dominant/anchor price, frozen.
alter table public.plans
  add column if not exists pricing_frozen boolean default false;
