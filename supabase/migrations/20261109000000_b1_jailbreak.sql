-- Migration: 20261109000000_b1_jailbreak.sql
-- B1: Jailbreak Base Mode
-- 1. Enum extensions: add 'jailed' to player_status, 'jailbreak' to game_mode
-- 2. Constraints: update games_mode_id_check
-- 3. Mode catalogue: add jailbreak mode definition
-- 4. Feature flag: enable feature.mode.jailbreak
-- 5. RPCs: set_jail_location, start_rescue, complete_rescue, cancel_rescue
-- 6. Updated functions: start_game, apply_tag, advance_game, get_game_state

-- 1. Enums ---------------------------------------------------------------------

alter type public.player_status add value if not exists 'jailed';
alter type public.game_mode add value if not exists 'jailbreak';

-- 2. Check Constraint ----------------------------------------------------------

alter table public.games drop constraint if exists games_mode_id_check;
alter table public.games add constraint games_mode_id_check
  check (mode_id in ('classic_chase', 'tag_hunt', 'haunted_map', 'ghost_duel', 'jailbreak'));

-- 3. Mode Catalogue ------------------------------------------------------------

create or replace function public.mode_catalogue()
returns jsonb
language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_array(
    jsonb_build_object(
      'id', 'classic_chase', 'layer', 'base', 'name', 'Classic Chase',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 2,
      'compatible_roles', jsonb_build_array('double_agent', 'vip', 'operator'),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone'
      ),
      'parameters', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'tag_hunt', 'layer', 'base', 'name', 'Tag Hunt',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 2,
      'compatible_roles', jsonb_build_array('double_agent', 'operator'),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone'
      ),
      'parameters', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'haunted_map', 'layer', 'base', 'name', 'Haunted Map',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 1,
      'compatible_roles', jsonb_build_array(),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone'
      ),
      'parameters', jsonb_build_object('ghost_count', 2, 'ghost_speed_mps', 1.3)
    ),
    jsonb_build_object(
      'id', 'ghost_duel', 'layer', 'base', 'name', 'Ghost Duel',
      'teams', jsonb_build_array('runner'), 'min_players', 1,
      'compatible_roles', jsonb_build_array(),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'shrinking_zone'
      ),
      'parameters', jsonb_build_object('variant', 'time_trial')
    ),
    jsonb_build_object(
      'id', 'jailbreak', 'layer', 'base', 'name', 'Jailbreak',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 5,
      'compatible_roles', jsonb_build_array('double_agent', 'operator'),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone'
      ),
      'parameters', jsonb_build_object(
        'jail_radius_m', 15,
        'auto_release_s', 300,
        'release_hold_s', 10,
        'release_radius_m', 10
      )
    )
  );
$$;

-- 4. Feature Flag --------------------------------------------------------------

insert into public.app_settings (key, value)
values ('feature.mode.jailbreak', 'true'::jsonb)
on conflict (key) do update set value = 'true'::jsonb;

-- 5. set_jail_location RPC ----------------------------------------------------

