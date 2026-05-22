-- Migration 008: Chameleon mode — auto-adapt paywall to host app design
alter table public.paywalls
  add column if not exists theme_mode text default 'auto'
    check (theme_mode in ('auto','manual')),
  add column if not exists adapt_font boolean default true,
  add column if not exists adapt_colors boolean default true,
  add column if not exists adapt_radius boolean default true;

comment on column public.paywalls.theme_mode is
  'auto = SDK detects host app styles at runtime; manual = use builder settings';
comment on column public.paywalls.adapt_font is
  'When theme_mode=auto, inherit font-family from host body';
comment on column public.paywalls.adapt_colors is
  'When theme_mode=auto, inherit accent color from host app';
comment on column public.paywalls.adapt_radius is
  'When theme_mode=auto, inherit border-radius from host buttons';
