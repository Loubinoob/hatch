-- Hatch — initial schema
-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─── Accounts ────────────────────────────────────────────────────────────────
create table public.accounts (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  app_name text,
  app_url text,
  platform text check (platform in ('lovable','bolt','replit','cursor','v0','other')),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ─── Users (founders) ────────────────────────────────────────────────────────
create table public.users (
  id uuid primary key references auth.users on delete cascade,
  account_id uuid references public.accounts on delete cascade,
  full_name text,
  email text unique not null,
  role text default 'owner' check (role in ('owner','member')),
  onboarding_completed boolean default false,
  api_key text unique,
  created_at timestamptz default now() not null
);

-- ─── Stripe Connections ───────────────────────────────────────────────────────
create table public.stripe_connections (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references public.accounts on delete cascade not null,
  stripe_account_id text unique not null,
  stripe_email text,
  access_token text not null,
  refresh_token text,
  livemode boolean default false,
  connected_at timestamptz default now() not null
);

-- ─── Plans ────────────────────────────────────────────────────────────────────
create table public.plans (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references public.accounts on delete cascade not null,
  name text not null,
  description text,
  stripe_product_id text,
  stripe_price_id_monthly text,
  stripe_price_id_yearly text,
  price_monthly integer not null default 0, -- cents
  price_yearly integer not null default 0,  -- cents
  trial_days integer default 0,
  features jsonb default '[]'::jsonb,
  is_popular boolean default false,
  badge_color text default '#6366F1',
  is_active boolean default true,
  sort_order integer default 0,
  created_at timestamptz default now() not null
);

-- ─── Paywalls ─────────────────────────────────────────────────────────────────
create table public.paywalls (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references public.accounts on delete cascade not null,
  name text not null,
  status text default 'draft' check (status in ('draft','live','archived')),
  template text default 'classic-modal',
  headline text default 'Unlock the full power of your app',
  subheadline text,
  cta_copy text default 'Get started',
  social_proof text,
  show_yearly_toggle boolean default true,
  closeable boolean default true,
  plan_ids uuid[] default '{}',
  design jsonb default '{}'::jsonb,
  trigger_config jsonb default '{}'::jsonb,
  views integer default 0,
  conversions integer default 0,
  revenue_cents integer default 0,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ─── Paywall Variants (A/B) ───────────────────────────────────────────────────
create table public.paywall_variants (
  id uuid primary key default uuid_generate_v4(),
  paywall_id uuid references public.paywalls on delete cascade not null,
  name text not null default 'Variant B',
  traffic_split integer default 50, -- percentage
  headline text,
  subheadline text,
  design jsonb default '{}'::jsonb,
  views integer default 0,
  conversions integer default 0,
  is_winner boolean default false,
  created_at timestamptz default now() not null
);

-- ─── Events ───────────────────────────────────────────────────────────────────
create table public.events (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references public.accounts on delete cascade not null,
  subscriber_id uuid,
  paywall_id uuid references public.paywalls,
  event_type text not null, -- page_view, paywall_shown, plan_selected, checkout_started, payment_success, etc.
  properties jsonb default '{}'::jsonb,
  user_id_external text, -- the founder's user ID
  session_id text,
  ip text,
  user_agent text,
  created_at timestamptz default now() not null
);

-- ─── Subscribers (end-users of founders) ─────────────────────────────────────
create table public.subscribers (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references public.accounts on delete cascade not null,
  external_user_id text,
  email text,
  stripe_customer_id text,
  plan_id uuid references public.plans,
  subscription_status text default 'free' check (subscription_status in ('free','trialing','active','past_due','canceled','churned')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  ltv_cents integer default 0,
  churn_risk_score integer default 0, -- 0-100
  last_seen_at timestamptz default now(),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now() not null
);

-- ─── Subscriptions ────────────────────────────────────────────────────────────
create table public.subscriptions (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references public.accounts on delete cascade not null,
  subscriber_id uuid references public.subscribers on delete cascade not null,
  plan_id uuid references public.plans not null,
  stripe_subscription_id text unique,
  stripe_customer_id text,
  status text not null,
  amount_cents integer not null,
  currency text default 'usd',
  interval text check (interval in ('month','year')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  canceled_at timestamptz,
  created_at timestamptz default now() not null
);

-- ─── Commissions ──────────────────────────────────────────────────────────────
create table public.commissions (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references public.accounts on delete cascade not null,
  subscription_id uuid references public.subscriptions,
  stripe_payment_intent_id text,
  gross_cents integer not null,
  commission_cents integer not null, -- 1% of gross
  status text default 'pending' check (status in ('pending','paid','failed')),
  created_at timestamptz default now() not null
);

-- ─── Recovery Campaigns ────────────────────────────────────────────────────────
create table public.recovery_campaigns (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references public.accounts on delete cascade not null,
  type text not null check (type in ('trial_expiring','failed_payment','churn_winback')),
  name text not null,
  is_active boolean default true,
  steps jsonb default '[]'::jsonb, -- array of {delay_days, subject, body, offer_percent}
  emails_sent integer default 0,
  emails_opened integer default 0,
  conversions integer default 0,
  revenue_recovered_cents integer default 0,
  created_at timestamptz default now() not null
);

-- ─── RLS Policies ─────────────────────────────────────────────────────────────
alter table public.accounts enable row level security;
alter table public.users enable row level security;
alter table public.stripe_connections enable row level security;
alter table public.plans enable row level security;
alter table public.paywalls enable row level security;
alter table public.paywall_variants enable row level security;
alter table public.events enable row level security;
alter table public.subscribers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.commissions enable row level security;
alter table public.recovery_campaigns enable row level security;

-- Users can only see their own account data
create policy "Users see own account" on public.accounts
  for all using (id in (
    select account_id from public.users where id = auth.uid()
  ));

create policy "Users see own profile" on public.users
  for all using (id = auth.uid() or account_id in (
    select account_id from public.users where id = auth.uid()
  ));

create policy "Account members see stripe connections" on public.stripe_connections
  for all using (account_id in (
    select account_id from public.users where id = auth.uid()
  ));

create policy "Account members see plans" on public.plans
  for all using (account_id in (
    select account_id from public.users where id = auth.uid()
  ));

create policy "Account members see paywalls" on public.paywalls
  for all using (account_id in (
    select account_id from public.users where id = auth.uid()
  ));

create policy "Account members see variants" on public.paywall_variants
  for all using (paywall_id in (
    select id from public.paywalls where account_id in (
      select account_id from public.users where id = auth.uid()
    )
  ));

create policy "Account members see events" on public.events
  for all using (account_id in (
    select account_id from public.users where id = auth.uid()
  ));

create policy "Account members see subscribers" on public.subscribers
  for all using (account_id in (
    select account_id from public.users where id = auth.uid()
  ));

create policy "Account members see subscriptions" on public.subscriptions
  for all using (account_id in (
    select account_id from public.users where id = auth.uid()
  ));

create policy "Account members see commissions" on public.commissions
  for all using (account_id in (
    select account_id from public.users where id = auth.uid()
  ));

create policy "Account members see campaigns" on public.recovery_campaigns
  for all using (account_id in (
    select account_id from public.users where id = auth.uid()
  ));

-- SDK can insert events via service role (no RLS bypass needed — we use service role key in API)

-- ─── Indexes ──────────────────────────────────────────────────────────────────
create index on public.events (account_id, created_at desc);
create index on public.events (account_id, event_type);
create index on public.subscribers (account_id, subscription_status);
create index on public.subscriptions (account_id, created_at desc);
create index on public.commissions (account_id, created_at desc);
create index on public.users (api_key);
