-- Migration: 20261110010000_b2_canonical_get_game_state.sql
-- Full canonical get_game_state returning all required fields (events, heat_marks, heat_charges, complete pings) + assassin_ring

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
  if not public.is_member(get_game_state.game_id) then raise exception 'You are not a member of this game.'; end if;

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
        'player_id', ping.player_id,
        'longitude', extensions.st_x(ping.geog::extensions.geometry),
        'latitude', extensions.st_y(ping.geog::extensions.geometry),
        'position_age_s', ping.position_age_s,
        'reason', ping.reason,
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
          select count(*) from public.players sp where sp.game_id = g.id and sp.status = 'active'
        )
      )
      else null
    end,
    'target', case
      when mine.team = 'runner' or g.status in ('ended', 'cancelled') then (
        select jsonb_build_object(
          'longitude', extensions.st_x(t.geog::extensions.geometry),
          'latitude', extensions.st_y(t.geog::extensions.geometry)
        )
        from public.targets t where t.game_id = g.id
      )
      else null
    end,
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
        select * from public.events ev
        where ev.game_id = g.id
          and (
            (ev.target_player is null and (ev.audience = 'all' or ev.audience = mine.team::text))
            or ev.target_player = mine.id
          )
        order by ev.id desc limit 50
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
