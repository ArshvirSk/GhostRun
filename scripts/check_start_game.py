import psycopg2

conn = psycopg2.connect('postgresql://postgres:Arrshvirro709GR@db.jgpbxsvgpewjvauozrzq.supabase.co:5432/postgres')
cur = conn.cursor()
cur.execute("SELECT prosrc FROM pg_proc WHERE proname = 'start_game'")
src = cur.fetchone()[0]
idx = src.find("extraction")
print(src[idx-100:idx+400])
conn.close()
