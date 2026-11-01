-- V2-M3.2 Dead Drops.
--
-- At the live transition the server scatters up to six hidden drops inside the
-- area (at least 150 m apart and 60 m inside the edge). A drop is invisible
-- until a player is within 40 m; claiming needs 15 m and a 5 s hold. Each drop
-- is single use and rolls an item from the claimer's team pool:
--
--   runners  veil | decoy | burn
--   hunters  free_ping | jam | sweep
--
-- Items live in player_resources.charges (owner-only). Veil and Decoy are
-- consumed by the next scheduled ping, so advance_game is replaced in full.
-- Drop positions never reach the events table: the claim event carries the team
-- and the item is delivered only to the claimer.

-- One in-flight hold per player. Server-only: no client reads this table.
create table public.drop_claims (
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  drop_id uuid not null references public.entities(id) on delete cascade,
  started_at timestamptz not null default now(),
  primary key (game_id, player_id)
);

alter table public.drop_claims enable row level security;
revoke all on public.drop_claims from anon, authenticated;

-- random_area_point: uniform point inside radius - inset, as geography.
create or replace function public.random_area_point(
  center extensions.geography,
  radius_m double precision,
  inset_m double precision
)
returns extensions.geography
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  center_lng double precision := extensions.st_x(center::extensions.geometry);
  center_lat double precision := extensions.st_y(center::extensions.geometry);
  angle double precision := random() * 2 * pi();
  reach double precision := sqrt(random()) * greatest(0, radius_m - inset_m);
begin
  return extensions.st_setsrid(
    extensions.st_makepoint(
      center_lng + (reach * sin(angle)) / (111320 * cos(radians(center_lat))),
      center_lat + (reach * cos(angle)) / 110540
    ),
    4326
  )::extensions.geography;
end;
$$;

revoke all on function public.random_area_point(
  extensions.geography, double precision, double precision
) from public, anon, authenticated;

-- spawn_drops: idempotent enough to call on the live transition. Placement is
-- retried per drop so spacing holds; if the area is too small for the requested
-- count, fewer drops are spawned rather than stacking them.
create or replace function public.spawn_drops(p_game_id uuid, p_count integer default null)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  current_game public.games%rowtype;
  wanted integer;
  spacing_m double precision;
  inset_m double precision;
  candidate extensions.geography;
  placed integer := 0;
  attempt integer;
  i integer;
begin
  select * into current_game from public.games g where g.id = p_game_id;
  if not found then return 0; end if;
  if not ('dead_drops' = any(current_game.modifiers)) then return 0; end if;

  wanted := coalesce(
    p_count,
    coalesce((current_game.mode_params->'dead_drops'->>'drops')::integer, 6)
  );
  wanted := least(12, greatest(1, wanted));
  spacing_m := coalesce((current_game.mode_params->'dead_drops'->>'spacing_m')::double precision, 150);
  inset_m := coalesce((current_game.mode_params->'dead_drops'->>'inset_m')::double precision, 60);
  inset_m := least(inset_m, greatest(0, current_game.area_radius_m - 30));

  for i in 1..wanted loop
    for attempt in 1..40 loop
      candidate := public.random_area_point(
        current_game.area_center, current_game.area_radius_m, inset_m
      );
      exit when not exists (
        select 1 from public.entities e
        where e.game_id = current_game.id
          and e.kind = 'drop'
          and e.geog is not null
          and extensions.st_distance(e.geog, candidate) < spacing_m
      );
      candidate := null;
    end loop;

    if candidate is not null then
      insert into public.entities (game_id, kind, geog, state, visible_to)
      values (current_game.id, 'drop', candidate, '{}'::jsonb, 'none');
      placed := placed + 1;
    end if;
  end loop;

  return placed;
end;
$$;

revoke all on function public.spawn_drops(uuid, integer) from public, anon, authenticated;

