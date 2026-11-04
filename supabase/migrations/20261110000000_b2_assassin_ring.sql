-- Migration: 20261110000000_b2_assassin_ring.sql
-- B2: Assassin Ring Base Mode (docs/MODES.md §4.3)

-- 1. Types and Constraints ---------------------------------------------------

alter type public.game_mode add value if not exists 'assassin_ring';
alter type public.team_type add value if not exists 'solo';

alter table public.games drop constraint if exists games_winner_check;
alter table public.games add constraint games_winner_check check (winner in ('runners', 'hunters', 'solo'));

-- 2. Ring Assignments Table ---------------------------------------------------

create table if not exists public.ring_assignments (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  hunter_player_id uuid not null references public.players(id) on delete cascade,
  prey_player_id uuid not null references public.players(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'eliminated', 'relinked')),
  assigned_at timestamptz not null default now(),
  eliminated_at timestamptz,
  unique (game_id, hunter_player_id, status)
);

create index if not exists ring_assignments_game_idx on public.ring_assignments(game_id);
create index if not exists ring_assignments_prey_idx on public.ring_assignments(game_id, prey_player_id);

alter table public.ring_assignments enable row level security;
revoke all on public.ring_assignments from anon;
grant select on public.ring_assignments to authenticated;

drop policy if exists ring_assignments_select on public.ring_assignments;
create policy ring_assignments_select on public.ring_assignments for select to authenticated
  using (
    public.is_member(game_id)
    and (
      (select status from public.games where id = ring_assignments.game_id) in ('ended', 'cancelled')
      or (
        status = 'active'
        and hunter_player_id in (
          select p.id from public.players p
          where p.game_id = ring_assignments.game_id and p.user_id = auth.uid()
        )
      )
    )
  );

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
    ),
    jsonb_build_object(
      'id', 'assassin_ring', 'layer', 'base', 'name', 'Assassin Ring',
      'teams', jsonb_build_array('solo'), 'min_players', 3,
      'compatible_roles', jsonb_build_array(),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'qr_tagging', 'shrinking_zone'
      ),
      'parameters', jsonb_build_object(
        'tag_radius_m', 15,
        'safe_zone_count', 2,
        'safe_zone_radius_m', 20,
        'safe_zone_max_s', 60,
        'safe_zone_cooldown_s', 120,
        'hunter_pulse_far_m', 100,
        'hunter_pulse_near_m', 40,
        'offline_relink_s', 180
      )
    )
  );
$$;

-- 4. Safe Zone RPC -------------------------------------------------------------

