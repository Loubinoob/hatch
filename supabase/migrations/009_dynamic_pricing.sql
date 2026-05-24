-- â”€â”€â”€ Dynamic Pricing â€” Revenue-weighted bandit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- Price candidates per plan (tested by the revenue bandit)
create table if not exists public.plan_price_candidates (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid references public.plans on delete cascade not null,
  account_id  uuid references public.accounts on delete cascade not null,
  interval    text not null check (interval in ('monthly','yearly')),
  price_cents integer not null,
  is_anchor   boolean default false,   -- original price set by the founder
  is_active   boolean default true,
  generated_by text default 'ai' check (generated_by in ('ai','human')),
  created_at  timestamptz default now() not null,
  unique (plan_id, interval, price_cents)
);
create index on public.plan_price_candidates (plan_id, interval, is_active);

-- Posteriors per (price candidate, segment) â€” optimise REVENUE not just conversion
create table if not exists public.price_point_posteriors (
  price_candidate_id uuid references public.plan_price_candidates on delete cascade not null,
  segment_hash       text not null,
  alpha              integer default 1 not null,        -- beta prior for conversion prob
  beta               integer default 1 not null,
  impressions        integer default 0 not null,
  conversions        integer default 0 not null,
  revenue_cents      bigint  default 0 not null,
  updated_at         timestamptz default now() not null,
  primary key (price_candidate_id, segment_hash)
);

-- Guard rails + dynamic pricing flag per plan
alter table public.plans
  add column if not exists dynamic_pricing_enabled boolean default true,
  add column if not exists price_floor_cents  integer,
  add column if not exists price_ceiling_cents integer;

-- Record price shown on each variant assignment
alter table public.variant_assignments
  add column if not exists price_candidate_id  uuid references public.plan_price_candidates,
  add column if not exists price_shown_cents   integer;

-- Extra indexes on events table for behavioral analytics
create index if not exists events_account_type_created
  on public.events (account_id, event_type, created_at desc);
create index if not exists events_paywall_type
  on public.events (paywall_id, event_type)
  where paywall_id is not null;

-- RLS
alter table public.price_point_posteriors  enable row level security;
alter table public.plan_price_candidates   enable row level security;

create policy "ppc_account" on public.plan_price_candidates
  for all to authenticated
  using (account_id in (select account_id from public.users where id = auth.uid()));

create policy "ppp_select" on public.price_point_posteriors
  for select to authenticated
  using (
    price_candidate_id in (
      select id from public.plan_price_candidates
      where account_id in (select account_id from public.users where id = auth.uid())
    )
  );

-- SDK (anon) needs to upsert posteriors during serving
create policy "ppp_write" on public.price_point_posteriors
  for all to anon, authenticated
  using (true) with check (true);

