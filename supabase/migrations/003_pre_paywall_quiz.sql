-- Hatch — Phase 2: Pre-paywall quiz + auto-fill fields

-- ─── Project Briefs: add auto-fill tracking ───────────────────────────────────
alter table public.project_briefs
  add column if not exists auto_generated_at timestamptz,
  add column if not exists auto_generated_source text check (auto_generated_source in ('url', 'paste'));

-- ─── Paywall Quizzes ──────────────────────────────────────────────────────────
create table if not exists public.paywall_quizzes (
  id uuid primary key default uuid_generate_v4(),
  paywall_id uuid references public.paywalls on delete cascade not null,
  is_active boolean default false,
  questions jsonb not null default '[]'::jsonb,
  -- Each question: { id, type, question, options?, helper_text?, weight }
  completion_message text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ─── Quiz Responses ───────────────────────────────────────────────────────────
create table if not exists public.quiz_responses (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references public.accounts on delete cascade not null,
  paywall_id uuid references public.paywalls,
  quiz_id uuid references public.paywall_quizzes,
  session_id text,
  user_id_external text,
  answers jsonb not null default '{}'::jsonb,
  completed_at timestamptz default now(),
  led_to_paywall_view boolean default false,
  led_to_conversion boolean default false
);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
alter table public.paywall_quizzes enable row level security;
alter table public.quiz_responses enable row level security;

create policy "quiz_access" on public.paywall_quizzes
  for all to authenticated
  using (
    paywall_id in (
      select id from public.paywalls where account_id in (
        select account_id from public.users where id = auth.uid()
      )
    )
  );

create policy "quiz_responses_select" on public.quiz_responses
  for select to authenticated
  using (
    account_id in (
      select account_id from public.users where id = auth.uid()
    )
  );

-- Public insert for quiz responses (from SDK, no auth)
create policy "quiz_responses_insert_public" on public.quiz_responses
  for insert to anon, authenticated
  with check (true);

-- ─── Updated_at triggers ──────────────────────────────────────────────────────
drop trigger if exists paywall_quizzes_updated_at on public.paywall_quizzes;
create trigger paywall_quizzes_updated_at
  before update on public.paywall_quizzes
  for each row execute function public.set_updated_at();
