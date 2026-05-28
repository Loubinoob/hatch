-- ─── Migration 018 — Paywall Block System ────────────────────────────────────
--
-- Adds composable block-based paywall architecture.
--
-- Changes:
--   1. paywalls.blocks         — ordered array of block definitions (JSONB)
--   2. paywalls.display_mode   — 'modal' (centered overlay) or 'fullscreen' (takeover)
--   3. paywalls.template_id    — which library template was used as starting point

alter table public.paywalls
  add column if not exists blocks       jsonb default '[]'::jsonb,
  add column if not exists display_mode text  default 'modal'
    check (display_mode in ('modal', 'fullscreen')),
  add column if not exists template_id  text;
