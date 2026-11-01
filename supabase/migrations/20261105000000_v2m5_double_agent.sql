-- V2-M5: Double Agent role, abilities, tribunal mechanics, and post-game role reveal.
--
-- MODES.md 5.1:
-- - Server assigns one hunter (random or host-chosen) as 'agent' when the role is on and >=2 hunters.
-- - If only 1 hunter in the game, the role is disabled.
-- - Agent powers (one use each):
--     * Scramble: shifts chosen runner's next scheduled ping 150-250 m, clamped inside boundary.
--     * Whisper: reveals the cardinal quadrant of the runners' target in Classic Chase.
-- - Hunter counter-play (Tribunal): once per game vote.
--     * Eject Agent: bonus ping round for hunters.
--     * Eject Loyal: hunters lose next ping round + accused silenced for 5 minutes.
-- - Secrecy: secret_role is hidden during live play and revealed to everyone post-end.

-- 1. Tribunals table ----------------------------------------------------------
create table if not exists public.tribunals (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  accused_id uuid not null references public.players(id) on delete cascade,
  started_by uuid not null references public.players(id) on delete cascade,
  status text not null default 'voting' check (status in ('voting', 'concluded')),
  outcome text check (outcome in ('ejected', 'dismissed')),
  votes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  concluded_at timestamptz
);

create index if not exists tribunals_game_idx on public.tribunals(game_id);

alter table public.tribunals enable row level security;

drop policy if exists tribunals_hunter_member on public.tribunals;
create policy tribunals_hunter_member on public.tribunals for select to authenticated
  using (public.is_member(game_id) and public.my_team(game_id) = 'hunter');