create or replace function public.set_jail_location(
  game_id uuid,
  lat double precision,
  lng double precision
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  jail_geog extensions.geography;
  v_jail_radius_m integer;
  v_jail_id uuid;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into current_game from public.games g
    where g.id = set_jail_location.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.host_id <> caller_id then
    raise exception 'Only the host can place the jail.';
  end if;
  if current_game.status not in ('lobby', 'target_selection') then
    raise exception 'The jail can only be placed before the round starts.';
  end if;
  if current_game.mode_id <> 'jailbreak' then
    raise exception 'This game is not in Jailbreak mode.';
  end if;
  if lat is null or lng is null or lat not between -90 and 90 or lng not between -180 and 180 then
    raise exception 'Invalid coordinates for jail location.';
  end if;

  jail_geog := extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography;

  if extensions.st_distance(jail_geog, current_game.area_center) > current_game.area_radius_m then
    raise exception 'The jail must be placed inside the play area.';
  end if;

  v_jail_radius_m := coalesce((current_game.mode_params->'jailbreak'->>'jail_radius_m')::integer, 15);

  -- Replace any existing jail entity for this game
  delete from public.entities e
    where e.game_id = current_game.id and e.kind = 'jail';

  insert into public.entities (game_id, kind, geog, visible_to, state)
  values (
    current_game.id,
    'jail',
    jail_geog,
    'all',
    jsonb_build_object('radius_m', v_jail_radius_m)
  )
  returning id into v_jail_id;

  insert into public.events (game_id, type, audience, payload)
  values (
    current_game.id,
    'jail_placed',
    'all',
    jsonb_build_object(
      'jail_id', v_jail_id,
      'latitude', lat,
      'longitude', lng,
      'radius_m', v_jail_radius_m
    )
  );

  return jsonb_build_object(
    'success', true,
    'jail_id', v_jail_id,
    'latitude', lat,
    'longitude', lng,
    'radius_m', v_jail_radius_m
  );
end;
$$;

revoke all on function public.set_jail_location(uuid, double precision, double precision) from public, anon;
grant execute on function public.set_jail_location(uuid, double precision, double precision) to authenticated;

-- 6. Updated start_game -------------------------------------------------------

create or replace function public.start_game(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  active_runners integer;
  active_hunters integer;
  unassigned integer;
  missing_consent integer;
  countdown_ends timestamptz;
  live_starts timestamptz;
  round_ends timestamptz;
  hunter_heat_charges integer := 0;
  chosen_agent_id uuid;
  agent_charges integer;
  agent_cooldown integer;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into current_game from public.games g
    where g.id = start_game.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.host_id <> caller_id then
    raise exception 'Only the host can start the round.';
  end if;
  if current_game.status not in ('lobby', 'target_selection') then
    raise exception 'This game has already started.';
  end if;
  if current_game.mode_id = 'classic_chase' and current_game.status <> 'target_selection' then
    raise exception 'Choose the secret target before starting the round.';
  end if;

  perform public.assert_mode_config(
    current_game.mode_id, current_game.roles, current_game.modifiers
  );

  -- For Jailbreak mode, jail must be placed before start
  if current_game.mode_id = 'jailbreak' then
    if not exists (select 1 from public.entities e where e.game_id = current_game.id and e.kind = 'jail') then
      raise exception 'Place the jail before starting the round.';
    end if;
  end if;

  select count(*) filter (where p.team = 'runner'),
         count(*) filter (where p.team = 'hunter'),
         count(*) filter (where p.team = 'unassigned')
    into active_runners, active_hunters, unassigned
    from public.players p
    where p.game_id = start_game.game_id and p.status = 'active';

  if current_game.mode_id not in ('haunted_map', 'ghost_duel') then
    if active_runners = 0 or active_hunters = 0 then
      raise exception 'Assign at least one runner and one hunter before starting.';
    end if;
  else
    if active_runners = 0 and active_hunters = 0 then
      raise exception 'Assign at least one player before starting.';
    end if;
  end if;

  if unassigned > 0 then
    raise exception 'Every player must choose a team before the round starts.';
  end if;
  if current_game.mode_id = 'classic_chase'
     and not exists (select 1 from public.targets t where t.game_id = start_game.game_id) then
    raise exception 'Runners must save the secret target first.';
  end if;

  select count(*) into missing_consent
    from public.players p
    where p.game_id = start_game.game_id and p.status = 'active' and p.share_trail is null;
  if missing_consent > 0 then
    raise exception 'Every player must choose whether to share their route before the round starts.';
  end if;

  if 'double_agent' = any(current_game.roles) then
    if active_hunters >= 2 then
      select p.id into chosen_agent_id
      from public.players p
      where p.game_id = current_game.id and p.team = 'hunter' and p.status = 'active'
      order by random()
      limit 1;

      agent_charges := coalesce((current_game.mode_params->'double_agent'->>'scramble_charges')::int, 1);
      agent_cooldown := coalesce((current_game.mode_params->'double_agent'->>'scramble_cooldown_s')::int, 120);

      update public.players
      set secret_role = 'agent',
          status_detail = jsonb_build_object(
            'scramble_available', true,
            'scramble_charges', agent_charges,
            'scramble_cooldown_s', agent_cooldown,
            'whisper_available', true
          )
      where id = chosen_agent_id;

      insert into public.events (game_id, type, target_player, audience, payload)
      values (
        current_game.id,
        'agent_assigned',
        chosen_agent_id,
        'hunter',
        jsonb_build_object('message', 'You are secretly working as the Double Agent.')
      );
    else
      current_game.roles := array_remove(current_game.roles, 'double_agent');
      update public.games set roles = current_game.roles where id = current_game.id;
      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'role_disabled',
        'all',
        jsonb_build_object(
          'role', 'double_agent',
          'reason', 'Requires at least 2 active hunters to maintain mystery.'
        )
      );
    end if;
  end if;

  countdown_ends := clock_timestamp() + interval '10 seconds';
  live_starts := countdown_ends + make_interval(secs => current_game.head_start_s);
  round_ends := live_starts + make_interval(secs => current_game.duration_s);

  update public.games g
    set status = 'countdown',
        head_start_at = countdown_ends,
        live_at = live_starts,
        ends_at = round_ends,
        ping_interval_s = case
          when 'hot_cold' = any(g.modifiers) or g.mode_id = 'hot_cold' then least(900, g.ping_interval_s * 3)
          else g.ping_interval_s
        end,
        next_ping_at = live_starts + make_interval(secs => case
          when 'hot_cold' = any(g.modifiers) or g.mode_id = 'hot_cold' then least(900, g.ping_interval_s * 3)
          else g.ping_interval_s
        end),
        ping_seq = 0
    where g.id = current_game.id
    returning * into current_game;

  if current_game.mode_id in ('haunted_map', 'ghost_duel') then
    perform public.spawn_ghost_npcs(current_game.id);
  end if;

  if 'dead_drops' = any(current_game.modifiers) then
    perform public.spawn_drops(start_game.game_id, null);
  end if;

  if 'hot_cold' = any(current_game.modifiers) or current_game.mode_id = 'hot_cold' then
    hunter_heat_charges := coalesce((current_game.mode_params->'hot_cold'->>'heat_charges')::integer, 6);
  end if;

  -- Ensure player_resources rows exist for all active players
  insert into public.player_resources (player_id, game_id)
  select p.id, p.game_id
  from public.players p
  where p.game_id = current_game.id and p.status = 'active'
  on conflict (player_id) do nothing;

  -- Ensure team_resources rows exist for runner and hunter
  insert into public.team_resources (game_id, team, heat_charges, heat_updated_at)
  values
    (current_game.id, 'runner', 0, now()),
    (current_game.id, 'hunter', hunter_heat_charges, now())
  on conflict on constraint team_resources_pkey do update
    set heat_charges = excluded.heat_charges,
        heat_updated_at = excluded.heat_updated_at;

  insert into public.events (game_id, type, payload)
  values (
    start_game.game_id,
    'game_started',
    jsonb_build_object(
      'mode', current_game.mode,
      'mode_id', current_game.mode_id,
      'modifiers', to_jsonb(current_game.modifiers),
      'roles', to_jsonb(current_game.roles),
      'head_start_at', countdown_ends,
      'live_at', live_starts,
      'ends_at', round_ends
    )
  );

  return jsonb_build_object(
    'status', 'countdown',
    'head_start_at', countdown_ends,
    'live_at', live_starts,
    'ends_at', round_ends
  );
end;
$$;

revoke all on function public.start_game(uuid) from public, anon;
grant execute on function public.start_game(uuid) to authenticated;

-- 7. Updated apply_tag for Jailbreak Mode -------------------------------------

create or replace function public.apply_tag(
  p_game_id uuid,
  p_hunter_id uuid,
  p_runner_id uuid,
  p_distance_m double precision
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  current_game public.games%rowtype;
  target_runner public.players%rowtype;
  runner_name text;
  active_runners integer;
  is_jailbreak boolean;
begin
  select * into current_game from public.games g where g.id = p_game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then
    raise exception 'Tagging is only available while the round is live.';
  end if;

  select * into target_runner from public.players p
    where p.id = p_runner_id and p.game_id = p_game_id
      and p.team = 'runner' and p.status = 'active'
    for update;
  if not found then raise exception 'That runner is not taggable.'; end if;

  select pr.display_name into runner_name
    from public.profiles pr where pr.id = target_runner.user_id;

  insert into public.tags (game_id, hunter_id, runner_id, distance_m)
  values (p_game_id, p_hunter_id, target_runner.id, greatest(0, p_distance_m)::real);

  update public.players p set last_tag_attempt_at = null where p.id = p_hunter_id;

  is_jailbreak := (current_game.mode_id = 'jailbreak');

  if is_jailbreak then
    -- Jailbreak: runner becomes 'jailed', any active rescue attempt is cancelled
    update public.players p
      set status = 'jailed',
          tagged_at = now(),
          is_ready = false,
          status_detail = p.status_detail - 'free_started_at'
      where p.id = target_runner.id;

    insert into public.events (game_id, type, audience, payload)
    values (
      p_game_id, 'runner_jailed', 'all',
      jsonb_build_object(
        'runner_id', target_runner.id,
        'hunter_id', p_hunter_id,
        'display_name', runner_name,
        'distance_m', round(p_distance_m::numeric, 1)
      )
    );

    -- Win condition check: Hunters win if all runners are jailed
    select count(*) into active_runners
      from public.players p
      where p.game_id = p_game_id and p.team = 'runner' and p.status = 'active';

    if active_runners = 0 then
      perform public.end_game(p_game_id, 'hunters', 'all_jailed');
    end if;

  else
    -- Standard modes (Classic Chase, Tag Hunt, etc.): runner is eliminated
    update public.players p
      set status = 'tagged', tagged_at = now(), is_ready = false
      where p.id = target_runner.id;

    insert into public.events (game_id, type, audience, payload)
    values (
      p_game_id, 'runner_tagged', 'all',
      jsonb_build_object(
        'runner_id', target_runner.id,
        'hunter_id', p_hunter_id,
        'display_name', runner_name
      )
    );

    select count(*) into active_runners
      from public.players p
      where p.game_id = p_game_id and p.team = 'runner' and p.status = 'active';

    if active_runners = 0 then
      perform public.end_game(p_game_id, 'hunters', 'all_tagged');
    end if;
  end if;

  select * into current_game from public.games g where g.id = p_game_id;

  return jsonb_build_object(
    'success', true,
    'runner_id', target_runner.id,
    'phase', current_game.status,
    'winner', current_game.winner,
    'end_reason', current_game.end_reason
  );
end;
$$;

revoke all on function public.apply_tag(uuid, uuid, uuid, double precision)
  from public, anon, authenticated;

-- 8. Rescue RPCs: start_rescue, complete_rescue, cancel_rescue -----------------

create or replace function public.start_rescue(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  me public.players%rowtype;
  my_pos public.player_positions%rowtype;
  jail_geog extensions.geography;
  v_release_radius_m double precision;
  v_hold_s integer;
  jailed_count integer;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into current_game from public.games g
    where g.id = start_rescue.game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then
    raise exception 'Rescue is only available while the round is live.';
  end if;
  if current_game.mode_id <> 'jailbreak' then
    raise exception 'Rescue is only available in Jailbreak mode.';
  end if;

  select * into me from public.players p
    where p.game_id = current_game.id and p.user_id = caller_id and p.status <> 'left'
    for update;
  if not found then raise exception 'You are not a player in this game.'; end if;
  if me.team <> 'runner' then raise exception 'Only runners can rescue teammates.'; end if;
  if me.status <> 'active' then raise exception 'Only active (free) runners can rescue teammates.'; end if;

  -- Ensure fresh fix (<=20s)
  select * into my_pos from public.player_positions pp where pp.player_id = me.id;
  if not found or now() - my_pos.recorded_at > interval '20 seconds' then
    raise exception 'Your GPS location is stale. Move to an open area and wait for a fix.';
  end if;

  -- Read jail coordinates
  select e.geog into jail_geog from public.entities e
    where e.game_id = current_game.id and e.kind = 'jail'
    limit 1;
  if jail_geog is null then raise exception 'Jail entity not found.'; end if;

  v_release_radius_m := coalesce((current_game.mode_params->'jailbreak'->>'release_radius_m')::double precision, 10.0);
  if extensions.st_distance(my_pos.geog, jail_geog) > v_release_radius_m then
    raise exception 'You must be within % meters of the jail to rescue teammates.', v_release_radius_m;
  end if;

  -- Verify at least one runner is jailed
  select count(*) into jailed_count from public.players p
    where p.game_id = current_game.id and p.team = 'runner' and p.status = 'jailed';
  if jailed_count = 0 then
    raise exception 'No runners are currently jailed.';
  end if;

  v_hold_s := coalesce((current_game.mode_params->'jailbreak'->>'release_hold_s')::integer, 10);

  update public.players
    set status_detail = jsonb_set(coalesce(status_detail, '{}'::jsonb), '{free_started_at}', to_jsonb(now()::text))
    where id = me.id;

  insert into public.events (game_id, type, audience, payload)
  values (
    current_game.id,
    'rescue_started',
    'runner',
    jsonb_build_object(
      'rescuer_id', me.id,
      'hold_s', v_hold_s
    )
  );

  return jsonb_build_object(
    'success', true,
    'hold_s', v_hold_s,
    'jailed_count', jailed_count
  );
end;
$$;

revoke all on function public.start_rescue(uuid) from public, anon;
grant execute on function public.start_rescue(uuid) to authenticated;

create or replace function public.complete_rescue(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  me public.players%rowtype;
  my_pos public.player_positions%rowtype;
  jail_geog extensions.geography;
  v_release_radius_m double precision;
  v_hold_s integer;
  v_started_at timestamptz;
  freed_count integer := 0;
  rescuer_name text;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into current_game from public.games g
    where g.id = complete_rescue.game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then
    raise exception 'Rescue is only available while the round is live.';
  end if;
  if current_game.mode_id <> 'jailbreak' then
    raise exception 'Rescue is only available in Jailbreak mode.';
  end if;

  select * into me from public.players p
    where p.game_id = current_game.id and p.user_id = caller_id and p.status <> 'left'
    for update;
  if not found then raise exception 'You are not a player in this game.'; end if;
  if me.team <> 'runner' then raise exception 'Only runners can rescue teammates.'; end if;
  if me.status <> 'active' then raise exception 'You cannot complete a rescue while jailed or eliminated.'; end if;

  if (me.status_detail->>'free_started_at') is null then
    raise exception 'No active rescue in progress. Start a rescue first.';
  end if;

  v_started_at := (me.status_detail->>'free_started_at')::timestamptz;
  v_hold_s := coalesce((current_game.mode_params->'jailbreak'->>'release_hold_s')::integer, 10);

  -- Allow 0.5s network leeway
  if now() < v_started_at + make_interval(secs => greatest(0, v_hold_s - 0.5)) then
    raise exception 'Rescue hold duration not completed.';
  end if;

  select * into my_pos from public.player_positions pp where pp.player_id = me.id;
  if not found or now() - my_pos.recorded_at > interval '20 seconds' then
    raise exception 'Your GPS fix is stale. Rescue cancelled.';
  end if;

  select e.geog into jail_geog from public.entities e
    where e.game_id = current_game.id and e.kind = 'jail'
    limit 1;
  v_release_radius_m := coalesce((current_game.mode_params->'jailbreak'->>'release_radius_m')::double precision, 10.0);
  if jail_geog is null or extensions.st_distance(my_pos.geog, jail_geog) > v_release_radius_m then
    raise exception 'You must remain within % meters of the jail to complete rescue.', v_release_radius_m;
  end if;

  -- Free all jailed runners
  update public.players
    set status = 'active', tagged_at = null
    where game_id = current_game.id and team = 'runner' and status = 'jailed';
  get diagnostics freed_count = row_count;

  -- Clear free_started_at on rescuer
  update public.players
    set status_detail = status_detail - 'free_started_at'
    where id = me.id;

  -- If Noise Meter is active, reset noise for all runners
  if 'noise_meter' = any(current_game.modifiers) or current_game.mode_id = 'noise_meter' then
    update public.player_positions
      set noise = 0, noise_alerted = false
      where game_id = current_game.id
        and player_id in (select p.id from public.players p where p.game_id = current_game.id and p.team = 'runner');
  end if;

  select pr.display_name into rescuer_name
    from public.profiles pr where pr.id = me.user_id;

  insert into public.events (game_id, type, audience, payload)
  values (
    current_game.id,
    'runners_freed',
    'all',
    jsonb_build_object(
      'freed_count', freed_count,
      'rescuer_id', me.id,
      'rescuer_name', rescuer_name
    )
  );

  return jsonb_build_object(
    'success', true,
    'freed_count', freed_count
  );
end;
$$;

revoke all on function public.complete_rescue(uuid) from public, anon;
grant execute on function public.complete_rescue(uuid) to authenticated;

create or replace function public.cancel_rescue(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  me public.players%rowtype;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into me from public.players p
    where p.game_id = cancel_rescue.game_id and p.user_id = caller_id and p.status <> 'left'
    for update;
  if not found then raise exception 'You are not a player in this game.'; end if;

  update public.players
    set status_detail = status_detail - 'free_started_at'
    where id = me.id;

  insert into public.events (game_id, type, audience, payload)
  values (
    cancel_rescue.game_id,
    'rescue_cancelled',
    'runner',
    jsonb_build_object('player_id', me.id)
  );

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.cancel_rescue(uuid) from public, anon;
grant execute on function public.cancel_rescue(uuid) to authenticated;

-- 9. Updated advance_game -----------------------------------------------------

create or replace function public.advance_game(game_id uuid)
returns public.game_status
language plpgsql
security definer
set search_path = public, extensions
as $$
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
  stage_index integer;
  progress double precision;
  next_stage integer;
  next_start timestamptz;
  ghost_rec record;
  patrol_geom geometry;
  path_len_m double precision;
  duration_s int;
  effective_duration_s int;
  elapsed_s float;
  loop_frac float;
  current_ghost_pt geometry;
  runner_fix record;
  active_runners_count int;
  jailed_runners_count int;
  v_dwells jsonb;
  v_first_seen timestamptz;
  v_ghost_ping_seq integer;
  v_auto_release_s integer;
  jailed_rec record;
  jail_rec record;
begin
  -- Allow internal background jobs (caller_id is null) or game members
  if caller_id is not null and not public.is_member(advance_game.game_id) then
    raise exception 'You are not a member of this game.';
  end if;

  select * into current_game from public.games g
    where g.id = advance_game.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  if current_game.status = 'countdown'
     and current_game.head_start_at is not null
     and now() >= current_game.head_start_at then
    update public.games g set status = 'head_start'
      where g.id = current_game.id
      returning * into current_game;
    insert into public.events (game_id, type) values (current_game.id, 'head_start_began');
  end if;

  if current_game.status = 'head_start'
     and current_game.live_at is not null
     and now() >= current_game.live_at then
    update public.games g set status = 'live'
      where g.id = current_game.id
      returning * into current_game;
    insert into public.events (game_id, type) values (current_game.id, 'live_began');

    if 'dead_drops' = any(current_game.modifiers)
       and not exists (
         select 1 from public.entities e
         where e.game_id = current_game.id and e.kind = 'drop'
       ) then
      perform public.spawn_drops(current_game.id, null);
    end if;

    if current_game.mode_id in ('haunted_map', 'ghost_duel')
       and not exists (
         select 1 from public.entities e
         where e.game_id = current_game.id and e.kind = 'ghost'
       ) then
      perform public.spawn_ghost_npcs(current_game.id);
    end if;
  end if;

  -- Shrinking Zone: advance stage and announce 60 s before
  zone_on := 'shrinking_zone' = any(current_game.modifiers);
  if zone_on and current_game.status = 'live' then
    stages := public.zone_stage_values(current_game.id);
    stage_count := coalesce(array_length(stages, 1), 0);

    if stage_count > 0 and current_game.zone_stage < stage_count then
      progress := extract(epoch from (now() - current_game.live_at))
        / greatest(1, extract(epoch from (current_game.ends_at - current_game.live_at)));
      stage_index := least(stage_count, floor(progress * stage_count)::integer + 1);

      if stage_index > current_game.zone_stage then
        update public.games g
          set zone_stage = stage_index
          where g.id = current_game.id
          returning * into current_game;

        insert into public.events (game_id, type, payload)
        values (
          current_game.id,
          'zone_shrink',
          jsonb_build_object(
            'stage', stage_index,
            'factor', stages[stage_index],
            'radius_m', round(current_game.area_radius_m * stages[stage_index] / 100.0)
          )
        );

        -- If Jailbreak mode and jail is now outside effective radius, auto-release all jailed runners
        if current_game.mode_id = 'jailbreak' then
          select * into jail_rec from public.entities e where e.game_id = current_game.id and e.kind = 'jail' limit 1;
          if jail_rec.id is not null and extensions.st_distance(jail_rec.geog, current_game.area_center) > public.effective_radius_m(current_game.id) then
            update public.players
              set status = 'active', tagged_at = null
              where game_id = current_game.id and team = 'runner' and status = 'jailed';
            insert into public.events (game_id, type, audience, payload)
            values (
              current_game.id,
              'jail_overrun',
              'all',
              jsonb_build_object('message', 'The safe zone shrank past the jail! Jailed runners are freed.')
            );
          end if;
        end if;
      end if;

      next_stage := current_game.zone_stage + 1;
      if next_stage <= stage_count then
        next_start := current_game.live_at
          + make_interval(secs => (
              extract(epoch from (current_game.ends_at - current_game.live_at))
              * (next_stage - 1) / stage_count
            )::integer);

        if now() >= next_start - interval '60 seconds'
           and not exists (
             select 1 from public.events e
             where e.game_id = current_game.id
               and e.type = 'zone_warning'
               and (e.payload->>'stage')::integer = next_stage
           ) then
          insert into public.events (game_id, type, payload)
          values (
            current_game.id,
            'zone_warning',
            jsonb_build_object(
              'stage', next_stage,
              'factor', stages[next_stage],
              'radius_m', round(current_game.area_radius_m * stages[next_stage] / 100.0),
              'at', next_start
            )
          );
        end if;
      end if;
    end if;
  end if;

  -- Jailbreak Live Loop: Auto-release after timeout and all-jailed check
  if current_game.status = 'live' and current_game.mode_id = 'jailbreak' then
    v_auto_release_s := coalesce((current_game.mode_params->'jailbreak'->>'auto_release_s')::integer, 300);

    for jailed_rec in
      select p.id, p.user_id, pr.display_name
      from public.players p
      left join public.profiles pr on pr.id = p.user_id
      where p.game_id = current_game.id
        and p.team = 'runner'
        and p.status = 'jailed'
        and p.tagged_at is not null
        and now() >= p.tagged_at + make_interval(secs => v_auto_release_s)
    loop
      update public.players
        set status = 'active', tagged_at = null
        where id = jailed_rec.id;

      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id,
        'runner_auto_released',
        'all',
        jsonb_build_object(
          'player_id', jailed_rec.id,
          'display_name', jailed_rec.display_name
        )
      );
    end loop;

    -- All-jailed win check: if no active runners remain and some are jailed
    select count(*) filter (where status = 'active'),
           count(*) filter (where status = 'jailed')
      into active_runners_count, jailed_runners_count
      from public.players
      where game_id = current_game.id and team = 'runner';

    if active_runners_count = 0 and jailed_runners_count > 0 then
      perform public.end_game(current_game.id, 'hunters', 'all_jailed');
      select * into current_game from public.games g where g.id = advance_game.game_id;
      return current_game.status;
    end if;
  end if;

  -- Ghost NPC simulation loop for Haunted Map & Ghost Duel
  if current_game.status = 'live' and current_game.mode_id in ('haunted_map', 'ghost_duel') then
    for ghost_rec in
      select * from public.entities e where e.game_id = current_game.id and e.kind = 'ghost'
    loop
      if (ghost_rec.state->>'path_wkt') is not null or (ghost_rec.state->>'path_geojson') is not null then
        if (ghost_rec.state->>'path_wkt') is not null then
          patrol_geom := extensions.st_geomfromtext(ghost_rec.state->>'path_wkt', 4326);
        else
          patrol_geom := extensions.st_geomfromgeojson(ghost_rec.state->>'path_geojson');
        end if;

        duration_s := greatest(30, coalesce((ghost_rec.state->>'duration_s')::int, 240));
        path_len_m := coalesce(extensions.st_length(patrol_geom::geography), 0.0);
        effective_duration_s := greatest(duration_s, ceil(path_len_m / 2.0)::int);

        elapsed_s := extract(epoch from (now() - (ghost_rec.state->>'t0')::timestamptz));
        loop_frac := greatest(0.0, least(1.0, (mod(elapsed_s::numeric, effective_duration_s::numeric) / effective_duration_s::numeric)::float));

        current_ghost_pt := extensions.st_lineinterpolatepoint(patrol_geom, loop_frac);

        if current_game.area_center is not null and current_game.area_radius_m is not null then
          if extensions.st_distance(current_ghost_pt::geography, current_game.area_center) > current_game.area_radius_m then
            current_ghost_pt := extensions.st_project(
              current_game.area_center,
              greatest(5.0, current_game.area_radius_m - 10.0),
              extensions.st_azimuth(current_game.area_center::geometry, current_ghost_pt)
            )::geometry;
          end if;
        end if;

        v_dwells := coalesce(ghost_rec.state->'dwells', '{}'::jsonb);

        for runner_fix in
          select p.id as runner_id, p.user_id, pr.display_name as runner_name, pp.geog as runner_geog,
                 pp.accuracy_m, pp.recorded_at,
                 extensions.st_distance(current_ghost_pt::geography, pp.geog) as dist_m
          from public.players p
          join public.player_positions pp on pp.player_id = p.id
          left join public.profiles pr on pr.id = p.user_id
          where p.game_id = current_game.id
            and p.team = 'runner'
            and p.status = 'active'
            and pp.recorded_at > now() - interval '30 seconds'
            and coalesce(pp.accuracy_m, 999.0) <= 30.0
        loop
          if runner_fix.dist_m <= 40.0 then
            if current_game.ghost_mode = 'assist' then
              if not exists (
                select 1 from public.pings pi
                where pi.game_id = current_game.id
                  and pi.player_id = runner_fix.runner_id
                  and pi.reason = 'ghost_sighting'
                  and pi.released_at > now() - interval '20 seconds'
              ) then
                update public.games g
                  set ping_seq = g.ping_seq + 1
                  where g.id = current_game.id
                  returning g.ping_seq into v_ghost_ping_seq;

                insert into public.pings (
                  game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
                ) values (
                  current_game.id,
                  v_ghost_ping_seq,
                  runner_fix.runner_id,
                  current_ghost_pt::geography,
                  coalesce(runner_fix.accuracy_m, 15.0),
                  greatest(0, floor(extract(epoch from (now() - runner_fix.recorded_at)))::integer),
                  'ghost_sighting',
                  now()
                );

                insert into public.events (game_id, type, audience, payload)
                values (
                  current_game.id,
                  'ghost_sighting',
                  'hunter',
                  jsonb_build_object(
                    'ghost_index', ghost_rec.state->>'ghost_index',
                    'runner_id', runner_fix.runner_id,
                    'approx_lat', round(extensions.st_y(current_ghost_pt)::numeric, 5),
                    'approx_lng', round(extensions.st_x(current_ghost_pt)::numeric, 5),
                    'message', 'Ghost assisted hunters with a sighting ping!'
                  )
                );
              end if;
            else
              if not exists (
                select 1 from public.events ev
                where ev.game_id = current_game.id
                  and ev.type = 'ghost_sighting'
                  and (ev.payload->>'runner_id') = runner_fix.runner_id::text
                  and ev.created_at > now() - interval '20 seconds'
              ) then
                insert into public.events (game_id, type, audience, payload)
                values (
                  current_game.id,
                  'ghost_sighting',
                  'hunter',
                  jsonb_build_object(
                    'ghost_index', ghost_rec.state->>'ghost_index',
                    'runner_id', runner_fix.runner_id,
                    'approx_lat', round(extensions.st_y(current_ghost_pt)::numeric, 5),
                    'approx_lng', round(extensions.st_x(current_ghost_pt)::numeric, 5),
                    'message', 'A ghost sighted a runner!'
                  )
                );
              end if;
            end if;
          end if;

          if runner_fix.dist_m <= 12.0 then
            if not (v_dwells ? runner_fix.runner_id::text) then
              v_dwells := jsonb_set(v_dwells, array[runner_fix.runner_id::text], to_jsonb(now()));
            else
              v_first_seen := (v_dwells->>runner_fix.runner_id::text)::timestamptz;
              if now() >= v_first_seen + interval '3 seconds' then
                v_dwells := v_dwells - runner_fix.runner_id::text;

                update public.players
                set status = 'tagged', tagged_at = now()
                where id = runner_fix.runner_id;

                insert into public.events (game_id, type, audience, payload)
                values (
                  current_game.id,
                  'runner_tagged',
                  'all',
                  jsonb_build_object(
                    'runner_id', runner_fix.runner_id,
                    'runner_name', runner_fix.runner_name,
                    'by', 'ghost',
                    'reason', 'haunted',
                    'tagged_at', now()
                  )
                );

                select count(*) into active_runners_count
                from public.players pl
                where pl.game_id = current_game.id and pl.team = 'runner' and pl.status = 'active';

                if active_runners_count = 0 then
                  perform public.end_game(current_game.id, 'hunters', 'all_tagged');
                  select * into current_game from public.games g where g.id = advance_game.game_id;
                  return current_game.status;
                end if;
              end if;
            end if;
          else
            if v_dwells ? runner_fix.runner_id::text then
              v_dwells := v_dwells - runner_fix.runner_id::text;
            end if;
          end if;
        end loop;

        update public.entities
        set geog = current_ghost_pt::geography,
        state = jsonb_set(
          jsonb_set(
            jsonb_set(ghost_rec.state, '{current_lat}', to_jsonb(extensions.st_y(current_ghost_pt))),
            '{current_lng}', to_jsonb(extensions.st_x(current_ghost_pt))
          ),
          '{dwells}', v_dwells
        ),
        updated_at = now()
        where id = ghost_rec.id;
      end if;
    end loop;
  end if;

  -- Scheduled pings release: active runners only (jailed runners automatically excluded!)
  if current_game.status = 'live'
     and current_game.next_ping_at is not null
     and now() >= current_game.next_ping_at then
    next_ping := current_game.next_ping_at
      + make_interval(secs => current_game.ping_interval_s);
    if next_ping <= now() then
      next_ping := now() + make_interval(secs => current_game.ping_interval_s);
    end if;

    update public.games g
      set ping_seq = g.ping_seq + 1,
          next_ping_at = next_ping
      where g.id = current_game.id
      returning * into current_game;

    for runner in
      select p.id, p.status_detail, pp.geog, pp.accuracy_m, pp.recorded_at
      from public.players p
      join public.player_positions pp on pp.player_id = p.id
      where p.game_id = current_game.id
        and p.status = 'active'
        and p.team = 'runner'
    loop
      if runner.status_detail ? 'veil' then
        update public.players p
          set status_detail = p.status_detail - 'veil'
          where p.id = runner.id;
        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'veil_used', 'runner',
          jsonb_build_object('player_id', runner.id)
        );
        continue;
      end if;

      ping_geog := runner.geog;
      if (runner.status_detail ? 'decoy') or (runner.status_detail ? 'scramble') then
        shift_m := 150 + random() * 100;
        ping_geog := extensions.st_project(runner.geog, shift_m, radians(random() * 360));

        dist_from_center := extensions.st_distance(ping_geog, current_game.area_center);
        if dist_from_center > current_game.area_radius_m - 10 then
          bearing := extensions.st_azimuth(
            current_game.area_center::extensions.geometry,
            ping_geog::extensions.geometry
          );
          ping_geog := extensions.st_project(
            current_game.area_center,
            greatest(10, current_game.area_radius_m - 10),
            bearing
          );
        end if;

        if runner.status_detail ? 'scramble' then
          update public.players p
            set status_detail = p.status_detail - 'scramble'
            where p.id = runner.id;
        end if;

        if runner.status_detail ? 'decoy' then
          update public.players p
            set status_detail = p.status_detail - 'decoy'
            where p.id = runner.id;
          insert into public.events (game_id, type, audience, payload)
          values (
            current_game.id, 'decoy_used', 'runner',
            jsonb_build_object('player_id', runner.id)
          );
        end if;
      end if;

      insert into public.pings (
        game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
      ) values (
        current_game.id,
        current_game.ping_seq,
        runner.id,
        ping_geog,
        runner.accuracy_m,
        greatest(0, floor(extract(epoch from (now() - runner.recorded_at)))::integer),
        'scheduled',
        now()
      );
      ping_count := ping_count + 1;
    end loop;

    if ping_count > 0 then
      insert into public.events (game_id, type, payload)
      values (
        current_game.id,
        'ping_released',
        jsonb_build_object(
          'seq', current_game.ping_seq,
          'count', ping_count,
          'released_at', now()
        )
      );
    end if;
  end if;

  -- Match Timeout win condition
  if current_game.status in ('countdown', 'head_start', 'live')
     and current_game.ends_at is not null
     and now() >= current_game.ends_at then
    if current_game.mode = 'classic_chase' then
      perform public.end_game(current_game.id, 'hunters', 'time_expired');
    elsif current_game.mode_id = 'jailbreak' then
      select count(*) into active_runners_count
        from public.players
        where game_id = current_game.id and team = 'runner' and status = 'active';
      if active_runners_count > 0 then
        perform public.end_game(current_game.id, 'runners', 'time_expired');
      else
        perform public.end_game(current_game.id, 'hunters', 'all_jailed');
      end if;
    else
      perform public.end_game(current_game.id, 'runners', 'time_expired');
    end if;
    select * into current_game from public.games g where g.id = advance_game.game_id;
  end if;

  return current_game.status;
end;
$$;

revoke all on function public.advance_game(uuid) from public, anon;
grant execute on function public.advance_game(uuid) to authenticated;

-- 10. Updated get_game_state with Jail Entity & Jailed Status ------------------

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

  perform public.advance_game(get_game_state.game_id);

  select jsonb_build_object(
    'server_time', now(),
    'game', to_jsonb(g) || jsonb_build_object(
      'area', jsonb_build_object(
        'longitude', extensions.st_x(g.area_center::extensions.geometry),
        'latitude', extensions.st_y(g.area_center::extensions.geometry),
        'radius_m', public.effective_radius_m(g.id),
        'base_radius_m', g.area_radius_m,
        'zone_stage', g.zone_stage,
        'zone_stage_count', array_length(public.zone_stage_values(g.id), 1),
        'shrinking', 'shrinking_zone' = any(g.modifiers)
      ),
      'target_set', exists (select 1 from public.targets t where t.game_id = g.id),
      'jail', (
        select jsonb_build_object(
          'id', e.id,
          'longitude', extensions.st_x(e.geog::extensions.geometry),
          'latitude', extensions.st_y(e.geog::extensions.geometry),
          'radius_m', coalesce((e.state->>'radius_m')::int, (g.mode_params->'jailbreak'->>'jail_radius_m')::int, 15)
        )
        from public.entities e
        where e.game_id = g.id and e.kind = 'jail'
        limit 1
      ),
      'ping_visible_s', g.ping_visible_s,
      'ghost_mode', g.ghost_mode
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'user_id', p.user_id,
        'display_name', pr.display_name,
        'color', pr.color,
        'team', p.team,
        'status', p.status,
        'is_ready', p.is_ready,
        'joined_at', p.joined_at,
        'jailed_at', case when p.status = 'jailed' then p.tagged_at else null end,
        'secret_role', case
          when g.status in ('ended', 'cancelled') or p.id = mine.id then p.secret_role
          else null
        end
      ) order by p.joined_at)
      from public.players p join public.profiles pr on pr.id = p.user_id
      where p.game_id = g.id and p.status <> 'left'
    ), '[]'::jsonb),
    'my_player_id', mine.id,
    'my_team', mine.team,
    'rescue_in_progress', coalesce((mine.status_detail->>'free_started_at') is not null, false),
    'my_position', (
      select jsonb_build_object(
        'player_id', pp.player_id,
        'longitude', extensions.st_x(pp.geog::extensions.geometry),
        'latitude', extensions.st_y(pp.geog::extensions.geometry),
        'accuracy_m', pp.accuracy_m,
        'recorded_at', pp.recorded_at,
        'is_mock', pp.is_mock
      )
      from public.player_positions pp
      where pp.player_id = mine.id
    ),
    'positions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id', pp.player_id,
        'display_name', pr.display_name,
        'color', pr.color,
        'team', p.team,
        'status', p.status,
        'longitude', extensions.st_x(pp.geog::extensions.geometry),
        'latitude', extensions.st_y(pp.geog::extensions.geometry),
        'accuracy_m', pp.accuracy_m,
        'recorded_at', pp.recorded_at,
        'is_mock', pp.is_mock
      ) order by p.joined_at)
      from public.player_positions pp
      join public.players p on p.id = pp.player_id
      join public.profiles pr on pr.id = p.user_id
      where pp.game_id = g.id
        and p.status <> 'left'
        and (g.status in ('ended', 'cancelled') or p.id = mine.id or p.team = mine.team)
    ), '[]'::jsonb),
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
        where pings.game_id = g.id
          and (
            g.status in ('ended', 'cancelled')
            or pings.released_at >= now() - make_interval(secs => coalesce(g.ping_visible_s, 10))
          )
        order by released_at desc, id desc limit 100
      ) ping
    ), '[]'::jsonb),
    'target', case when mine.team = 'runner' or g.status in ('ended', 'cancelled') then (
      select jsonb_build_object(
        'longitude', extensions.st_x(t.geog::extensions.geometry),
        'latitude', extensions.st_y(t.geog::extensions.geometry)
      )
      from public.targets t where t.game_id = g.id
    ) else null end,
    'heat_marks', case when mine.team = 'hunter' or g.status in ('ended', 'cancelled') then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', hpf.id,
        'hunter_id', hpf.hunter_id,
        'result', hpf.result,
        'longitude', extensions.st_x(hpf.hunter_geog::extensions.geometry),
        'latitude', extensions.st_y(hpf.hunter_geog::extensions.geometry),
        'pressed_at', hpf.pressed_at
      ) order by hpf.pressed_at asc)
      from public.heat_press_feed hpf
      where hpf.game_id = g.id
    ), '[]'::jsonb) else '[]'::jsonb end,
    'heat_charges', case when mine.team = 'hunter' then (
      select tr.heat_charges from public.team_resources tr
      where tr.game_id = g.id and tr.team = 'hunter'
    ) else null end,
    'events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.id)
      from (
        select * from public.events
        where events.game_id = g.id
          and (
            (target_player is null and (audience = 'all' or audience = mine.team::text))
            or target_player = mine.id
          )
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

revoke all on function public.get_game_state(uuid) from public, anon;
grant execute on function public.get_game_state(uuid) to authenticated;
