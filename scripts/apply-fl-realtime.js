const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const envContent = fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8');
const envVars = {};
for (const line of envContent.split(/\r?\n/)) {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    envVars[match[1]] = value.trim();
  }
}

const client = new Client({
  host: 'db.jgpbxsvgpewjvauozrzq.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: envVars.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  const sql = fs.readFileSync(path.resolve(__dirname, '..', 'supabase', 'migrations', '20261121194500_fl_realtime_friendships.sql'), 'utf8');
  await client.query(sql);
  console.log('Migration applied successfully!');
  const res = await client.query("SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'");
  console.log('Updated Realtime tables in supabase_realtime:');
  console.log(res.rows.map(r => r.tablename));
  await client.end();
}

main().catch(console.error);
