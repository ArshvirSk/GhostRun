import psycopg2

conn = psycopg2.connect('postgresql://postgres:Arrshvirro709GR@db.jgpbxsvgpewjvauozrzq.supabase.co:5432/postgres')
cur = conn.cursor()

cur.execute("SELECT prosrc FROM pg_proc WHERE proname = 'get_game_state'")
proc = cur.fetchone()
print("GET_GAME_STATE:")
print(proc[0])
