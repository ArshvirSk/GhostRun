-- Migration: 20261116004000_b8_fix_get_game_state_color.sql
-- Fix get_game_state: reference pr.color instead of non-existent p.color

create or replace function public.get_game_state(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
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
