import psycopg2

conn = psycopg2.connect('postgresql://postgres:Arrshvirro709GR@db.jgpbxsvgpewjvauozrzq.supabase.co:5432/postgres')
cur = conn.cursor()
cur.execute("SELECT public.end_game('1440aab8-7c3e-4209-b3c3-38529ca11fa0', 'runners', 'package_extracted')")
conn.commit()
print("Game M6F8 ended with runners victory!")
conn.close()