-- advance_game ----------------------------------------------------------------
-- Same clock as v1, plus: spawn drops when the round goes live, and consume a
-- runner's Veil/Decoy on their next scheduled ping.
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
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not public.is_member(advance_game.game_id) then
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

    -- Drops appear with the live round, not in the lobby.
    if 'dead_drops' = any(current_game.modifiers)
       and not exists (
         select 1 from public.entities e
         where e.game_id = current_game.id and e.kind = 'drop'
       ) then
      perform public.spawn_drops(current_game.id, null);
    end if;
  end if;

  if current_game.status = 'live'
     and current_game.next_ping_at is not null
     and now() >= current_game.next_ping_at then
    -- Skip missed rounds instead of replaying a burst of identical snapshots.
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
      -- Veil: skip this ping entirely. The runner is told so the HUD can fade
      -- the effect; hunters are not, so silence is indistinguishable from luck.
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
      if runner.status_detail ? 'decoy' then
        shift_m := 150 + random() * 100;
        ping_geog := extensions.st_project(runner.geog, shift_m, radians(random() * 360));

        -- A decoy must still land inside the play area: pull it back toward the
        -- centre on the same bearing when the shift leaves the circle.
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

        update public.players p
          set status_detail = p.status_detail - 'decoy'
          where p.id = runner.id;
        insert into public.events (game_id, type, audience, payload)
        values (
          current_game.id, 'decoy_used', 'runner',
          jsonb_build_object('player_id', runner.id)
        );
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
          'next_ping_at', current_game.next_ping_at
        )
      );
    end if;
  end if;

  if current_game.status = 'live'
     and current_game.ends_at is not null
     and now() >= current_game.ends_at then
    update public.games g set
      status = 'ended',
      winner = case when g.mode = 'classic_chase' then 'hunters' else 'runners' end,
      end_reason = 'time_expired',
      ended_at = now()
      where g.id = current_game.id
      returning * into current_game;
    insert into public.events (game_id, type, payload) values (
      current_game.id,
      'game_ended',
      jsonb_build_object('winner', current_game.winner, 'reason', 'time_expired')
    );
  end if;

  return current_game.status;
end;
$$;

revoke all on function public.advance_game(uuid) from public, anon;
grant execute on function public.advance_game(uuid) to authenticated;

-- get_my_status --------------------------------------------------------------
-- The owner-only view of secret per-player state: noise bar, item charges and
-- live Veil/Decoy effects. Nothing here is readable for another player.
create or replace function public.get_my_status(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  me public.players%rowtype;
  current_game public.games%rowtype;
  my_noise integer := 0;
  my_smoothed real;
  charges jsonb := '{}'::jsonb;
  cooldowns jsonb := '{}'::jsonb;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into current_game from public.games g where g.id = get_my_status.game_id;
  if not found then raise exception 'Game not found.'; end if;
  select * into me from public.players p
    where p.game_id = get_my_status.game_id
      and p.user_id = caller_id
      and p.status <> 'left';
  if not found then raise exception 'You are not a player in this game.'; end if;

  select pp.noise, pp.smoothed_speed_mps into my_noise, my_smoothed
    from public.player_positions pp where pp.player_id = me.id;
  select pr.charges, pr.cooldowns into charges, cooldowns
    from public.player_resources pr where pr.player_id = me.id;

  return jsonb_build_object(
    'player_id', me.id,
    'team', me.team,
    'status', me.status,
    'noise', coalesce(my_noise, 0),
    'smoothed_speed_mps', my_smoothed,
    'charges', coalesce(charges, '{}'::jsonb),
    'cooldowns', coalesce(cooldowns, '{}'::jsonb),
    'effects', jsonb_build_object(
      'veil', coalesce(me.status_detail ? 'veil', false),
      'decoy', coalesce(me.status_detail ? 'decoy', false)
    ),
    'noise_enabled', 'noise_meter' = any(current_game.modifiers),
    'drops_enabled', 'dead_drops' = any(current_game.modifiers)
  );
end;
$$;

revoke all on function public.get_my_status(uuid) from public, anon;
grant execute on function public.get_my_status(uuid) to authenticated;

-- nearby_drops ---------------------------------------------------------------
-- Drops exist in entities with visible_to 'none'; this RPC is the only reveal,
-- limited to 40 m around the caller's freshest fix.
create or replace function public.nearby_drops(game_id uuid)
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
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into current_game from public.games g where g.id = nearby_drops.game_id;
  if not found then raise exception 'Game not found.'; end if;
  if not public.is_member(nearby_drops.game_id) then
    raise exception 'You are not a member of this game.';
  end if;
  if not ('dead_drops' = any(current_game.modifiers)) or current_game.status <> 'live' then
    return jsonb_build_object('range_m', 40, 'claim_range_m', 15, 'drops', '[]'::jsonb);
  end if;

  select * into me from public.players p
    where p.game_id = nearby_drops.game_id and p.user_id = caller_id and p.status <> 'left';
  select * into my_pos from public.player_positions pp where pp.player_id = me.id;

  if not found or now() - my_pos.recorded_at > interval '30 seconds' then
    return jsonb_build_object(
      'range_m', 40, 'claim_range_m', 15, 'drops', '[]'::jsonb,
      'reason', 'stale_position'
    );
  end if;

  return jsonb_build_object(
    'range_m', 40,
    'claim_range_m', 15,
    'drops', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'longitude', extensions.st_x(e.geog::extensions.geometry),
        'latitude', extensions.st_y(e.geog::extensions.geometry),
        'distance_m', round(extensions.st_distance(e.geog, my_pos.geog)::numeric, 1),
        'claimable', extensions.st_distance(e.geog, my_pos.geog) <= 15
      ) order by extensions.st_distance(e.geog, my_pos.geog))
      from public.entities e
      where e.game_id = current_game.id
        and e.kind = 'drop'
        and e.geog is not null
        and coalesce(e.state->>'claimed_by', '') = ''
        and extensions.st_distance(e.geog, my_pos.geog) <= 40
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.nearby_drops(uuid) from public, anon;
grant execute on function public.nearby_drops(uuid) to authenticated;

