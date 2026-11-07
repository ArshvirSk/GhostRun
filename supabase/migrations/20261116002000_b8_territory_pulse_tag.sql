-- Migration: 20261116002000_b8_territory_pulse_tag.sql
-- Phase B Milestone B8: Territory Pulse contest tag support in apply_tag and attempt_tag

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
  hunter_player public.players%rowtype;
  target_runner public.players%rowtype;
  remaining_runners integer;
  hunter_name text;
  runner_name text;
  is_jailbreak boolean;
  is_assassin boolean;
  is_relay boolean;
  is_territory boolean;
  v_next_prey_id uuid;
  active_survivors integer;
begin
  select * into current_game from public.games g
    where g.id = p_game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;

  select * into hunter_player from public.players where id = p_hunter_id and game_id = p_game_id;
  if not found then raise exception 'Hunter not found in this game.'; end if;

  -- Remote Operator immunity & restriction
  if coalesce(hunter_player.is_remote, false) then
    raise exception 'Remote Operators cannot execute tags.';
  end if;

  select * into target_runner from public.players p
    where p.id = p_runner_id and p.game_id = p_game_id and p.status = 'active'
    for update;
  if not found then raise exception 'Runner is not an active player in this game.'; end if;

  if coalesce(target_runner.is_remote, false) then
    raise exception 'Remote Operators are immune to physical tags.';
  end if;

  select display_name into hunter_name from public.profiles where id = hunter_player.user_id;
  select display_name into runner_name from public.profiles where id = target_runner.user_id;

  -- Successful tag: clear any failed-tag cooldown from hunter
  update public.players p set last_tag_attempt_at = null where p.id = p_hunter_id;

  is_jailbreak := (current_game.mode_id = 'jailbreak');
  is_assassin := (current_game.mode_id = 'assassin_ring');
  is_relay := (current_game.mode_id = 'relay_heist');
  is_territory := (current_game.mode_id = 'territory_pulse');

  -- Relay Heist package carrier check
  if is_relay then
    if exists (
      select 1 from public.entities e
      where e.game_id = p_game_id and e.kind = 'package'
        and (e.state->>'carrier_player_id') = target_runner.id::text
        and (e.state->>'status') = 'carried'
    ) then
      update public.entities e
      set state = jsonb_build_object(
            'carrier_player_id', null,
            'status', 'dropped',
            'dropped_at', now(),
            'securing_hunter_id', null,
            'securing_started_at', null
          ),
          visible_to = 'all'
      where e.game_id = p_game_id and e.kind = 'package';

      insert into public.events (game_id, type, audience, payload)
      values (
        p_game_id, 'package_dropped', 'all',
        jsonb_build_object(
          'carrier_player_id', target_runner.id,
          'carrier_name', runner_name,
          'hunter_id', p_hunter_id,
          'hunter_name', hunter_name,
          'message', runner_name || ' was tagged and dropped the package!'
        )
      );
    end if;
  end if;

  -- VIP Escort check
  if 'vip' = any(current_game.roles) and target_runner.secret_role is not null then
    if target_runner.secret_role = 'vip' then
      update public.players p
        set status = 'tagged',
            tagged_at = now(),
            is_ready = false
        where p.id = target_runner.id;

      insert into public.tags (game_id, hunter_id, runner_id, distance_m)
      values (p_game_id, p_hunter_id, target_runner.id, p_distance_m);

      insert into public.events (game_id, type, audience, payload)
      values (
        p_game_id, 'vip_eliminated', 'all',
        jsonb_build_object(
          'vip_id', target_runner.id,
          'vip_name', runner_name,
          'hunter_id', p_hunter_id,
          'hunter_name', hunter_name,
          'message', 'The VIP has been eliminated! Hunters win!'
        )
      );

      perform public.end_game(p_game_id, 'hunters', 'vip_eliminated');
      select * into current_game from public.games g where g.id = p_game_id;

      return jsonb_build_object(
        'success', true,
        'runner_id', target_runner.id,
        'phase', current_game.status,
        'winner', current_game.winner,
        'end_reason', current_game.end_reason
      );

    elsif target_runner.secret_role = 'bodyguard' then
      if target_runner.status_detail->>'frozen_until' is not null and
         (target_runner.status_detail->>'frozen_until')::timestamptz > now() then
        raise exception 'already_frozen';
      end if;

      update public.players p
      set status_detail = coalesce(p.status_detail, '{}'::jsonb) ||
                          jsonb_build_object('frozen_until', (now() + interval '60 seconds'))
      where p.id = target_runner.id;

      insert into public.tags (game_id, hunter_id, runner_id, distance_m)
      values (p_game_id, p_hunter_id, target_runner.id, p_distance_m);

      insert into public.events (game_id, type, audience, payload)
      values (
        p_game_id, 'bodyguard_frozen', 'all',
        jsonb_build_object(
          'bodyguard_id', target_runner.id,
          'bodyguard_name', runner_name,
          'hunter_id', p_hunter_id,
          'hunter_name', hunter_name,
          'frozen_seconds', 60,
          'message', runner_name || ' is a bodyguard! Frozen for 60 seconds.'
        )
      );

      return jsonb_build_object(
        'success', true,
        'runner_id', target_runner.id,
        'phase', current_game.status,
        'frozen', true,
        'frozen_seconds', 60
      );
    end if;
  end if;

  -- Record tag in tags table
  insert into public.tags (game_id, hunter_id, runner_id, distance_m)
  values (p_game_id, p_hunter_id, target_runner.id, p_distance_m);

  if is_territory then
    -- Territory Pulse: contest tag incapacitates player from zone presence for 60 seconds
    update public.players p
    set status_detail = coalesce(p.status_detail, '{}'::jsonb) ||
                        jsonb_build_object('incapacitated_until', (now() + interval '60 seconds'))
    where p.id = target_runner.id;

    insert into public.events (game_id, type, audience, payload)
    values (
      p_game_id, 'contest_tag', 'all',
      jsonb_build_object(
        'runner_id', target_runner.id,
        'runner_name', runner_name,
        'hunter_id', p_hunter_id,
        'hunter_name', hunter_name,
        'incapacitated_seconds', 60,
        'message', runner_name || ' was tagged and incapacitated from sector presence for 60s!'
      )
    );

    return jsonb_build_object(
      'success', true,
      'runner_id', target_runner.id,
      'phase', current_game.status,
      'incapacitated', true,
      'incapacitated_seconds', 60
    );

  elsif is_assassin then
    update public.players p
      set status = 'tagged',
          tagged_at = now(),
          is_ready = false
      where p.id = target_runner.id;

    update public.ring_assignments ra
      set status = 'eliminated', eliminated_at = now()
      where ra.game_id = p_game_id and ra.prey_player_id = target_runner.id and ra.status = 'active';

    select ra.prey_player_id into v_next_prey_id
    from public.ring_assignments ra
    where ra.game_id = p_game_id and ra.hunter_player_id = target_runner.id and ra.status = 'active';

    update public.ring_assignments ra
      set status = 'relinked'
      where ra.game_id = p_game_id and ra.hunter_player_id = target_runner.id and ra.status = 'active';

    if v_next_prey_id is not null and v_next_prey_id <> p_hunter_id then
      update public.ring_assignments ra
        set status = 'relinked'
        where ra.game_id = p_game_id and ra.hunter_player_id = p_hunter_id and ra.status = 'active';

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

    select count(*) into active_survivors
      from public.players sp
      where sp.game_id = p_game_id and sp.status = 'active';

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
        'runner_name', runner_name,
        'hunter_id', p_hunter_id,
        'hunter_name', hunter_name,
        'distance_m', round(p_distance_m::numeric, 1)
      )
    );

    select count(*) into remaining_runners
      from public.players p
      where p.game_id = p_game_id
        and p.team = 'runner'
        and p.status = 'active'
        and not p.is_remote;

    if remaining_runners = 0 then
      perform public.end_game(p_game_id, 'hunters', 'all_jailed');
    end if;

  else
    -- Standard Classic / Tag Hunt elimination
    update public.players p
      set status = 'tagged',
          tagged_at = now(),
          is_ready = false
      where p.id = target_runner.id;

    insert into public.events (game_id, type, target_player, audience, payload)
    values (
      p_game_id, 'player_tagged', target_runner.id, 'all',
      jsonb_build_object(
        'runner_id', target_runner.id,
        'runner_name', runner_name,
        'hunter_id', p_hunter_id,
        'hunter_name', hunter_name,
        'distance_m', round(p_distance_m::numeric, 1)
      )
    );

    select count(*) into remaining_runners
      from public.players p
      where p.game_id = p_game_id
        and p.team = 'runner'
        and p.status = 'active'
        and not p.is_remote;

    if remaining_runners = 0 then
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

revoke all on function public.apply_tag(uuid, uuid, uuid, double precision) from public, anon;
grant execute on function public.apply_tag(uuid, uuid, uuid, double precision) to authenticated;