create or replace function public.set_safe_zone_location(
  p_game_id uuid,
  p_zone_index integer,
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  new_geog extensions.geography;
  existing_entity_id uuid;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into current_game from public.games g where g.id = p_game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.host_id <> caller_id then raise exception 'Only the host can set safe zones.'; end if;
  if current_game.status <> 'lobby' then raise exception 'Safe zones can only be set in the lobby.'; end if;

  new_geog := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
  if not extensions.st_dwithin(new_geog, current_game.area_center, current_game.area_radius_m) then
    raise exception 'Safe zone must be placed inside the play area boundary.';
  end if;

  select e.id into existing_entity_id
  from public.entities e
  where e.game_id = p_game_id and e.kind = 'safe_zone' and (e.state->>'zone_index')::int = p_zone_index;

  if existing_entity_id is not null then
    update public.entities
    set geog = new_geog,
        state = jsonb_build_object('zone_index', p_zone_index, 'radius_m', coalesce(p_radius_m, 20)),
        updated_at = now()
    where id = existing_entity_id;
  else
    insert into public.entities (game_id, kind, geog, state, visible_to)
    values (
      p_game_id, 'safe_zone', new_geog,
      jsonb_build_object('zone_index', p_zone_index, 'radius_m', coalesce(p_radius_m, 20)),
      'all'
    );
  end if;

  return jsonb_build_object('success', true, 'zone_index', p_zone_index, 'radius_m', coalesce(p_radius_m, 20));
end;
$$;

revoke all on function public.set_safe_zone_location(uuid, integer, double precision, double precision, integer) from public, anon;
grant execute on function public.set_safe_zone_location(uuid, integer, double precision, double precision, integer) to authenticated;

-- 5. End Game Support for Solo Winner -----------------------------------------

create or replace function public.end_game(
  game_id uuid,
  end_winner text,
  end_reason text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  current_game public.games%rowtype;
begin
  if end_winner not in ('runners', 'hunters', 'solo') then
    raise exception 'Winner must be runners, hunters, or solo.';
  end if;
  if end_reason is null or length(trim(end_reason)) = 0 then
    raise exception 'An end reason is required.';
  end if;

  select * into current_game from public.games g
    where g.id = end_game.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status in ('ended', 'cancelled') then return; end if;
  if current_game.status <> 'live' then
    raise exception 'The round is not live.';
  end if;

  update public.games g set
    status = 'ended',
    winner = end_game.end_winner,
    end_reason = end_game.end_reason,
    ended_at = now()
    where g.id = current_game.id
    returning * into current_game;

  insert into public.events (game_id, type, payload)
  values (
    current_game.id,
    'game_ended',
    jsonb_build_object('winner', current_game.winner, 'reason', current_game.end_reason)
  );
end;
$$;

revoke all on function public.end_game(uuid, text, text) from public, anon, authenticated;

-- 6. Start Game Updates for Assassin Ring -------------------------------------

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
  active_total integer;
  unassigned integer;
  missing_consent integer;
  countdown_ends timestamptz;
  live_starts timestamptz;
  round_ends timestamptz;
  hunter_heat_charges integer := 0;
  chosen_agent_id uuid;
  agent_charges integer;
  agent_cooldown integer;
  safe_zone_count integer;
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
         count(*) filter (where p.team = 'unassigned'),
         count(*)
    into active_runners, active_hunters, unassigned, active_total
    from public.players p
    where p.game_id = start_game.game_id and p.status = 'active';

  if current_game.mode_id = 'assassin_ring' then
    if active_total < 3 then
      raise exception 'Assassin Ring requires at least 3 players to form a ring.';
    end if;

    -- In assassin_ring, all active players play as 'solo'
    update public.players
      set team = 'solo'
      where game_id = current_game.id and status = 'active';

    -- Auto-place 2 safe zones if fewer than 2 exist
    select count(*) into safe_zone_count
      from public.entities e
      where e.game_id = current_game.id and e.kind = 'safe_zone';

    if safe_zone_count < 2 then
      insert into public.entities (game_id, kind, geog, state, visible_to)
      values
        (current_game.id, 'safe_zone',
         extensions.st_project(current_game.area_center, current_game.area_radius_m * 0.45, radians(0)),
         jsonb_build_object('zone_index', 1, 'radius_m', 20), 'all'),
        (current_game.id, 'safe_zone',
         extensions.st_project(current_game.area_center, current_game.area_radius_m * 0.45, radians(180)),
         jsonb_build_object('zone_index', 2, 'radius_m', 20), 'all');
    end if;

    -- Generate circular Hamiltonian cycle permutation
    with shuffled as (
      select id,
             row_number() over (order by random()) as rn,
             count(*) over () as total
      from public.players
      where game_id = current_game.id and status = 'active'
    ),
    ring as (
      select s1.id as hunter_id,
             s2.id as prey_id
      from shuffled s1
      join shuffled s2 on s2.rn = (case when s1.rn = s1.total then 1 else s1.rn + 1 end)
    )
    insert into public.ring_assignments (game_id, hunter_player_id, prey_player_id, status)
    select current_game.id, hunter_id, prey_id, 'active'
    from ring;

  elsif current_game.mode_id not in ('haunted_map', 'ghost_duel') then
    if active_runners = 0 or active_hunters = 0 then
      raise exception 'Assign at least one runner and one hunter before starting.';
    end if;
    if unassigned > 0 then
      raise exception 'Every player must choose a team before the round starts.';
    end if;
  else
    if active_runners = 0 and active_hunters = 0 then
      raise exception 'Assign at least one player before starting.';
    end if;
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

  if 'double_agent' = any(current_game.roles) and current_game.mode_id <> 'assassin_ring' then
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

  if 'hot_cold' = any(current_game.modifiers) and current_game.mode_id <> 'assassin_ring' then
    current_game.ping_interval_s := current_game.ping_interval_s * 3;
    hunter_heat_charges := coalesce(
      (current_game.mode_params->'hot_cold'->>'initial_charges')::int,
      6
    );
  end if;

  update public.games g set
    status = 'countdown',
    started_at = clock_timestamp(),
    countdown_ends_at = countdown_ends,
    head_start_at = countdown_ends,
    live_at = live_starts,
    ends_at = round_ends,
    ping_interval_s = current_game.ping_interval_s,
    next_ping_at = live_starts + make_interval(secs => current_game.ping_interval_s),
    ping_seq = 0,
    winner = null,
    end_reason = null,
    ended_at = null,
    zone_stage = 0,
    zone_next_shrink_at = case
      when 'shrinking_zone' = any(current_game.modifiers) then
        live_starts + make_interval(secs => floor(current_game.duration_s * (2.0 / 3.0))::int)
      else null
    end
    where g.id = current_game.id;

  insert into public.player_resources (game_id, player_id, team, heat_charges)
  select current_game.id, p.id, p.team, 0
  from public.players p
  where p.game_id = current_game.id and p.status = 'active'
  on conflict (game_id, player_id) do nothing;

  insert into public.team_resources (game_id, team, heat_charges, heat_updated_at)
  values
    (current_game.id, 'runner', 0, now()),
    (current_game.id, 'hunter', hunter_heat_charges, now())
  on conflict (game_id, team) do update
    set heat_charges = excluded.heat_charges,
        heat_updated_at = excluded.heat_updated_at;

  insert into public.events (game_id, type, payload)
  values (
    current_game.id,
    'game_started',
    jsonb_build_object(
      'countdown_ends_at', countdown_ends,
      'head_start_at', countdown_ends,
      'live_at', live_starts,
      'ends_at', round_ends,
      'ping_interval_s', current_game.ping_interval_s
    )
  );

  return jsonb_build_object(
    'phase', 'countdown',
    'countdown_ends_at', countdown_ends,
    'head_start_at', countdown_ends,
    'live_at', live_starts,
    'ends_at', round_ends
  );
end;
$$;

-- 7. Attempt Tag & Apply Tag Updates ------------------------------------------

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
  hunter_name text;
  active_runners integer;
  active_survivors integer;
  is_jailbreak boolean;
  is_assassin boolean;
  v_next_prey_id uuid;
begin
  select * into current_game from public.games g where g.id = p_game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then
    raise exception 'Tagging is only available while the round is live.';
  end if;

  select * into target_runner from public.players p
    where p.id = p_runner_id and p.game_id = p_game_id and p.status = 'active'
    for update;
  if not found then raise exception 'That player is not taggable.'; end if;

  select pr.display_name into runner_name
    from public.profiles pr where pr.id = target_runner.user_id;
  select pr.display_name into hunter_name
    from public.players hp join public.profiles pr on pr.id = hp.user_id
    where hp.id = p_hunter_id;

  insert into public.tags (game_id, hunter_id, runner_id, distance_m)
  values (p_game_id, p_hunter_id, target_runner.id, greatest(0, p_distance_m)::real);

  update public.players p set last_tag_attempt_at = null where p.id = p_hunter_id;

  is_jailbreak := (current_game.mode_id = 'jailbreak');
  is_assassin := (current_game.mode_id = 'assassin_ring');

  if is_assassin then
    -- Assassin Ring: eliminate prey and relink ring
    update public.players p
      set status = 'tagged',
          tagged_at = now(),
          is_ready = false
      where p.id = target_runner.id;

    -- Mark incoming ring assignment for prey eliminated
    update public.ring_assignments
      set status = 'eliminated', eliminated_at = now()
      where game_id = p_game_id and prey_player_id = target_runner.id and status = 'active';

    -- Find prey's assigned prey
    select prey_player_id into v_next_prey_id
    from public.ring_assignments
    where game_id = p_game_id and hunter_player_id = target_runner.id and status = 'active';

    -- Relink prey's outgoing assignment
    update public.ring_assignments
      set status = 'relinked'
      where game_id = p_game_id and hunter_player_id = target_runner.id and status = 'active';

    -- If next prey is someone other than the hunter, inherit it
    if v_next_prey_id is not null and v_next_prey_id <> p_hunter_id then
      update public.ring_assignments
        set status = 'relinked'
        where game_id = p_game_id and hunter_player_id = p_hunter_id and status = 'active';

      insert into public.ring_assignments (game_id, hunter_player_id, prey_player_id, status)
      values (p_game_id, p_hunter_id, v_next_prey_id, 'active');
    end if;

    insert into public.events (game_id, type, audience, payload)
    values (
      p_game_id, 'player_eliminated', 'all',
      jsonb_build_object(
        'hunter_id', p_hunter_id,
        'prey_id', target_runner.id,
        'hunter_name', hunter_name,
        'prey_name', runner_name,
        'distance_m', round(p_distance_m::numeric, 1)
      )
    );

    -- Check last survivor win condition
    select count(*) into active_survivors
      from public.players p
      where p.game_id = p_game_id and p.status = 'active';

    if active_survivors <= 1 then
      perform public.end_game(p_game_id, 'solo', 'last_survivor');
    end if;

  elsif is_jailbreak then
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

    select count(*) into active_runners
      from public.players p
      where p.game_id = p_game_id and p.team = 'runner' and p.status = 'active';

    if active_runners = 0 then
      perform public.end_game(p_game_id, 'hunters', 'all_jailed');
    end if;

  else
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

create or replace function public.attempt_tag(game_id uuid)
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
  target_id uuid;
  target_distance double precision;
  v_my_prey_id uuid;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into me from public.players p
    where p.game_id = attempt_tag.game_id
      and p.user_id = caller_id
      and p.status = 'active'
    for update;
  if not found then raise exception 'You are not an active player in this game.'; end if;

  perform public.advance_game(attempt_tag.game_id);

  select * into current_game from public.games g
    where g.id = attempt_tag.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then
    raise exception 'Tagging is only available while the round is live.';
  end if;

  if current_game.mode_id <> 'assassin_ring' and me.team <> 'hunter' then
    raise exception 'Only hunters can tag runners.';
  end if;

  if me.last_tag_attempt_at is not null
     and now() - me.last_tag_attempt_at < interval '8 seconds' then
    return jsonb_build_object('success', false, 'reason', 'cooldown');
  end if;

  select * into my_pos from public.player_positions pp where pp.player_id = me.id;
  if not found or now() - my_pos.recorded_at > interval '20 seconds' then
    return jsonb_build_object('success', false, 'reason', 'stale_position');
  end if;

  -- Safe zone check: if caller is inside safe zone, tag is disabled
  if exists (
    select 1 from public.entities e
    where e.game_id = current_game.id and e.kind = 'safe_zone'
      and extensions.st_dwithin(e.geog, my_pos.geog, coalesce((e.state->>'radius_m')::int, 20))
  ) then
    return jsonb_build_object('success', false, 'reason', 'in_safe_zone');
  end if;

  if current_game.mode_id = 'assassin_ring' then
    -- Find caller's assigned prey
    select ra.prey_player_id into v_my_prey_id
    from public.ring_assignments ra
    where ra.game_id = current_game.id and ra.hunter_player_id = me.id and ra.status = 'active';

    if v_my_prey_id is null then
      return jsonb_build_object('success', false, 'reason', 'no_prey_assigned');
    end if;

    -- Check if target is inside a safe zone
    if exists (
      select 1 from public.entities e
      join public.player_positions pp on pp.player_id = v_my_prey_id
      where e.game_id = current_game.id and e.kind = 'safe_zone'
        and extensions.st_dwithin(e.geog, pp.geog, coalesce((e.state->>'radius_m')::int, 20))
    ) then
      return jsonb_build_object('success', false, 'reason', 'in_safe_zone');
    end if;

    -- Check if assigned prey is within tag range
    select p.id, extensions.st_distance(pp.geog, my_pos.geog)
      into target_id, target_distance
    from public.players p
    join public.player_positions pp on pp.player_id = p.id
    where p.id = v_my_prey_id
      and p.game_id = current_game.id
      and p.status = 'active'
      and pp.recorded_at > now() - interval '20 seconds'
      and extensions.st_distance(pp.geog, my_pos.geog)
          <= current_game.tag_radius_m + least(
               10::double precision,
               (coalesce(my_pos.accuracy_m, 0)::double precision
                + coalesce(pp.accuracy_m, 0)::double precision) / 2
             );

    if target_id is null then
      update public.players p set last_tag_attempt_at = now() where p.id = me.id;
      return jsonb_build_object('success', false, 'reason', 'no_target');
    end if;

  else
    -- Standard Hunter vs Runner modes
    select p.id, extensions.st_distance(pp.geog, my_pos.geog)
      into target_id, target_distance
    from public.players p
    join public.player_positions pp on pp.player_id = p.id
    where p.game_id = current_game.id
      and p.team = 'runner'
      and p.status = 'active'
      and pp.recorded_at > now() - interval '20 seconds'
      and extensions.st_distance(pp.geog, my_pos.geog)
          <= current_game.tag_radius_m + least(
               10::double precision,
               (coalesce(my_pos.accuracy_m, 0)::double precision
                + coalesce(pp.accuracy_m, 0)::double precision) / 2
             )
    order by extensions.st_distance(pp.geog, my_pos.geog) asc
    limit 1;

    if target_id is null then
      update public.players p set last_tag_attempt_at = now() where p.id = me.id;
      return jsonb_build_object('success', false, 'reason', 'no_target');
    end if;
  end if;

  return public.apply_tag(current_game.id, me.id, target_id, target_distance);
end;
$$;

-- 8. Update get_game_state ---------------------------------------------------

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
      'ping_visible_s', g.ping_visible_s,
      'ghost_mode', g.ghost_mode,
      'jail', (
        select jsonb_build_object(
          'id', e.id,
          'longitude', extensions.st_x(e.geog::extensions.geometry),
          'latitude', extensions.st_y(e.geog::extensions.geometry),
          'radius_m', coalesce((e.state->>'radius_m')::int, 15)
        )
        from public.entities e
        where e.game_id = g.id and e.kind = 'jail'
        limit 1
      )
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
        'jailed_at', p.jailed_at,
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
        and (
          g.status in ('ended', 'cancelled')
          or p.id = mine.id
          or (mine.team <> 'solo' and p.team = mine.team and p.status <> 'jailed')
        )
    ), '[]'::jsonb),
    'pings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ping.id,
        'seq', ping.seq,
        'longitude', extensions.st_x(ping.geog::extensions.geometry),
        'latitude', extensions.st_y(ping.geog::extensions.geometry),
        'position_age_s', round(ping.accuracy_m),
        'released_at', ping.released_at
      ) order by ping.seq)
      from public.pings ping
      where ping.game_id = g.id
        and (
          g.status in ('ended', 'cancelled')
          or (
            ping.released_at >= now() - make_interval(secs => coalesce(g.ping_visible_s, 10))
            and (
              g.mode_id <> 'assassin_ring'
              or ping.player_id = (
                select ra.prey_player_id from public.ring_assignments ra
                where ra.game_id = g.id and ra.hunter_player_id = mine.id and ra.status = 'active'
              )
            )
          )
        )
    ), '[]'::jsonb),
    'assassin_ring', case
      when g.mode_id = 'assassin_ring' then jsonb_build_object(
        'my_prey', (
          select jsonb_build_object(
            'player_id', prey_p.id,
            'display_name', prey_pr.display_name,
            'color', prey_pr.color,
            'status', prey_p.status
          )
          from public.ring_assignments ra
          join public.players prey_p on prey_p.id = ra.prey_player_id
          join public.profiles prey_pr on prey_pr.id = prey_p.user_id
          where ra.game_id = g.id
            and ra.hunter_player_id = mine.id
            and ra.status = 'active'
        ),
        'hunter_proximity', (
          select case
            when hunter_pp.geog is null or my_pp.geog is null then 'none'
            when extensions.st_dwithin(hunter_pp.geog, my_pp.geog, 40) then 'close'
            when extensions.st_dwithin(hunter_pp.geog, my_pp.geog, 100) then 'near'
            else 'none'
          end
          from public.ring_assignments ra
          join public.player_positions hunter_pp on hunter_pp.player_id = ra.hunter_player_id
          left join public.player_positions my_pp on my_pp.player_id = mine.id
          where ra.game_id = g.id
            and ra.prey_player_id = mine.id
            and ra.status = 'active'
        ),
        'safe_zones', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', e.id,
            'zone_index', coalesce((e.state->>'zone_index')::int, 1),
            'longitude', extensions.st_x(e.geog::extensions.geometry),
            'latitude', extensions.st_y(e.geog::extensions.geometry),
            'radius_m', coalesce((e.state->>'radius_m')::int, 20)
          ))
          from public.entities e
          where e.game_id = g.id and e.kind = 'safe_zone'
        ), '[]'::jsonb),
        'in_safe_zone', exists (
          select 1 from public.entities e
          join public.player_positions pp on pp.player_id = mine.id
          where e.game_id = g.id and e.kind = 'safe_zone'
            and extensions.st_dwithin(e.geog, pp.geog, coalesce((e.state->>'radius_m')::int, 20))
        ),
        'active_survivors', (
          select count(*) from public.players where game_id = g.id and status = 'active'
        )
      )
      else null
    end,
    'target', case
      when g.mode_id = 'classic_chase' and (
        g.status in ('ended', 'cancelled')
        or mine.team = 'runner'
      ) then (
        select jsonb_build_object(
          'id', t.id,
          'longitude', extensions.st_x(t.geog::extensions.geometry),
          'latitude', extensions.st_y(t.geog::extensions.geometry),
          'radius_m', t.radius_m,
          'selected_by_player_id', t.selected_by_player_id
        )
        from public.targets t where t.game_id = g.id
      )
      else null
    end
  ) into snapshot
  from public.games g
  join public.players mine on mine.game_id = g.id and mine.user_id = caller_id
  where g.id = get_game_state.game_id;

  return snapshot;