-- start_drop_claim -----------------------------------------------------------
-- Records the beginning of a hold so the server, not the phone, decides whether
-- five seconds really passed.
create or replace function public.start_drop_claim(game_id uuid, drop_id uuid)
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
  target_drop public.entities%rowtype;
  last_claim text;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into current_game from public.games g
    where g.id = start_drop_claim.game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then
    raise exception 'Drops can only be claimed while the round is live.';
  end if;
  if not ('dead_drops' = any(current_game.modifiers)) then
    raise exception 'This round has no drops.';
  end if;

  select * into me from public.players p
    where p.game_id = start_drop_claim.game_id and p.user_id = caller_id and p.status <> 'left';
  if not found then raise exception 'You are not a player in this game.'; end if;
  if me.status <> 'active' then raise exception 'Tagged players cannot claim drops.'; end if;

  select * into target_drop from public.entities e
    where e.id = start_drop_claim.drop_id and e.game_id = current_game.id and e.kind = 'drop';
  if not found then raise exception 'Drop not found.'; end if;
  if coalesce(target_drop.state->>'claimed_by', '') <> '' then
    raise exception 'That drop has already been claimed.';
  end if;

  select * into my_pos from public.player_positions pp where pp.player_id = me.id;
  if not found or now() - my_pos.recorded_at > interval '30 seconds' then
    raise exception 'Your position is stale. Wait for a fresh GPS fix.';
  end if;
  if extensions.st_distance(my_pos.geog, target_drop.geog) > 15 then
    raise exception 'Move closer to the drop.';
  end if;

  select pr.cooldowns->>'drop_claim' into last_claim
    from public.player_resources pr where pr.player_id = me.id;
  if last_claim is not null and now() - last_claim::timestamptz < interval '3 minutes' then
    raise exception 'Wait a few minutes before claiming another drop.';
  end if;

  insert into public.drop_claims (game_id, player_id, drop_id, started_at)
  values (current_game.id, me.id, target_drop.id, now())
  on conflict on constraint drop_claims_pkey do update
    set drop_id = excluded.drop_id, started_at = excluded.started_at;

  return jsonb_build_object('drop_id', target_drop.id, 'hold_s', 5, 'started_at', now());
end;
$$;

revoke all on function public.start_drop_claim(uuid, uuid) from public, anon;
grant execute on function public.start_drop_claim(uuid, uuid) to authenticated;

