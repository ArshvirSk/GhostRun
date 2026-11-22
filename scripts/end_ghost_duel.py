import psycopg2

conn = psycopg2.connect('postgresql://postgres:Arrshvirro709GR@db.jgpbxsvgpewjvauozrzq.supabase.co:5432/postgres')
cur = conn.cursor()
cur.execute("""
    UPDATE games 
    SET status = 'ended', 
        winner = 'runners', 
        end_reason = 'beat_ghost' 
    WHERE code = '7ZVN'
""")
conn.commit()
print("Ghost Duel ended rows:", cur.rowcount)
conn.close()
