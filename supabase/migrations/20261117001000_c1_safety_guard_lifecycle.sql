-- Migration: 20261117001000_c1_safety_guard_lifecycle.sql
-- Phase C Milestone C1: Speed & Safety Guard (all modes)
-- Functions: pause_game, resume_game, vote_pause_game, update send_sos, advance_game, submit_position, get_game_state

-- 1. pause_game ---------------------------------------------------------------
create or replace function public.pause_game(
  game_id uuid,
  reason text default 'safety_pause'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  me public.players%rowtype;
  caller_name text;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into current_game from public.games g where g.id = pause_game.game_id for update;
  if not found then raise exception 'Game not found.'; end if;

  select * into me from public.players p where p.game_id = pause_game.game_id and p.user_id = caller_id and p.status <> 'left';
  if not found then raise exception 'You are not an active member of this game.'; end if;

  if current_game.status = 'paused' then
    return jsonb_build_object('success', true, 'phase', 'paused', 'already_paused', true);
  end if;

  if current_game.status not in ('live', 'head_start', 'countdown') then
    raise exception 'Game cannot be paused in its current state (%).', current_game.status;
  end if;

  select display_name into caller_name from public.profiles where id = caller_id;

  update public.games
  set status = 'paused',
      mode_params = coalesce(mode_params, '{}'::jsonb) || jsonb_build_object(
        'safety', coalesce(mode_params->'safety', '{}'::jsonb) || jsonb_build_object(
          'paused_at', clock_timestamp(),
          'pre_pause_status', current_game.status,
          'paused_by', caller_id,
          'pause_reason', coalesce(pause_game.reason, 'safety_pause')
        )
      )
  where id = current_game.id;

  insert into public.events (game_id, type, audience, payload)
  values (
    current_game.id,
    'game_paused',
    'all',
    jsonb_build_object(
      'player_id', me.id,
      'user_id', caller_id,
      'display_name', caller_name,
      'reason', coalesce(pause_game.reason, 'safety_pause'),
      'paused_at', clock_timestamp(),
      'message', caller_name || ' paused the game for safety!'
    )
  );

  return jsonb_build_object(
    'success', true,
    'phase', 'paused',
    'reason', coalesce(pause_game.reason, 'safety_pause')
  );
end;
$$;

revoke all on function public.pause_game(uuid, text) from public, anon;
grant execute on function public.pause_game(uuid, text) to authenticated;

-- 2. resume_game --------------------------------------------------------------
create or replace function public.resume_game(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  me public.players%rowtype;
  caller_name text;
  v_paused_at timestamptz;
  v_pre_status public.game_status;
  v_pause_delta interval;
  v_new_mode_params jsonb;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into current_game from public.games g where g.id = resume_game.game_id for update;
  if not found then raise exception 'Game not found.'; end if;

  select * into me from public.players p where p.game_id = resume_game.game_id and p.user_id = caller_id and p.status <> 'left';
  if not found then raise exception 'You are not an active member of this game.'; end if;

  if current_game.status <> 'paused' then
    return jsonb_build_object('success', false, 'reason', 'game_not_paused', 'phase', current_game.status);
  end if;

  v_paused_at := (current_game.mode_params->'safety'->>'paused_at')::timestamptz;
  v_pre_status := coalesce((current_game.mode_params->'safety'->>'pre_pause_status')::public.game_status, 'live'::public.game_status);

  if v_paused_at is not null then
    v_pause_delta := clock_timestamp() - v_paused_at;
  else
    v_pause_delta := interval '0 seconds';
  end if;

  select display_name into caller_name from public.profiles where id = caller_id;

  v_new_mode_params := current_game.mode_params;
  v_new_mode_params := jsonb_set(v_new_mode_params, '{safety,paused_at}', 'null'::jsonb);
  v_new_mode_params := jsonb_set(v_new_mode_params, '{safety,resumed_at}', to_jsonb(to_char(clock_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  v_new_mode_params := jsonb_set(v_new_mode_params, '{safety,pause_votes}', '{}'::jsonb);

  -- Adjust mode-specific pulse or curfew timers if present
  if v_new_mode_params ? 'territory_pulse' and (v_new_mode_params->'territory_pulse'->>'next_pulse_at') is not null then
    v_new_mode_params := jsonb_set(
      v_new_mode_params,
      '{territory_pulse,next_pulse_at}',
      to_jsonb(to_char((v_new_mode_params->'territory_pulse'->>'next_pulse_at')::timestamptz + v_pause_delta, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    );
  end if;

  if (v_new_mode_params->'safety'->>'curfew_at') is not null then
    v_new_mode_params := jsonb_set(
      v_new_mode_params,
      '{safety,curfew_at}',
      to_jsonb(to_char((v_new_mode_params->'safety'->>'curfew_at')::timestamptz + v_pause_delta, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    );
  end if;

  update public.games
  set status = v_pre_status,
      ends_at = ends_at + v_pause_delta,
      next_ping_at = next_ping_at + v_pause_delta,
      live_at = case when live_at is not null then live_at + v_pause_delta else null end,
      head_start_at = case when head_start_at is not null then head_start_at + v_pause_delta else null end,
      mode_params = v_new_mode_params
  where id = current_game.id;

  insert into public.events (game_id, type, audience, payload)
  values (
    current_game.id,
    'game_resumed',
    'all',
    jsonb_build_object(
      'player_id', me.id,
      'user_id', caller_id,
      'display_name', caller_name,
      'resumed_at', clock_timestamp(),
      'pause_duration_s', extract(epoch from v_pause_delta)::int,
      'message', caller_name || ' resumed the game!'
    )
  );

  return jsonb_build_object(
    'success', true,
    'phase', v_pre_status,
    'pause_duration_s', extract(epoch from v_pause_delta)::int
  );
end;
$$;

revoke all on function public.resume_game(uuid) from public, anon;
grant execute on function public.resume_game(uuid) to authenticated;

-- 3. vote_pause_game ----------------------------------------------------------
create or replace function public.vote_pause_game(
  game_id uuid,
  vote boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  me public.players%rowtype;
  caller_name text;
  v_votes jsonb;
  v_active_players integer;
  v_yes_count integer := 0;
  v_needed integer;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into current_game from public.games g where g.id = vote_pause_game.game_id for update;
  if not found then raise exception 'Game not found.'; end if;

  select * into me from public.players p where p.game_id = vote_pause_game.game_id and p.user_id = caller_id and p.status <> 'left';
  if not found then raise exception 'You are not an active member of this game.'; end if;

  if current_game.status = 'paused' then
    return jsonb_build_object('success', true, 'paused', true, 'already_paused', true);
  end if;

  select display_name into caller_name from public.profiles where id = caller_id;

  v_votes := coalesce(current_game.mode_params->'safety'->'pause_votes', '{}'::jsonb);
  v_votes := jsonb_set(v_votes, array[caller_id::text], to_jsonb(vote));

  -- Count total active field players
  select count(*) into v_active_players
  from public.players p
  where p.game_id = current_game.id and p.status = 'active' and not coalesce(p.is_remote, false);

  -- Count yes votes among active players
  select count(*) into v_yes_count
  from jsonb_each_text(v_votes) v
  join public.players p on p.user_id = v.key::uuid and p.game_id = current_game.id and p.status = 'active'
  where v.value = 'true';

  v_needed := greatest(1, ceil(v_active_players::numeric / 2.0)::integer);

  if v_yes_count >= v_needed then
    -- Majority reached: execute pause!
    perform public.pause_game(current_game.id, 'majority_safety_vote');
    return jsonb_build_object(
      'success', true,
      'paused', true,
      'yes_votes', v_yes_count,
      'needed', v_needed,
      'active_players', v_active_players
    );
  else
    -- Update mode_params with vote
    update public.games
    set mode_params = jsonb_set(
      coalesce(mode_params, '{}'::jsonb),
      '{safety,pause_votes}',
      v_votes
    )
    where id = current_game.id;

    insert into public.events (game_id, type, audience, payload)
    values (
      current_game.id,
      'pause_vote_update',
      'all',
      jsonb_build_object(
        'player_id', me.id,
        'user_id', caller_id,
        'display_name', caller_name,
        'vote', vote,
        'yes_votes', v_yes_count,
        'needed', v_needed,
        'active_players', v_active_players
      )
    );

    return jsonb_build_object(
      'success', true,
      'paused', false,
      'yes_votes', v_yes_count,
      'needed', v_needed,
      'active_players', v_active_players
    );
  end if;
end;
$$;

revoke all on function public.vote_pause_game(uuid, boolean) from public, anon;
grant execute on function public.vote_pause_game(uuid, boolean) to authenticated;

-- 4. Update send_sos to automatically trigger safety pause --------------------
create or replace function public.send_sos(game_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  caller_id uuid := auth.uid();
  me public.players%rowtype;
  caller_name text;
  last_pos public.player_positions%rowtype;
  current_game public.games%rowtype;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into me from public.players p
    where p.game_id = send_sos.game_id and p.user_id = caller_id and p.status <> 'left';
  if not found then raise exception 'You are not an active member of this game.'; end if;

  select * into current_game from public.games g where g.id = send_sos.game_id for update;
  if not found then raise exception 'Game not found.'; end if;

  select display_name into caller_name from public.profiles where id = caller_id;
  select * into last_pos from public.player_positions where player_id = me.id;

  insert into public.events (game_id, type, audience, payload)
  values (
    send_sos.game_id,
    'sos',
    'all',
    jsonb_build_object(
      'player_id', me.id,
      'user_id', caller_id,
      'display_name', caller_name,
      'longitude', case when last_pos.geog is not null then extensions.st_x(last_pos.geog::extensions.geometry) else null end,
      'latitude', case when last_pos.geog is not null then extensions.st_y(last_pos.geog::extensions.geometry) else null end,
      'sent_at', clock_timestamp()
    )
  );

  -- Automatic Safety Pause on SOS
  if current_game.status in ('live', 'head_start', 'countdown') then
    update public.games
    set status = 'paused',
        mode_params = coalesce(mode_params, '{}'::jsonb) || jsonb_build_object(
          'safety', coalesce(mode_params->'safety', '{}'::jsonb) || jsonb_build_object(
            'paused_at', clock_timestamp(),
            'pre_pause_status', current_game.status,
            'paused_by', caller_id,
            'pause_reason', 'emergency_sos'
          )
        )
    where id = current_game.id;

    insert into public.events (game_id, type, audience, payload)
    values (
      current_game.id,
      'game_paused',
      'all',
      jsonb_build_object(
        'player_id', me.id,
        'user_id', caller_id,
        'display_name', caller_name,
        'reason', 'emergency_sos',
        'paused_at', clock_timestamp(),
        'message', caller_name || ' triggered emergency SOS! Game is automatically paused for safety.'
      )
    );
  end if;
end;
$$;

revoke all on function public.send_sos(uuid) from public, anon;
grant execute on function public.send_sos(uuid) to authenticated;

-- 5. Update advance_game to handle paused status and curfew -------------------
create or replace function public.advance_game(game_id uuid)
returns public.game_status
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  next_ping timestamptz;
  ping_count integer := 0;
  runner record;
  ping_geog extensions.geography;
  shift_m double precision;
  bearing double precision;
  dist_from_center double precision;
  zone_on boolean;
  stages numeric[];
  stage_count integer;
  base_radius double precision;
  pct numeric;
  stage_idx integer;
  stage_radius double precision;
  staged_at timestamptz;
  prev_staged_at timestamptz;
  target_interval_s double precision;
  interp double precision;
  interp_radius double precision;
  prev_stage integer;
  current_stage integer;
  announced integer;
  active_runners integer;
  active_hunters integer;
  active_survivors integer;
  ghost_rec record;
  patrol_geom geometry;
  duration_s integer;
  effective_duration_s integer;
  elapsed_s double precision;
  loop_frac double precision;
  current_ghost_pt geometry;
  runner_fix record;
  v_ghost_ping_seq integer;
  path_len_m double precision;
  v_duel_variant text;

  -- Territory Pulse locals
  v_tp_next timestamptz;
  v_tp_seq integer;
  v_tp_interval integer;
  v_r_score integer := 0;
  v_h_score integer := 0;
  v_r_controlled integer := 0;
  v_h_controlled integer := 0;
  v_r_dom integer := 0;
  v_h_dom integer := 0;
  v_zone_rec record;
  v_z_runners integer;
  v_z_hunters integer;
  v_prevailing text;
  v_ctrl text;
  v_cont text;
  v_cont_p integer;
begin
  select * into current_game from public.games g
    where g.id = advance_game.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  if current_game.status in ('ended', 'cancelled', 'paused') then
    return current_game.status;
  end if;

  -- Curfew safety check
  if current_game.status in ('live', 'head_start') and (current_game.mode_params->'safety'->>'curfew_at') is not null then
    if clock_timestamp() >= (current_game.mode_params->'safety'->>'curfew_at')::timestamptz then
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id, 'curfew_reached', 'all',
        jsonb_build_object('curfew_at', current_game.mode_params->'safety'->>'curfew_at', 'message', 'Curfew reached. Round automatically concluded for safety.')
      );
      perform public.end_game(current_game.id, 'runners', 'curfew_reached');
      select * into current_game from public.games g where g.id = advance_game.game_id;
      return current_game.status;
    end if;
  end if;

  if current_game.status = 'countdown' and clock_timestamp() >= current_game.head_start_at then
    if current_game.head_start_s = 0 then
      update public.games set status = 'live' where id = current_game.id;
      insert into public.events (game_id, type, payload) values (current_game.id, 'game_live', '{}'::jsonb);
      current_game.status := 'live';
    else
      update public.games set status = 'head_start' where id = current_game.id;
      insert into public.events (game_id, type, payload) values (current_game.id, 'head_start_started', '{}'::jsonb);
      current_game.status := 'head_start';
    end if;
  end if;

  if current_game.status = 'head_start' and clock_timestamp() >= current_game.live_at then
    update public.games set status = 'live' where id = current_game.id;
    insert into public.events (game_id, type, payload) values (current_game.id, 'game_live', '{}'::jsonb);
    current_game.status := 'live';
  end if;

  -- Timeout condition check
  if current_game.status = 'live' and clock_timestamp() >= current_game.ends_at then
    if current_game.mode_id = 'assassin_ring' then
      select count(*) into active_survivors
      from public.players p
      where p.game_id = current_game.id and p.status = 'active';

      if active_survivors > 1 then
        perform public.end_game(current_game.id, 'solo', 'timeout');
      else
        perform public.end_game(current_game.id, 'solo', 'last_survivor');
      end if;
    elsif current_game.mode_id = 'ghost_duel' then
      perform public.end_game(current_game.id, 'hunters', 'ghost_won');
    elsif current_game.mode_id = 'territory_pulse' then
      v_r_score := coalesce((current_game.mode_params->'territory_pulse'->'scores'->>'runner')::int, 0);
      v_h_score := coalesce((current_game.mode_params->'territory_pulse'->'scores'->>'hunter')::int, 0);
      if v_r_score > v_h_score then
        perform public.end_game(current_game.id, 'runners', 'points_victory');
      elsif v_h_score > v_r_score then
        perform public.end_game(current_game.id, 'hunters', 'points_victory');
      else
        perform public.end_game(current_game.id, 'runners', 'draw');
      end if;
    else
      perform public.end_game(
        current_game.id,
        case when current_game.mode_id = 'classic_chase' then 'hunters' else 'runners' end,
        'time_expired'
      );
    end if;
    select * into current_game from public.games g where g.id = advance_game.game_id;
    return current_game.status;
  end if;

  -- Territory Pulse Execution
  if current_game.status = 'live' and current_game.mode_id = 'territory_pulse' then
    v_tp_next := (current_game.mode_params->'territory_pulse'->>'next_pulse_at')::timestamptz;
    v_tp_interval := coalesce((current_game.mode_params->'territory_pulse'->>'pulse_interval_s')::int, 90);

    if v_tp_next is not null and clock_timestamp() >= v_tp_next then
      v_tp_seq := coalesce((current_game.mode_params->'territory_pulse'->>'pulse_seq')::int, 0) + 1;
      v_r_score := coalesce((current_game.mode_params->'territory_pulse'->'scores'->>'runner')::int, 0);
      v_h_score := coalesce((current_game.mode_params->'territory_pulse'->'scores'->>'hunter')::int, 0);
      v_r_dom := coalesce((current_game.mode_params->'territory_pulse'->'consecutive_dominance'->>'runner')::int, 0);
      v_h_dom := coalesce((current_game.mode_params->'territory_pulse'->'consecutive_dominance'->>'hunter')::int, 0);

      for v_zone_rec in
        select id, geog, state from public.entities
        where entities.game_id = current_game.id and kind = 'zone'
        order by (state->>'zone_index')::int asc
      loop
        select count(*) into v_z_runners
        from public.players p
        join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id
          and p.team = 'runner'
          and p.status = 'active'
          and not coalesce(p.is_remote, false)
          and (p.status_detail->>'incapacitated_until' is null or (p.status_detail->>'incapacitated_until')::timestamptz <= clock_timestamp())
          and pp.recorded_at > clock_timestamp() - interval '45 seconds'
          and extensions.st_dwithin(pp.geog, v_zone_rec.geog, coalesce((v_zone_rec.state->>'radius_m')::double precision, 60.0));

        select count(*) into v_z_hunters
        from public.players p
        join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id
          and p.team = 'hunter'
          and p.status = 'active'
          and not coalesce(p.is_remote, false)
          and (p.status_detail->>'incapacitated_until' is null or (p.status_detail->>'incapacitated_until')::timestamptz <= clock_timestamp())
          and pp.recorded_at > clock_timestamp() - interval '45 seconds'
          and extensions.st_dwithin(pp.geog, v_zone_rec.geog, coalesce((v_zone_rec.state->>'radius_m')::double precision, 60.0));

        if v_z_runners > v_z_hunters then
          v_prevailing := 'runner';
        elsif v_z_hunters > v_z_runners then
          v_prevailing := 'hunter';
        else
          v_prevailing := null;
        end if;

        v_ctrl := v_zone_rec.state->>'controller';
        v_cont := v_zone_rec.state->>'contender';
        v_cont_p := coalesce((v_zone_rec.state->>'contender_pulses')::int, 0);

        if v_ctrl is null then
          if v_prevailing is not null then
            v_ctrl := v_prevailing;
            v_cont := null;
            v_cont_p := 0;
          end if;
        else
          if v_prevailing = v_ctrl then
            v_cont := null;
            v_cont_p := 0;
          elsif v_prevailing is not null and v_prevailing <> v_ctrl then
            if v_cont = v_prevailing then
              v_cont_p := v_cont_p + 1;
              if v_cont_p >= 2 then
                v_ctrl := v_prevailing;
                v_cont := null;
                v_cont_p := 0;
              end if;
            else
              v_cont := v_prevailing;
              v_cont_p := 1;
            end if;
          end if;
        end if;

        update public.entities
        set state = v_zone_rec.state || jsonb_build_object(
              'controller', v_ctrl,
              'contender', v_cont,
              'contender_pulses', v_cont_p,
              'last_pulse_seq', v_tp_seq,
              'runners_present', v_z_runners,
              'hunters_present', v_z_hunters
            ),
            updated_at = now()
        where entities.id = v_zone_rec.id;

        if v_ctrl = 'runner' then
          v_r_score := v_r_score + 1;
          v_r_controlled := v_r_controlled + 1;
        elsif v_ctrl = 'hunter' then
          v_h_score := v_h_score + 1;
          v_h_controlled := v_h_controlled + 1;
        end if;
      end loop;

      if v_r_controlled >= 5 then
        v_r_dom := v_r_dom + 1;
        v_h_dom := 0;
      elsif v_h_controlled >= 5 then
        v_h_dom := v_h_dom + 1;
        v_r_dom := 0;
      else
        v_r_dom := 0;
        v_h_dom := 0;
      end if;

      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'territory_pulse',
        'all',
        jsonb_build_object(
          'pulse_seq', v_tp_seq,
          'scores', jsonb_build_object('runner', v_r_score, 'hunter', v_h_score),
          'controlled', jsonb_build_object('runner', v_r_controlled, 'hunter', v_h_controlled, 'neutral', 7 - v_r_controlled - v_h_controlled)
        )
      );

      update public.games
      set mode_params = mode_params || jsonb_build_object(
        'territory_pulse', jsonb_build_object(
          'pulse_interval_s', v_tp_interval,
          'last_pulse_at', clock_timestamp(),
          'next_pulse_at', clock_timestamp() + make_interval(secs => v_tp_interval),
          'pulse_seq', v_tp_seq,
          'scores', jsonb_build_object('runner', v_r_score, 'hunter', v_h_score),
          'dominance_pct', 70,
          'consecutive_dominance', jsonb_build_object('runner', v_r_dom, 'hunter', v_h_dom)
        )
      )
      where id = current_game.id;

      if v_r_dom >= 2 or v_r_controlled >= 7 then
        perform public.end_game(current_game.id, 'runners', 'territory_dominance');
        select * into current_game from public.games g where g.id = advance_game.game_id;
        return current_game.status;
      elsif v_h_dom >= 2 or v_h_controlled >= 7 then
        perform public.end_game(current_game.id, 'hunters', 'territory_dominance');
        select * into current_game from public.games g where g.id = advance_game.game_id;
        return current_game.status;
      end if;
    end if;
  end if;

  -- Stepping Ghost NPCs (for haunted_map and ghost_duel)
  if current_game.status = 'live' and current_game.mode_id in ('haunted_map', 'ghost_duel') then
    v_duel_variant := coalesce(current_game.mode_params->'ghost_duel'->>'variant', 'time_trial');
    for ghost_rec in
      select id, state, geog from public.entities
      where entities.game_id = current_game.id and kind = 'ghost'
    loop
      patrol_geom := null;
      if ghost_rec.state ? 'path_wkt' then
        begin
          patrol_geom := extensions.st_geomfromtext(ghost_rec.state->>'path_wkt', 4326);
        exception when others then
          patrol_geom := null;
        end;
      end if;

      if patrol_geom is not null and extensions.st_geometrytype(patrol_geom) = 'ST_LineString' then
        duration_s := coalesce((ghost_rec.state->>'duration_s')::integer, 240);
        path_len_m := coalesce((ghost_rec.state->>'total_length_m')::real, 0);

        if path_len_m > 0 and duration_s > 0 then
          effective_duration_s := greatest(duration_s, ceil(path_len_m / 2.0)::integer);
        else
          effective_duration_s := duration_s;
        end if;

        elapsed_s := extract(epoch from (now() - current_game.live_at));
        if current_game.mode_id = 'ghost_duel' and elapsed_s >= effective_duration_s then
          loop_frac := 1.0;
        else
          loop_frac := (elapsed_s / effective_duration_s) - floor(elapsed_s / effective_duration_s);
        end if;

        current_ghost_pt := extensions.st_lineinterpolatepoint(patrol_geom, loop_frac);

        if extensions.st_distance(current_ghost_pt::geography, current_game.area_center) > current_game.area_radius_m then
          current_ghost_pt := extensions.st_closestpoint(
            extensions.st_boundary(current_game.area_center::geometry),
            current_ghost_pt
          );
        end if;

        update public.entities
        set geog = current_ghost_pt::geography,
            updated_at = now()
        where entities.id = ghost_rec.id;

        -- Mirror chase timeout check
        if current_game.mode_id = 'ghost_duel' and v_duel_variant = 'mirror_chase' and elapsed_s >= effective_duration_s then
          perform public.end_game(current_game.id, 'runners', 'ghost_escaped');
          select * into current_game from public.games g where g.id = advance_game.game_id;
          return current_game.status;
        end if;

        -- Proximity assist check (40 m) for Haunted Map
        if current_game.mode_id = 'haunted_map' and current_game.ghost_mode = 'assist' then
          for runner_fix in
            select pp.player_id, pp.geog, pp.accuracy_m, pp.recorded_at
            from public.player_positions pp
            join public.players p on p.id = pp.player_id
            where pp.game_id = current_game.id
              and p.team = 'runner'
              and p.status = 'active'
              and not p.is_remote
              and extensions.st_dwithin(pp.geog, current_ghost_pt::geography, 40)
              and pp.recorded_at > clock_timestamp() - interval '45 seconds'
          loop
            select coalesce(max(seq), 0) + 1 into v_ghost_ping_seq from public.pings where pings.game_id = current_game.id;
            insert into public.pings (game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at)
            values (
              current_game.id,
              v_ghost_ping_seq,
              runner_fix.player_id,
              runner_fix.geog,
              runner_fix.accuracy_m,
              extract(epoch from (clock_timestamp() - runner_fix.recorded_at))::integer,
              'ghost_sighting',
              clock_timestamp()
            );
            insert into public.events (game_id, type, audience, payload)
            values (
              current_game.id,
              'ghost_sighting',
              'all',
              jsonb_build_object(
                'ghost_id', ghost_rec.id,
                'runner_id', runner_fix.player_id,
                'message', 'A wandering ghost spotted a runner!'
              )
            );
          end loop;
        end if;
      end if;
    end loop;
  end if;

  -- Shrinking zone evaluation
  zone_on := ('shrinking_zone' = any(current_game.modifiers) or 'zone' = any(current_game.modifiers));
  if zone_on and current_game.status in ('live', 'head_start') then
    stages := public.zone_stage_values(current_game.id);
    stage_count := array_length(stages, 1);
    base_radius := current_game.area_radius_m;

    if stage_count > 0 and current_game.duration_s > 0 then
      target_interval_s := current_game.duration_s::double precision / (stage_count + 1)::double precision;
      elapsed_s := extract(epoch from (clock_timestamp() - current_game.live_at));
      current_stage := least(stage_count, greatest(0, floor(elapsed_s / target_interval_s)::integer));
      prev_stage := coalesce(current_game.zone_stage, 0);

      if current_stage <> prev_stage then
        update public.games set zone_stage = current_stage where id = current_game.id;
        current_game.zone_stage := current_stage;
        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id,
          'zone_shrink_stage',
          'all',
          jsonb_build_object(
            'stage', current_stage,
            'effective_radius_m', public.effective_radius_m(current_game.id),
            'message', 'Zone has shrunk to stage ' || current_stage::text
          )
        );
      end if;
    end if;
  end if;

  -- Scheduled runner pings
  if current_game.status = 'live' and clock_timestamp() >= current_game.next_ping_at then
    select coalesce(max(seq), 0) + 1 into ping_count from public.pings where pings.game_id = current_game.id;
    update public.games g set ping_seq = ping_count where g.id = current_game.id;

    for runner in
      select pp.player_id, pp.geog, pp.accuracy_m, pp.recorded_at, p.id as p_id
      from public.player_positions pp
      join public.players p on p.id = pp.player_id
      where pp.game_id = current_game.id
        and p.team = 'runner'
        and p.status = 'active'
        and not p.is_remote
        and pp.recorded_at > clock_timestamp() - interval '60 seconds'
    loop
      ping_geog := runner.geog;

      if 'double_agent' = any(current_game.roles) and exists (
        select 1 from public.entities e
        where e.game_id = current_game.id and e.kind = 'scramble' and (e.state->>'runner_id')::uuid = runner.p_id
      ) then
        shift_m := 150 + (random() * 100);
        bearing := random() * 360;
        ping_geog := extensions.st_project(runner.geog, shift_m, radians(bearing))::extensions.geography;
        delete from public.entities where game_id = current_game.id and kind = 'scramble' and (state->>'runner_id')::uuid = runner.p_id;
        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'agent_scramble_applied', 'all',
          jsonb_build_object('runner_id', runner.p_id, 'shift_m', round(shift_m::numeric, 1))
        );
      end if;

      insert into public.pings (
        game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
      ) values (
        current_game.id,
        current_game.ping_seq,
        runner.player_id,
        ping_geog,
        runner.accuracy_m,
        extract(epoch from (clock_timestamp() - runner.recorded_at))::integer,
        'scheduled',
        clock_timestamp()
      );
    end loop;

    next_ping := clock_timestamp() + make_interval(secs => current_game.ping_interval_s);
    update public.games g set next_ping_at = next_ping where g.id = current_game.id;
  end if;

  return current_game.status;
end;
$$;

revoke all on function public.advance_game(uuid) from public, anon;
grant execute on function public.advance_game(uuid) to authenticated;

-- 6. Update submit_position to handle vehicle warning and paused state ---------
create or replace function public.submit_position(
  game_id uuid,
  lat double precision,
  lng double precision,
  accuracy double precision default null,
  speed double precision default null,
  heading double precision default null,
  recorded_at timestamptz default null,
  is_mock boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  me public.players%rowtype;
  fix_time timestamptz;
  fix_geog geography;
  v_in_bounds boolean;
  v_radius double precision;
  v_accuracy real;
  v_speed real;
  v_heading real;
  v_prev_out timestamptz;
  v_out_since timestamptz;
  v_prev_noise integer;
  v_prev_alerted boolean;
  v_prev_smoothed real;
  v_prev_anchor geography;
  v_prev_anchor_since timestamptz;
  v_prev_updated timestamptz;
  v_prev_fast_since timestamptz;
  v_prev_vehicle_warned boolean;
  v_smoothed real;
  v_fast_since timestamptz;
  v_vehicle_warned boolean;
  v_noise integer := 0;
  v_alerted boolean := false;
  v_anchor geography;
  v_anchor_since timestamptz;
  v_dt double precision;
  v_noise_seq integer;
  v_noise_on boolean;
  v_duel_variant text;
  v_duel_target public.entities%rowtype;
  v_ghost_ent public.entities%rowtype;
  v_p_time double precision;
  v_g_time double precision;
  v_delta double precision;
  v_straight_m double precision;
  v_actual_m double precision;
  v_eff real := 1.0;
  v_score integer;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if submit_position.game_id is null then raise exception 'Game not found.'; end if;

  select * into current_game from public.games where id = submit_position.game_id;
  if not found then raise exception 'Game not found.'; end if;

  select * into me from public.players where game_id = submit_position.game_id and user_id = caller_id;
  if not found then raise exception 'You are not a member of this game.'; end if;

  if coalesce(me.is_remote, false) then
    return jsonb_build_object(
      'phase', current_game.status,
      'is_remote', true,
      'in_bounds', true
    );
  end if;

  fix_time := coalesce(submit_position.recorded_at, clock_timestamp());
  fix_geog := extensions.st_setsrid(extensions.st_makepoint(submit_position.lng, submit_position.lat), 4326)::extensions.geography;

  v_radius := public.effective_radius_m(current_game.id);
  v_in_bounds := extensions.st_dwithin(fix_geog, current_game.area_center, v_radius);
  v_accuracy := coalesce(submit_position.accuracy, 10)::real;
  v_speed := submit_position.speed::real;
  v_heading := submit_position.heading::real;

  select out_of_bounds_since, noise, noise_alerted, smoothed_speed_mps, anchor_geog, anchor_since, updated_at, fast_since, vehicle_warned
    into v_prev_out, v_prev_noise, v_prev_alerted, v_prev_smoothed, v_prev_anchor, v_prev_anchor_since, v_prev_updated, v_prev_fast_since, v_prev_vehicle_warned
    from public.player_positions
    where player_id = me.id;

  if v_in_bounds then
    v_out_since := null;
    if v_prev_out is not null then
      insert into public.events (game_id, type, target_player, audience, payload)
      values (
        current_game.id, 'boundary_restored', me.id, 'all',
        jsonb_build_object('user_id', caller_id, 'player_id', me.id)
      );
    end if;
  else
    v_out_since := coalesce(v_prev_out, fix_time);
    if v_prev_out is null then
      insert into public.events (game_id, type, target_player, audience, payload)
      values (
        current_game.id, 'boundary_warning', me.id, 'all',
        jsonb_build_object(
          'user_id', caller_id,
          'player_id', me.id,
          'message', 'You are outside the play area! Return inside.'
        )
      );
    end if;
  end if;

  v_dt := case
    when v_prev_updated is null then 1.0
    else greatest(0.5, least(10.0, extract(epoch from (now() - v_prev_updated))))
  end;

  -- Speed Smoothing & Vehicle Safety Warning (>8 m/s for 10 s)
  if v_speed is null then
    v_smoothed := coalesce(v_prev_smoothed, 0.0);
  elsif v_prev_smoothed is null then
    v_smoothed := v_speed;
  else
    v_smoothed := 0.75 * v_prev_smoothed + 0.25 * v_speed;
  end if;

  v_noise_on := ('noise_meter' = any(current_game.modifiers) or 'noise' = any(current_game.modifiers));

  if v_smoothed >= 8.0 then
    v_fast_since := coalesce(v_prev_fast_since, fix_time);
    v_vehicle_warned := coalesce(v_prev_vehicle_warned, false);
    if not v_vehicle_warned and v_fast_since is not null and greatest(now(), fix_time) - v_fast_since >= interval '10 seconds' then
      insert into public.events (game_id, type, audience, payload, target_player)
      values (
        current_game.id, 'vehicle_warning', 'all',
        jsonb_build_object(
          'player_id', me.id,
          'user_id', caller_id,
          'speed_mps', round(v_smoothed::numeric, 1),
          'message', 'Vehicle speed detected (>8 m/s sustained for 10 s). Motorized transit is prohibited!'
        ),
        me.id
      );
      v_vehicle_warned := true;

      -- Mode-specific penalty: Noise meter spike to 100
      if v_noise_on and me.team = 'runner' then
        v_noise := 100;
      end if;

      update public.players
      set status_detail = coalesce(status_detail, '{}'::jsonb) || jsonb_build_object(
        'vehicle_warning', true,
        'speed_warning_at', clock_timestamp(),
        'speed_warnings_count', coalesce((status_detail->>'speed_warnings_count')::int, 0) + 1
      )
      where id = me.id;
    end if;
  else
    v_fast_since := null;
    v_vehicle_warned := false;
  end if;

  -- Mock location check
  if coalesce(submit_position.is_mock, false) then
    insert into public.events (game_id, type, target_player, audience, payload)
    values (
      current_game.id,
      'mock_location_detected',
      me.id,
      'all',
      jsonb_build_object(
        'player_id', me.id,
        'message', 'Mock location detected from player.'
      )
    );
  end if;

  -- Noise modifier logic
  if v_noise_on and me.team = 'runner' and not v_vehicle_warned then
    if v_smoothed >= 8 then
      v_noise := round(coalesce(v_prev_noise, 0) + 8 * v_dt)::integer;
    elsif v_smoothed >= 5 then
      v_noise := round(coalesce(v_prev_noise, 0) + 4 * v_dt)::integer;
    elsif v_smoothed >= 2.5 then
      v_noise := round(coalesce(v_prev_noise, 0) + 1.5 * v_dt)::integer;
    elsif v_smoothed >= 0.5 then
      v_noise := greatest(0, round(coalesce(v_prev_noise, 0) - 2 * v_dt))::integer;
    else
      v_noise := greatest(0, round(coalesce(v_prev_noise, 0) - 5 * v_dt))::integer;
    end if;
    v_noise := least(100, greatest(0, v_noise));

    v_alerted := coalesce(v_prev_alerted, false);
    if v_noise >= 100 and not v_alerted then
      v_alerted := true;
      select coalesce(max(seq), 0) + 1 into v_noise_seq
        from public.pings
        where pings.game_id = current_game.id;
      insert into public.pings (game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at)
      values (
        current_game.id,
        v_noise_seq,
        me.id,
        fix_geog,
        coalesce(v_accuracy, 10)::real,
        0,
        'noise_burst',
        now()
      );
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'noise_spike',
        'hunter',
        jsonb_build_object('player_id', me.id, 'noise', v_noise)
      );
      v_noise := 50;
    elsif v_noise < 100 then
      v_alerted := false;
    end if;
  end if;

  insert into public.player_positions (
    player_id, game_id, geog, accuracy_m, speed_mps, heading,
    recorded_at, updated_at, is_mock, out_of_bounds_since,
    noise, noise_alerted, smoothed_speed_mps, anchor_geog, anchor_since,
    fast_since, vehicle_warned
  ) values (
    me.id, current_game.id, fix_geog, v_accuracy, v_speed, v_heading,
    fix_time, now(), coalesce(submit_position.is_mock, false), v_out_since,
    v_noise, v_alerted, v_smoothed, v_anchor, v_anchor_since,
    v_fast_since, v_vehicle_warned
  )
  on conflict (player_id) do update set
    game_id = excluded.game_id,
    geog = excluded.geog,
    accuracy_m = excluded.accuracy_m,
    speed_mps = excluded.speed_mps,
    heading = excluded.heading,
    recorded_at = excluded.recorded_at,
    updated_at = excluded.updated_at,
    out_of_bounds_since = excluded.out_of_bounds_since,
    noise = excluded.noise,
    noise_alerted = excluded.noise_alerted,
    smoothed_speed_mps = excluded.smoothed_speed_mps,
    anchor_geog = excluded.anchor_geog,
    anchor_since = excluded.anchor_since,
    fast_since = excluded.fast_since,
    vehicle_warned = excluded.vehicle_warned;

  -- Store trail points throttled to 10s
  if not coalesce(submit_position.is_mock, false) then
    insert into public.trail_points (game_id, player_id, geog, accuracy_m, recorded_at)
    select current_game.id, me.id, fix_geog, v_accuracy, fix_time
    where not exists (
      select 1
      from public.trail_points tp
      where tp.player_id = me.id
        and tp.recorded_at > fix_time - interval '10 seconds'
    );
  end if;

  -- Skip arrival & collision victory evaluations if game is paused
  if current_game.status <> 'paused' then
    -- Classic chase arrival check
    if current_game.mode_id = 'classic_chase' and me.team = 'runner' and current_game.status = 'live' then
      if exists (
        select 1 from public.targets t
        where t.game_id = current_game.id
          and extensions.st_dwithin(fix_geog, t.geog, current_game.target_radius_m)
      ) then
        insert into public.events (game_id, type, target_player, audience, payload)
        values (
          current_game.id, 'target_reached', me.id, 'all',
          jsonb_build_object('runner_id', me.id, 'user_id', caller_id)
        );
        perform public.end_game(current_game.id, 'runners', 'target_reached');
        select * into current_game from public.games g where g.id = submit_position.game_id;
      end if;
    end if;

    -- Ghost Duel arrival / collision checks
    if current_game.mode_id = 'ghost_duel' and current_game.status = 'live' then
      v_duel_variant := coalesce(current_game.mode_params->'ghost_duel'->>'variant', 'time_trial');

      select * into v_duel_target from public.entities where entities.game_id = current_game.id and kind = 'target' limit 1;
      select * into v_ghost_ent from public.entities where entities.game_id = current_game.id and kind = 'ghost' limit 1;

      -- Evade collision check
      if v_duel_variant = 'evade' and me.team = 'runner' and v_ghost_ent.id is not null then
        if extensions.st_dwithin(fix_geog, v_ghost_ent.geog, 20.0) then
          perform public.end_game(current_game.id, 'hunters', 'haunted');
          select * into current_game from public.games g where g.id = submit_position.game_id;
        end if;
      end if;

      -- Time trial arrival check
      if v_duel_target.id is not null and extensions.st_dwithin(fix_geog, v_duel_target.geog, coalesce((v_duel_target.state->>'radius_m')::double precision, 20.0)) then
        v_p_time := greatest(1.0, extract(epoch from (now() - current_game.live_at)));
        v_g_time := coalesce((v_ghost_ent.state->>'duration_s')::double precision, 240.0);
        v_delta := v_g_time - v_p_time;

        select extensions.st_distance(current_game.area_center, v_duel_target.geog) into v_straight_m;
        select coalesce(sum(extensions.st_length(tp.geog::extensions.geography)), v_straight_m) into v_actual_m
        from public.trail_points tp where tp.game_id = current_game.id and tp.player_id = me.id;

        if v_actual_m > 0 and v_straight_m > 0 then
          v_eff := least(1.0, (v_straight_m / v_actual_m)::real);
        else
          v_eff := 1.0;
        end if;

        v_score := greatest(100, round(1000.0 + (v_delta * 10.0) + (v_eff * 200.0))::integer);

        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'ghost_duel_finish', 'all',
          jsonb_build_object(
            'player_id', me.id,
            'player_time_s', v_p_time,
            'ghost_time_s', v_g_time,
            'delta_s', v_delta,
            'efficiency', round(v_eff::numeric, 2),
            'score', v_score,
            'beaten', (v_delta >= 0)
          )
        );

        if v_duel_variant = 'evade' then
          perform public.end_game(current_game.id, 'runners', 'evaded');
        elsif v_delta >= 0 then
          perform public.end_game(current_game.id, 'runners', 'ghost_beaten');
        else
          perform public.end_game(current_game.id, 'runners', 'ghost_won');
        end if;
        select * into current_game from public.games g where g.id = submit_position.game_id;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'phase', current_game.status,
    'server_time', clock_timestamp(),
    'live_at', current_game.live_at,
    'ends_at', current_game.ends_at,
    'next_ping_at', current_game.next_ping_at,
    'in_bounds', v_in_bounds,
    'effective_radius_m', v_radius,
    'my_status', me.status,
    'winner', current_game.winner,
    'end_reason', current_game.end_reason,
    'noise', coalesce(v_noise, 0),
    'smoothed_speed_mps', round(v_smoothed::numeric, 2),
    'vehicle_warning', coalesce(v_vehicle_warned, false)
  );
end;
$$;

revoke all on function public.submit_position(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz, boolean) from public, anon;
grant execute on function public.submit_position(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz, boolean) to authenticated;

-- 7. Update get_game_state to expose safety snapshot --------------------------
create or replace function public.get_game_state(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  mine public.players%rowtype;
  v_ghost_duel jsonb;
  v_territory_pulse jsonb;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not public.is_member(game_id) then raise exception 'You are not a member of this game.'; end if;

  perform public.advance_game(get_game_state.game_id);

  select * into current_game from public.games g where g.id = get_game_state.game_id;
  select * into mine from public.players p where p.game_id = get_game_state.game_id and p.user_id = caller_id;

  v_ghost_duel := case
    when current_game.mode_id = 'ghost_duel' then jsonb_build_object(
      'variant', coalesce(current_game.mode_params->'ghost_duel'->>'variant', 'time_trial'),
      'target', (
        select jsonb_build_object(
          'id', e.id,
          'longitude', extensions.st_x(e.geog::extensions.geometry),
          'latitude', extensions.st_y(e.geog::extensions.geometry),
          'radius_m', coalesce((e.state->>'radius_m')::int, 20)
        )
        from public.entities e
        where e.game_id = current_game.id and e.kind = 'target'
        limit 1
      ),
      'ghost', (
        select jsonb_build_object(
          'id', e.id,
          'longitude', extensions.st_x(e.geog::extensions.geometry),
          'latitude', extensions.st_y(e.geog::extensions.geometry),
          'duration_s', coalesce((e.state->>'duration_s')::int, 240),
          'elapsed_s', greatest(0, extract(epoch from (clock_timestamp() - current_game.live_at))::int),
          'total_length_m', coalesce((e.state->>'total_length_m')::real, 0),
          'path_wkt', e.state->>'path_wkt'
        )
        from public.entities e
        where e.game_id = current_game.id and e.kind = 'ghost'
        limit 1
      )
    )
    else null
  end;

  v_territory_pulse := case
    when current_game.mode_id = 'territory_pulse' then jsonb_build_object(
      'pulse_seq', coalesce((current_game.mode_params->'territory_pulse'->>'pulse_seq')::int, 0),
      'pulse_interval_s', coalesce((current_game.mode_params->'territory_pulse'->>'pulse_interval_s')::int, 90),
      'next_pulse_at', current_game.mode_params->'territory_pulse'->>'next_pulse_at',
      'last_pulse_at', current_game.mode_params->'territory_pulse'->>'last_pulse_at',
      'scores', coalesce(current_game.mode_params->'territory_pulse'->'scores', jsonb_build_object('runner', 0, 'hunter', 0)),
      'dominance_pct', coalesce((current_game.mode_params->'territory_pulse'->>'dominance_pct')::int, 70),
      'zones', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id', e.id,
            'name', coalesce(e.state->>'name', 'Sector'),
            'zone_index', coalesce((e.state->>'zone_index')::int, 0),
            'latitude', extensions.st_y(e.geog::extensions.geometry),
            'longitude', extensions.st_x(e.geog::extensions.geometry),
            'radius_m', coalesce((e.state->>'radius_m')::int, 60),
            'controller', e.state->>'controller',
            'contender', e.state->>'contender',
            'contender_pulses', coalesce((e.state->>'contender_pulses')::int, 0)
          ) order by (e.state->>'zone_index')::int asc
        ), '[]'::jsonb)
        from public.entities e
        where e.game_id = current_game.id and e.kind = 'zone'
      )
    )
    else null
  end;

  return jsonb_build_object(
    'server_time', clock_timestamp(),
    'ghost_duel', v_ghost_duel,
    'territory_pulse', v_territory_pulse,
    'safety', jsonb_build_object(
      'is_paused', (current_game.status = 'paused'),
      'paused_at', current_game.mode_params->'safety'->>'paused_at',
      'paused_by', current_game.mode_params->'safety'->>'paused_by',
      'paused_by_name', (
        select pr.display_name from public.profiles pr
        where pr.id = (current_game.mode_params->'safety'->>'paused_by')::uuid
      ),
      'pause_reason', current_game.mode_params->'safety'->>'pause_reason',
      'pause_votes', coalesce(current_game.mode_params->'safety'->'pause_votes', '{}'::jsonb),
      'curfew_at', current_game.mode_params->'safety'->>'curfew_at',
      'is_night', (
        extract(hour from clock_timestamp() at time zone 'UTC') in (20, 21, 22, 23, 0, 1, 2, 3, 4, 5)
      ),
      'vehicle_warning', coalesce((mine.status_detail->>'vehicle_warning')::boolean, false)
    ),
    'game', to_jsonb(current_game) || jsonb_build_object(
      'area', jsonb_build_object(
        'longitude', extensions.st_x(current_game.area_center::extensions.geometry),
        'latitude', extensions.st_y(current_game.area_center::extensions.geometry),
        'radius_m', public.effective_radius_m(current_game.id),
        'base_radius_m', current_game.area_radius_m,
        'zone_stage', current_game.zone_stage,
        'zone_stage_count', array_length(public.zone_stage_values(current_game.id), 1),
        'shrinking', 'shrinking_zone' = any(current_game.modifiers)
      ),
      'target_set', exists (select 1 from public.targets t where t.game_id = current_game.id),
      'ping_visible_s', current_game.ping_visible_s,
      'ghost_mode', current_game.ghost_mode,
      'jail', (
        select jsonb_build_object(
          'id', e.id,
          'latitude', extensions.st_y(e.geog::extensions.geometry),
          'longitude', extensions.st_x(e.geog::extensions.geometry),
          'radius_m', coalesce((e.state->>'radius_m')::int, 15)
        )
        from public.entities e
        where e.game_id = current_game.id and e.kind = 'jail'
        limit 1
      ),
      'jail_rules', case
        when current_game.mode_id = 'jailbreak' then jsonb_build_object(
          'auto_release_s', coalesce((current_game.mode_params->'jailbreak'->>'auto_release_s')::int, 300),
          'release_hold_s', coalesce((current_game.mode_params->'jailbreak'->>'release_hold_s')::int, 10),
          'release_radius_m', coalesce((current_game.mode_params->'jailbreak'->>'release_radius_m')::int, 10)
        )
        else null
      end,
      'ghost_duel', v_ghost_duel,
      'territory_pulse', v_territory_pulse,
      'relay_heist', case
        when current_game.mode_id = 'relay_heist' then jsonb_build_object(
          'extraction', (
            select jsonb_build_object(
              'id', e.id,
              'longitude', extensions.st_x(e.geog::extensions.geometry),
              'latitude', extensions.st_y(e.geog::extensions.geometry),
              'radius_m', coalesce((e.state->>'radius_m')::int, 25)
            )
            from public.entities e
            where e.game_id = current_game.id and e.kind in ('extraction', 'extraction_point')
            limit 1
          ),
          'package', (
            select case
              when (e.state->>'status') = 'dropped' then
                jsonb_build_object(
                  'status', 'dropped',
                  'dropped_at', e.state->>'dropped_at',
                  'longitude', extensions.st_x(e.geog::extensions.geometry),
                  'latitude', extensions.st_y(e.geog::extensions.geometry),
                  'securing_hunter_id', e.state->>'securing_hunter_id',
                  'securing_started_at', e.state->>'securing_started_at'
                )
              when (e.state->>'status') = 'carried' and (e.state->>'handoff_pending_to') is not null then
                jsonb_build_object(
                  'status', 'carried',
                  'longitude', extensions.st_x(e.geog::extensions.geometry),
                  'latitude', extensions.st_y(e.geog::extensions.geometry),
                  'handoff_pending_to', e.state->>'handoff_pending_to',
                  'handoff_expires_at', e.state->>'handoff_expires_at'
                )
              else
                jsonb_build_object(
                  'status', 'carried'
                )
            end
            from public.entities e
            where e.game_id = current_game.id and e.kind = 'package'
            limit 1
          ),
          'is_carrier', exists (
            select 1 from public.entities e
            where e.game_id = current_game.id and e.kind = 'package'
              and (e.state->>'carrier_player_id') = mine.id::text
              and (e.state->>'status') = 'carried'
          ),
          'handoff_pending_from', (
            select e.state->>'carrier_player_id'
            from public.entities e
            where e.game_id = current_game.id and e.kind = 'package'
              and (e.state->>'handoff_pending_to') = mine.id::text
              and (e.state->>'handoff_expires_at')::timestamptz > clock_timestamp()
            limit 1
          )
        )
        else null
      end,
      'vip_escort', case
        when 'vip' = any(current_game.roles) then jsonb_build_object(
          'is_active', true,
          'vip_player_id', case
            when mine.team = 'runner' or current_game.status in ('ended', 'cancelled') then (
              select p.id from public.players p
              where p.game_id = current_game.id and p.team = 'runner' and p.secret_role = 'vip' and p.status = 'active'
              limit 1
            )
            else null
          end
        )
        else null
      end
    ),
    'my_player_id', mine.id,
    'my_team', mine.team,
    'my_position', (
      select jsonb_build_object(
        'player_id', pp.player_id,
        'longitude', extensions.st_x(pp.geog::extensions.geometry),
        'latitude', extensions.st_y(pp.geog::extensions.geometry),
        'accuracy_m', pp.accuracy_m,
        'heading', pp.heading,
        'speed_mps', pp.speed_mps,
        'recorded_at', pp.recorded_at,
        'in_bounds', extensions.st_dwithin(pp.geog, current_game.area_center, public.effective_radius_m(current_game.id)),
        'noise', pp.noise
      )
      from public.player_positions pp
      where pp.player_id = mine.id
    ),
    'teammates', case
      when mine.team = 'solo' then '[]'::jsonb
      else coalesce((
        select jsonb_agg(jsonb_build_object(
          'player_id', p.id,
          'user_id', p.user_id,
          'display_name', pr.display_name,
          'color', pr.color,
          'status', p.status,
          'is_remote', p.is_remote,
          'longitude', extensions.st_x(pp.geog::extensions.geometry),
          'latitude', extensions.st_y(pp.geog::extensions.geometry),
          'accuracy_m', pp.accuracy_m,
          'heading', pp.heading,
          'speed_mps', pp.speed_mps,
          'recorded_at', pp.recorded_at
        ))
        from public.players p
        join public.profiles pr on pr.id = p.user_id
        left join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id
          and p.team = mine.team
          and p.id <> mine.id
          and p.status <> 'left'
      ), '[]'::jsonb)
    end,
    'pings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pi.id,
        'seq', pi.seq,
        'player_id', pi.player_id,
        'longitude', extensions.st_x(pi.geog::extensions.geometry),
        'latitude', extensions.st_y(pi.geog::extensions.geometry),
        'accuracy_m', pi.accuracy_m,
        'reason', pi.reason,
        'released_at', pi.released_at
      ) order by pi.seq desc)
      from public.pings pi
      where pi.game_id = current_game.id
        and pi.released_at > clock_timestamp() - make_interval(secs => current_game.ping_visible_s)
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ev.id,
        'type', ev.type,
        'payload', ev.payload,
        'created_at', ev.created_at
      ) order by ev.id desc)
      from public.events ev
      where ev.game_id = current_game.id
        and (
          ev.audience = 'all'
          or (ev.audience = 'team' and ev.target_player in (
            select p2.id from public.players p2 where p2.game_id = current_game.id and p2.team = mine.team
          ))
          or (ev.audience in ('runner', 'hunter') and ev.audience = mine.team::text)
          or (ev.target_player = mine.id)
        )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_game_state(uuid) from public, anon;
grant execute on function public.get_game_state(uuid) to authenticated;
