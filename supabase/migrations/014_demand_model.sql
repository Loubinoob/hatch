-- Chapelle-Li 2011 diagonal Gaussian posterior for each (plan, segment) pair.
-- m_vec[i] = posterior mean for weight i
-- q_vec[i] = posterior precision (= 1/variance) for weight i
-- Prior: q_i_0 = 1.0  →  N(0, 1) weak regularisation
-- feature_names stores the canonical order so the array positions never drift.

create table if not exists public.pricing_demand_models (
  id              uuid        not null default gen_random_uuid() primary key,
  plan_id         uuid        not null references public.plans(id) on delete cascade,
  account_id      uuid        not null,
  segment_hash    text        not null default 'global',

  -- observation count (gates hierarchical borrowing)
  n_obs           integer     not null default 0,

  -- reference price used to normalise price_cents → price_norm
  anchor_cents    integer     not null,

  -- ordered feature names so array positions are stable across updates
  feature_names   text[]      not null default '{}',

  -- diagonal Gaussian posterior
  m_vec           double precision[] not null default '{}',
  q_vec           double precision[] not null default '{}',

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (plan_id, segment_hash)
);

-- index: scientist + bandit both query by plan_id
create index if not exists idx_pricing_demand_models_plan_id
  on public.pricing_demand_models (plan_id);

-- RLS: service role only (SDK routes use service key; no direct user access needed)
alter table public.pricing_demand_models enable row level security;
