-- ─── Simulation — migration 012 ──────────────────────────────────────────────
-- Adds is_synthetic flag to track dev-simulator data so it can be purged cleanly.
-- Synthetic posteriors use segment_hash prefixed with "sim:" (no column needed there).

alter table public.paywall_impressions
  add column if not exists is_synthetic boolean not null default false;

-- Fast lookup for the reset route (DELETE WHERE is_synthetic = true)
create index if not exists paywall_impressions_synthetic_idx
  on public.paywall_impressions (account_id, is_synthetic)
  where is_synthetic = true;
