-- Real Pinpoint round initialization, scout photo latching, and coordinate hydration RPCs.

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
      'started_at', pr.started_at
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

create or replace function public.init_pinpoint_game(
  p_game_id uuid,
  p_rounds jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_game public.games%rowtype;
  v_pg public.pinpoint_games%rowtype;
  v_pp_cfg jsonb;
  v_photo_source text;
  v_total_rounds integer;
  v_duration integer;
  v_radius integer;
  v_round jsonb;
  v_idx integer := 0;
  v_existing_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;
  if not public.is_member(p_game_id) then
    raise exception 'You are not a member of this game.';
  end if;

  select * into v_game from public.games where id = p_game_id for update;
  if not found then
    raise exception 'Game not found.';
  end if;

  v_pp_cfg := coalesce(v_game.mode_params->'pinpoint', v_game.mode_params, '{}'::jsonb);
  v_photo_source := coalesce(v_pp_cfg->>'photo_source', 'host_drop');
  if v_photo_source not in ('scout_and_swap', 'host_drop', 'map_poi') then
    v_photo_source := 'host_drop';
  end if;
  v_total_rounds := least(5, greatest(1, coalesce((v_pp_cfg->>'total_rounds')::integer, jsonb_array_length(coalesce(p_rounds, '[]'::jsonb)), 3)));
  v_duration := least(600, greatest(60, coalesce((v_pp_cfg->>'round_duration_s')::integer, 180)));
  v_radius := least(750, greatest(100, coalesce((v_pp_cfg->>'radius_meters')::integer, 500)));

  select * into v_pg from public.pinpoint_games where game_id = p_game_id limit 1;
  if not found then
    insert into public.pinpoint_games (game_id, radius_meters, photo_source, total_rounds, round_duration_seconds)
    values (p_game_id, v_radius, v_photo_source, v_total_rounds, v_duration)
    returning * into v_pg;
  end if;

  select count(*) into v_existing_count from public.pinpoint_rounds where pinpoint_game_id = v_pg.id;
  if v_existing_count = 0 and jsonb_typeof(p_rounds) = 'array' then
    for v_round in select * from jsonb_array_elements(p_rounds) loop
      v_idx := v_idx + 1;
      exit when v_idx > v_pg.total_rounds;
      insert into public.pinpoint_rounds (
        pinpoint_game_id,
        round_number,
        target_photo_url,
        target_location,
        target_heading,
        status,
        started_at
      ) values (
        v_pg.id,
        coalesce((v_round->>'roundNumber')::integer, v_idx),
        coalesce(nullif(v_round->>'targetPhotoUrl', ''), 'pending://scout'),
        extensions.st_setsrid(
          extensions.st_makepoint(
            coalesce((v_round->>'longitude')::double precision, 0),
            coalesce((v_round->>'latitude')::double precision, 0)
          ),
          4326
        ),
        mod(greatest(0, coalesce((v_round->>'heading')::numeric, 0)), 360.0),
        case when v_photo_source = 'scout_and_swap' then 'scouting' else 'active' end,
        case when v_photo_source = 'scout_and_swap' then null else now() end
      );
    end loop;
  end if;

  return public.get_pinpoint_rounds(p_game_id);
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

  update public.pinpoint_rounds
  set
    target_photo_url = p_photo_url,
    target_location = extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326),
    target_heading = mod(greatest(0, coalesce(p_heading, 0)), 360.0),
    scouted_by_team = p_team,
    status = 'active',
    started_at = coalesce(started_at, now())
  where id = p_round_id
  returning * into v_round;

  return jsonb_build_object(
    'id', v_round.id,
    'round_number', v_round.round_number,
    'target_photo_url', v_round.target_photo_url,
    'latitude', extensions.st_y(v_round.target_location::extensions.geometry),
    'longitude', extensions.st_x(v_round.target_location::extensions.geometry),
    'target_heading', v_round.target_heading,
    'status', v_round.status
  );
end;
$$;

revoke all on function public.get_pinpoint_rounds(uuid) from public, anon;
grant execute on function public.get_pinpoint_rounds(uuid) to authenticated;

revoke all on function public.init_pinpoint_game(uuid, jsonb) from public, anon;
grant execute on function public.init_pinpoint_game(uuid, jsonb) to authenticated;

revoke all on function public.latch_pinpoint_scout(uuid, text, double precision, double precision, numeric, text) from public, anon;
grant execute on function public.latch_pinpoint_scout(uuid, text, double precision, double precision, numeric, text) to authenticated;
