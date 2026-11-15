import { Client } from 'pg';

async function main() {
  const host = 'db.jgpbxsvgpewjvauozrzq.supabase.co';
  const password = process.env.SUPABASE_DB_PASSWORD;
  const user = 'postgres';
  const database = 'postgres';
  const port = 5432;

  if (!password) {
    console.error('SUPABASE_DB_PASSWORD is not set in environment.');
    process.exit(1);
  }

  const client = new Client({
    host,
    port,
    database,
    user,
    password,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to Supabase PostgreSQL database.');

  console.log('\n--- Pre-Truncate Counts ---');
  const userCountBefore = (await client.query('SELECT count(*) FROM auth.users')).rows[0].count;
  const profileCountBefore = (await client.query('SELECT count(*) FROM public.profiles')).rows[0].count;
  const gameCountBefore = (await client.query('SELECT count(*) FROM public.games')).rows[0].count;
  const eventCountBefore = (await client.query('SELECT count(*) FROM public.events')).rows[0].count;
  const settingsBefore = (await client.query('SELECT count(*) FROM public.app_settings')).rows[0].count;

  console.log(`auth.users: ${userCountBefore}`);
  console.log(`public.profiles: ${profileCountBefore}`);
  console.log(`public.games: ${gameCountBefore}`);
  console.log(`public.events: ${eventCountBefore}`);
  console.log(`public.app_settings (PRESERVE): ${settingsBefore}`);

  console.log('\nExecuting truncate and cleanup transaction...');
  await client.query('BEGIN');

  try {
    // 1. Truncate all public user and match activity tables
    await client.query(`
      TRUNCATE TABLE 
        public.events,
        public.pings,
        public.trail_points,
        public.tags,
        public.targets,
        public.player_positions,
        public.player_resources,
        public.team_resources,
        public.entities,
        public.ring_assignments,
        public.heat_presses,
        public.ghost_duel_scores,
        public.tribunals,
        public.drop_claims,
        public.qr_uses,
        public.ghost_contributions,
        public.ghost_library,
        public.players,
        public.games,
        public.consents,
        public.profiles
      CASCADE;
    `);
    console.log('✓ Truncated all public gameplay, user, and session data.');

    // Also check if any recent Wave tables exist and truncate if present
    const additionalTables = [
      'friends',
      'friend_requests',
      'moderation_reports',
      'moderation_blocks',
      'moderation_digests',
      'player_badges',
      'user_crews',
      'crews',
      'scheduled_games',
      'push_tokens',
      'echo_rounds',
    ];

    for (const tbl of additionalTables) {
      const existsRes = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = $1
        );
      `, [tbl]);

      if (existsRes.rows[0].exists) {
        await client.query(`TRUNCATE TABLE public."${tbl}" CASCADE;`);
        console.log(`✓ Truncated public."${tbl}"`);
      }
    }

    // 2. Delete all auth users (cascades to identities, sessions, refresh tokens)
    await client.query('DELETE FROM auth.users;');
    console.log('✓ Deleted all auth.users.');

    await client.query('COMMIT');
    console.log('✓ Transaction committed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Transaction failed, rolled back:', err);
    throw err;
  }

  console.log('\n--- Post-Truncate Verification ---');
  const userCountAfter = (await client.query('SELECT count(*) FROM auth.users')).rows[0].count;
  const profileCountAfter = (await client.query('SELECT count(*) FROM public.profiles')).rows[0].count;
  const gameCountAfter = (await client.query('SELECT count(*) FROM public.games')).rows[0].count;
  const eventCountAfter = (await client.query('SELECT count(*) FROM public.events')).rows[0].count;
  const settingsAfter = (await client.query('SELECT count(*) FROM public.app_settings')).rows[0].count;

  console.log(`auth.users: ${userCountAfter} (was ${userCountBefore})`);
  console.log(`public.profiles: ${profileCountAfter} (was ${profileCountBefore})`);
  console.log(`public.games: ${gameCountAfter} (was ${gameCountBefore})`);
  console.log(`public.events: ${eventCountAfter} (was ${eventCountBefore})`);
  console.log(`public.app_settings (PRESERVED): ${settingsAfter}`);

  await client.end();
}

main().catch((err) => {
  console.error('Truncate operation failed:', err);
  process.exit(1);
});
