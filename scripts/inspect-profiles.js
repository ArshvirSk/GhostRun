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
  const cols = await client.query("SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'profiles'");
  console.log('Profiles columns:', cols.rows);
  const users = await client.query('SELECT id, display_name, show_presence, allow_friend_requests, share_echo, profile_visibility FROM public.profiles');
  console.log('Profiles rows (' + users.rows.length + '):', users.rows);
  const consents = await client.query('SELECT * FROM public.consents');
  console.log('Consents rows (' + consents.rows.length + '):', consents.rows);
  await client.end();
}

main().catch(console.error);
