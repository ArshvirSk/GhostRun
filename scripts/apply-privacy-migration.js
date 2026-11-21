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
  console.log('Connected to PostgreSQL.');

  const sqlPath = path.resolve(__dirname, '..', 'supabase', 'migrations', '20261121200000_fl_privacy_defaults_on.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await client.query(sql);
  console.log('Migration 20261121200000_fl_privacy_defaults_on.sql executed successfully.');

  const profiles = await client.query('SELECT id, display_name, show_presence, allow_friend_requests, share_echo, profile_visibility FROM public.profiles ORDER BY created_at ASC');
  console.log('Updated profiles:');
  console.table(profiles.rows);

  const consents = await client.query('SELECT user_id, consent_type, granted, policy_version FROM public.consents ORDER BY user_id, consent_type');
  console.log('Consents table records:');
  console.table(consents.rows);

  await client.end();
}

main().catch(err => {
  console.error('Error applying migration:', err);
  process.exit(1);
});
