create extension if not exists postgis with schema extensions;

create type public.game_mode as enum ('classic_chase', 'tag_hunt');
create type public.game_status as enum (
  'lobby', 'target_selection', 'countdown', 'head_start', 'live', 'ended', 'cancelled'
);
create type public.team_type as enum ('runner', 'hunter', 'unassigned');
create type public.player_status as enum ('active', 'tagged', 'left');

drop policy profiles_select_own on public.profiles;

create table public.games (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-HJ-NP-Z2-9]{4}$'),
  host_id uuid not null references public.profiles(id),
  mode public.game_mode not null default 'classic_chase',
  status public.game_status not null default 'lobby',
  area_center extensions.geography(Point,4326) not null,
  area_radius_m integer not null default 600 check (area_radius_m between 100 and 5000),
  head_start_s integer not null default 180 check (head_start_s between 0 and 600),
  duration_s integer not null default 2700 check (duration_s between 300 and 14400),
  ping_interval_s integer not null default 150 check (ping_interval_s between 30 and 900),
  tag_radius_m integer not null default 20 check (tag_radius_m between 5 and 100),
  target_radius_m integer not null default 25 check (target_radius_m between 10 and 100),
  boundary_grace_s integer not null default 30 check (boundary_grace_s between 10 and 120),
  boundary_penalty text not null default 'warn' check (boundary_penalty in ('warn', 'extra_ping')),
  head_start_at timestamptz,
  live_at timestamptz,
  ends_at timestamptz,
  next_ping_at timestamptz,
  ping_seq integer not null default 0,
  winner text check (winner in ('runners', 'hunters')),
  end_reason text,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index games_code_active_uq on public.games(code)
  where status not in ('ended', 'cancelled');

create table public.players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  team public.team_type not null default 'unassigned',
  status public.player_status not null default 'active',
  is_ready boolean not null default false,
  last_tag_attempt_at timestamptz,
  joined_at timestamptz not null default now(),
  tagged_at timestamptz,
  unique (game_id, user_id)
);
create index players_game_idx on public.players(game_id);

create policy profiles_select_self_or_game_mates
  on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.players mine
      join public.players other on other.game_id = mine.game_id
      where mine.user_id = (select auth.uid())
        and mine.status <> 'left'
        and other.user_id = profiles.id
        and other.status <> 'left'
    )
  );

