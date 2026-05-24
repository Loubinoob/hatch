-- Phase 3 — Contextual Bandit, Structured Memory, Quiz Extensions

-- Posteriors per (variant, segment) — the core of the contextual bandit
create table if not exists public.variant_segment_posteriors (
  variant_id   uuid references public.paywall_variants on delete cascade not null,
  segment_hash text not null,
  segment_features jsonb not null default '{}'::jsonb,
  alpha        integer default 1 not null,
  beta         integer default 1 not null,
  views        integer default 0 not null,
  conversions  integer default 0 not null,
  updated_at   timestamptz default now() not null,
  primary key (variant_id, segment_hash)
);
create index if not exists vsp_variant_views
  on public.variant_segment_posteriors (variant_id, views desc);

-- Quiz UI activation per paywall (extend existing table)
alter table public.paywall_quizzes
  add column if not exists trigger_mode text default 'before_paywall'
    check (trigger_mode in ('before_paywall', 'disabled')),
  add column if not exists ai_generated boolean default false,
  add column if not exists completion_message text default 'Great — finding the best plan for you…';

-- Anti-patterns memory (what the agent must avoid re-testing)
create table if not exists public.agent_antipatterns (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid references public.accounts on delete cascade not null,
  pattern_type text not null check (pattern_type in (
    'angle', 'wording', 'price_anchor', 'design', 'cta_style', 'length', 'tone'
  )),
  description  text not null,
  evidence     jsonb default '{}'::jsonb,
  confidence   numeric(3,2) default 0.50,
  active       boolean default true,
  generated_at timestamptz default now() not null
);
create index if not exists antipatterns_account
  on public.agent_antipatterns (account_id, active, confidence desc, generated_at desc);

-- Extend agent_insights with structured learning type
alter table public.agent_insights
  add column if not exists learning_type text default 'observation'
    check (learning_type in ('positive_pattern', 'negative_pattern', 'observation', 'hypothesis')),
  add column if not exists segment_conditions jsonb default '{}'::jsonb,
  add column if not exists confirmed_count integer default 0,
  add column if not exists last_confirmed_at timestamptz;

-- Quiz responses: store segment hash for later contextual lookup
alter table public.quiz_responses
  add column if not exists segment_hash text,
  add column if not exists derived_features jsonb default '{}'::jsonb;
create index if not exists quiz_responses_segment
  on public.quiz_responses (account_id, segment_hash);

-- Plateau detection: track CI tightening over time
alter table public.paywall_variants
  add column if not exists last_ci_width numeric,
  add column if not exists last_ci_check_at timestamptz;

-- Store segment hash in variant_assignments for fast event-time lookup
alter table public.variant_assignments
  add column if not exists segment_hash text;

-- RLS
alter table public.variant_segment_posteriors enable row level security;
alter table public.agent_antipatterns enable row level security;

create policy "vsp_select" on public.variant_segment_posteriors
  for select to authenticated using (
    variant_id in (
      select id from public.paywall_variants
      where account_id in (
        select account_id from public.users where id = auth.uid()
      )
    )
  );

create policy "vsp_service_insert" on public.variant_segment_posteriors
  for insert to anon, authenticated with check (true);

create policy "vsp_service_update" on public.variant_segment_posteriors
  for update to anon, authenticated using (true);

create policy "antipatterns_account" on public.agent_antipatterns
  for all to authenticated
  using (
    account_id in (
      select account_id from public.users where id = auth.uid()
    )
  );
