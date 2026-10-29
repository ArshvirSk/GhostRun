-- Corrects set_target: `on conflict (game_id)` was parsed as the function's own
-- parameter and raised "column reference game_id is ambiguous", so runners could
-- never save a target. Named as a constraint it resolves to the primary key.
create or replace function public.set_target(game_id uuid, lat double precision, lng double precision)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  caller_player public.players%rowtype;
  current_game public.games%rowtype;
  point geography;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into caller_player from public.players p
    where p.game_id = set_target.game_id and p.user_id = caller_id and p.status <> 'left';
  if not found or caller_player.team <> 'runner' then
    raise exception 'Only runners can choose the secret target.';
  end if;
  select * into current_game from public.games g where g.id = set_target.game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.mode <> 'classic_chase' then
    raise exception 'This game mode has no target.';
  end if;
  if current_game.status not in ('lobby', 'target_selection') then
    raise exception 'The target is locked once the round starts.';
  end if;
  if set_target.lat not between -90 and 90 or set_target.lng not between -180 and 180 then
    raise exception 'Target coordinates are invalid.';
  end if;

  point := extensions.st_setsrid(extensions.st_makepoint(set_target.lng, set_target.lat), 4326)::extensions.geography;
  if extensions.st_distance(point, current_game.area_center) > current_game.area_radius_m then
    raise exception 'The target must be inside the play area.';
  end if;

  insert into public.targets (game_id, geog, set_by, set_at)
  values (set_target.game_id, point, caller_player.id, now())
  on conflict on constraint targets_pkey do update
    set geog = excluded.geog, set_by = excluded.set_by, set_at = excluded.set_at;

  insert into public.events (game_id, type, audience) values (set_target.game_id, 'target_set', 'runner');

  return jsonb_build_object('longitude', set_target.lng, 'latitude', set_target.lat);
end;
$$;

revoke all on function public.set_target(uuid, double precision, double precision) from public, anon;
grant execute on function public.set_target(uuid, double precision, double precision) to authenticated;