create table public.player_positions (
  player_id uuid primary key references public.players(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  geog extensions.geography(Point,4326) not null,
  accuracy_m real,
  speed_mps real,
  heading real,
  is_mock boolean not null default false,
  recorded_at timestamptz not null,
  updated_at timestamptz not null default now(),
  out_of_bounds_since timestamptz
);

create table public.trail_points (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  geog extensions.geography(Point,4326) not null,
  accuracy_m real,
  recorded_at timestamptz not null
);
create index trail_idx on public.trail_points(game_id, player_id, recorded_at);

create table public.targets (
  game_id uuid primary key references public.games(id) on delete cascade,
  geog extensions.geography(Point,4326) not null,
  set_by uuid not null references public.players(id),
  set_at timestamptz not null default now()
);

create table public.pings (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  seq integer not null,
  player_id uuid not null references public.players(id) on delete cascade,
  geog extensions.geography(Point,4326),
  accuracy_m real,
  position_age_s integer,
  reason text not null default 'scheduled' check (reason in ('scheduled', 'boundary')),
  released_at timestamptz not null default now()
);
create index pings_game_idx on public.pings(game_id, released_at desc);

create table public.tags (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  hunter_id uuid not null references public.players(id),
  runner_id uuid not null references public.players(id),
  distance_m real not null,
  tagged_at timestamptz not null default now()
);

create table public.events (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  type text not null,
  audience text not null default 'all' check (audience in ('all', 'runner', 'hunter')),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index events_game_idx on public.events(game_id, id);

create or replace function public.is_member(game_id uuid)
returns boolean
language sql stable security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.players
    where players.game_id = $1 and user_id = auth.uid() and status <> 'left'
  );
$$;

create or replace function public.my_team(game_id uuid)
returns public.team_type
language sql stable security definer
set search_path = public, extensions
as $$
  select team from public.players
  where players.game_id = $1 and user_id = auth.uid() and status <> 'left'
  limit 1;
$$;

create or replace function public.game_ended(game_id uuid)
returns boolean
language sql stable security definer
set search_path = public, extensions
as $$
  select exists (select 1 from public.games where id = $1 and status = 'ended');
$$;

revoke all on function public.is_member(uuid), public.my_team(uuid), public.game_ended(uuid) from public, anon;
grant execute on function public.is_member(uuid), public.my_team(uuid), public.game_ended(uuid) to authenticated;

alter table public.games enable row level security;
alter table public.players enable row level security;
alter table public.player_positions enable row level security;
alter table public.trail_points enable row level security;
alter table public.targets enable row level security;
alter table public.pings enable row level security;
alter table public.tags enable row level security;
alter table public.events enable row level security;

create policy games_member_read on public.games for select to authenticated
  using (public.is_member(id));
create policy players_member_read on public.players for select to authenticated
  using (public.is_member(game_id));
create policy positions_same_team_or_ended on public.player_positions for select to authenticated
  using (
    public.is_member(game_id)
    and (
      public.my_team(game_id) in ('runner', 'hunter')
      and exists (
        select 1 from public.players p
        where p.id = player_positions.player_id and p.team = public.my_team(game_id)
      )
      or public.game_ended(game_id)
    )
  );
create policy trails_after_end on public.trail_points for select to authenticated
  using (public.is_member(game_id) and public.game_ended(game_id));
create policy targets_runner_or_ended on public.targets for select to authenticated
  using (
    public.is_member(game_id)
    and (public.my_team(game_id) = 'runner' or public.game_ended(game_id))
  );
create policy pings_member_read on public.pings for select to authenticated
  using (public.is_member(game_id));
create policy tags_member_read on public.tags for select to authenticated
  using (public.is_member(game_id));
create policy events_audience_read on public.events for select to authenticated
  using (
    public.is_member(game_id)
    and (audience = 'all' or audience = public.my_team(game_id)::text)
  );

revoke all on public.games, public.players, public.player_positions, public.trail_points,
  public.targets, public.pings, public.tags, public.events from anon, authenticated;
grant select on public.games, public.players, public.player_positions, public.trail_points,
  public.targets, public.pings, public.tags, public.events to authenticated;

-- create_game ---------------------------------------------------------------
create or replace function public.create_game(
  mode public.game_mode,
  lat double precision,
  lng double precision,
  radius_m integer default 600,
  settings jsonb default '{}'::jsonb
)
returns table (game_id uuid, code text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  new_id uuid;
  new_code text;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  attempt integer := 0;
  chosen_mode public.game_mode := create_game.mode;
  chosen_settings jsonb := coalesce(create_game.settings, '{}'::jsonb);
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not exists (select 1 from public.profiles where id = caller_id) then
    raise exception 'Create a profile before creating a game.';
  end if;
  if chosen_mode is null then raise exception 'Choose a game mode.'; end if;
  if create_game.lat not between -90 and 90 or create_game.lng not between -180 and 180 then
    raise exception 'Map centre coordinates are invalid.';
  end if;
  if create_game.radius_m not between 100 and 5000 then
    raise exception 'Area radius must be 100-5000 metres.';
  end if;

  loop
    attempt := attempt + 1;
    new_code := '';
    for i in 1..4 loop
      new_code := new_code || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
    end loop;
    exit when not exists (
      select 1 from public.games g
      where g.code = new_code and g.status not in ('ended', 'cancelled')
    );
    if attempt >= 20 then raise exception 'Could not allocate a game code. Try again.'; end if;
  end loop;

  insert into public.games (
    code, host_id, mode, area_center, area_radius_m,
    head_start_s, duration_s, ping_interval_s, tag_radius_m, target_radius_m,
    boundary_grace_s, boundary_penalty
  ) values (
    new_code, caller_id, chosen_mode,
    extensions.st_setsrid(extensions.st_makepoint(create_game.lng, create_game.lat), 4326)::extensions.geography,
    create_game.radius_m,
    coalesce((chosen_settings->>'head_start_s')::integer, 180),
    coalesce((chosen_settings->>'duration_s')::integer, 2700),
    coalesce((chosen_settings->>'ping_interval_s')::integer, 150),
    coalesce((chosen_settings->>'tag_radius_m')::integer, 20),
    coalesce((chosen_settings->>'target_radius_m')::integer, 25),
    coalesce((chosen_settings->>'boundary_grace_s')::integer, 30),
    coalesce(chosen_settings->>'boundary_penalty', 'warn')
  ) returning id into new_id;

  insert into public.players (game_id, user_id) values (new_id, caller_id);
  insert into public.events (game_id, type, payload)
    values (new_id, 'player_joined', jsonb_build_object('user_id', caller_id));
  return query select new_id, new_code;
exception
  when check_violation or invalid_text_representation then
    raise exception 'Game settings are invalid. Check the allowed ranges and try again.';
end;
$$;

-- join_game -----------------------------------------------------------------
create or replace function public.join_game(code text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  target_game public.games%rowtype;
  current_count integer;
  requested_code text := upper(btrim(join_game.code));
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not exists (select 1 from public.profiles where id = caller_id) then
    raise exception 'Create a profile before joining a game.';
  end if;
  if requested_code is null or requested_code !~ '^[A-HJ-NP-Z2-9]{4}$' then
    raise exception 'Enter a valid four-character game code.';
  end if;

  select * into target_game from public.games g
  where g.code = requested_code and g.status = 'lobby'
  for update;
  if not found then raise exception 'No open lobby found for that code.'; end if;
  if exists (
    select 1 from public.players p
    where p.game_id = target_game.id and p.user_id = caller_id and p.status <> 'left'
  ) then
    return target_game.id;
  end if;
  select count(*) into current_count from public.players p
    where p.game_id = target_game.id and p.status <> 'left';
  if current_count >= 20 then raise exception 'This lobby is full.'; end if;

  insert into public.players (game_id, user_id) values (target_game.id, caller_id);
  insert into public.events (game_id, type, payload)
    values (target_game.id, 'player_joined', jsonb_build_object('user_id', caller_id));
  return target_game.id;
end;
$$;

-- set_team ------------------------------------------------------------------
create or replace function public.set_team(game_id uuid, player_id uuid, team public.team_type)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  target public.players%rowtype;
  current_status public.game_status;
  caller_is_host boolean;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into target from public.players p
    where p.id = set_team.player_id and p.game_id = set_team.game_id for update;
  if not found or target.status = 'left' then raise exception 'Player is not in this game.'; end if;
  select g.status, (g.host_id = caller_id) into current_status, caller_is_host
    from public.games g where g.id = set_team.game_id;
  if current_status is distinct from 'lobby' then raise exception 'Teams can only change in the lobby.'; end if;
  if caller_id <> target.user_id and not coalesce(caller_is_host, false) then
    raise exception 'Only the player or host can change this team.';
  end if;
  if set_team.team not in ('runner', 'hunter') then raise exception 'Choose runner or hunter.'; end if;

  update public.players set team = set_team.team, is_ready = false where id = set_team.player_id;
  insert into public.events (game_id, type, payload) values (
    set_team.game_id,
    'team_changed',
    jsonb_build_object('player_id', set_team.player_id, 'team', set_team.team)
  );
end;
$$;

-- randomize_teams -----------------------------------------------------------
create or replace function public.randomize_teams(game_id uuid, hunter_count integer)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  player_total integer;
  game_phase public.game_status;
  game_host uuid;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select g.status, g.host_id into game_phase, game_host
    from public.games g where g.id = randomize_teams.game_id for update;
  if not found or game_phase <> 'lobby' or caller_id <> game_host then
    raise exception 'Only the host can randomize teams in the lobby.';
  end if;
  select count(*) into player_total from public.players p
    where p.game_id = randomize_teams.game_id and p.status = 'active';
  if player_total < 2 then raise exception 'At least two players are needed to assign teams.'; end if;
  if hunter_count < 1 or hunter_count >= player_total then
    raise exception 'Hunter count must leave at least one runner.';
  end if;

  with shuffled as (
    select p.id, row_number() over (order by random()) as position
    from public.players p where p.game_id = randomize_teams.game_id and p.status = 'active'
  )
  update public.players p
  set team = case
        when shuffled.position <= hunter_count then 'hunter'::public.team_type
        else 'runner'::public.team_type
      end,
      is_ready = false
  from shuffled where p.id = shuffled.id;
  insert into public.events (game_id, type, payload) values (
    randomize_teams.game_id, 'teams_randomized', jsonb_build_object('hunter_count', hunter_count)
  );
end;
$$;

-- begin_target_selection -----------------------------------------------------
-- Classic Chase only: Tag Hunt has no target, so its lobby goes straight to the
-- start phase in a later milestone. Keeping the transition classic-only avoids a
-- status the app cannot render yet.
create or replace function public.begin_target_selection(game_id uuid)
returns public.game_status
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into current_game from public.games g where g.id = begin_target_selection.game_id for update;
  if not found or current_game.host_id <> caller_id then
    raise exception 'Only the host can advance this lobby.';
  end if;
  if current_game.status <> 'lobby' then raise exception 'This game is no longer in the lobby.'; end if;
  if not exists (
    select 1 from public.players p
    where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active'
  ) or not exists (
    select 1 from public.players p
    where p.game_id = current_game.id and p.team = 'hunter' and p.status = 'active'
  ) then
    raise exception 'Assign at least one runner and one hunter before continuing.';
  end if;

  if current_game.mode <> 'classic_chase' then
    raise exception 'Tag Hunt has no target to choose. Ready up in the lobby and start the round.';
  end if;

  update public.games set status = 'target_selection' where id = current_game.id;
  insert into public.events (game_id, type) values (current_game.id, 'target_selection_began');
  return 'target_selection';
end;
$$;

-- set_target -----------------------------------------------------------------
create or replace function public.set_target(game_id uuid, lat double precision, lng double precision)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  caller_player public.players%rowtype;
  current_game public.games%rowtype;
  point geography;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into caller_player from public.players p
    where p.game_id = set_target.game_id and p.user_id = caller_id and p.status <> 'left';
  if not found or caller_player.team <> 'runner' then
    raise exception 'Only runners can choose the secret target.';
  end if;
  select * into current_game from public.games g where g.id = set_target.game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.mode <> 'classic_chase' then
    raise exception 'This game mode has no target.';
  end if;
  if current_game.status not in ('lobby', 'target_selection') then
    raise exception 'The target is locked once the round starts.';
  end if;
  if set_target.lat not between -90 and 90 or set_target.lng not between -180 and 180 then
    raise exception 'Target coordinates are invalid.';
  end if;

  point := extensions.st_setsrid(extensions.st_makepoint(set_target.lng, set_target.lat), 4326)::extensions.geography;
  if extensions.st_distance(point, current_game.area_center) > current_game.area_radius_m then
    raise exception 'The target must be inside the play area.';
  end if;

  -- The conflict target is named as a constraint: an unqualified `(game_id)` here
  -- is read as the function's own `game_id` parameter and becomes ambiguous.
  insert into public.targets (game_id, geog, set_by, set_at)
  values (set_target.game_id, point, caller_player.id, now())
  on conflict on constraint targets_pkey do update
    set geog = excluded.geog, set_by = excluded.set_by, set_at = excluded.set_at;

  insert into public.events (game_id, type, audience) values (set_target.game_id, 'target_set', 'runner');

  return jsonb_build_object('longitude', set_target.lng, 'latitude', set_target.lat);
end;
$$;

-- set_ready ------------------------------------------------------------------
create or replace function public.set_ready(game_id uuid, ready boolean)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  affected_game uuid;
  game_phase public.game_status;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select status into game_phase from public.games where id = set_ready.game_id for update;
  if not found or game_phase not in ('lobby', 'target_selection') then
    raise exception 'Ready status can only change before the game starts.';
  end if;
  update public.players p set is_ready = set_ready.ready
  from public.games g
  where p.game_id = g.id and p.game_id = set_ready.game_id
    and p.user_id = caller_id and p.status = 'active'
    and g.status in ('lobby', 'target_selection')
  returning p.game_id into affected_game;
  if affected_game is null then raise exception 'You cannot change ready status right now.'; end if;
  insert into public.events (game_id, type, payload) values (
    affected_game, 'ready_changed', jsonb_build_object('user_id', caller_id, 'ready', set_ready.ready)
  );
end;
$$;

-- leave_game -----------------------------------------------------------------
create or replace function public.leave_game(game_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  leaving public.players%rowtype;
  next_host uuid;
  game_phase public.game_status;
  in_progress boolean;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into leaving from public.players p
    where p.game_id = leave_game.game_id and p.user_id = caller_id and p.status <> 'left'
    for update;
  if not found then raise exception 'You are not an active member of this game.'; end if;

  select g.status into game_phase from public.games g where g.id = leave_game.game_id for update;
  in_progress := game_phase in ('countdown', 'head_start', 'live');

  -- A runner who leaves a live round counts as tagged; anyone else just leaves.
  if leaving.team = 'runner' and in_progress then
    update public.players set status = 'tagged', tagged_at = now(), is_ready = false
      where id = leaving.id;
  else
    update public.players set status = 'left', is_ready = false where id = leaving.id;
  end if;

  if game_phase = 'lobby' and exists (
    select 1 from public.games where id = leave_game.game_id and host_id = caller_id
  ) then
    select user_id into next_host from public.players
      where game_id = leave_game.game_id and status = 'active'
      order by joined_at limit 1;
    if next_host is not null then
      update public.games set host_id = next_host where id = leave_game.game_id;
    end if;
  end if;

  if in_progress and not exists (
    select 1 from public.players
    where game_id = leave_game.game_id and status = 'active' and team = 'hunter'
  ) then
    update public.games
      set status = 'ended', winner = 'runners', end_reason = 'all_hunters_left', ended_at = now()
      where id = leave_game.game_id;
    insert into public.events (game_id, type, payload)
      values (leave_game.game_id, 'game_ended', jsonb_build_object('winner', 'runners', 'reason', 'all_hunters_left'));
  elsif in_progress and not exists (
    select 1 from public.players
    where game_id = leave_game.game_id and status = 'active' and team = 'runner'
  ) then
    update public.games
      set status = 'ended', winner = 'hunters', end_reason = 'all_tagged', ended_at = now()
      where id = leave_game.game_id;
    insert into public.events (game_id, type, payload)
      values (leave_game.game_id, 'game_ended', jsonb_build_object('winner', 'hunters', 'reason', 'all_tagged'));
  end if;

  insert into public.events (game_id, type, payload) values (
    leave_game.game_id, 'player_left', jsonb_build_object('user_id', caller_id)
  );
end;
$$;

-- kick_player ----------------------------------------------------------------
create or replace function public.kick_player(game_id uuid, player_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  target public.players%rowtype;
  game_host uuid;
  game_phase public.game_status;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select g.host_id, g.status into game_host, game_phase
    from public.games g where g.id = kick_player.game_id for update;
  if game_phase is distinct from 'lobby' or caller_id <> game_host then
    raise exception 'Only the host can remove players from a lobby.';
  end if;
  select * into target from public.players p
    where p.id = kick_player.player_id and p.game_id = kick_player.game_id and p.status <> 'left'
    for update;
  if not found then raise exception 'Player is not in this lobby.'; end if;
  if target.user_id = caller_id then raise exception 'The host cannot remove themselves.'; end if;
  update public.players set status = 'left', is_ready = false where id = target.id;
  insert into public.events (game_id, type, payload) values (
    kick_player.game_id,
    'player_left',
    jsonb_build_object('user_id', target.user_id, 'kicked', true)
  );
end;
$$;

-- get_game_state -------------------------------------------------------------
create or replace function public.get_game_state(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  snapshot jsonb;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not public.is_member(game_id) then raise exception 'You are not a member of this game.'; end if;

  select jsonb_build_object(
    'server_time', now(),
    'game', to_jsonb(g) || jsonb_build_object(
      'area', jsonb_build_object(
        'longitude', extensions.st_x(g.area_center::extensions.geometry),
        'latitude', extensions.st_y(g.area_center::extensions.geometry),
        'radius_m', g.area_radius_m
      ),
      'target_set', exists (select 1 from public.targets t where t.game_id = g.id)
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'user_id', p.user_id, 'display_name', pr.display_name, 'color', pr.color,
        'team', p.team, 'status', p.status, 'is_ready', p.is_ready, 'joined_at', p.joined_at
      ) order by p.joined_at)
      from public.players p join public.profiles pr on pr.id = p.user_id
      where p.game_id = g.id and p.status <> 'left'
    ), '[]'::jsonb),
    'my_player_id', mine.id,
    'my_team', mine.team,
    'pings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ping.id,
        'seq', ping.seq,
        'player_id', ping.player_id,
        'longitude', extensions.st_x(ping.geog::extensions.geometry),
        'latitude', extensions.st_y(ping.geog::extensions.geometry),
        'accuracy_m', ping.accuracy_m,
        'position_age_s', ping.position_age_s,
        'reason', ping.reason,
        'released_at', ping.released_at
      ) order by ping.released_at desc, ping.id desc)
      from (
        select * from public.pings
        where pings.game_id = g.id and (mine.team = 'hunter' or g.status = 'ended')
        order by released_at desc, id desc limit 100
      ) ping
    ), '[]'::jsonb),
    -- Hunters never receive the target before the game is over.
    'target', case when mine.team = 'runner' or g.status = 'ended' then (
      select jsonb_build_object(
        'longitude', extensions.st_x(t.geog::extensions.geometry),
        'latitude', extensions.st_y(t.geog::extensions.geometry)
      )
      from public.targets t where t.game_id = g.id
    ) else null end,
    'events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.id)
      from (
        select * from public.events
        where events.game_id = g.id
          and (events.audience = 'all' or events.audience = mine.team::text)
        order by id desc limit 50
      ) e
    ), '[]'::jsonb)
  ) into snapshot
  from public.games g
  join public.players mine on mine.game_id = g.id and mine.user_id = caller_id and mine.status <> 'left'
  where g.id = get_game_state.game_id;

  if snapshot is null then raise exception 'Game could not be loaded.'; end if;
  return snapshot;
end;
$$;

revoke all on function public.create_game(public.game_mode, double precision, double precision, integer, jsonb),
  public.join_game(text), public.set_team(uuid, uuid, public.team_type), public.randomize_teams(uuid, integer),
  public.begin_target_selection(uuid), public.set_target(uuid, double precision, double precision),
  public.set_ready(uuid, boolean), public.leave_game(uuid), public.kick_player(uuid, uuid),
  public.get_game_state(uuid) from public, anon;
grant execute on function public.create_game(public.game_mode, double precision, double precision, integer, jsonb),
  public.join_game(text), public.set_team(uuid, uuid, public.team_type), public.randomize_teams(uuid, integer),
  public.begin_target_selection(uuid), public.set_target(uuid, double precision, double precision),
  public.set_ready(uuid, boolean), public.leave_game(uuid), public.kick_player(uuid, uuid),
  public.get_game_state(uuid) to authenticated;

-- Realtime publishes only rows whose own RLS policies permit the subscriber to see them.
do $$
declare
  table_name text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach table_name in array array['games', 'players', 'player_positions', 'pings', 'tags', 'events'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
