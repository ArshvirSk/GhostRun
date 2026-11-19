import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const client = new Client({
    host: 'db.jgpbxsvgpewjvauozrzq.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.SUPABASE_DB_PASSWORD || 'Arrshvirro709GR',
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to Supabase PostgreSQL database.');

  const sqlPath = path.join(__dirname, '../supabase/migrations/20261119070000_fl_p6_real_metrics_and_badge_triggers.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Applying migration 20261119070000_fl_p6_real_metrics_and_badge_triggers.sql...');
  await client.query(sql);

  console.log('Migration applied successfully!');
  await client.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
