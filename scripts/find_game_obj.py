import psycopg2

conn = psycopg2.connect('postgresql://postgres:Arrshvirro709GR@db.jgpbxsvgpewjvauozrzq.supabase.co:5432/postgres')
cur = conn.cursor()
cur.execute("SELECT prosrc FROM pg_proc WHERE proname = 'get_game_state'")
src = cur.fetchone()[0]
idx = src.find("'game',")
print(src[idx+1000:idx+2500])
