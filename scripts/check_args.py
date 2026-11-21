import psycopg2

conn = psycopg2.connect('postgresql://postgres:Arrshvirro709GR@db.jgpbxsvgpewjvauozrzq.supabase.co:5432/postgres')
cur = conn.cursor()
cur.execute("""
SELECT proname, proargnames
FROM pg_proc 
WHERE proname IN ('set_extraction_location', 'set_target', 'set_jail_location');
""")
for r in cur.fetchall():
    print(r)
