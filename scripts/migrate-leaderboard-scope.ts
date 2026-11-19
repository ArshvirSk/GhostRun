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
  console.log('Connected to Supabase PostgreSQL database.');

  console.log('Updating get_friends_board RPC with p_scope parameter...');
  await client.query(`
    CREATE OR REPLACE FUNCTION public.get_friends_board(
      p_season text DEFAULT NULL,
      p_scope text DEFAULT 'friends'
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, extensions
    AS $$
    DECLARE
      v_caller_id uuid := auth.uid();
      v_season text := coalesce(p_season, to_char(now(), 'YYYY-MM'));
      v_scope text := lower(coalesce(p_scope, 'friends'));
      v_caller_profile record;
      v_board jsonb;
    BEGIN
      IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
      END IF;

      SELECT * INTO v_caller_profile FROM public.profiles WHERE id = v_caller_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Profile not found';
      END IF;

      -- Caller must have share_echo enabled to view the board
      IF NOT coalesce(v_caller_profile.share_echo, false) THEN
        RETURN jsonb_build_object(
          'can_view', false,
          'reason', 'share_echo_disabled',
          'season', v_season,
          'scope', v_scope,
          'board', '[]'::jsonb
        );
      END IF;

      -- Compile board according to scope
      -- Strictly respecting the 60-minute privacy delay rule: ended_at <= now() - interval '60 minutes'
      WITH eligible_operatives AS (
        SELECT id AS user_id
        FROM public.profiles
        WHERE (
          (v_scope = 'global' AND coalesce(share_echo, false) = true)
          OR
          (v_scope = 'friends' AND (
            id = v_caller_id
            OR id IN (
              SELECT (CASE WHEN f.user_a = v_caller_id THEN f.user_b ELSE f.user_a END)
              FROM public.friendships f
              WHERE f.status = 'accepted'
                AND (f.user_a = v_caller_id OR f.user_b = v_caller_id)
            )
          ))
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.blocks b
          WHERE (b.user_id = v_caller_id AND b.blocked_user_id = profiles.id)
             OR (b.blocked_user_id = v_caller_id AND b.user_id = profiles.id)
        )
      ),
      operative_rounds AS (
        SELECT
          rs.user_id,
          rs.echo,
          rs.y,
          rs.role,
          row_number() OVER (PARTITION BY rs.user_id ORDER BY rs.echo DESC) as rnk
        FROM public.round_scores rs
        JOIN eligible_operatives eo ON eo.user_id = rs.user_id
        WHERE to_char(rs.ended_at, 'YYYY-MM') = v_season
          AND rs.counted = true
          AND rs.ended_at <= (now() - interval '60 minutes') -- 60-Minute Privacy Delay Rule
      ),
      operative_aggregates AS (
        SELECT
          eo.user_id,
          pr.display_name,
          pr.handle,
          coalesce(sum(sub.echo) FILTER (WHERE sub.rnk <= 12), 0) AS season_echo,
          count(sub.echo) AS rounds_counted,
          coalesce(avg(sub.echo) FILTER (WHERE sub.rnk <= 12), 0) AS avg_best,
          coalesce(avg(sub.y) FILTER (WHERE sub.role = 'runner'), 0) AS avg_ghost,
          coalesce(avg(sub.y) FILTER (WHERE sub.role = 'hunter'), 0) AS avg_cash
        FROM eligible_operatives eo
        JOIN public.profiles pr ON pr.id = eo.user_id
        LEFT JOIN operative_rounds sub ON sub.user_id = eo.user_id
        GROUP BY eo.user_id, pr.display_name, pr.handle
      ),
      ranked_operatives AS (
        SELECT
          oa.*,
          dense_rank() OVER (ORDER BY oa.season_echo DESC, oa.rounds_counted DESC) as rank
        FROM operative_aggregates oa
      )
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'rank', ro.rank,
          'user_id', ro.user_id,
          'display_name', ro.display_name,
          'handle', ro.handle,
          'season_echo', round(ro.season_echo),
          'tier', CASE
            WHEN ro.avg_best >= 85 THEN 'Revenant'
            WHEN ro.avg_best >= 70 THEN 'Phantom'
            WHEN ro.avg_best >= 55 THEN 'Wraith'
            WHEN ro.avg_best >= 40 THEN 'Shade'
            ELSE 'Whisper'
          END,
          'rounds_counted', ro.rounds_counted,
          'avg_ghost', round(ro.avg_ghost, 1),
          'avg_cash', round(ro.avg_cash, 1),
          'is_self', (ro.user_id = v_caller_id)
        )
        ORDER BY ro.rank ASC
      ), '[]'::jsonb) INTO v_board
      FROM ranked_operatives ro;

      RETURN jsonb_build_object(
        'can_view', true,
        'season', v_season,
        'scope', v_scope,
        'board', v_board
      );
    END;
    $$;

    GRANT EXECUTE ON FUNCTION public.get_friends_board(text, text) TO authenticated;
  `);

  console.log('Migration successful: get_friends_board now supports scope (friends | global).');
  await client.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
