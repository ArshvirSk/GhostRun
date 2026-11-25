-- True 2-team Method A (Scout & Swap) persistence and rival target resolution.

create table if not exists public.pinpoint_scout_drops (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.pinpoint_rounds(id) on delete cascade,
  team text not null check (team in ('runner', 'hunter')),
  player_id uuid not null references public.profiles(id) on delete cascade,
  photo_url text not null,
  location extensions.geometry(Point, 4326) not null,
  heading numeric(5, 2) not null default 0,
  created_at timestamptz not null default now(),
  unique (round_id, team)
);

alter table public.pinpoint_scout_drops enable row level security;

create policy "pinpoint_scout_drops_select_players"
  on public.pinpoint_scout_drops for select
  using (exists (
    select 1 from public.pinpoint_rounds pr
    join public.pinpoint_games pg on pg.id = pr.pinpoint_game_id
    join public.players p on p.game_id = pg.game_id
    where pr.id = pinpoint_scout_drops.round_id
      and p.user_id = auth.uid()
  ));

create or replace function public.get_pinpoint_rounds(
  p_game_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pg public.pinpoint_games%rowtype;
  v_rounds jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;
  if not public.is_member(p_game_id) then
    raise exception 'You are not a member of this game.';
  end if;

  select * into v_pg
  from public.pinpoint_games
  where game_id = p_game_id
  limit 1;

  if not found then
    return jsonb_build_object('exists', false, 'rounds', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', pr.id,
      'round_number', pr.round_number,
      'target_photo_url', pr.target_photo_url,
      'latitude', extensions.st_y(pr.target_location::extensions.geometry),
      'longitude', extensions.st_x(pr.target_location::extensions.geometry),
      'target_heading', pr.target_heading,
      'scouted_by_team', pr.scouted_by_team,
      'status', pr.status,
      'started_at', pr.started_at,
      'scout_drops', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'team', sd.team,
            'photo_url', sd.photo_url,
            'latitude', extensions.st_y(sd.location::extensions.geometry),
            'longitude', extensions.st_x(sd.location::extensions.geometry),
            'heading', sd.heading
          )
        )
        from public.pinpoint_scout_drops sd
        where sd.round_id = pr.id
      ), '[]'::jsonb)
    )
    order by pr.round_number asc
  ), '[]'::jsonb)
  into v_rounds
  from public.pinpoint_rounds pr
  where pr.pinpoint_game_id = v_pg.id;

  return jsonb_build_object(
    'exists', true,
    'pinpoint_game_id', v_pg.id,
    'photo_source', v_pg.photo_source,
    'total_rounds', v_pg.total_rounds,
    'round_duration_seconds', v_pg.round_duration_seconds,
    'rounds', v_rounds
  );
end;
$$;

create or replace function public.latch_pinpoint_scout(
  p_round_id uuid,
  p_photo_url text,
  p_lat double precision,
  p_lng double precision,
  p_heading numeric,
  p_team text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_game_id uuid;
  v_round public.pinpoint_rounds%rowtype;
  v_team text := case when p_team in ('runner', 'hunter') then p_team else 'runner' end;
  v_rival_team text := case when p_team = 'hunter' then 'runner' else 'hunter' end;
  v_has_runners boolean := false;
  v_has_hunters boolean := false;
  v_runner_drop public.pinpoint_scout_drops%rowtype;
  v_hunter_drop public.pinpoint_scout_drops%rowtype;
  v_rival_drop public.pinpoint_scout_drops%rowtype;
  v_swapped boolean := false;
  v_point extensions.geometry;
  v_norm_heading numeric;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select pg.game_id into v_game_id
  from public.pinpoint_rounds pr
  join public.pinpoint_games pg on pg.id = pr.pinpoint_game_id
  where pr.id = p_round_id;

  if v_game_id is null then
    raise exception 'Pinpoint round not found.';
  end if;

  if not public.is_member(v_game_id) then
    raise exception 'You are not a member of this game.';
  end if;

  v_point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326);
  v_norm_heading := mod(greatest(0, coalesce(p_heading, 0)), 360.0);

  insert into public.pinpoint_scout_drops (round_id, team, player_id, photo_url, location, heading)
  values (p_round_id, v_team, auth.uid(), p_photo_url, v_point, v_norm_heading)
  on conflict (round_id, team) do update
  set
    player_id = excluded.player_id,
    photo_url = excluded.photo_url,
    location = excluded.location,
    heading = excluded.heading,
    created_at = now();

  select
    bool_or(p.team = 'runner' and p.status <> 'left'),
    bool_or(p.team = 'hunter' and p.status <> 'left')
  into v_has_runners, v_has_hunters
  from public.players p
  where p.game_id = v_game_id;

  select * into v_runner_drop from public.pinpoint_scout_drops where round_id = p_round_id and team = 'runner';
  select * into v_hunter_drop from public.pinpoint_scout_drops where round_id = p_round_id and team = 'hunter';

  if (v_has_runners and v_has_hunters) then
    v_swapped := (v_runner_drop.id is not null and v_hunter_drop.id is not null);
  else
    v_swapped := true;
  end if;

  if v_swapped then
    select * into v_rival_drop
    from public.pinpoint_scout_drops
    where round_id = p_round_id and team = v_rival_team;

    update public.pinpoint_rounds
    set
      target_photo_url = coalesce(v_rival_drop.photo_url, p_photo_url),
      target_location = coalesce(v_rival_drop.location, v_point),
      target_heading = coalesce(v_rival_drop.heading, v_norm_heading),
      scouted_by_team = coalesce(v_rival_drop.team, v_team),
      status = 'active',
      started_at = coalesce(started_at, now())
    where id = p_round_id
    returning * into v_round;
  else
    select * into v_round from public.pinpoint_rounds where id = p_round_id;
  end if;

  return jsonb_build_object(
    'id', v_round.id,
    'round_number', v_round.round_number,
    'swapped', v_swapped,
    'waiting_for_team', case when v_swapped then null else v_rival_team end,
    'target_photo_url', case when v_swapped then coalesce(v_rival_drop.photo_url, p_photo_url) else p_photo_url end,
    'latitude', extensions.st_y(case when v_swapped then coalesce(v_rival_drop.location, v_point) else v_point end),
    'longitude', extensions.st_x(case when v_swapped then coalesce(v_rival_drop.location, v_point) else v_point end),
    'target_heading', case when v_swapped then coalesce(v_rival_drop.heading, v_norm_heading) else v_norm_heading end,
    'status', v_round.status
  );
end;
$$;

revoke all on function public.get_pinpoint_rounds(uuid) from public, anon;
grant execute on function public.get_pinpoint_rounds(uuid) to authenticated;

revoke all on function public.latch_pinpoint_scout(uuid, text, double precision, double precision, numeric, text) from public, anon;
grant execute on function public.latch_pinpoint_scout(uuid, text, double precision, double precision, numeric, text) to authenticated;
