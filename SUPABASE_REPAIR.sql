-- Scale It Now - REPAIR script. Run in Supabase > SQL Editor AFTER SUPABASE_MIGRATION.sql. Safe to re-run; deletes nothing.
-- Fixes: a "purchases" table that already existed with different/missing columns, and PostgREST's stale schema cache.

create extension if not exists pgcrypto;

-- 1) make sure every column the site writes/reads exists on purchases
alter table public.purchases add column if not exists razorpay_order_id   text;
alter table public.purchases add column if not exists razorpay_payment_id text;
alter table public.purchases add column if not exists customer_name       text;
alter table public.purchases add column if not exists customer_email      text;
alter table public.purchases add column if not exists amount_paise        integer;
alter table public.purchases add column if not exists currency            text default 'INR';
alter table public.purchases add column if not exists status              text default 'created';
alter table public.purchases add column if not exists rzp_mode            text;
alter table public.purchases add column if not exists terms_version       text;
alter table public.purchases add column if not exists terms_accepted_at   timestamptz;
alter table public.purchases add column if not exists access_claimed_at   timestamptz;
alter table public.purchases add column if not exists created_at          timestamptz default now();
alter table public.purchases add column if not exists paid_at             timestamptz;
alter table public.purchases add column if not exists revoked_at          timestamptz;
create unique index if not exists purchases_order_uniq   on public.purchases (razorpay_order_id);
create unique index if not exists purchases_payment_uniq on public.purchases (razorpay_payment_id) where razorpay_payment_id is not null;

-- 2) any OLD column that is not ours must not block inserts: drop its NOT NULL (data is kept)
do $$
declare c record;
begin
  for c in select column_name from information_schema.columns
           where table_schema='public' and table_name='purchases' and is_nullable='NO'
             and column_name not in ('id','razorpay_order_id','customer_name','customer_email','amount_paise','currency','status','created_at')
  loop execute format('alter table public.purchases alter column %I drop not null', c.column_name); end loop;
end $$;

-- 3) same columns on access_tokens / certificates
alter table public.access_tokens add column if not exists purchase_id  uuid;
alter table public.access_tokens add column if not exists token_hash   text;
alter table public.access_tokens add column if not exists created_at   timestamptz default now();
alter table public.access_tokens add column if not exists expires_at   timestamptz;
alter table public.access_tokens add column if not exists revoked_at   timestamptz;
alter table public.access_tokens add column if not exists last_used_at timestamptz;
create unique index if not exists access_tokens_hash_uniq on public.access_tokens (token_hash);
alter table public.certificates add column if not exists purchase_id uuid;
alter table public.certificates alter column user_id drop not null;
create unique index if not exists certificates_purchase_uniq on public.certificates (purchase_id) where purchase_id is not null;

-- 4) keep RLS on, no browser access to the new tables
alter table public.purchases     enable row level security;
alter table public.access_tokens enable row level security;
revoke all on public.purchases, public.access_tokens from anon, authenticated;

-- 5) tell Supabase's API to reload its schema cache (new columns are invisible to it until it does)
notify pgrst, 'reload schema';

-- 6) diagnostic: you should see ALL of these columns for purchases
select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='purchases' order by ordinal_position;