-- 2. Tribunal evaluation helper -----------------------------------------------
create or replace function public.evaluate_tribunal(tribunal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  t public.tribunals%rowtype;
  current_game public.games%rowtype;
  accused public.players%rowtype;
  active_hunters_count integer;
  yes_votes integer := 0;
  no_votes integer := 0;
  v record;
  runner record;
  ping_count integer := 0;
  was_agent boolean;
begin
  select * into t from public.tribunals where id = tribunal_id for update;
  if not found or t.status <> 'voting' then
    return jsonb_build_object('status', coalesce(t.status, 'concluded'), 'outcome', t.outcome);
  end if;

  select * into current_game from public.games where id = t.game_id for update;
  select * into accused from public.players where id = t.accused_id for update;

  select count(*) into active_hunters_count
  from public.players p
  where p.game_id = current_game.id and p.team = 'hunter' and p.status = 'active';

  for v in select value::boolean as val from jsonb_each(t.votes) loop
    if v.val = true then yes_votes := yes_votes + 1;
    elsif v.val = false then no_votes := no_votes + 1;
    end if;
  end loop;

  -- Majority threshold: strictly greater than half of active hunters
  if yes_votes > (active_hunters_count / 2) then
    was_agent := (accused.secret_role = 'agent');

    update public.players
    set status = 'tagged',
        tagged_at = now()
    where id = accused.id;

    if was_agent then
      -- Bonus ping round for hunters
      current_game.ping_seq := current_game.ping_seq + 1;
      update public.games set ping_seq = current_game.ping_seq where id = current_game.id;

      for runner in
        select p.id, pp.geog, pp.accuracy_m, pp.recorded_at
        from public.players p
        join public.player_positions pp on pp.player_id = p.id
        where p.game_id = current_game.id and p.status = 'active' and p.team = 'runner'
      loop
        insert into public.pings (
          game_id, seq, player_id, geog, accuracy_m, position_age_s, reason, released_at
        ) values (
          current_game.id,
          current_game.ping_seq,
          runner.id,
          runner.geog,
          runner.accuracy_m,
          greatest(0, floor(extract(epoch from (now() - runner.recorded_at)))::integer),
          'scheduled',
          now()
        );
        ping_count := ping_count + 1;
      end loop;

      if ping_count > 0 then
        insert into public.events (game_id, type, payload) values (
          current_game.id,
          'ping_released',
          jsonb_build_object('seq', current_game.ping_seq, 'count', ping_count, 'reason', 'tribunal_bonus')
        );
      end if;
    else
      -- Loyal hunter ejected: delay next ping by 1 interval, silence player for 5 min
      update public.games
      set next_ping_at = next_ping_at + make_interval(secs => ping_interval_s)
      where id = current_game.id;

      update public.players
      set status_detail = jsonb_set(status_detail, '{silenced_until}', to_jsonb(now() + interval '5 minutes'))
      where id = accused.id;
    end if;

    update public.tribunals
    set status = 'concluded', outcome = 'ejected', concluded_at = now()
    where id = t.id;

    insert into public.events (game_id, type, audience, payload) values (
      current_game.id,
      'tribunal_concluded',
      'hunter',
      jsonb_build_object(
        'accused_id', accused.id,
        'ejected', true,
        'was_agent', was_agent
      )
    );

    return jsonb_build_object('status', 'concluded', 'outcome', 'ejected', 'was_agent', was_agent);

  elsif no_votes >= ceil(active_hunters_count / 2.0) and (yes_votes + no_votes) = active_hunters_count then
    -- Acquitted
    update public.tribunals
    set status = 'concluded', outcome = 'dismissed', concluded_at = now()
    where id = t.id;

    insert into public.events (game_id, type, audience, payload) values (
      current_game.id,
      'tribunal_concluded',
      'hunter',
      jsonb_build_object(
        'accused_id', accused.id,
        'ejected', false
      )
    );

    return jsonb_build_object('status', 'concluded', 'outcome', 'dismissed');
  end if;

  return jsonb_build_object('status', 'voting', 'yes_votes', yes_votes, 'no_votes', no_votes);
end;
$$;

revoke all on function public.evaluate_tribunal(uuid) from public, anon;

-- 3. start_tribunal RPC -------------------------------------------------------
create or replace function public.start_tribunal(
  game_id uuid,
  accused_hunter_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  me public.players%rowtype;
  accused public.players%rowtype;
  current_game public.games%rowtype;
  existing_tribunal public.tribunals%rowtype;
  new_tribunal_id uuid;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into current_game from public.games g where g.id = start_tribunal.game_id;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then raise exception 'Tribunal can only be convened during live play.'; end if;
  if not ('double_agent' = any(current_game.roles)) then
    raise exception 'Double Agent role is not active in this game.';
  end if;

  select * into me from public.players p
  where p.game_id = current_game.id and p.user_id = caller_id and p.status <> 'left';
  if not found or me.status <> 'active' or me.team <> 'hunter' then
    raise exception 'Only active hunters can convene a tribunal.';
  end if;

  select * into accused from public.players p
  where p.id = start_tribunal.accused_hunter_id and p.game_id = current_game.id and p.status <> 'left';
  if not found or accused.status <> 'active' or accused.team <> 'hunter' then
    raise exception 'The accused must be an active hunter in this game.';
  end if;
  if accused.id = me.id then
    raise exception 'You cannot accuse yourself.';
  end if;

  -- Once per game rule
  select * into existing_tribunal from public.tribunals t where t.game_id = current_game.id;
  if found then
    raise exception 'Tribunal has already been held in this game.';
  end if;

  -- Create tribunal with caller's vote = true
  insert into public.tribunals (
    game_id, accused_id, started_by, status, votes
  ) values (
    current_game.id,
    accused.id,
    me.id,
    'voting',
    jsonb_build_object(me.id::text, true)
  ) returning id into new_tribunal_id;

  insert into public.events (game_id, type, audience, payload) values (
    current_game.id,
    'tribunal_started',
    'hunter',
    jsonb_build_object(
      'tribunal_id', new_tribunal_id,
      'accused_id', accused.id,
      'started_by', me.id
    )
  );

  return public.evaluate_tribunal(new_tribunal_id);
end;
$$;

revoke all on function public.start_tribunal(uuid, uuid) from public, anon;
grant execute on function public.start_tribunal(uuid, uuid) to authenticated;

-- 4. cast_vote RPC ------------------------------------------------------------
create or replace function public.cast_vote(
  game_id uuid,
  vote boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  me public.players%rowtype;
  current_tribunal public.tribunals%rowtype;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into me from public.players p
  where p.game_id = cast_vote.game_id and p.user_id = caller_id and p.status <> 'left';
  if not found or me.status <> 'active' or me.team <> 'hunter' then
    raise exception 'Only active hunters can vote in the tribunal.';
  end if;

  select * into current_tribunal from public.tribunals t
  where t.game_id = cast_vote.game_id and t.status = 'voting'
  for update;
  if not found then
    raise exception 'No active tribunal voting in progress.';
  end if;

  update public.tribunals t
  set votes = jsonb_set(t.votes, array[me.id::text], to_jsonb(cast_vote.vote))
  where t.id = current_tribunal.id;

  return public.evaluate_tribunal(current_tribunal.id);
end;
$$;

revoke all on function public.cast_vote(uuid, boolean) from public, anon;
grant execute on function public.cast_vote(uuid, boolean) to authenticated;

-- 5. agent_scramble RPC -------------------------------------------------------
create or replace function public.agent_scramble(
  game_id uuid,
  runner_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  me public.players%rowtype;
  target_runner public.players%rowtype;
  current_game public.games%rowtype;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into current_game from public.games g where g.id = agent_scramble.game_id;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then raise exception 'Round must be live.'; end if;

  select * into me from public.players p
  where p.game_id = current_game.id and p.user_id = caller_id and p.status <> 'left';
  if not found or me.status <> 'active' then raise exception 'Active player required.'; end if;
  if me.secret_role is distinct from 'agent' then
    raise exception 'Only the Double Agent can scramble pings.';
  end if;

  if coalesce((me.status_detail->>'scramble_available')::boolean, false) is not true then
    raise exception 'Scramble has already been used.';
  end if;

  select * into target_runner from public.players p
  where p.id = agent_scramble.runner_id
    and p.game_id = current_game.id
    and p.team = 'runner'
    and p.status = 'active';
  if not found then raise exception 'Target must be an active runner in this game.'; end if;

  -- Consume ability on agent
  update public.players
  set status_detail = jsonb_set(status_detail, '{scramble_available}', 'false'::jsonb)
  where id = me.id;

  -- Arm scramble on runner
  update public.players
  set status_detail = jsonb_set(status_detail, '{scramble}', 'true'::jsonb)
  where id = target_runner.id;

  insert into public.events (game_id, type, audience, target_player, payload) values (
    current_game.id,
    'scramble_armed',
    'hunter',
    me.id,
    jsonb_build_object('runner_id', target_runner.id)
  );

  return jsonb_build_object('success', true, 'runner_id', target_runner.id);
end;
$$;

revoke all on function public.agent_scramble(uuid, uuid) from public, anon;
grant execute on function public.agent_scramble(uuid, uuid) to authenticated;

-- 6. agent_whisper RPC --------------------------------------------------------
create or replace function public.agent_whisper(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  me public.players%rowtype;
  current_game public.games%rowtype;
  target_geog extensions.geography;
  azimuth_deg double precision;
  quadrant text;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into current_game from public.games g where g.id = agent_whisper.game_id;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then raise exception 'Round must be live.'; end if;
  if current_game.mode <> 'classic_chase' then
    raise exception 'Whisper is only available in Classic Chase mode.';
  end if;

  select * into me from public.players p
  where p.game_id = current_game.id and p.user_id = caller_id and p.status <> 'left';
  if not found or me.status <> 'active' then raise exception 'Active player required.'; end if;
  if me.secret_role is distinct from 'agent' then
    raise exception 'Only the Double Agent can use Whisper.';
  end if;

  if coalesce((me.status_detail->>'whisper_available')::boolean, false) is not true then
    raise exception 'Whisper has already been used.';
  end if;

  select t.geog into target_geog from public.targets t where t.game_id = current_game.id;
  if target_geog is null then raise exception 'Secret target not set.'; end if;

  azimuth_deg := degrees(extensions.st_azimuth(
    current_game.area_center::extensions.geometry,
    target_geog::extensions.geometry
  ));

  if azimuth_deg >= 315 or azimuth_deg < 45 then
    quadrant := 'North';
  elsif azimuth_deg >= 45 and azimuth_deg < 135 then
    quadrant := 'East';
  elsif azimuth_deg >= 135 and azimuth_deg < 225 then
    quadrant := 'South';
  else
    quadrant := 'West';
  end if;

  update public.players
  set status_detail = jsonb_set(status_detail, '{whisper_available}', 'false'::jsonb)
  where id = me.id;

  insert into public.events (game_id, type, audience, target_player, payload) values (
    current_game.id,
    'whisper_revealed',
    'hunter',
    me.id,
    jsonb_build_object('quadrant', quadrant)
  );

  return jsonb_build_object('quadrant', quadrant);
end;
$$;

revoke all on function public.agent_whisper(uuid) from public, anon;
grant execute on function public.agent_whisper(uuid) to authenticated;

-- 7. advance_game updated: handle scramble ping displacement ------------------
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

    if 'dead_drops' = any(current_game.modifiers)
       and not exists (
         select 1 from public.entities e
         where e.game_id = current_game.id and e.kind = 'drop'
       ) then
      perform public.spawn_drops(current_game.id, null);
    end if;
  end if;

  -- Shrinking Zone: advance stage and announce 60 s before
  if current_game.status = 'live'
     and 'shrinking_zone' = any(current_game.modifiers)
     and current_game.live_at is not null
     and current_game.duration_s > 0 then
    zone_on := true;
    stages := public.zone_stage_values(current_game.id);
    stage_count := array_length(stages, 1);
    progress := greatest(
      0,
      least(1, extract(epoch from (now() - current_game.live_at)) / current_game.duration_s)
    );
    stage_index := public.zone_stage_at(current_game.id, progress);

    if current_game.zone_stage = 0 then
      update public.games g set zone_stage = 1 where g.id = current_game.id
        returning * into current_game;
    elsif stage_index > current_game.zone_stage then
      update public.games g set zone_stage = stage_index where g.id = current_game.id
        returning * into current_game;
      insert into public.events (game_id, type, payload)
      values (
        current_game.id, 'zone_shrunk',
        jsonb_build_object(
          'stage', stage_index,
          'stages', stage_count,
          'percent', stages[stage_index],
          'radius_m', round(current_game.area_radius_m * stages[stage_index] / 100.0)
        )
      );
    end if;

    next_stage := current_game.zone_stage + 1;
    if next_stage <= stage_count and current_game.zone_announced < next_stage then
      next_start := current_game.live_at
        + make_interval(secs => (
            current_game.duration_s * (
              2.0 / 3.0 + (next_stage - 2) * (1.0 / 3.0) / (stage_count - 1)
            )
          )::double precision);
      if now() >= next_start - interval '60 seconds' then
        update public.games g set zone_announced = next_stage where g.id = current_game.id
          returning * into current_game;
        insert into public.events (game_id, type, payload)
        values (
          current_game.id, 'zone_shrink_soon',
          jsonb_build_object(
            'stage', next_stage,
            'stages', stage_count,
            'percent', stages[next_stage],
            'radius_m', round(current_game.area_radius_m * stages[next_stage] / 100.0),
            'at', next_start
          )
        );
      end if;
    end if;
  end if;

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

  if current_game.status in ('countdown', 'head_start', 'live')
     and current_game.ends_at is not null
     and now() >= current_game.ends_at then
    if current_game.mode = 'classic_chase' then
      perform public.end_game(current_game.id, 'time_expired', 'hunter');
    else
      perform public.end_game(current_game.id, 'time_expired', 'runner');
    end if;
    select * into current_game from public.games g where g.id = advance_game.game_id;
  end if;

  return current_game.status;
end;
$$;

revoke all on function public.advance_game(uuid) from public, anon;
grant execute on function public.advance_game(uuid) to authenticated;

-- 8. start_game updated: assign Double Agent when enabled and >=2 hunters ------
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
  hunter_heat_charges integer := 0;
  chosen_agent_id uuid;
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
  if current_game.mode = 'classic_chase' and current_game.status <> 'target_selection' then
    raise exception 'Choose the secret target before starting the round.';
  end if;
  if current_game.mode = 'tag_hunt' and current_game.status <> 'lobby' then
    raise exception 'This game is no longer in the lobby.';
  end if;

  perform public.assert_mode_config(
    current_game.mode_id, current_game.roles, current_game.modifiers
  );

  select count(*) filter (where p.team = 'runner'),
         count(*) filter (where p.team = 'hunter'),
         count(*) filter (where p.team = 'unassigned')
    into active_runners, active_hunters, unassigned
    from public.players p
    where p.game_id = start_game.game_id and p.status = 'active';

  if active_runners = 0 or active_hunters = 0 then
    raise exception 'Assign at least one runner and one hunter before starting.';
  end if;
  if unassigned > 0 then
    raise exception 'Every player must choose a team before the round starts.';
  end if;
  if current_game.mode = 'classic_chase'
     and not exists (select 1 from public.targets t where t.game_id = start_game.game_id) then
    raise exception 'Runners must save the secret target first.';
  end if;

  select count(*) into missing_consent
    from public.players p
    where p.game_id = start_game.game_id and p.status = 'active' and p.share_trail is null;
  if missing_consent > 0 then
    raise exception 'Every player must choose whether to share their route before the round starts.';
  end if;

  -- Double Agent assignment: requires at least 2 active hunters
  if 'double_agent' = any(current_game.roles) then
    if active_hunters >= 2 then
      -- Pick random hunter or host-specified
      select p.id into chosen_agent_id
      from public.players p
      where p.game_id = current_game.id and p.team = 'hunter' and p.status = 'active'
      order by random()
      limit 1;

      update public.players
      set secret_role = 'agent',
          status_detail = jsonb_build_object('scramble_available', true, 'whisper_available', true)
      where id = chosen_agent_id;

      insert into public.events (game_id, type, audience, payload) values (
        start_game.game_id,
        'double_agent_assigned',
        'all',
        jsonb_build_object('active', true)
      );
    else
      insert into public.events (game_id, type, audience, payload) values (
        start_game.game_id,
        'double_agent_disabled',
        'all',
        jsonb_build_object('reason', 'Need at least 2 hunters')
      );
    end if;
  end if;

  countdown_ends := now() + interval '10 seconds';
  live_starts := countdown_ends + make_interval(secs => current_game.head_start_s);

  if 'hot_cold' = any(current_game.modifiers) then
    hunter_heat_charges := coalesce((current_game.mode_params->'hot_cold'->>'heat_charges')::integer, 6);
  end if;

  update public.games g set
    status = 'countdown',
    head_start_at = countdown_ends,
    live_at = live_starts,
    ends_at = live_starts + make_interval(secs => current_game.duration_s),
    next_ping_at = live_starts,
    ping_seq = 0,
    ping_interval_s = case
      when 'hot_cold' = any(g.modifiers) then least(900, g.ping_interval_s * 3)
      else g.ping_interval_s
    end,
    winner = null,
    end_reason = null,
    ended_at = null
  where g.id = start_game.game_id
  returning * into current_game;

  insert into public.player_resources (player_id, game_id)
  select p.id, p.game_id
  from public.players p
  where p.game_id = current_game.id and p.status = 'active'
  on conflict (player_id) do nothing;

  insert into public.team_resources (game_id, team, heat_charges, heat_updated_at)
  values
    (current_game.id, 'runner', 0, now()),
    (current_game.id, 'hunter', hunter_heat_charges, now())
  on conflict on constraint team_resources_pkey do update
    set heat_charges = excluded.heat_charges,
        heat_updated_at = excluded.heat_updated_at;

  insert into public.events (game_id, type, payload) values (
    start_game.game_id,
    'game_started',
    jsonb_build_object(
      'mode', current_game.mode,
      'mode_id', current_game.mode_id,
      'modifiers', to_jsonb(current_game.modifiers),
      'roles', to_jsonb(current_game.roles),
      'head_start_at', current_game.head_start_at,
      'live_at', current_game.live_at,
      'ends_at', current_game.ends_at
    )
  );

  return jsonb_build_object(
    'status', current_game.status,
    'head_start_at', current_game.head_start_at,
    'live_at', current_game.live_at,
    'next_ping_at', current_game.next_ping_at,
    'ends_at', current_game.ends_at
  );
end;
$$;

revoke all on function public.start_game(uuid) from public, anon;
grant execute on function public.start_game(uuid) to authenticated;

-- 9. get_my_status updated: include double agent and tribunal data --------------
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
  hunter_charges integer := null;
  max_charges integer := 6;
  regen_s integer := 30;
  elapsed_s integer;
  tr public.team_resources%rowtype;
  tribunal_row public.tribunals%rowtype;
  tribunal_info jsonb := null;
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

  if me.team = 'hunter' and 'hot_cold' = any(current_game.modifiers) then
    select * into tr from public.team_resources
    where team_resources.game_id = current_game.id and team_resources.team = 'hunter';
    if found then
      max_charges := coalesce((current_game.mode_params->'hot_cold'->>'heat_charges')::integer, 6);
      regen_s := coalesce((current_game.mode_params->'hot_cold'->>'regen_s')::integer, 30);
      elapsed_s := floor(extract(epoch from (now() - tr.heat_updated_at)))::integer;
      hunter_charges := least(max_charges, tr.heat_charges + (elapsed_s / regen_s));
    end if;
  end if;

  if me.team = 'hunter' and 'double_agent' = any(current_game.roles) then
    select * into tribunal_row from public.tribunals t
    where t.game_id = current_game.id and t.status = 'voting';
    if found then
      tribunal_info := jsonb_build_object(
        'tribunal_id', tribunal_row.id,
        'accused_id', tribunal_row.accused_id,
        'started_by', tribunal_row.started_by,
        'my_vote', tribunal_row.votes->(me.id::text)
      );
    end if;
  end if;

  return jsonb_build_object(
    'player_id', me.id,
    'team', me.team,
    'status', me.status,
    'secret_role', me.secret_role,
    'noise', coalesce(my_noise, 0),
    'smoothed_speed_mps', my_smoothed,
    'charges', coalesce(charges, '{}'::jsonb),
    'cooldowns', coalesce(cooldowns, '{}'::jsonb),
    'effects', jsonb_build_object(
      'veil', coalesce(me.status_detail ? 'veil', false),
      'decoy', coalesce(me.status_detail ? 'decoy', false),
      'scramble', coalesce(me.status_detail ? 'scramble', false),
      'silenced', (
        me.status_detail ? 'silenced_until'
        and now() < (me.status_detail->>'silenced_until')::timestamptz
      )
    ),
    'agent_powers', case
      when me.secret_role = 'agent' then jsonb_build_object(
        'scramble_available', coalesce((me.status_detail->>'scramble_available')::boolean, true),
        'whisper_available', coalesce((me.status_detail->>'whisper_available')::boolean, true)
      )
      else null
    end,
    'tribunal', tribunal_info,
    'noise_enabled', 'noise_meter' = any(current_game.modifiers),
    'drops_enabled', 'dead_drops' = any(current_game.modifiers),
    'hot_cold_enabled', 'hot_cold' = any(current_game.modifiers),
    'double_agent_enabled', 'double_agent' = any(current_game.roles),
    'heat_charges', hunter_charges
  );
end;
$$;

revoke all on function public.get_my_status(uuid) from public, anon;
grant execute on function public.get_my_status(uuid) to authenticated;

-- 10. get_game_state updated: post-game role reveal for all players -------------
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
  if not public.is_member(get_game_state.game_id) then
    raise exception 'You are not a member of this game.';
  end if;

  perform public.advance_game(get_game_state.game_id);

  select jsonb_build_object(
    'server_time', now(),
    'game', jsonb_build_object(
      'id', g.id,
      'code', g.code,
      'host_id', g.host_id,
      'mode', g.mode,
      'mode_id', g.mode_id,
      'roles', g.roles,
      'modifiers', g.modifiers,
      'mode_params', g.mode_params,
      'status', g.status,
      'head_start_s', g.head_start_s,
      'duration_s', g.duration_s,
      'ping_interval_s', g.ping_interval_s,
      'tag_radius_m', g.tag_radius_m,
      'target_radius_m', g.target_radius_m,
      'boundary_grace_s', g.boundary_grace_s,
      'boundary_penalty', g.boundary_penalty,
      'head_start_at', g.head_start_at,
      'live_at', g.live_at,
      'ends_at', g.ends_at,
      'next_ping_at', g.next_ping_at,
      'ping_seq', g.ping_seq,
      'winner', g.winner,
      'end_reason', g.end_reason,
      'ended_at', g.ended_at,
      'rematch_game_id', g.rematch_game_id,
      'effective_radius_m', case
        when 'shrinking_zone' = any(g.modifiers) then public.current_effective_radius(g.id)
        else g.area_radius_m
      end
    ),
    'area', jsonb_build_object(
      'lat', extensions.st_y(g.area_center::extensions.geometry),
      'lng', extensions.st_x(g.area_center::extensions.geometry),
      'radius_m', g.area_radius_m
    ),
    'players', (
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'user_id', p.user_id,
          'display_name', coalesce(pr.display_name, 'Player'),
          'color', coalesce(pr.color, '#1D4ED8'),
          'team', p.team,
          'status', p.status,
          'is_ready', p.is_ready,
          'is_remote', p.is_remote,
          -- Secrecy rule: secret_role is visible to the owner during play, and to everyone after game ends
          'secret_role', case
            when g.status = 'ended' or p.user_id = caller_id then p.secret_role
            else null
          end
        ) order by p.joined_at
      )
      from public.players p
      left join public.profiles pr on pr.id = p.user_id
      where p.game_id = g.id and p.status <> 'left'
    ),
    'my_position', (
      select jsonb_build_object(
        'lat', extensions.st_y(pp.geog::extensions.geometry),
        'lng', extensions.st_x(pp.geog::extensions.geometry),
        'accuracy_m', pp.accuracy_m,
        'heading', pp.heading,
        'speed_mps', pp.speed_mps,
        'recorded_at', pp.recorded_at,
        'out_of_bounds_since', pp.out_of_bounds_since
      )
      from public.player_positions pp
      join public.players p on p.id = pp.player_id
      where pp.game_id = g.id and p.user_id = caller_id
    ),
    'team_positions', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'player_id', pp.player_id,
            'lat', extensions.st_y(pp.geog::extensions.geometry),
            'lng', extensions.st_x(pp.geog::extensions.geometry),
            'heading', pp.heading,
            'speed_mps', pp.speed_mps,
            'recorded_at', pp.recorded_at
          )
        ),
        '[]'::jsonb
      )
      from public.player_positions pp
      join public.players p on p.id = pp.player_id
      where pp.game_id = g.id
        and p.user_id <> caller_id
        and p.status <> 'left'
        and (
          p.team = public.my_team(g.id)
          or g.status = 'ended'
        )
    ),
    'pings', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', pi.id,
            'seq', pi.seq,
            'player_id', pi.player_id,
            'lat', case when pi.geog is not null then extensions.st_y(pi.geog::extensions.geometry) end,
            'lng', case when pi.geog is not null then extensions.st_x(pi.geog::extensions.geometry) end,
            'accuracy_m', pi.accuracy_m,
            'position_age_s', pi.position_age_s,
            'reason', pi.reason,
            'released_at', pi.released_at
          ) order by pi.seq asc
        ),
        '[]'::jsonb
      )
      from (
        select * from public.pings
        where game_id = g.id
          and released_at >= now() - interval '10 seconds'
        order by seq desc
        limit 100
      ) pi
    ),
    'heat_marks', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', hpf.id,
            'lat', hpf.lat,
            'lng', hpf.lng,
            'result', hpf.result,
            'heat_radius_m', hpf.heat_radius_m,
            'pressed_at', hpf.pressed_at
          ) order by hpf.pressed_at asc
        ),
        '[]'::jsonb
      )
      from public.heat_press_feed hpf
      where hpf.game_id = g.id
    ),
    'target', case
      when public.my_team(g.id) = 'runner' or g.status = 'ended' then (
        select jsonb_build_object(
          'lat', extensions.st_y(t.geog::extensions.geometry),
          'lng', extensions.st_x(t.geog::extensions.geometry),
          'set_at', t.set_at
        )
        from public.targets t
        where t.game_id = g.id
      )
      else null
    end,
    'events', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', ev.id,
            'type', ev.type,
            'audience', ev.audience,
            'payload', ev.payload,
            'created_at', ev.created_at
          ) order by ev.created_at asc
        ),
        '[]'::jsonb
      )
      from (
        select * from public.events
        where game_id = g.id
          and (
            audience = 'all'
            or (audience = 'runner' and public.my_team(g.id) = 'runner')
            or (audience = 'hunter' and public.my_team(g.id) = 'hunter')
          )
          and (
            target_player is null
            or target_player = (
              select id from public.players where game_id = g.id and user_id = caller_id
            )
          )
        order by created_at desc
        limit 50
      ) ev
    )
  ) into snapshot
  from public.games g
  where g.id = get_game_state.game_id;

  return snapshot;
end;
$$;

revoke all on function public.get_game_state(uuid) from public, anon;
grant execute on function public.get_game_state(uuid) to authenticated;

-- 11. Activate feature flag ---------------------------------------------------
insert into public.app_settings (key, value) values
  ('feature.role.double_agent', 'true'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();