end;
$$;

-- 9. Update advance_game Canonical -------------------------------------------

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
  active_survivors_count int;
  v_dwells jsonb;
  v_first_seen timestamptz;
  v_ghost_ping_seq integer;
  v_auto_release_s integer;
  jailed_rec record;
  jail_rec public.entities%rowtype;
  offline_rec record;
  v_next_prey_id uuid;
begin
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
    insert into public.events (game_id, type, payload)
    values (current_game.id, 'head_start_began', jsonb_build_object('phase', 'head_start'));
  end if;

  if current_game.status = 'head_start'
     and current_game.live_at is not null
     and now() >= current_game.live_at then
    update public.games g set status = 'live'
      where g.id = current_game.id
      returning * into current_game;
    insert into public.events (game_id, type, payload)
    values (current_game.id, 'live_began', jsonb_build_object('phase', 'live'));
  end if;

  -- Shrinking zone progression
  zone_on := 'shrinking_zone' = any(current_game.modifiers);
  if current_game.status = 'live' and zone_on and current_game.zone_next_shrink_at is not null then
    stages := public.zone_stage_values(current_game.id);
    stage_count := array_length(stages, 1);
    stage_index := coalesce(current_game.zone_stage, 0) + 1;

    if now() >= current_game.zone_next_shrink_at and stage_index < stage_count then
      next_stage := stage_index;
      progress := (stage_index::double precision) / ((stage_count - 1)::double precision);
      next_start := current_game.live_at + make_interval(
        secs => floor(
          current_game.duration_s * (2.0 / 3.0 + (1.0 / 3.0) * progress)
        )::int
      );

      update public.games g set
        zone_stage = next_stage,
        zone_next_shrink_at = case when next_stage + 1 < stage_count then next_start else null end
        where g.id = current_game.id
        returning * into current_game;

      insert into public.events (game_id, type, payload)
      values (
        current_game.id,
        'zone_shrunk',
        jsonb_build_object(
          'stage', current_game.zone_stage,
          'effective_radius_m', public.effective_radius_m(current_game.id)
        )
      );
    end if;
  end if;

  -- Jailbreak mode passive processing
  if current_game.status = 'live' and current_game.mode_id = 'jailbreak' then
    v_auto_release_s := coalesce(
      (current_game.mode_params->'jailbreak'->>'auto_release_s')::int,
      300
    );

    for jailed_rec in
      select p.id, p.user_id, p.jailed_at, pr.display_name
      from public.players p
      join public.profiles pr on pr.id = p.user_id
      where p.game_id = current_game.id
        and p.status = 'jailed'
        and p.jailed_at is not null
        and now() >= p.jailed_at + make_interval(secs => v_auto_release_s)
    loop
      update public.players
        set status = 'active', jailed_at = null, status_detail = status_detail - 'free_started_at'
        where id = jailed_rec.id;

      insert into public.events (game_id, type, audience, payload)
      values (
        current_game.id, 'player_released', 'all',
        jsonb_build_object(
          'player_id', jailed_rec.id,
          'display_name', jailed_rec.display_name,
          'reason', 'auto_release'
        )
      );
    end loop;

    -- Shrinking zone jail overrun check
    if zone_on then
      select * into jail_rec
      from public.entities e
      where e.game_id = current_game.id and e.kind = 'jail'
      limit 1;

      if found and jail_rec.geog is not null then
        if extensions.st_distance(jail_rec.geog, current_game.area_center)
           + coalesce((jail_rec.state->>'radius_m')::int, 15)
           > public.effective_radius_m(current_game.id) then
          select count(*) into jailed_runners_count
          from public.players p
          where p.game_id = current_game.id and p.status = 'jailed';

          if jailed_runners_count > 0 then
            update public.players
              set status = 'active', jailed_at = null, status_detail = status_detail - 'free_started_at'
              where game_id = current_game.id and status = 'jailed';

            insert into public.events (game_id, type, audience, payload)
            values (
              current_game.id, 'jail_overrun', 'all',
              jsonb_build_object(
                'message', 'The shrinking zone overrun the jail. All prisoners are released!'
              )
            );
          end if;
        end if;
      end if;
    end if;

    select count(*) into active_runners_count
      from public.players p
      where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active';

    if active_runners_count = 0 then
      perform public.end_game(current_game.id, 'hunters', 'all_jailed');
      select * into current_game from public.games g where g.id = advance_game.game_id;
      return current_game.status;
    end if;
  end if;

  -- Assassin Ring mode passive processing: offline relink and survivor check
  if current_game.status = 'live' and current_game.mode_id = 'assassin_ring' then
    for offline_rec in
      select ra.id as assignment_id, ra.hunter_player_id, ra.prey_player_id, pr.display_name
      from public.ring_assignments ra
      join public.players prey_p on prey_p.id = ra.prey_player_id
      join public.profiles pr on pr.id = prey_p.user_id
      left join public.player_positions pp on pp.player_id = prey_p.id
      where ra.game_id = current_game.id
        and ra.status = 'active'
        and prey_p.status = 'active'
        and (pp.recorded_at is null or pp.recorded_at < now() - interval '180 seconds')
    loop
      select ra2.prey_player_id into v_next_prey_id
      from public.ring_assignments ra2
      where ra2.game_id = current_game.id and ra2.hunter_player_id = offline_rec.prey_player_id and ra2.status = 'active';

      if v_next_prey_id is not null and v_next_prey_id <> offline_rec.hunter_player_id then
        update public.players set status = 'tagged', tagged_at = now() where id = offline_rec.prey_player_id;
        update public.ring_assignments set status = 'eliminated', eliminated_at = now()
          where game_id = current_game.id and prey_player_id = offline_rec.prey_player_id and status = 'active';
        update public.ring_assignments set status = 'relinked' where id = offline_rec.assignment_id;

        insert into public.ring_assignments (game_id, hunter_player_id, prey_player_id, status)
        values (current_game.id, offline_rec.hunter_player_id, v_next_prey_id, 'active');

        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'player_timed_out', 'all',
          jsonb_build_object(
            'player_id', offline_rec.prey_player_id,
            'display_name', offline_rec.display_name,
            'reason', 'offline_timeout'
          )
        );
      end if;
    end loop;

    select count(*) into active_survivors_count
    from public.players p
    where p.game_id = current_game.id and p.status = 'active';

    if active_survivors_count <= 1 then
      perform public.end_game(current_game.id, 'solo', 'last_survivor');
      select * into current_game from public.games g where g.id = advance_game.game_id;
      return current_game.status;
    end if;
  end if;

  -- Ghost NPC movement and tagging (Haunted Map)
  if current_game.status = 'live' and ('ghost_npc' = any(current_game.modifiers) or current_game.mode_id = 'haunted_map') then
    for ghost_rec in
      select e.id, e.state
      from public.entities e
      where e.game_id = current_game.id and e.kind = 'ghost'
    loop
      patrol_geom := extensions.st_geomfromgeojson(ghost_rec.state->>'patrol_route');
      duration_s := coalesce((ghost_rec.state->>'duration_s')::int, 600);
      effective_duration_s := greatest(30, duration_s / 3);
      elapsed_s := extract(epoch from (now() - current_game.live_at));
      loop_frac := (elapsed_s % effective_duration_s) / effective_duration_s::float;

      current_ghost_pt := extensions.st_lineinterpolatepoint(patrol_geom, loop_frac);

      update public.entities
      set geog = current_ghost_pt::extensions.geography,
          updated_at = now()
      where id = ghost_rec.id;

      for runner_fix in
        select pp.player_id, pp.geog, pp.accuracy_m, pr.display_name
        from public.player_positions pp
        join public.players p on p.id = pp.player_id
        join public.profiles pr on pr.id = p.user_id
        where p.game_id = current_game.id
          and p.team = 'runner'
          and p.status = 'active'
          and pp.accuracy_m <= 30.0
          and pp.recorded_at > now() - interval '15 seconds'
      loop
        if current_game.ghost_mode = 'assist' then
          if extensions.st_dwithin(current_ghost_pt::extensions.geography, runner_fix.geog, 40.0) then
            select coalesce(max(seq), 0) + 1 into v_ghost_ping_seq
            from public.pings where game_id = current_game.id;

            insert into public.pings (
              game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
            ) values (
              current_game.id,
              v_ghost_ping_seq,
              runner_fix.player_id,
              runner_fix.geog,
              runner_fix.accuracy_m,
              0,
              'ghost_sighting',
              now()
            );

            insert into public.events (game_id, type, audience, payload)
            values (
              current_game.id, 'ghost_sighting', 'hunter',
              jsonb_build_object(
                'runner_id', runner_fix.player_id,
                'message', 'Ghost spotted a runner nearby!'
              )
            );
          end if;
        end if;

        if extensions.st_dwithin(current_ghost_pt::extensions.geography, runner_fix.geog, 12.0) then
          v_dwells := coalesce(ghost_rec.state->'dwells', '{}'::jsonb);
          v_first_seen := (v_dwells->>(runner_fix.player_id::text))::timestamptz;

          if v_first_seen is null then
            v_dwells := jsonb_set(
              v_dwells,
              array[runner_fix.player_id::text],
              to_jsonb(now()::text)
            );
            update public.entities
            set state = jsonb_set(ghost_rec.state, '{dwells}', v_dwells)
            where id = ghost_rec.id;
          elsif now() >= v_first_seen + interval '3 seconds' then
            update public.players
            set status = 'tagged', tagged_at = now()
            where id = runner_fix.player_id;

            insert into public.events (game_id, type, audience, payload)
            values (
              current_game.id, 'runner_haunted', 'all',
              jsonb_build_object(
                'runner_id', runner_fix.player_id,
                'display_name', runner_fix.display_name,
                'ghost_id', ghost_rec.id
              )
            );

            select count(*) into active_runners_count
            from public.players
            where game_id = current_game.id and team = 'runner' and status = 'active';

            if active_runners_count = 0 then
              perform public.end_game(current_game.id, 'hunters', 'all_haunted');
            end if;

            v_dwells := v_dwells - (runner_fix.player_id::text);
            update public.entities
            set state = jsonb_set(ghost_rec.state, '{dwells}', v_dwells)
            where id = ghost_rec.id;
          end if;
        else
          v_dwells := coalesce(ghost_rec.state->'dwells', '{}'::jsonb);
          if v_dwells ? (runner_fix.player_id::text) then
            v_dwells := v_dwells - (runner_fix.player_id::text);
            update public.entities
            set state = jsonb_set(ghost_rec.state, '{dwells}', v_dwells)
            where id = ghost_rec.id;
          end if;
        end if;
      end loop;
    end loop;
  end if;

  -- Scheduled radar ping release
  if current_game.status = 'live'
     and current_game.next_ping_at is not null
     and now() >= current_game.next_ping_at then
    next_ping := current_game.next_ping_at;
    while next_ping <= now() loop
      next_ping := next_ping + make_interval(secs => current_game.ping_interval_s);
    end loop;

    update public.games g set
      ping_seq = g.ping_seq + 1,
      next_ping_at = next_ping
      where g.id = current_game.id
      returning * into current_game;

    for runner in
      select p.id, pp.geog, pp.accuracy_m, pp.recorded_at, p.status_detail
      from public.players p
      join public.player_positions pp on pp.player_id = p.id
      where p.game_id = current_game.id
        and (
          (current_game.mode_id <> 'assassin_ring' and p.team = 'runner' and p.status = 'active')
          or (current_game.mode_id = 'assassin_ring' and p.status = 'active')
        )
        and pp.recorded_at > now() - interval '2 minutes'
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

      -- Skip ping if player is inside an active safe zone in assassin_ring
      if current_game.mode_id = 'assassin_ring' and exists (
        select 1 from public.entities e
        where e.game_id = current_game.id and e.kind = 'safe_zone'
          and extensions.st_dwithin(e.geog, runner.geog, coalesce((e.state->>'radius_m')::int, 20))
      ) then
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

  -- Time expiry win check
  if current_game.status in ('countdown', 'head_start', 'live')
     and current_game.ends_at is not null
     and now() >= current_game.ends_at then
    if current_game.mode = 'classic_chase' then
      perform public.end_game(current_game.id, 'hunters', 'time_expired');
    elsif current_game.mode_id = 'jailbreak' then
      select count(*) into active_runners_count
        from public.players p
        where p.game_id = current_game.id and p.team = 'runner' and p.status = 'active';
      if active_runners_count > 0 then
        perform public.end_game(current_game.id, 'runners', 'time_expired');
      else
        perform public.end_game(current_game.id, 'hunters', 'all_jailed');
      end if;
    elsif current_game.mode_id = 'assassin_ring' then
      perform public.end_game(current_game.id, 'solo', 'time_expired');
    else
      perform public.end_game(current_game.id, 'runners', 'time_expired');
    end if;
    select * into current_game from public.games g where g.id = advance_game.game_id;
  end if;

  return current_game.status;
end;
$$;
