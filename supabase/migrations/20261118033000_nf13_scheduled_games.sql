-- NF-13: Scheduled Games & RSVPs Schema

create table if not exists public.scheduled_games (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  mode_id text not null,
  scheduled_at timestamptz not null,
  area_name text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists scheduled_games_scheduled_idx on public.scheduled_games(scheduled_at);
create index if not exists scheduled_games_host_idx on public.scheduled_games(host_id);

alter table public.scheduled_games enable row level security;

create policy scheduled_games_select on public.scheduled_games
  for select to authenticated
  using (true);

create policy scheduled_games_insert on public.scheduled_games
  for insert to authenticated
  with check (host_id = (select auth.uid()));

create policy scheduled_games_update on public.scheduled_games
  for update to authenticated
  using (host_id = (select auth.uid()))
  with check (host_id = (select auth.uid()));

create policy scheduled_games_delete on public.scheduled_games
  for delete to authenticated
  using (host_id = (select auth.uid()));

-- RSVPs table
create table if not exists public.scheduled_game_rsvps (
  scheduled_game_id uuid not null references public.scheduled_games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  response text not null check (response in ('attending', 'declined', 'tentative')),
  updated_at timestamptz not null default now(),
  primary key (scheduled_game_id, user_id)
);

create index if not exists scheduled_game_rsvps_game_idx on public.scheduled_game_rsvps(scheduled_game_id);

alter table public.scheduled_game_rsvps enable row level security;

create policy scheduled_game_rsvps_select on public.scheduled_game_rsvps
  for select to authenticated
  using (true);

create policy scheduled_game_rsvps_upsert on public.scheduled_game_rsvps
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy scheduled_game_rsvps_update on public.scheduled_game_rsvps
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy scheduled_game_rsvps_delete on public.scheduled_game_rsvps
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- RPC create_scheduled_game
create or replace function public.create_scheduled_game(
  p_title text,
  p_mode_id text,
  p_scheduled_at timestamptz,
  p_area_name text default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_new_id uuid;
begin
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  if char_length(trim(p_title)) < 1 then
    raise exception 'Title cannot be empty';
  end if;

  if p_scheduled_at <= now() then
    raise exception 'Scheduled time must be in the future';
  end if;

  insert into public.scheduled_games (
    host_id,
    title,
    mode_id,
    scheduled_at,
    area_name,
    notes
  ) values (
    v_caller_id,
    trim(p_title),
    p_mode_id,
    p_scheduled_at,
    p_area_name,
    p_notes
  )
  returning id into v_new_id;

  -- Host automatically attends
  insert into public.scheduled_game_rsvps (scheduled_game_id, user_id, response)
  values (v_new_id, v_caller_id, 'attending');

  return v_new_id;
end;
$$;

-- RPC rsvp_scheduled_game
create or replace function public.rsvp_scheduled_game(
  p_scheduled_game_id uuid,
  p_response text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
begin
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_response not in ('attending', 'declined', 'tentative') then
    raise exception 'Invalid RSVP response';
  end if;

  insert into public.scheduled_game_rsvps (scheduled_game_id, user_id, response, updated_at)
  values (p_scheduled_game_id, v_caller_id, p_response, now())
  on conflict (scheduled_game_id, user_id) do update
  set response = excluded.response,
      updated_at = now();
end;
$$;
