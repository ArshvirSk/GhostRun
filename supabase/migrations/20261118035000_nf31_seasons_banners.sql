-- NF-31: Season Framework & Remote Promo Announcement Banners Schema

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_active boolean not null default true
);

create index if not exists seasons_active_idx on public.seasons(is_active, starts_at, ends_at);

alter table public.seasons enable row level security;

create policy seasons_select on public.seasons
  for select to authenticated, anon
  using (true);

create table if not exists public.announcement_banners (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  link_url text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists announcement_banners_active_idx
  on public.announcement_banners(is_active, starts_at, ends_at);

alter table public.announcement_banners enable row level security;

create policy announcement_banners_select on public.announcement_banners
  for select to authenticated, anon
  using (true);

-- Seed initial Season 1 if none exists
insert into public.seasons (number, name, starts_at, ends_at, is_active)
values (
  1,
  'Season 1: First Infiltration',
  now(),
  now() + interval '30 days',
  true
)
on conflict (number) do nothing;

-- RPC: get_active_season_and_banners
create or replace function public.get_active_season_and_banners()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season jsonb;
  v_banners jsonb;
begin
  select to_jsonb(s) into v_season
  from public.seasons s
  where s.is_active = true
    and now() between s.starts_at and s.ends_at
  order by s.number desc
  limit 1;

  select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) into v_banners
  from (
    select id, title, subtitle, link_url, starts_at, ends_at
    from public.announcement_banners
    where is_active = true
      and now() between starts_at and ends_at
    order by starts_at desc
    limit 3
  ) b;

  return jsonb_build_object(
    'season', v_season,
    'banners', v_banners
  );
end;
$$;
