create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 20),
  color text not null default '#1D4ED8' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

revoke all on table public.profiles from anon, authenticated;
grant select, update on table public.profiles to authenticated;

create or replace function public.upsert_profile(name text, color text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Authentication is required to save a profile.';
  end if;

  if name is null or char_length(btrim(name)) not between 1 and 20 then
    raise exception 'Display name must contain between 1 and 20 characters.';
  end if;

  if color is null or color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Player color must be a six-digit hexadecimal color.';
  end if;

  insert into public.profiles (id, display_name, color)
  values (caller_id, btrim(name), color)
  on conflict (id) do update
    set display_name = excluded.display_name,
        color = excluded.color;
end;
$$;

revoke all on function public.upsert_profile(text, text) from public, anon;
grant execute on function public.upsert_profile(text, text) to authenticated;
