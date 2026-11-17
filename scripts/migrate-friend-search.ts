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

  // 1. Update send_friend_request to support both handle and display_name (case-insensitive, optional @)
  console.log('Updating send_friend_request RPC...');
  await client.query(`
    CREATE OR REPLACE FUNCTION public.send_friend_request(p_target_handle text)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, extensions
    AS $$
    DECLARE
      v_caller_id uuid := auth.uid();
      v_target_id uuid;
      v_target_profile record;
      v_clean text;
      v_ua uuid;
      v_ub uuid;
      v_existing record;
      v_today_requests integer;
      v_pending_requests integer;
      v_friend_count integer;
    BEGIN
      IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
      END IF;

      -- Strip leading @ and trim whitespace
      v_clean := lower(trim(p_target_handle));
      IF starts_with(v_clean, '@') THEN
        v_clean := substring(v_clean from 2);
      END IF;

      IF length(v_clean) = 0 THEN
        RAISE EXCEPTION 'Invalid operative codename or handle';
      END IF;

      -- Match by handle OR display_name (case-insensitive)
      SELECT * INTO v_target_profile FROM public.profiles
      WHERE (handle IS NOT NULL AND lower(handle::text) = v_clean)
         OR lower(trim(display_name)) = v_clean
      ORDER BY (handle IS NOT NULL AND lower(handle::text) = v_clean) DESC
      LIMIT 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Operative not found with that codename or handle';
      END IF;

      v_target_id := v_target_profile.id;

      IF v_target_id = v_caller_id THEN
        RAISE EXCEPTION 'Cannot add yourself as a friend';
      END IF;

      -- Block check
      IF EXISTS (
        SELECT 1 FROM public.blocks
        WHERE (user_id = v_caller_id AND blocked_user_id = v_target_id)
           OR (user_id = v_target_id AND blocked_user_id = v_caller_id)
      ) THEN
        RAISE EXCEPTION 'Unable to send friend request';
      END IF;

      -- Target allows friend requests
      IF NOT coalesce(v_target_profile.allow_friend_requests, true) THEN
        RETURN jsonb_build_object('success', false, 'reason', 'requests_disabled');
      END IF;

      -- Rate limits: max 10 outgoing per 24 hours
      SELECT count(*) INTO v_today_requests
      FROM public.friendships
      WHERE requested_by = v_caller_id AND created_at >= (now() - interval '24 hours');
      IF v_today_requests >= 10 THEN
        RAISE EXCEPTION 'Daily friend request limit reached (10/day)';
      END IF;

      -- Pending limit: max 20 pending outgoing
      SELECT count(*) INTO v_pending_requests
      FROM public.friendships
      WHERE requested_by = v_caller_id AND status = 'pending';
      IF v_pending_requests >= 20 THEN
        RAISE EXCEPTION 'Pending request limit reached (20 maximum)';
      END IF;

      -- Max friends: 200
      SELECT count(*) INTO v_friend_count
      FROM public.friendships
      WHERE status = 'accepted' AND (user_a = v_caller_id OR user_b = v_caller_id);
      IF v_friend_count >= 200 THEN
        RAISE EXCEPTION 'Friend limit reached (200 maximum)';
      END IF;

      -- Canonical pair ordering
      IF v_caller_id < v_target_id THEN
        v_ua := v_caller_id; v_ub := v_target_id;
      ELSE
        v_ua := v_target_id; v_ub := v_caller_id;
      END IF;

      SELECT * INTO v_existing FROM public.friendships WHERE user_a = v_ua AND user_b = v_ub;
      IF FOUND THEN
        IF v_existing.status = 'accepted' THEN
          RETURN jsonb_build_object('success', true, 'status', 'already_friends');
        ELSIF v_existing.status = 'pending' THEN
          IF v_existing.requested_by = v_caller_id THEN
            RETURN jsonb_build_object('success', true, 'status', 'request_already_sent');
          ELSE
            -- Mutual request auto-accepts
            UPDATE public.friendships
            SET status = 'accepted', responded_at = now()
            WHERE user_a = v_ua AND user_b = v_ub;
            RETURN jsonb_build_object('success', true, 'status', 'accepted');
          END IF;
        ELSIF v_existing.status = 'declined' THEN
          IF v_existing.responded_at > (now() - interval '7 days') THEN
            RAISE EXCEPTION 'Cannot send request yet (decline cooldown active)';
          ELSE
            UPDATE public.friendships
            SET status = 'pending', requested_by = v_caller_id, created_at = now(), responded_at = null
            WHERE user_a = v_ua AND user_b = v_ub;
            RETURN jsonb_build_object('success', true, 'status', 'sent');
          END IF;
        END IF;
      ELSE
        INSERT INTO public.friendships (user_a, user_b, status, requested_by)
        VALUES (v_ua, v_ub, 'pending', v_caller_id);
        RETURN jsonb_build_object('success', true, 'status', 'sent');
      END IF;
    END;
    $$;

    GRANT EXECUTE ON FUNCTION public.send_friend_request(text) TO authenticated;
  `);
  console.log('send_friend_request RPC updated successfully.');

  // 2. Create search_operatives RPC
  console.log('Creating search_operatives RPC...');
  await client.query(`
    CREATE OR REPLACE FUNCTION public.search_operatives(p_query text)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, extensions
    AS $$
    DECLARE
      v_caller_id uuid := auth.uid();
      v_clean text := lower(trim(p_query));
      v_results jsonb;
    BEGIN
      IF v_caller_id IS NULL THEN
        RETURN jsonb_build_array();
      END IF;

      IF starts_with(v_clean, '@') THEN
        v_clean := substring(v_clean from 2);
      END IF;

      IF length(v_clean) < 1 THEN
        RETURN jsonb_build_array();
      END IF;

      SELECT jsonb_agg(sub) INTO v_results
      FROM (
        SELECT
          p.id,
          p.display_name,
          p.handle::text,
          p.color,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM public.friendships f
              WHERE ((f.user_a = v_caller_id AND f.user_b = p.id) OR (f.user_b = v_caller_id AND f.user_a = p.id))
                AND f.status = 'accepted'
            ) THEN 'friend'
            WHEN EXISTS (
              SELECT 1 FROM public.friendships f
              WHERE f.requested_by = v_caller_id
                AND ((f.user_a = v_caller_id AND f.user_b = p.id) OR (f.user_b = v_caller_id AND f.user_a = p.id))
                AND f.status = 'pending'
            ) THEN 'pending_outgoing'
            WHEN EXISTS (
              SELECT 1 FROM public.friendships f
              WHERE f.requested_by = p.id
                AND ((f.user_a = v_caller_id AND f.user_b = p.id) OR (f.user_b = v_caller_id AND f.user_a = p.id))
                AND f.status = 'pending'
            ) THEN 'pending_incoming'
            ELSE 'none'
          END AS relationship
        FROM public.profiles p
        WHERE p.id <> v_caller_id
          AND (
            (p.handle IS NOT NULL AND p.handle::text ILIKE ('%' || v_clean || '%'))
            OR p.display_name ILIKE ('%' || v_clean || '%')
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.blocks b
            WHERE (b.user_id = v_caller_id AND b.blocked_user_id = p.id)
               OR (b.user_id = p.id AND b.blocked_user_id = v_caller_id)
          )
        ORDER BY
          CASE
            WHEN lower(coalesce(p.handle::text, '')) = v_clean THEN 1
            WHEN lower(p.display_name) = v_clean THEN 2
            WHEN lower(coalesce(p.handle::text, '')) LIKE (v_clean || '%') THEN 3
            WHEN lower(p.display_name) LIKE (v_clean || '%') THEN 4
            ELSE 5
          END,
          p.display_name ASC
        LIMIT 15
      ) sub;

      RETURN coalesce(v_results, jsonb_build_array());
    END;
    $$;

    GRANT EXECUTE ON FUNCTION public.search_operatives(text) TO authenticated;
  `);
  console.log('search_operatives RPC created successfully.');

  await client.end();
  console.log('Migration finished.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
