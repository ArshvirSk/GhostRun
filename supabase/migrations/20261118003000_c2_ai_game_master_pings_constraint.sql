-- Migration: 20261118003000_c2_ai_game_master_pings_constraint.sql
-- Allow 'ai_gm_double_ping' in pings_reason_check and refresh trigger_game_master_event

-- 1. Update pings_reason_check to include ai_gm_double_ping
do $$
declare
  existing record;
begin
  for existing in
    select conname
    from pg_constraint
    where conrelid = 'public.pings'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%reason%'
  loop
    execute format('alter table public.pings drop constraint %I', existing.conname);
  end loop;
end;
$$;

alter table public.pings add constraint pings_reason_check
  check (reason in ('scheduled', 'boundary', 'noise', 'camping', 'item', 'ghost_sighting', 'ai_gm_double_ping'));

-- 2. Update trigger_game_master_event with not coalesce(p.is_remote, false)
create or replace function public.trigger_game_master_event(
  game_id uuid,
  event_type text default null
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
  v_count integer;
  v_max integer;
  v_interval integer;
  v_chosen_event text;
  v_elapsed double precision;
  v_progress double precision;
  v_last_ping timestamptz;
  v_title text;
  v_narration text;
  v_details jsonb := '{}'::jsonb;
  v_next_at timestamptz;
  v_new_gm jsonb;
  -- Event specific locals
  v_dist double precision;
  v_bearing double precision;
  v_drop_geog extensions.geography;
  v_drop_id uuid;
  v_ping_seq integer;
  v_ping_count integer := 0;
  runner record;
  v_fog_until timestamptz;
  v_current_scale double precision;
  v_new_scale double precision;
  v_ne_count integer := 0;
  v_nw_count integer := 0;
  v_se_count integer := 0;
  v_sw_count integer := 0;
  v_rumour_quadrant text := 'North-East';
  v_max_q_count integer := -1;
  pos_rec record;
begin
  select * into current_game from public.games g where g.id = trigger_game_master_event.game_id for update;
  if not found then raise exception 'Game not found.'; end if;

  if current_game.status <> 'live' then
    return jsonb_build_object('success', false, 'reason', 'game_not_live', 'phase', current_game.status);
  end if;

  if not ('ai_gm' = any(current_game.modifiers)) then
    return jsonb_build_object('success', false, 'reason', 'ai_gm_modifier_not_active');
  end if;

  v_count := coalesce((current_game.mode_params->'ai_gm'->>'event_count')::int, 0);
  v_max := coalesce((current_game.mode_params->'ai_gm'->>'max_events')::int, 12);
  v_interval := coalesce((current_game.mode_params->'ai_gm'->>'event_interval_s')::int, 180);

  if v_count >= v_max then
    return jsonb_build_object('success', false, 'reason', 'max_events_reached', 'event_count', v_count, 'max_events', v_max);
  end if;

  -- 1. Determine Event Type
  if trigger_game_master_event.event_type is not null then
    if trigger_game_master_event.event_type not in ('supply_drop', 'double_ping', 'fog', 'rumour', 'shrink_step') then
      raise exception 'Invalid event_type: %', trigger_game_master_event.event_type;
    end if;
    v_chosen_event := trigger_game_master_event.event_type;
  else
    -- Context-sensitive selection
    v_elapsed := extract(epoch from (clock_timestamp() - current_game.live_at));
    v_progress := case when current_game.duration_s > 0 then v_elapsed / current_game.duration_s else 0.5 end;

    select max(released_at) into v_last_ping from public.pings p where p.game_id = current_game.id;

    if v_last_ping is null or (clock_timestamp() - v_last_ping > interval '120 seconds') then
      -- Lull detected: supply radar intel or directional rumor
      if (v_count % 2 = 0) then
        v_chosen_event := 'double_ping';
      else
        v_chosen_event := 'rumour';
      end if;
    elsif v_progress > 0.65 then
      -- Late match: accelerate urgency
      if (v_count % 3 = 0) then
        v_chosen_event := 'shrink_step';
      elsif (v_count % 3 = 1) then
        v_chosen_event := 'fog';
      else
        v_chosen_event := 'supply_drop';
      end if;
    else
      -- Regular cadence: rotation across all 5
      case (v_count % 5)
        when 0 then v_chosen_event := 'supply_drop';
        when 1 then v_chosen_event := 'double_ping';
        when 2 then v_chosen_event := 'fog';
        when 3 then v_chosen_event := 'rumour';
        else v_chosen_event := 'shrink_step';
      end case;
    end if;
  end if;

  -- 2. Execute Event Logic
  if v_chosen_event = 'supply_drop' then
    v_dist := random() * (current_game.area_radius_m * 0.65);
    v_bearing := random() * 360.0;
    v_drop_geog := extensions.st_project(current_game.area_center, v_dist, radians(v_bearing))::extensions.geography;

    insert into public.entities (game_id, kind, geog, state, visible_to)
    values (
      current_game.id,
      'drop',
      v_drop_geog,
      jsonb_build_object(
        'type', 'tactical_cache',
        'claimed', false,
        'claimed_by', null,
        'claimed_at', null,
        'spawned_by', 'ai_gm',
        'seq', v_count + 1
      ),
      'all'
    ) returning id into v_drop_id;

    v_title := 'Tactical Supply Drop';
    v_narration := 'Tactical supply cache dropped in the sector. Secure the telemetry cache before opposing forces converge.';
    v_details := jsonb_build_object(
      'entity_id', v_drop_id,
      'longitude', extensions.st_x(v_drop_geog::geometry),
      'latitude', extensions.st_y(v_drop_geog::geometry)
    );

  elsif v_chosen_event = 'double_ping' then
    select coalesce(max(seq), 0) + 1 into v_ping_seq from public.pings p where p.game_id = current_game.id;

    for runner in
      select pp.player_id, pp.geog, pp.accuracy_m, pp.recorded_at
      from public.player_positions pp
      join public.players p on p.id = pp.player_id
      where pp.game_id = current_game.id
        and p.team = 'runner'
        and p.status = 'active'
        and not coalesce(p.is_remote, false)
        and pp.recorded_at > clock_timestamp() - interval '60 seconds'
    loop
      insert into public.pings (game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at)
      values (
        current_game.id,
        v_ping_seq,
        runner.player_id,
        runner.geog,
        runner.accuracy_m,
        extract(epoch from (clock_timestamp() - runner.recorded_at))::int,
        'ai_gm_double_ping',
        clock_timestamp()
      );
      v_ping_count := v_ping_count + 1;
    end loop;

    v_title := 'Satellite Recon Sweep';
    v_narration := 'High-altitude satellite pulse re-synchronized. Active runner signatures mirrored on tactical radar.';
    v_details := jsonb_build_object('ping_seq', v_ping_seq, 'pings_emitted', v_ping_count);

  elsif v_chosen_event = 'fog' then
    v_fog_until := clock_timestamp() + interval '60 seconds';
    v_title := 'Atmospheric Radar Fog';
    v_narration := 'Dense atmospheric interference rolling into the sector. Radar feeds obscured for the next 60 seconds.';
    v_details := jsonb_build_object('duration_s', 60, 'ends_at', to_char(v_fog_until, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

  elsif v_chosen_event = 'rumour' then
    -- Runner quadrant count relative to area_center
    for pos_rec in
      select extensions.st_x(pp.geog::geometry) - extensions.st_x(current_game.area_center::geometry) as dx,
             extensions.st_y(pp.geog::geometry) - extensions.st_y(current_game.area_center::geometry) as dy
      from public.player_positions pp
      join public.players p on p.id = pp.player_id
      where pp.game_id = current_game.id
        and p.team = 'runner'
        and p.status = 'active'
        and not coalesce(p.is_remote, false)
        and pp.recorded_at > clock_timestamp() - interval '60 seconds'
    loop
      if pos_rec.dy >= 0 and pos_rec.dx >= 0 then
        v_ne_count := v_ne_count + 1;
      elsif pos_rec.dy >= 0 and pos_rec.dx < 0 then
        v_nw_count := v_nw_count + 1;
      elsif pos_rec.dy < 0 and pos_rec.dx >= 0 then
        v_se_count := v_se_count + 1;
      else
        v_sw_count := v_sw_count + 1;
      end if;
    end loop;

    v_max_q_count := v_ne_count;
    v_rumour_quadrant := 'North-East';

    if v_nw_count > v_max_q_count then
      v_max_q_count := v_nw_count;
      v_rumour_quadrant := 'North-West';
    end if;
    if v_se_count > v_max_q_count then
      v_max_q_count := v_se_count;
      v_rumour_quadrant := 'South-East';
    end if;
    if v_sw_count > v_max_q_count then
      v_max_q_count := v_sw_count;
      v_rumour_quadrant := 'South-West';
    end if;

    v_title := 'Intelligence Rumour';
    v_narration := 'Intercepted radio chatter indicates concentrated runner movement in the ' || v_rumour_quadrant || ' sector.';
    v_details := jsonb_build_object('quadrant', v_rumour_quadrant, 'confidence', 'medium');

  elsif v_chosen_event = 'shrink_step' then
    v_current_scale := coalesce((current_game.mode_params->'ai_gm'->>'shrink_scale')::double precision, 1.0);
    v_new_scale := round((v_current_scale * 0.85)::numeric, 3);
    if (current_game.area_radius_m * v_new_scale) < 60.0 then
      v_new_scale := round((60.0 / greatest(1.0, current_game.area_radius_m))::numeric, 3);
    end if;

    v_title := 'Perimeter Contraction Step';
    v_narration := 'Command has accelerated boundary containment. Sector perimeter contracted by 15%.';
    v_details := jsonb_build_object(
      'shrink_scale', v_new_scale,
      'effective_radius_m', greatest(60.0, round(current_game.area_radius_m * v_new_scale))
    );
  end if;

  -- 3. Update mode_params
  v_next_at := clock_timestamp() + make_interval(secs => v_interval);

  v_new_gm := coalesce(current_game.mode_params->'ai_gm', '{}'::jsonb) || jsonb_build_object(
    'is_active', true,
    'event_count', v_count + 1,
    'max_events', v_max,
    'event_interval_s', v_interval,
    'last_event_type', v_chosen_event,
    'last_title', v_title,
    'last_narration', v_narration,
    'last_event_at', to_char(clock_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'next_event_at', to_char(v_next_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

  if v_chosen_event = 'shrink_step' then
    v_new_gm := v_new_gm || jsonb_build_object('shrink_scale', v_new_scale);
  end if;

  if v_chosen_event = 'fog' then
    v_new_gm := v_new_gm || jsonb_build_object('fog_active_until', to_char(v_fog_until, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  end if;

  update public.games
  set mode_params = jsonb_set(coalesce(mode_params, '{}'::jsonb), '{ai_gm}', v_new_gm)
  where id = current_game.id;

  -- 4. Emit game_master event
  insert into public.events (game_id, type, audience, payload)
  values (
    current_game.id,
    'game_master',
    'all',
    jsonb_build_object(
      'event_type', v_chosen_event,
      'title', v_title,
      'narration', v_narration,
      'details', v_details,
      'event_seq', v_count + 1,
      'timestamp', clock_timestamp()
    )
  );

  return jsonb_build_object(
    'success', true,
    'event_type', v_chosen_event,
    'title', v_title,
    'narration', v_narration,
    'details', v_details,
    'event_count', v_count + 1,
    'next_event_at', v_next_at
  );
end;
$$;

revoke all on function public.trigger_game_master_event(uuid, text) from public, anon;
grant execute on function public.trigger_game_master_event(uuid, text) to authenticated;
