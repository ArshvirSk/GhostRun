-- Wave 6: FL-P3 Private Friends Board, 60-Minute Privacy Delay & Head-to-Head

-- 1. RPC: get_friends_board
CREATE OR REPLACE FUNCTION public.get_friends_board(p_season text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_season text := coalesce(p_season, to_char(now(), 'YYYY-MM'));
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
      'board', '[]'::jsonb
    );
  END IF;

  -- Compile board among caller + accepted friends who also share Echo
  -- Strictly respecting the 60-minute privacy delay rule: ended_at <= now() - interval '60 minutes'
  WITH eligible_operatives AS (
    SELECT v_caller_id AS user_id
    UNION
    SELECT (CASE WHEN f.user_a = v_caller_id THEN f.user_b ELSE f.user_a END) AS user_id
    FROM public.friendships f
    JOIN public.profiles pr ON pr.id = (CASE WHEN f.user_a = v_caller_id THEN f.user_b ELSE f.user_a END)
    WHERE f.status = 'accepted'
      AND (f.user_a = v_caller_id OR f.user_b = v_caller_id)
      AND pr.share_echo = true
      AND NOT EXISTS (
        SELECT 1 FROM public.blocks b
        WHERE (b.user_id = v_caller_id AND b.blocked_user_id = pr.id)
           OR (b.blocked_user_id = v_caller_id AND b.user_id = pr.id)
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
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'rank', dense_rank() OVER (ORDER BY oa.season_echo DESC, oa.rounds_counted DESC),
      'user_id', oa.user_id,
      'display_name', oa.display_name,
      'handle', oa.handle,
      'season_echo', round(oa.season_echo),
      'tier', CASE
        WHEN oa.avg_best >= 85 THEN 'Revenant'
        WHEN oa.avg_best >= 70 THEN 'Phantom'
        WHEN oa.avg_best >= 55 THEN 'Wraith'
        WHEN oa.avg_best >= 40 THEN 'Shade'
        ELSE 'Whisper'
      END,
      'rounds_counted', oa.rounds_counted,
      'avg_ghost', round((oa.avg_ghost * 100)::numeric, 1),
      'avg_cash', round((oa.avg_cash * 100)::numeric, 1),
      'is_self', (oa.user_id = v_caller_id)
    ) ORDER BY oa.season_echo DESC, oa.rounds_counted DESC
  ), '[]'::jsonb)
  INTO v_board
  FROM operative_aggregates oa;

  RETURN jsonb_build_object(
    'can_view', true,
    'season', v_season,
    'board', v_board
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_friends_board(text) TO authenticated;

-- 2. RPC: get_head_to_head_stats
CREATE OR REPLACE FUNCTION public.get_head_to_head_stats(p_friend_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_friend_profile record;
  v_caller_profile record;
  v_opposite_rounds int := 0;
  v_my_wins int := 0;
  v_friend_wins int := 0;
  v_times_ghosted int := 0;
  v_times_cashed int := 0;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_caller_profile FROM public.profiles WHERE id = v_caller_id;
  SELECT * INTO v_friend_profile FROM public.profiles WHERE id = p_friend_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Friend profile not found';
  END IF;

  -- Both must share Echo
  IF NOT coalesce(v_caller_profile.share_echo, false) OR NOT coalesce(v_friend_profile.share_echo, false) THEN
    RETURN jsonb_build_object(
      'available', false,
      'reason', 'both_must_share_echo'
    );
  END IF;

  -- Count rounds on opposite sides
  SELECT
    count(*),
    count(*) FILTER (WHERE (me.team = 'runner' AND g.winner = 'runners') OR (me.team = 'hunter' AND g.winner = 'hunters')),
    count(*) FILTER (WHERE (fr.team = 'runner' AND g.winner = 'runners') OR (fr.team = 'hunter' AND g.winner = 'hunters'))
  INTO v_opposite_rounds, v_my_wins, v_friend_wins
  FROM public.players me
  JOIN public.players fr ON fr.game_id = me.game_id
  JOIN public.games g ON g.id = me.game_id
  WHERE me.user_id = v_caller_id
    AND fr.user_id = p_friend_id
    AND me.team <> fr.team
    AND me.status <> 'left'
    AND fr.status <> 'left'
    AND g.status = 'ended';

  -- Times caller ghosted friend (caller was runner, friend was hunter)
  SELECT coalesce(sum(rs.hit), 0) INTO v_times_ghosted
  FROM public.round_scores rs
  JOIN public.players me ON me.game_id = rs.game_id AND me.user_id = v_caller_id AND me.team = 'runner'
  JOIN public.players fr ON fr.game_id = rs.game_id AND fr.user_id = p_friend_id AND fr.team = 'hunter'
  WHERE rs.user_id = v_caller_id;

  -- Times friend cashed caller (friend was hunter, caller was runner)
  SELECT coalesce(sum(rs.hit), 0) INTO v_times_cashed
  FROM public.round_scores rs
  JOIN public.players fr ON fr.game_id = rs.game_id AND fr.user_id = p_friend_id AND fr.team = 'hunter'
  JOIN public.players me ON me.game_id = rs.game_id AND me.user_id = v_caller_id AND me.team = 'runner'
  WHERE rs.user_id = p_friend_id;

  RETURN jsonb_build_object(
    'available', true,
    'friend_id', p_friend_id,
    'friend_name', v_friend_profile.display_name,
    'friend_handle', v_friend_profile.handle,
    'opposite_rounds', v_opposite_rounds,
    'my_wins', v_my_wins,
    'friend_wins', v_friend_wins,
    'times_ghosted_them', v_times_ghosted,
    'times_they_cashed_me', v_times_cashed
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_head_to_head_stats(uuid) TO authenticated;
