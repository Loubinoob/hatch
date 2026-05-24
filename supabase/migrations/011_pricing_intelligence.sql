-- ─── Pricing Intelligence — migration 011 ────────────────────────────────────
-- Adds: elasticity snapshots, variable importance, scientist runs, data maturity

-- Snapshot d'élasticité calculé par segment (lu par le scientist + le dashboard)
create table if not exists public.price_elasticity_snapshots (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references public.accounts on delete cascade not null,
  plan_id uuid references public.plans on delete cascade not null,
  segment_hash text,                         -- null = global
  segment_features jsonb default '{}'::jsonb,
  -- Points de la courbe : [{ price_cents, impressions, conversions, conv_rate, rpi_cents, ci_low, ci_high }]
  curve jsonb not null default '[]'::jsonb,
  optimal_price_cents integer,               -- prix qui maximise le RPI
  optimal_rpi_cents numeric,
  confidence numeric(3,2) default 0,         -- 0-1, fiabilité de la courbe
  computed_at timestamptz default now() not null
);
create index if not exists price_elasticity_snapshots_account_plan_idx
  on public.price_elasticity_snapshots (account_id, plan_id, computed_at desc);

-- Variables les plus rémunératrices ("la variable parfaite")
create table if not exists public.pricing_variable_importance (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references public.accounts on delete cascade not null,
  plan_id uuid references public.plans on delete cascade,
  variable_name text not null,               -- ex: 'utm_source', 'device_type', 'q_role'
  importance_score numeric not null,         -- 0-1, force de discrimination tarifaire
  -- Prix optimal par valeur : { "social": 1900, "organic": 4900 }
  optimal_price_by_value jsonb default '{}'::jsonb,
  revenue_spread_cents integer,              -- écart de RPI entre meilleure et pire valeur
  evidence jsonb default '{}'::jsonb,
  computed_at timestamptz default now() not null
);
create index if not exists pricing_variable_importance_account_idx
  on public.pricing_variable_importance (account_id, importance_score desc);

-- Runs du Pricing Scientist (audit + dashboard + mémoire)
create table if not exists public.pricing_scientist_runs (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references public.accounts on delete cascade not null,
  plan_id uuid references public.plans on delete cascade,
  run_type text not null check (run_type in ('cold_start','analysis','evolution')),
  engine text not null default 'claude' check (engine in ('claude','in_house_model')),
  data_maturity numeric,                     -- 0-1 au moment du run
  reasoning text,                            -- explication langage naturel pour le founder
  actions jsonb default '[]'::jsonb,         -- candidats ajoutés/élagués
  model_used text,
  tokens_in integer,
  tokens_out integer,
  duration_ms integer,
  created_at timestamptz default now() not null
);
create index if not exists pricing_scientist_runs_account_idx
  on public.pricing_scientist_runs (account_id, created_at desc);

-- Maturité de données par (plan, segment) — gate Claude vs modèle maison
create table if not exists public.pricing_data_maturity (
  plan_id uuid references public.plans on delete cascade not null,
  segment_hash text not null default 'global',
  total_impressions integer default 0,
  total_conversions integer default 0,
  distinct_prices_tested integer default 0,
  maturity_score numeric default 0,          -- 0-1, calculé via sigmoïde
  preferred_engine text default 'claude',    -- bascule à 'in_house_model' au-dessus du seuil
  updated_at timestamptz default now() not null,
  primary key (plan_id, segment_hash)
);

-- Mémoire de pricing (raisonnements durables, réinjectés dans runs futurs)
alter table public.agent_insights
  add column if not exists pricing_related boolean default false;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.price_elasticity_snapshots  enable row level security;
alter table public.pricing_variable_importance enable row level security;
alter table public.pricing_scientist_runs      enable row level security;
alter table public.pricing_data_maturity       enable row level security;

create policy "pes_account" on public.price_elasticity_snapshots
  for all to authenticated
  using (account_id in (select account_id from public.users where id = auth.uid()));

create policy "pvi_account" on public.pricing_variable_importance
  for all to authenticated
  using (account_id in (select account_id from public.users where id = auth.uid()));

create policy "psr_account" on public.pricing_scientist_runs
  for select to authenticated
  using (account_id in (select account_id from public.users where id = auth.uid()));

create policy "pdm_all" on public.pricing_data_maturity
  for all to anon, authenticated
  using (true) with check (true);
