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
  const cols = await client.query("SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'consents'");
  console.log('Consents columns:', cols.rows);
  const indexes = await client.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'consents'");
  console.log('Consents indexes:', indexes.rows);
  await client.end();
}

main().catch(console.error);
