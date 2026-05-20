-- Hatch — Phase 1.5 schema additions

-- ─── Accounts: add heartbeat + sort_order on plans ───────────────────────────
alter table public.accounts
  add column if not exists last_heartbeat_at timestamptz;

-- ─── Plans: add sort_order + is_most_popular ─────────────────────────────────
alter table public.plans
  add column if not exists sort_order integer default 0,
  add column if not exists is_most_popular boolean default false,
  add column if not exists trial_days integer default 0;

-- ─── Project Briefs ───────────────────────────────────────────────────────────
create table if not exists public.project_briefs (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references public.accounts on delete cascade not null unique,
  app_description text,
  app_category text check (app_category in (
    'saas','productivity','developer-tools','ai-tools',
    'design','marketing','finance','education','other'
  )),
  icp_description text,          -- Ideal Customer Profile
  core_problem text,             -- Problem the app solves
  emotional_drivers text[],      -- e.g. ['fear_of_missing_out','desire_for_status']
  key_benefits text[],           -- Top 3-5 benefits
  competitors text[],            -- Competitor names for positioning
  price_anchor text,             -- e.g. "cheaper than a Netflix subscription"
  tone_of_voice text check (tone_of_voice in (
    'professional','friendly','bold','minimal','playful','urgent'
  )),
  completed_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ─── Paywall Copy Suggestions ─────────────────────────────────────────────────
create table if not exists public.paywall_copy_suggestions (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references public.accounts on delete cascade not null,
  paywall_id uuid references public.paywalls on delete cascade,
  emotional_driver text not null,
  headline text not null,
  subheadline text,
  cta_text text,
  body_copy text,
  tone text,
  generated_at timestamptz default now() not null
);

-- ─── RLS: project_briefs ──────────────────────────────────────────────────────
alter table public.project_briefs enable row level security;

create policy "project_briefs_select" on public.project_briefs
  for select to authenticated
  using (
    account_id in (
      select account_id from public.users where id = auth.uid()
    )
  );

create policy "project_briefs_insert" on public.project_briefs
  for insert to authenticated
  with check (
    account_id in (
      select account_id from public.users where id = auth.uid()
    )
  );

create policy "project_briefs_update" on public.project_briefs
  for update to authenticated
  using (
    account_id in (
      select account_id from public.users where id = auth.uid()
    )
  );

-- ─── RLS: paywall_copy_suggestions ───────────────────────────────────────────
alter table public.paywall_copy_suggestions enable row level security;

create policy "copy_suggestions_select" on public.paywall_copy_suggestions
  for select to authenticated
  using (
    account_id in (
      select account_id from public.users where id = auth.uid()
    )
  );

create policy "copy_suggestions_insert" on public.paywall_copy_suggestions
  for insert to authenticated
  with check (
    account_id in (
      select account_id from public.users where id = auth.uid()
    )
  );

create policy "copy_suggestions_delete" on public.paywall_copy_suggestions
  for delete to authenticated
  using (
    account_id in (
      select account_id from public.users where id = auth.uid()
    )
  );

-- ─── Updated_at trigger for project_briefs ───────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists project_briefs_updated_at on public.project_briefs;
create trigger project_briefs_updated_at
  before update on public.project_briefs
  for each row execute function public.set_updated_at();
