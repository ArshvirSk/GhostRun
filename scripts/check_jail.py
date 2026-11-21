import psycopg2

conn = psycopg2.connect('postgresql://postgres:Arrshvirro709GR@db.jgpbxsvgpewjvauozrzq.supabase.co:5432/postgres')
cur = conn.cursor()

cur.execute("SELECT proname, prosrc FROM pg_proc WHERE proname = 'set_jail_location'")
proc = cur.fetchone()
print("PROSRC:")
print(proc[1])

cur.execute("""
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'games';
""")
print("\nGAMES COLUMNS:")
for col in cur.fetchall():
    print(col[0], col[1])

cur.execute("""
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public';
""")
print("\nPUBLIC TABLES:")
for tbl in cur.fetchall():
    print(tbl[0])
