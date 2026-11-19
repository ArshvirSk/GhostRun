import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

async function main() {
  const sqlPath = path.resolve(__dirname, '../supabase/migrations/20261120090000_fl_p8_standardize_codenames_and_search.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const client = new Client({
    connectionString: 'postgresql://postgres:Arrshvirro709GR@db.jgpbxsvgpewjvauozrzq.supabase.co:5432/postgres',
    ssl: { rejectUnauthorized: false },
  });

  console.log('Connecting to Supabase...');
  await client.connect();

  console.log('Applying migration 20261120090000_fl_p8_standardize_codenames_and_search.sql...');
  await client.query(sql);

  console.log('Verifying updated profiles:');
  const res = await client.query('SELECT id, display_name, handle FROM public.profiles ORDER BY created_at DESC;');
  console.log(res.rows);

  await client.end();
  console.log('Migration applied and verified successfully!');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
