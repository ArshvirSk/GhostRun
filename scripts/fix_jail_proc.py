import psycopg2

conn = psycopg2.connect('postgresql://postgres:Arrshvirro709GR@db.jgpbxsvgpewjvauozrzq.supabase.co:5432/postgres')
cur = conn.cursor()

# Drop existing overloads first
cur.execute("DROP FUNCTION IF EXISTS public.set_jail_location(uuid, double precision, double precision, integer);")
cur.execute("DROP FUNCTION IF EXISTS public.set_jail_location(uuid, double precision, double precision);")

sql = """
CREATE OR REPLACE FUNCTION public.set_jail_location(
  game_id uuid,
  lat double precision,
  lng double precision,
  radius_m integer DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  jail_geog extensions.geography;
  v_jail_radius_m integer;
  v_jail_id uuid;
begin
  select * into current_game from public.games g
    where g.id = set_jail_location.game_id
    for update;
  if not found then raise exception 'Game not found.'; end if;
  if caller_id is not null and current_game.host_id <> caller_id then
    raise exception 'Only the host can place the jail.';
  end if;
  if current_game.status not in ('lobby', 'target_selection') then
    raise exception 'The jail can only be placed before the round starts.';
  end if;
  if current_game.mode_id <> 'jailbreak' then
    raise exception 'This game is not in Jailbreak mode.';
  end if;
  if lat is null or lng is null or lat not between -90 and 90 or lng not between -180 and 180 then
    raise exception 'Invalid coordinates for jail location.';
  end if;

  jail_geog := extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography;

  if extensions.st_distance(jail_geog, current_game.area_center) > current_game.area_radius_m then
    raise exception 'The jail must be placed inside the play area.';
  end if;

  v_jail_radius_m := coalesce(radius_m, (current_game.mode_params->'jailbreak'->>'jail_radius_m')::integer, 15);

  -- Replace any existing jail entity for this game
  delete from public.entities e
    where e.game_id = current_game.id and e.kind = 'jail';

  insert into public.entities (game_id, kind, geog, visible_to, state)
  values (
    current_game.id,
    'jail',
    jail_geog,
    'all',
    jsonb_build_object('radius_m', v_jail_radius_m)
  )
  returning id into v_jail_id;

  insert into public.events (game_id, type, audience, payload)
  values (
    current_game.id,
    'jail_placed',
    'all',
    jsonb_build_object(
      'jail_id', v_jail_id,
      'latitude', lat,
      'longitude', lng,
      'radius_m', v_jail_radius_m
    )
  );

  return jsonb_build_object(
    'success', true,
    'jail_id', v_jail_id,
    'latitude', lat,
    'longitude', lng,
    'radius_m', v_jail_radius_m
  );
end;
$$;
"""

cur.execute(sql)
conn.commit()
print("Clean set_jail_location created!")

# Place jail for game X2HD
cur.execute("SELECT id, extensions.st_y(area_center::extensions.geometry), extensions.st_x(area_center::extensions.geometry) FROM games WHERE code = 'X2HD'")
g = cur.fetchone()
if g:
    gid, lat, lng = g
    cur.execute("SELECT public.set_jail_location(%s::uuid, %s::double precision, %s::double precision)", (gid, float(lat), float(lng)))
    res = cur.fetchone()
    conn.commit()
    print("Placed result:", res)

conn.close()
