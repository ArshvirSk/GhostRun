import psycopg2

conn = psycopg2.connect('postgresql://postgres:Arrshvirro709GR@db.jgpbxsvgpewjvauozrzq.supabase.co:5432/postgres')
cur = conn.cursor()
cur.execute("SELECT prosrc FROM pg_proc WHERE proname = 'set_extraction_location'")
print(cur.fetchone()[0])
conn.close()