-- claim_drop -----------------------------------------------------------------
create or replace function public.claim_drop(game_id uuid, drop_id uuid)
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
  target_drop public.entities%rowtype;
  claim public.drop_claims%rowtype;
  pool text[];
  item text;
  held_s double precision;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into current_game from public.games g
    where g.id = claim_drop.game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' or not ('dead_drops' = any(current_game.modifiers)) then
    raise exception 'Drops are not available in this phase.';
  end if;

  select * into me from public.players p
    where p.game_id = claim_drop.game_id and p.user_id = caller_id and p.status <> 'left';
  if not found then raise exception 'You are not a player in this game.'; end if;
  if me.status <> 'active' then raise exception 'Tagged players cannot claim drops.'; end if;

  select * into claim from public.drop_claims c
    where c.game_id = claim_drop.game_id and c.player_id = me.id
    for update;
  if not found or claim.drop_id <> claim_drop.drop_id then
    raise exception 'Start the hold again.';
  end if;
  held_s := extract(epoch from (now() - claim.started_at));
  if held_s < 4 then
    raise exception 'Keep holding the drop.';
  end if;
  if held_s > 15 then
    raise exception 'The hold expired. Try again.';
  end if;

  select * into target_drop from public.entities e
    where e.id = claim_drop.drop_id and e.game_id = current_game.id and e.kind = 'drop'
    for update;
  if not found or coalesce(target_drop.state->>'claimed_by', '') <> '' then
    raise exception 'That drop has already been claimed.';
  end if;

  select * into my_pos from public.player_positions pp where pp.player_id = me.id;
  if not found or now() - my_pos.recorded_at > interval '30 seconds'
     or extensions.st_distance(my_pos.geog, target_drop.geog) > 15 then
    raise exception 'Move closer and wait for a fresh GPS fix.';
  end if;

  pool := case me.team
    when 'runner' then array['veil', 'decoy', 'burn']
    else array['free_ping', 'jam', 'sweep']
  end;
  item := pool[1 + floor(random() * array_length(pool, 1))::integer];

  update public.player_resources pr
    set charges = jsonb_set(
      pr.charges,
      array[item],
      to_jsonb(coalesce((pr.charges->>item)::integer, 0) + 1),
      true
    ),
    cooldowns = pr.cooldowns || jsonb_build_object('drop_claim', now())
    where pr.player_id = me.id;

  update public.entities e
    set state = e.state || jsonb_build_object(
      'claimed_by', me.id,
      'claimed_at', now()
    )
    where e.id = target_drop.id;

  delete from public.drop_claims c where c.game_id = current_game.id and c.player_id = me.id;

  insert into public.events (game_id, type, audience, payload)
  values (
    current_game.id, 'drop_claimed', 'all',
    jsonb_build_object('team', me.team)
  );

  insert into public.events (game_id, type, audience, payload, target_player)
  values (
    current_game.id, 'drop_item', 'all',
    jsonb_build_object('item', item),
    me.id
  );

  return jsonb_build_object('success', true, 'item', item, 'team', me.team);
end;
$$;

revoke all on function public.claim_drop(uuid, uuid) from public, anon;
grant execute on function public.claim_drop(uuid, uuid) to authenticated;

