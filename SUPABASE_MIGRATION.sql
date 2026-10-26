-- =====================================================================================================
-- Scale It Now Academy - Supabase migration for the NO-REGISTRATION purchase flow
-- Run ONCE in Supabase Dashboard > SQL Editor (your project). Safe to re-run.
--
-- ADDITIVE ONLY: it never drops, truncates or rewrites existing tables or rows. Old tables from the login-based
-- version (profiles, payments, enrollments, lesson_progress, course_state, quiz_attempts, reviews) are left untouched
-- and are simply no longer used by the site. Existing rows in "certificates" are kept.
-- Row Level Security stays ON everywhere. The new tables have RLS enabled and NO policies, and anon/authenticated
-- roles are revoked, so the browser can never read them. Only the server (Netlify Functions, service-role key) can.
-- =====================================================================================================
create extension if not exists pgcrypto;

-- 1) One row per checkout attempt / purchase ---------------------------------------------------------
create table if not exists public.purchases (
  id                  uuid primary key default gen_random_uuid(),
  razorpay_order_id   text not null unique,                       -- idempotency: one purchase per Razorpay order
  razorpay_payment_id text unique,                                -- a payment can only ever back one purchase
  customer_name       text not null check (char_length(customer_name) between 2 and 60),
  customer_email      text not null check (char_length(customer_email) <= 254),
  amount_paise        integer not null check (amount_paise > 0),
  currency            text not null default 'INR',
  status              text not null default 'created' check (status in ('created','paid','failed','refunded')),
  rzp_mode            text check (rzp_mode in ('test','live')),
  terms_version       text,
  terms_accepted_at   timestamptz,
  access_claimed_at   timestamptz,                                -- set when the buyer's browser received its first access token
  created_at          timestamptz not null default now(),
  paid_at             timestamptz,
  revoked_at          timestamptz                                 -- set this to cut off access (e.g. after a refund)
);
create index if not exists purchases_email_idx  on public.purchases (customer_email, status, created_at desc);

-- 2) Secret access links: only the SHA-256 HASH of each token is stored ------------------------------
create table if not exists public.access_tokens (
  id           uuid primary key default gen_random_uuid(),
  purchase_id  uuid not null references public.purchases(id) on delete cascade,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,                                       -- null = lifetime access
  revoked_at   timestamptz,
  last_used_at timestamptz
);
create index if not exists access_tokens_purchase_idx on public.access_tokens (purchase_id);

-- 3) Certificates: reuse the existing table, but let a certificate belong to a PURCHASE instead of a login user
create table if not exists public.certificates (            -- only creates it if your database does not have it yet
  id uuid primary key default gen_random_uuid(),
  cert_id text not null unique check (cert_id ~ '^SIN-[0-9]{4}-[A-HJ-NP-Z2-9]{8}$'),
  user_id uuid,
  student_name text not null, course_title text not null, completed_on date not null,
  issued_at timestamptz not null default now()
);
alter table public.certificates add column if not exists purchase_id uuid references public.purchases(id) on delete cascade;
alter table public.certificates alter column user_id drop not null;           -- old rows keep their user_id
create unique index if not exists certificates_purchase_uniq on public.certificates (purchase_id) where purchase_id is not null;  -- one certificate per purchase

-- 4) Row Level Security ----------------------------------------------------------------------------
alter table public.purchases     enable row level security;
alter table public.access_tokens enable row level security;
alter table public.certificates  enable row level security;
-- Deliberately NO policies on purchases / access_tokens: nobody but the service-role key can touch them.
revoke all on public.purchases, public.access_tokens from anon, authenticated;
-- certificates keeps its existing policy ("own cert read", for old login-based rows). New rows have no user_id, so no browser can read them.
revoke insert, update, delete on public.certificates from anon, authenticated;
