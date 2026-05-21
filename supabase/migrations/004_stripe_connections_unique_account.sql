-- Add unique constraint on account_id so upsert works correctly
-- (one Stripe connection per Hatch account)
alter table public.stripe_connections
  add constraint stripe_connections_account_id_key unique (account_id);