-- use_item -------------------------------------------------------------------
create or replace function public.use_item(game_id uuid, item text)
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
  charges jsonb;
  have integer;
  runner_items constant text[] := array['veil', 'decoy', 'burn'];
  hunter_items constant text[] := array['free_ping', 'jam', 'sweep'];
  target_runner public.players%rowtype;
  hunter_pos public.player_positions%rowtype;
  hunter_name text;
  contacts jsonb;
  seq integer;
  cancelled text;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if item is null then raise exception 'Choose an item.'; end if;

  select * into current_game from public.games g
    where g.id = use_item.game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then
    raise exception 'Items can only be used while the round is live.';
  end if;
  if not ('dead_drops' = any(current_game.modifiers)) then
    raise exception 'This round has no items.';
  end if;

  select * into me from public.players p
    where p.game_id = use_item.game_id and p.user_id = caller_id and p.status <> 'left';
  if not found then raise exception 'You are not a player in this game.'; end if;
  if me.status <> 'active' then raise exception 'Tagged players cannot use items.'; end if;
  if me.team = 'runner' and not (item = any(runner_items)) then
    raise exception 'That item is not available to runners.';
  end if;
  if me.team = 'hunter' and not (item = any(hunter_items)) then
    raise exception 'That item is not available to hunters.';
  end if;

  select pr.charges into charges from public.player_resources pr where pr.player_id = me.id;
  have := coalesce((charges->>item)::integer, 0);
  if have < 1 then raise exception 'You do not have that item.'; end if;

  select * into my_pos from public.player_positions pp where pp.player_id = me.id;

  if item = 'veil' then
    if coalesce(me.status_detail ? 'veil', false) then
      raise exception 'Your Veil is already ready.';
    end if;
    update public.players p
      set status_detail = p.status_detail || '{"veil": true}'::jsonb
      where p.id = me.id;
    insert into public.events (game_id, type, audience, payload, target_player)
    values (current_game.id, 'item_used', 'all', jsonb_build_object('item', item), me.id);
    return jsonb_build_object('success', true, 'item', item, 'effect', 'next_ping_skipped');
  end if;

  if item = 'decoy' then
    if coalesce(me.status_detail ? 'decoy', false) then
      raise exception 'Your Decoy is already ready.';
    end if;
    update public.players p
      set status_detail = p.status_detail || '{"decoy": true}'::jsonb
      where p.id = me.id;
    insert into public.events (game_id, type, audience, payload, target_player)
    values (current_game.id, 'item_used', 'all', jsonb_build_object('item', item), me.id);
    return jsonb_build_object('success', true, 'item', item, 'effect', 'next_ping_shifted');
  end if;

  if item = 'burn' then
    if my_pos.geog is null then
      raise exception 'Wait for a GPS fix before using Burn.';
    end if;
    select p.* into target_runner
    from public.players p
    join public.player_positions pp on pp.player_id = p.id
    where p.game_id = current_game.id
      and p.team = 'hunter'
      and p.status = 'active'
      and pp.recorded_at > now() - interval '60 seconds'
    order by extensions.st_distance(pp.geog, my_pos.geog) asc nulls last
    limit 1;
    if not found then raise exception 'No hunter position is available yet.'; end if;
    select * into hunter_pos from public.player_positions pp where pp.player_id = target_runner.id;
    select pr.display_name into hunter_name
      from public.profiles pr where pr.id = target_runner.user_id;

    insert into public.events (game_id, type, audience, payload, target_player)
    values (
      current_game.id, 'burn_reveal', 'all',
      jsonb_build_object(
        'longitude', extensions.st_x(hunter_pos.geog::extensions.geometry),
        'latitude', extensions.st_y(hunter_pos.geog::extensions.geometry),
        'display_name', hunter_name,
        'expires_at', now() + interval '10 seconds'
      ),
      me.id
    );
    return jsonb_build_object(
      'success', true, 'item', item,
      'longitude', extensions.st_x(hunter_pos.geog::extensions.geometry),
      'latitude', extensions.st_y(hunter_pos.geog::extensions.geometry),
      'display_name', hunter_name,
      'expires_at', now() + interval '10 seconds'
    );
  end if;

  if item = 'free_ping' then
    select p.* into target_runner
    from public.players p
    join public.player_positions pp on pp.player_id = p.id
    where p.game_id = current_game.id
      and p.team = 'runner'
      and p.status = 'active'
    order by random()
    limit 1;
    if not found then raise exception 'No runner to ping.'; end if;

    select * into hunter_pos from public.player_positions pp where pp.player_id = target_runner.id;
    update public.games g
      set ping_seq = g.ping_seq + 1
      where g.id = current_game.id
      returning g.ping_seq into seq;
    insert into public.pings (
      game_id, seq, player_id, geog, accuracy_m, position_age_s, reason
    ) values (
      current_game.id, seq, target_runner.id, hunter_pos.geog, hunter_pos.accuracy_m,
      greatest(0, floor(extract(epoch from (now() - hunter_pos.recorded_at)))::integer),
      'item'
    );
    insert into public.events (game_id, type, audience, payload)
    values (current_game.id, 'free_ping', 'hunter', jsonb_build_object('seq', seq));
    return jsonb_build_object('success', true, 'item', item, 'seq', seq);
  end if;

  if item = 'jam' then
    select p.* into target_runner
    from public.players p
    where p.game_id = current_game.id
      and p.team = 'runner'
      and p.status = 'active'
      and (p.status_detail ? 'veil' or p.status_detail ? 'decoy')
    order by random()
    limit 1;
    if not found then raise exception 'No runner has an active effect to jam.'; end if;

    cancelled := case when target_runner.status_detail ? 'veil' then 'veil' else 'decoy' end;
    update public.players p
      set status_detail = p.status_detail - cancelled
      where p.id = target_runner.id;
    insert into public.events (game_id, type, audience, payload, target_player)
    values (
      current_game.id, 'jam', 'all',
      jsonb_build_object('cancelled', cancelled),
      target_runner.id
    );
    return jsonb_build_object('success', true, 'item', item, 'cancelled', cancelled);
  end if;

  if item = 'sweep' then
    if my_pos.geog is null or now() - my_pos.recorded_at > interval '30 seconds' then
      raise exception 'Wait for a fresh GPS fix before sweeping.';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'longitude', round(extensions.st_x(pp.geog::extensions.geometry)::numeric, 3),
      'latitude', round(extensions.st_y(pp.geog::extensions.geometry)::numeric, 3),
      'distance_m', round(extensions.st_distance(pp.geog, my_pos.geog)::numeric, -1)
    )), '[]'::jsonb)
      into contacts
    from public.players p
    join public.player_positions pp on pp.player_id = p.id
    where p.game_id = current_game.id
      and p.team = 'runner'
      and p.status = 'active'
      and pp.recorded_at > now() - interval '60 seconds'
      and extensions.st_distance(pp.geog, my_pos.geog) <= 150;

    if contacts = '[]'::jsonb then
      raise exception 'No runners are close enough to sweep.';
    end if;

    insert into public.events (game_id, type, audience, payload, target_player)
    values (
      current_game.id, 'sweep', 'all',
      jsonb_build_object('contacts', contacts),
      me.id
    );
    return jsonb_build_object('success', true, 'item', item, 'contacts', contacts);
  end if;

  raise exception 'Unknown item.';
