-- Fix spawn_ghost_npcs targets table column references
create or replace function public.spawn_ghost_npcs(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  g record;
  ghost_rec record;
  patrol_geom geometry;
  spawn_count int := 0;
  target_count int := 1;
  ghost_idx int := 1;
  v_variant text := 'time_trial';
  v_ghost_team public.team_type := 'hunter';
  v_visible_to text := 'none';
  v_target_pt geometry;
begin
  select * into g from public.games where id = p_game_id;
  if g.id is null then return; end if;

  if g.mode_id = 'ghost_duel' then
    target_count := 1;
    v_variant := coalesce(g.mode_params->'ghost_duel'->>'variant', 'time_trial');
    v_ghost_team := case when v_variant = 'mirror_chase' then 'runner'::public.team_type else 'hunter'::public.team_type end;
    -- In ghost duel, the ghost blip/path is visible on map to all members
    v_visible_to := 'all';
  elsif (g.mode_params->'haunted_map'->>'ghost_count') is not null then
    target_count := greatest(1, least(4, (g.mode_params->'haunted_map'->>'ghost_count')::int));
    v_ghost_team := 'hunter'::public.team_type;
    v_visible_to := 'none';
  else
    target_count := 2;
    v_ghost_team := 'hunter'::public.team_type;
    v_visible_to := 'none';
  end if;

  delete from public.entities where game_id = p_game_id and kind = 'ghost';

  -- 1. Try to find matching real ghosts from ghost_library within area radius + 500m
  for ghost_rec in
    select gl.id, gl.path, gl.duration_s
    from public.ghost_library gl
    where extensions.st_dwithin(gl.area_center, g.area_center, g.area_radius_m + 500)
    order by extensions.st_distance(gl.area_center, g.area_center) asc
    limit target_count
  loop
    patrol_geom := ghost_rec.path::geometry;
    insert into public.entities (
      game_id,
      kind,
      team,
      geog,
      state,
      visible_to
    ) values (
      p_game_id,
      'ghost',
      v_ghost_team,
      extensions.st_startpoint(patrol_geom)::geography,
      jsonb_build_object(
        'ghost_index', ghost_idx,
        'variant', v_variant,
        'path_id', ghost_rec.id,
        'path_wkt', extensions.st_astext(patrol_geom),
        'total_length_m', extensions.st_length(ghost_rec.path),
        'duration_s', ghost_rec.duration_s,
        'speed_mps', 1.3,
        't0', clock_timestamp()
      ),
      v_visible_to
    );
    spawn_count := spawn_count + 1;
    ghost_idx := ghost_idx + 1;
  end loop;

  -- 2. Fall back to synthetic benchmark patrol path if needed
  while spawn_count < target_count loop
    patrol_geom := public.generate_synthetic_patrol_path(g.area_center, g.area_radius_m, (spawn_count * 60.0)::float);
    insert into public.entities (
      game_id,
      kind,
      team,
      geog,
      state,
      visible_to
    ) values (
      p_game_id,
      'ghost',
      v_ghost_team,
      extensions.st_startpoint(patrol_geom)::geography,
      jsonb_build_object(
        'ghost_index', ghost_idx,
        'variant', v_variant,
        'path_id', null,
        'path_wkt', extensions.st_astext(patrol_geom),
        'total_length_m', extensions.st_length(patrol_geom::geography),
        'duration_s', 240,
        'speed_mps', 1.3,
        't0', clock_timestamp()
      ),
      v_visible_to
    );
    spawn_count := spawn_count + 1;
    ghost_idx := ghost_idx + 1;
  end loop;

  -- 3. For Ghost Duel, set course finish target at end of ghost path
  if g.mode_id = 'ghost_duel' and patrol_geom is not null then
    v_target_pt := extensions.st_endpoint(patrol_geom);
    delete from public.entities where game_id = p_game_id and kind = 'target';
    insert into public.entities (
      game_id, kind, geog, state, visible_to
    ) values (
      p_game_id,
      'target',
      v_target_pt::geography,
      jsonb_build_object('radius_m', 20, 'name', 'Finish Line'),
      'all'
    );

    insert into public.targets (game_id, geog, set_by)
    values (
      p_game_id,
      v_target_pt::geography,
      (select p.id from public.players p where p.game_id = p_game_id limit 1)
    )
    on conflict (game_id) do update
      set geog = excluded.geog;
  end if;

  insert into public.events (game_id, type, audience, payload)
  values (
    p_game_id,
    'ghosts_spawned',
    'all',
    jsonb_build_object(
      'count', spawn_count,
      'variant', v_variant,
      'message', case
        when g.mode_id = 'ghost_duel' then 'Ghost Duel begins! Race the ghost to the finish line.'
        else spawn_count || ' ghosts are haunting the map.'
      end
    )
  );
end;
$$;
