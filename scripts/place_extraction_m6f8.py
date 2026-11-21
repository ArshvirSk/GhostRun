import psycopg2

conn = psycopg2.connect('postgresql://postgres:Arrshvirro709GR@db.jgpbxsvgpewjvauozrzq.supabase.co:5432/postgres')
cur = conn.cursor()

cur.execute("""
SELECT id, extensions.st_y(area_center::extensions.geometry), extensions.st_x(area_center::extensions.geometry), area_radius_m 
FROM games 
WHERE code = 'M6F8'
""")
game = cur.fetchone()
print("GAME M6F8:", game)

if game:
    gid, lat, lng, rad = game
    # Insert extraction entity directly
    cur.execute("""
    DELETE FROM entities WHERE game_id = %s AND kind = 'extraction';
    INSERT INTO entities (game_id, kind, geog, state, visible_to)
    VALUES (
      %s,
      'extraction',
      extensions.st_setsrid(extensions.st_makepoint(%s, %s), 4326)::extensions.geography,
      jsonb_build_object('radius_m', 25),
      'all'
    ) RETURNING id;
    """, (gid, gid, lng, lat))
    eid = cur.fetchone()[0]
    conn.commit()
    print("Placed extraction entity for M6F8:", eid)

conn.close()
