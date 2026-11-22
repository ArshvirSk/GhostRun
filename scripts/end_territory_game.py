import psycopg2

conn = psycopg2.connect('postgresql://postgres:Arrshvirro709GR@db.jgpbxsvgpewjvauozrzq.supabase.co:5432/postgres')
cur = conn.cursor()
cur.execute("""
    UPDATE games 
    SET status = 'ended', 
        winner = 'hunters', 
        end_reason = 'sector_dominance' 
    WHERE code = 'RSWU'
""")
conn.commit()
print("Territory Pulse ended rows:", cur.rowcount)
conn.close()
