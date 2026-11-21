import psycopg2

conn = psycopg2.connect('postgresql://postgres:Arrshvirro709GR@db.jgpbxsvgpewjvauozrzq.supabase.co:5432/postgres')
cur = conn.cursor()
cur.execute("SELECT id, code, mode_id, area_center, area_radius_m FROM games WHERE code = 'X2HD'")
game = cur.fetchone()
print("GAME X2HD:", game)

if game:
    game_id = game[0]
    cur.execute("SELECT id, kind, state, extensions.st_astext(geog::extensions.geometry) FROM entities WHERE game_id = %s", (game_id,))
    entities = cur.fetchall()
    print("ENTITIES:", entities)
