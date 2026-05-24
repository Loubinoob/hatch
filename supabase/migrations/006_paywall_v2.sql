-- Paywall Builder V2 — full feature set
alter table public.paywalls
  -- Rich content
  add column if not exists body_copy text,
  add column if not exists footer_text text default 'Cancel anytime · No hidden fees',
  add column if not exists guarantee_text text,
  add column if not exists urgency_text text,
  add column if not exists urgency_end_date timestamptz,
  add column if not exists show_countdown boolean default false,
  add column if not exists trust_badges text[] default '{}',

  -- Pricing
  add column if not exists yearly_discount_percent integer default 20,
  add column if not exists currency text default 'USD',
  add column if not exists show_trial_in_cta boolean default false,

  -- Advanced design
  add column if not exists font_family text default 'system'
    check (font_family in ('system','serif','mono')),
  add column if not exists button_shape text default 'rounded'
    check (button_shape in ('rounded','pill','square')),
  add column if not exists overlay_opacity integer default 65
    check (overlay_opacity between 0 and 95),
  add column if not exists animation_style text default 'slide'
    check (animation_style in ('slide','fade','zoom','none')),

  -- Localisation
  add column if not exists locale text default 'en',
  add column if not exists localizations jsonb default '{}',
  add column if not exists auto_detect_locale boolean default true,

  -- Advanced
  add column if not exists custom_css text,
  add column if not exists success_redirect_url text,
  add column if not exists hide_powered_by boolean default false,

  -- Content (V2 extras)
  add column if not exists social_proof_type text default 'text'
    check (social_proof_type in ('none','text','stars','user_count'));

-- Add new templates to template check (drop constraint first if exists)
alter table public.paywalls
  drop constraint if exists paywalls_template_check;

-- Re-add template constraint with all 6 templates
alter table public.paywalls
  add constraint paywalls_template_check
  check (template in ('classic-modal','slide-in','fullscreen','bottom-sheet','minimal','side-panel'));
