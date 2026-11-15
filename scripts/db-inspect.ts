import { Client } from 'pg';

async function main() {
  const client = new Client({
    host: 'db.jgpbxsvgpewjvauozrzq.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const res = await client.query(`
    SELECT table_schema, table_name 
    FROM information_schema.tables 
    WHERE table_schema IN ('public', 'auth')
      AND table_type = 'BASE TABLE'
    ORDER BY table_schema, table_name;
  `);

  console.log('Tables in public and auth schemas:');
  for (const row of res.rows) {
    const { table_schema, table_name } = row;
    try {
      const c = await client.query(`SELECT count(*) FROM "${table_schema}"."${table_name}"`);
      console.log(`  [${table_schema}] ${table_name}: ${c.rows[0].count}`);
    } catch (e: any) {
      console.log(`  [${table_schema}] ${table_name}: error (${e.message})`);
    }
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
