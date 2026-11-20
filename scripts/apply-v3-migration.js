const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Parse .env file manually
const envPath = path.resolve(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
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

const dbPassword = envVars.SUPABASE_DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD;
if (!dbPassword) {
  console.error('Missing SUPABASE_DB_PASSWORD in .env');
  process.exit(1);
}

const client = new Client({
  host: 'db.jgpbxsvgpewjvauozrzq.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: dbPassword,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  console.log('Connecting to Supabase PostgreSQL...');
  await client.connect();
  console.log('Connected successfully.');

  const migrationFile = path.resolve(__dirname, '..', 'supabase', 'migrations', '20261120163000_v3_outbreak_horde_mode.sql');
  const sql = fs.readFileSync(migrationFile, 'utf8');

  console.log('Executing migration 20261120163000_v3_outbreak_horde_mode.sql...');
  await client.query(sql);
  console.log('Migration executed successfully!');

  // Verify enum values
  const enumCheck = await client.query(`
    SELECT enumlabel 
    FROM pg_enum 
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
    WHERE pg_type.typname = 'game_mode';
  `);
  console.log('Current game_mode enum labels:', enumCheck.rows.map(r => r.enumlabel));

  // Verify constraint
  const constraintCheck = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) 
    FROM pg_constraint 
    WHERE conname = 'games_mode_id_check';
  `);
  console.log('Current games_mode_id_check:', constraintCheck.rows[0]);

  await client.end();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
