-- Migration 013: Active segmentation keys for the pricing bandit
--
-- pricing_segment_keys (plans): JSON array of variable names the scientist has
-- validated as price-discriminating (e.g. ["utm_source","device_type"]).
-- Empty [] means all traffic is pooled under "global".
--
-- pricing_segment_hash (variant_assignments): The hash that was actually used
-- when the price was served — computed only from pricing_segment_keys.
-- Needed so events/route.ts can update the right posterior row.

alter table public.plans
  add column if not exists pricing_segment_keys jsonb not null default '[]'::jsonb;

alter table public.variant_assignments
  add column if not exists pricing_segment_hash text;

create index if not exists variant_assignments_pricing_seg_idx
  on public.variant_assignments (pricing_segment_hash)
  where pricing_segment_hash is not null;

comment on column public.plans.pricing_segment_keys is
  'Variables validated by the scientist as price-discriminating. '
  'Bandit hashes only these when choosing a price. Empty = global pool.';

comment on column public.variant_assignments.pricing_segment_hash is
  'Pricing-specific segment hash used when the price was assigned. '
  'May differ from segment_hash (which covers variant selection context).';
