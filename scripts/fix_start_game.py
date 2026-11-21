import psycopg2

conn = psycopg2.connect('postgresql://postgres:Arrshvirro709GR@db.jgpbxsvgpewjvauozrzq.supabase.co:5432/postgres')
cur = conn.cursor()

# 1. Update set_target
cur.execute("""
CREATE OR REPLACE FUNCTION public.set_target(game_id uuid, lat double precision, lng double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
declare
  caller_id uuid := auth.uid();
  caller_player public.players%rowtype;
  current_game public.games%rowtype;
  point geography;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into current_game from public.games g where g.id = set_target.game_id for update;
  if not found then raise exception 'Game not found.'; end if;

  select * into caller_player from public.players p
    where p.game_id = set_target.game_id and p.user_id = caller_id and p.status <> 'left';
  
  if (caller_player.team <> 'runner' and current_game.host_id <> caller_id) then
    raise exception 'Only runners or host can choose the secret target.';
  end if;

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
  values (set_target.game_id, point, coalesce(caller_player.id, (select id from public.players where game_id = set_target.game_id limit 1)), now())
  on conflict on constraint targets_pkey do update
    set geog = excluded.geog, set_by = excluded.set_by, set_at = excluded.set_at;

  insert into public.events (game_id, type, audience) values (set_target.game_id, 'target_set', 'runner');

  return jsonb_build_object('longitude', set_target.lng, 'latitude', set_target.lat);
end;
$$;
""")
print('set_target updated!')

# 2. Update start_game
cur.execute("SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'start_game';")
defn = cur.fetchone()[0]
defn = defn.replace('\r\n', '\n')

old_check = "  if current_game.mode_id = 'classic_chase' and current_game.status <> 'target_selection' then\n    raise exception 'Choose the secret target before starting the round.';\n  end if;"
new_check = "  -- Target requirement verified below via exists (select 1 from public.targets)"

if old_check in defn:
    defn = defn.replace(old_check, new_check)
    cur.execute(defn)
    print('start_game updated successfully!')
else:
    print('Pattern not matched in start_game!')
    # Print lines around classic_chase
    for l in defn.splitlines():
        if 'classic_chase' in l:
            print('MATCHED LINE:', repr(l))

conn.commit()
conn.close()
