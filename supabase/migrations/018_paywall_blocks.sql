-- ─── Migration 018 — Paywall Block System ────────────────────────────────────
--
-- Adds composable block-based paywall architecture.
--
-- Columns:
--   1. paywalls.blocks         — ordered array of block definitions (JSONB)
--   2. paywalls.display_mode   — 'modal' (centered overlay) or 'fullscreen'
--   3. paywalls.template_id    — which library template was used as starting point

alter table public.paywalls
  add column if not exists blocks       jsonb default '[]'::jsonb,
  add column if not exists display_mode text  default 'modal',
  add column if not exists template_id  text;

-- Optional check constraint added after columns exist (idempotent)
do $$ begin
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_schema = 'public'
      and constraint_name   = 'paywalls_display_mode_check'
  ) then
    alter table public.paywalls
      add constraint paywalls_display_mode_check
      check (display_mode in ('modal', 'fullscreen'));
  end if;
end $$;