end;
$$;

revoke all on function public.use_item(uuid, text) from public, anon;
grant execute on function public.use_item(uuid, text) to authenticated;

-- report_drop ----------------------------------------------------------------
-- Safety valve: report a drop that is somewhere unsafe and the server retires it
-- and places a fresh one elsewhere in the area.
create or replace function public.report_drop(game_id uuid, drop_id uuid)
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
  target_drop public.entities%rowtype;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into current_game from public.games g
    where g.id = report_drop.game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if not ('dead_drops' = any(current_game.modifiers)) then
    raise exception 'This round has no drops.';
  end if;

  select * into me from public.players p
    where p.game_id = report_drop.game_id and p.user_id = caller_id and p.status <> 'left';
  if not found then raise exception 'You are not a player in this game.'; end if;

  select * into target_drop from public.entities e
    where e.id = report_drop.drop_id and e.game_id = current_game.id and e.kind = 'drop'
    for update;
  if not found then raise exception 'Drop not found.'; end if;
  if coalesce(target_drop.state->>'claimed_by', '') <> '' then
    raise exception 'That drop has already been claimed.';
  end if;

  select * into my_pos from public.player_positions pp where pp.player_id = me.id;
  if not found or extensions.st_distance(my_pos.geog, target_drop.geog) > 40 then
    raise exception 'Move closer to report this drop.';
  end if;

  delete from public.entities e where e.id = target_drop.id;

  insert into public.events (game_id, type, audience, payload, target_player)
  values (
    current_game.id, 'drop_reported', 'all',
    jsonb_build_object('drop_id', target_drop.id),
    me.id
  );

  return jsonb_build_object('success', true, 'respawned', public.spawn_drops(current_game.id, 1));
end;
$$;

revoke all on function public.report_drop(uuid, uuid) from public, anon;
grant execute on function public.report_drop(uuid, uuid) to authenticated;
