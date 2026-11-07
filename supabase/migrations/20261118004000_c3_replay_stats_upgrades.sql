-- Migration: 20261118004000_c3_replay_stats_upgrades.sql
-- Phase C Milestone C3: Replay and stats upgrades (docs/MODES.md §7.3)
-- Upgrades get_game_stats with best_bluff, per-player heat stats, and per-mode recap summaries.
-- Upgrades get_game_replay with heat_marks, zones, pulse_history, npc_paths, handoffs, and drops.

-- 1. Upgrade get_game_stats ----------------------------------------------------
create or replace function public.get_game_stats(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  player_rows jsonb := '[]'::jsonb;
  p record;
  min_distance double precision;
  unseen_max double precision;
  peak_noise integer;
  peak_speed real;
  claimed_count integer;
  p_heat_presses integer := 0;
  p_heat_hits integer := 0;
  p_heat_rate integer := 0;
  total_heat integer := 0;
  hot_hits integer := 0;
  heat_hit_rate integer := 0;
  total_drops_claimed integer := 0;
  duration_seconds double precision;
  v_best_bluff jsonb;
  v_mode_recap jsonb := '{}'::jsonb;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not public.is_member(get_game_stats.game_id) then
    raise exception 'You are not a member of this game.';
  end if;

  select * into current_game from public.games g where g.id = get_game_stats.game_id;
  if not found then raise exception 'Game not found.'; end if;
  if not (current_game.status in ('ended', 'cancelled')) then
    raise exception 'Game stats are only available after the round ends.';
  end if;

  duration_seconds := greatest(0, extract(epoch from (coalesce(current_game.ended_at, now()) - coalesce(current_game.live_at, now()))));

  -- Game-wide Heat stats summary
  select count(*), count(*) filter (where result = 'hot')
  into total_heat, hot_hits
  from public.heat_presses hp
  where hp.game_id = current_game.id;

  if total_heat > 0 then
    heat_hit_rate := round((hot_hits * 100.0) / total_heat);
  end if;

  -- Total drops claimed
  select count(*) into total_drops_claimed
  from public.drop_claims dc
  where dc.game_id = current_game.id;

  -- Mode-specific recap summaries
  if current_game.mode_id = 'relay_heist' then
    v_mode_recap := jsonb_build_object(
      'mode_id', 'relay_heist',
      'total_handoffs', (select count(*) from public.events ev where ev.game_id = current_game.id and ev.type = 'package_handoff'),
      'package_drops', (select count(*) from public.events ev where ev.game_id = current_game.id and ev.type = 'package_dropped'),
      'package_secured', exists (select 1 from public.events ev where ev.game_id = current_game.id and ev.type = 'package_secured')
    );
  elsif current_game.mode_id = 'territory_pulse' then
    v_mode_recap := jsonb_build_object(
      'mode_id', 'territory_pulse',
      'pulse_seq', coalesce((current_game.mode_params->'territory_pulse'->>'pulse_seq')::int, 0),
      'scores', coalesce(current_game.mode_params->'territory_pulse'->'scores', jsonb_build_object('runner', 0, 'hunter', 0)),
      'dominance_pct', coalesce((current_game.mode_params->'territory_pulse'->>'dominance_pct')::int, 70),
      'end_reason', current_game.end_reason
    );
  elsif current_game.mode_id = 'jailbreak' then
    v_mode_recap := jsonb_build_object(
      'mode_id', 'jailbreak',
      'total_rescues', (select count(*) from public.events ev where ev.game_id = current_game.id and ev.type = 'runner_rescued'),
      'total_jailed', (select count(*) from public.events ev where ev.game_id = current_game.id and ev.type = 'runner_jailed')
    );
  elsif current_game.mode_id = 'assassin_ring' then
    v_mode_recap := jsonb_build_object(
      'mode_id', 'assassin_ring',
      'active_survivors', (select count(*) from public.players pl where pl.game_id = current_game.id and pl.status = 'active'),
      'safe_zone_count', (select count(*) from public.entities en where en.game_id = current_game.id and en.kind = 'safe_zone')
    );
  elsif current_game.mode_id = 'ghost_duel' then
    v_mode_recap := jsonb_build_object(
      'mode_id', 'ghost_duel',
      'variant', coalesce(current_game.mode_params->'ghost_duel'->>'variant', 'time_trial')
    );
  end if;

  if 'ai_gm' = any(current_game.modifiers) then
    v_mode_recap := v_mode_recap || jsonb_build_object(
      'ai_gm', jsonb_build_object(
        'total_events', coalesce((current_game.mode_params->'ai_gm'->>'event_count')::int, 0),
        'max_events', coalesce((current_game.mode_params->'ai_gm'->>'max_events')::int, 12),
        'last_event_type', current_game.mode_params->'ai_gm'->>'last_event_type',
        'last_narration', current_game.mode_params->'ai_gm'->>'last_narration'
      )
    );
  end if;

  for p in
    select
      pl.id,
      pl.user_id,
      coalesce(pr.display_name, 'Player') as display_name,
      coalesce(pr.color, '#1D4ED8') as color,
      pl.team,
      pl.status,
      pl.secret_role,
      pl.share_trail
    from public.players pl
    left join public.profiles pr on pr.id = pl.user_id
    where pl.game_id = current_game.id and pl.status <> 'left'
    order by pl.joined_at
  loop
    -- Closest call: only for players with share_trail = true
    min_distance := null;
    if p.share_trail = true then
      select min(extensions.st_distance(t1.geog, t2.geog))
      into min_distance
      from public.trail_points t1
      join public.trail_points t2
        on t2.game_id = current_game.id
        and t2.player_id in (
          select pl2.id from public.players pl2
          where pl2.game_id = current_game.id
            and pl2.team <> p.team
            and pl2.status <> 'left'
            and not coalesce(pl2.is_remote, false)
        )
        and abs(extract(epoch from (t1.recorded_at - t2.recorded_at))) <= 20
      where t1.player_id = p.id;
    end if;

    -- Longest unseen streak (seconds between scheduled pings)
    unseen_max := 0;
    if p.team = 'runner' then
      with ping_times as (
        select released_at
        from public.pings pi
        where pi.game_id = current_game.id and pi.player_id = p.id and pi.reason in ('scheduled', 'ai_gm_double_ping')
        order by released_at
      ),
      ping_gaps as (
        select extract(epoch from (lead(released_at) over () - released_at)) as gap
        from ping_times
      )
      select coalesce(max(gap), duration_seconds) into unseen_max
      from ping_gaps;
    end if;

    -- Loudest moment & speed
    select coalesce(pp.noise, 0), coalesce(pp.smoothed_speed_mps, 0)
    into peak_noise, peak_speed
    from public.player_positions pp
    where pp.player_id = p.id;

    -- Drops claimed by this player
    select count(*) into claimed_count
    from public.drop_claims dc
    where dc.game_id = current_game.id and dc.player_id = p.id;

    -- Per-player heat stats (for hunters)
    select count(*), count(*) filter (where hp.result = 'hot')
    into p_heat_presses, p_heat_hits
    from public.heat_presses hp
    where hp.game_id = current_game.id and hp.hunter_id = p.id;

    if p_heat_presses > 0 then
      p_heat_rate := round((p_heat_hits * 100.0) / p_heat_presses);
    else
      p_heat_rate := 0;
    end if;

    -- Best Bluff calculation
    v_best_bluff := case
      when p.team = 'runner' and min_distance is not null and min_distance <= 35.0 and p.status <> 'tagged' then
        jsonb_build_object(
          'achieved', true,
          'title', 'Close Ghost Evasion',
          'detail', 'Evaded within ' || round(min_distance::numeric, 1) || 'm of hunters without being tagged'
        )
      when p.secret_role = 'agent' and p.status <> 'tagged' then
        jsonb_build_object(
          'achieved', true,
          'title', 'Undetected Mole',
          'detail', 'Successfully completed round without tribunal detection'
        )
      when p.secret_role = 'bodyguard' and exists (
        select 1 from public.tags t where t.game_id = current_game.id and t.runner_id = p.id
      ) then
        jsonb_build_object(
          'achieved', true,
          'title', 'VIP Bodyguard Decoy',
          'detail', 'Drew hunter tag and took freeze penalty shielding the VIP'
        )
      when min_distance is not null and min_distance <= 50.0 then
        jsonb_build_object(
          'achieved', false,
          'title', 'Close Encounter',
          'detail', 'Approached within ' || round(min_distance::numeric, 1) || 'm before interception'
        )
      else null
    end;

    player_rows := player_rows || jsonb_build_array(
      jsonb_build_object(
        'player_id', p.id,
        'user_id', p.user_id,
        'display_name', p.display_name,
        'color', p.color,
        'team', p.team,
        'status', p.status,
        'secret_role', p.secret_role,
        'share_trail', p.share_trail,
        'closest_call_m', case when min_distance is not null then round(min_distance::numeric, 1) else null end,
        'longest_unseen_s', round(coalesce(unseen_max, 0)::numeric),
        'loudest_noise', peak_noise,
        'peak_speed_mps', round(coalesce(peak_speed, 0)::numeric, 1),
        'drops_claimed', claimed_count,
        'heat_presses', p_heat_presses,
        'heat_hits', p_heat_hits,
        'heat_hit_rate_pct', p_heat_rate,
        'best_bluff', v_best_bluff
      )
    );
  end loop;

  return jsonb_build_object(
    'game_id', current_game.id,
    'status', current_game.status,
    'winner', current_game.winner,
    'end_reason', current_game.end_reason,
    'duration_s', round(duration_seconds::numeric),
    'players', player_rows,
    'heat_stats', jsonb_build_object(
      'total_presses', total_heat,
      'hot_hits', hot_hits,
      'hit_rate_pct', heat_hit_rate
    ),
    'total_drops_claimed', total_drops_claimed,
    'mode_recap', v_mode_recap
  );
end;
$$;

revoke all on function public.get_game_stats(uuid) from public, anon;
grant execute on function public.get_game_stats(uuid) to authenticated;

-- 2. Upgrade get_game_replay ---------------------------------------------------
create or replace function public.get_game_replay(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not public.is_member(get_game_replay.game_id) then
    raise exception 'You are not a member of this game.';
  end if;

  select * into current_game
    from public.games g
    where g.id = get_game_replay.game_id;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status not in ('ended', 'cancelled') then
    raise exception 'The replay is only available after the round ends.';
  end if;

  return jsonb_build_object(
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tag.id,
        'hunter_id', tag.hunter_id,
        'runner_id', tag.runner_id,
        'hunter_name', hunter_profile.display_name,
        'runner_name', runner_profile.display_name,
        'distance_m', tag.distance_m,
        'tagged_at', tag.tagged_at
      ) order by tag.tagged_at, tag.id)
      from public.tags tag
      join public.players hunter on hunter.id = tag.hunter_id
      join public.profiles hunter_profile on hunter_profile.id = hunter.user_id
      join public.players runner on runner.id = tag.runner_id
      join public.profiles runner_profile on runner_profile.id = runner.user_id
      where tag.game_id = get_game_replay.game_id
    ), '[]'::jsonb),
    'pings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ping.id,
        'seq', ping.seq,
        'player_id', ping.player_id,
        'display_name', profile.display_name,
        'color', profile.color,
        'longitude', extensions.st_x(ping.geog::extensions.geometry),
        'latitude', extensions.st_y(ping.geog::extensions.geometry),
        'accuracy_m', ping.accuracy_m,
        'position_age_s', ping.position_age_s,
        'reason', ping.reason,
        'released_at', ping.released_at
      ) order by ping.released_at, ping.id)
      from public.pings ping
      join public.players p on p.id = ping.player_id
      join public.profiles profile on profile.id = p.user_id
      where ping.game_id = get_game_replay.game_id
        and ping.geog is not null
    ), '[]'::jsonb),
    'heat_marks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', hp.id,
        'hunter_id', hp.hunter_id,
        'display_name', profile.display_name,
        'color', profile.color,
        'result', hp.result,
        'longitude', extensions.st_x(hp.hunter_geog::extensions.geometry),
        'latitude', extensions.st_y(hp.hunter_geog::extensions.geometry),
        'nearest_runner_m', hp.nearest_runner_m,
        'pressed_at', hp.pressed_at
      ) order by hp.pressed_at, hp.id)
      from public.heat_presses hp
      join public.players p on p.id = hp.hunter_id
      join public.profiles profile on profile.id = p.user_id
      where hp.game_id = get_game_replay.game_id
    ), '[]'::jsonb),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'name', coalesce(e.state->>'name', 'Sector'),
        'zone_index', coalesce((e.state->>'zone_index')::int, 0),
        'longitude', extensions.st_x(e.geog::extensions.geometry),
        'latitude', extensions.st_y(e.geog::extensions.geometry),
        'radius_m', coalesce((e.state->>'radius_m')::int, 60),
        'controller', e.state->>'controller'
      ) order by (e.state->>'zone_index')::int asc)
      from public.entities e
      where e.game_id = get_game_replay.game_id and e.kind = 'zone'
    ), '[]'::jsonb),
    'pulse_history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ev.id,
        'pulse_seq', coalesce((ev.payload->>'pulse_seq')::int, 0),
        'scores', ev.payload->'scores',
        'controlled', ev.payload->'controlled',
        'created_at', ev.created_at
      ) order by ev.id asc)
      from public.events ev
      where ev.game_id = get_game_replay.game_id and ev.type = 'territory_pulse'
    ), '[]'::jsonb),
    'npc_paths', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'kind', e.kind,
        'path_wkt', e.state->>'path_wkt',
        'duration_s', coalesce((e.state->>'duration_s')::int, 300),
        'longitude', extensions.st_x(e.geog::extensions.geometry),
        'latitude', extensions.st_y(e.geog::extensions.geometry)
      ))
      from public.entities e
      where e.game_id = get_game_replay.game_id and e.kind = 'ghost'
    ), '[]'::jsonb),
    'handoffs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ev.id,
        'type', ev.type,
        'payload', ev.payload,
        'created_at', ev.created_at
      ) order by ev.id asc)
      from public.events ev
      where ev.game_id = get_game_replay.game_id
        and ev.type in ('package_handoff', 'package_dropped', 'package_secured', 'package_picked_up')
    ), '[]'::jsonb),
    'drops', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'type', coalesce(e.state->>'type', 'drop'),
        'claimed', coalesce((e.state->>'claimed')::boolean, false),
        'longitude', extensions.st_x(e.geog::extensions.geometry),
        'latitude', extensions.st_y(e.geog::extensions.geometry),
        'claimed_at', e.state->>'claimed_at'
      ))
      from public.entities e
      where e.game_id = get_game_replay.game_id and e.kind = 'drop'
    ), '[]'::jsonb),
    'jail_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ev.id,
        'type', ev.type,
        'payload', ev.payload,
        'created_at', ev.created_at
      ) order by ev.id asc)
      from public.events ev
      where ev.game_id = get_game_replay.game_id
        and ev.type in ('runner_jailed', 'runner_rescued', 'auto_released')
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_game_replay(uuid) from public, anon;
grant execute on function public.get_game_replay(uuid) to authenticated;
