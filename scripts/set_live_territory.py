import psycopg2

conn = psycopg2.connect('postgresql://postgres:Arrshvirro709GR@db.jgpbxsvgpewjvauozrzq.supabase.co:5432/postgres')
cur = conn.cursor()
cur.execute("""
    UPDATE games 
    SET status = 'live', 
        live_at = clock_timestamp() - interval '5 seconds'
    WHERE code = 'RSWU'
""")
conn.commit()
print("Territory Pulse live rows:", cur.rowcount)
conn.close()
