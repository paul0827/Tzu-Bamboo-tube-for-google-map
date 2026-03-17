-- Supabase schema + policies for Tzu for google map

create extension if not exists "pgcrypto";

-- Profiles (account metadata)
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null,
  role text not null default 'user',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  last_login_lat double precision,
  last_login_lng double precision,
  last_login_accuracy double precision,
  last_login_status text
);

-- Store pins
create table if not exists public.store_pins (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users
);

-- Prevent duplicate store name + address (case-insensitive)
create unique index if not exists store_pins_unique
  on public.store_pins (lower(name), lower(address));

-- Helper: is admin
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid and role = 'admin' and active = true
  );
$$;

alter table public.profiles enable row level security;
alter table public.store_pins enable row level security;

-- Profiles policies
create policy if not exists "profiles: self select"
  on public.profiles for select
  using (auth.uid() = id);

create policy if not exists "profiles: admin select"
  on public.profiles for select
  using (public.is_admin(auth.uid()));

create policy if not exists "profiles: self update"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy if not exists "profiles: admin update"
  on public.profiles for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Store pins policies
create policy if not exists "store_pins: select auth"
  on public.store_pins for select
  using (auth.uid() is not null);

create policy if not exists "store_pins: insert auth"
  on public.store_pins for insert
  with check (auth.uid() is not null);

create policy if not exists "store_pins: update admin"
  on public.store_pins for update
  using (public.is_admin(auth.uid()));

create policy if not exists "store_pins: delete admin"
  on public.store_pins for delete
  using (public.is_admin(auth.uid()));

-- Realtime
alter publication supabase_realtime add table public.store_pins;
alter publication supabase_realtime add table public.profiles;
