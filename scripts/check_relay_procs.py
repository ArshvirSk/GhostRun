import psycopg2

conn = psycopg2.connect('postgresql://postgres:Arrshvirro709GR@db.jgpbxsvgpewjvauozrzq.supabase.co:5432/postgres')
cur = conn.cursor()
cur.execute("SELECT proname FROM pg_proc WHERE proname LIKE '%relay%' OR proname LIKE '%package%' OR proname LIKE '%extract%'")
for r in cur.fetchall():
    print("PROC:", r[0])
conn.close()
