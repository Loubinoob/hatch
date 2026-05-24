-- B.4 — Pricing aggressiveness lever (the ONLY tuning knob exposed to founders).
-- conservative: ±25% amplitude, slow pruning, small steps
-- balanced:     ±50% amplitude (default)
-- aggressive:   ±90% amplitude, fast pruning, large steps

alter table public.plans
  add column if not exists pricing_aggressiveness text
    default 'balanced'
    check (pricing_aggressiveness in ('conservative', 'balanced', 'aggressive'));
