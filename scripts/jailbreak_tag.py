import psycopg2

conn = psycopg2.connect('postgresql://postgres:Arrshvirro709GR@db.jgpbxsvgpewjvauozrzq.supabase.co:5432/postgres')
cur = conn.cursor()

# Get game, hunter player id, runner player id
cur.execute("""
SELECT g.id, 
       (SELECT p.id FROM players p WHERE p.game_id = g.id AND p.team = 'hunter' LIMIT 1),
       (SELECT p.id FROM players p WHERE p.game_id = g.id AND p.team = 'runner' LIMIT 1)
FROM games g 
WHERE g.code = 'X2HD';
""")
row = cur.fetchone()
print("TAG PARAMS:", row)

gid, hunter_pid, runner_pid = row
cur.execute("SELECT public.apply_tag(%s, %s, %s, 8.5)", (gid, hunter_pid, runner_pid))
res = cur.fetchone()
conn.commit()
print("APPLY TAG RESULT:", res)

conn.close()
