-- V2-M2: enforce the 10-second radar window on the server (approved C-5).
-- The client already fades pings after 10 s; now a modified client cannot keep
-- reading old ping rows from the live snapshot either. Ended rounds still return
-- the history the recap needs, and get_game_replay is unchanged.

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
        'radius_m', g.area_radius_m
      ),
      'target_set', exists (select 1 from public.targets t where t.game_id = g.id)
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'user_id', p.user_id, 'display_name', pr.display_name, 'color', pr.color,
        'team', p.team, 'status', p.status, 'is_ready', p.is_ready, 'joined_at', p.joined_at
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
        and (g.status = 'ended' or p.id = mine.id or p.team = mine.team)
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
          and (g.status = 'ended' or pings.released_at >= now() - interval '10 seconds')
        order by released_at desc, id desc limit 100
      ) ping
    ), '[]'::jsonb),
    'target', case when mine.team = 'runner' or g.status = 'ended' then (
      select jsonb_build_object(
        'longitude', extensions.st_x(t.geog::extensions.geometry),
        'latitude', extensions.st_y(t.geog::extensions.geometry)
      )
      from public.targets t where t.game_id = g.id
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
