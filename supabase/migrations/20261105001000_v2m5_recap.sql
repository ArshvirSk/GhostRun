-- V2-M5: Per-mode recap stats RPC.
--
-- MODES.md 7.3:
-- Per-mode recap cards:
--   * Closest call (minimum distance to a hunter during play)
--     - Gated to ended games only.
--     - Gated strictly by Consent C3: computed and shown ONLY if player chose share_trail = true.
--     - If share_trail = false or null, closest_call_m is null.
--   * Longest unseen streak (seconds without a ping)
--   * Loudest moment (peak noise)
--   * Heat presses and hit rate
--   * Drops claimed

create or replace function public.get_game_stats(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  player_rows jsonb := '[]'::jsonb;
  p record;
  min_distance double precision;
  unseen_max double precision;
  peak_noise integer;
  peak_speed real;
  claimed_count integer;
  total_heat integer := 0;
  hot_hits integer := 0;
  heat_hit_rate integer := 0;
  total_drops_claimed integer := 0;
  duration_seconds double precision;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not public.is_member(get_game_stats.game_id) then
    raise exception 'You are not a member of this game.';
  end if;

  select * into current_game from public.games g where g.id = get_game_stats.game_id;
  if not found then raise exception 'Game not found.'; end if;
  if not public.game_ended(current_game.id) then
    raise exception 'Game stats are only available after the round ends.';
  end if;

  duration_seconds := greatest(0, extract(epoch from (coalesce(current_game.ended_at, now()) - coalesce(current_game.live_at, now()))));

  -- Heat stats summary
  select count(*), count(*) filter (where result = 'hot')
  into total_heat, hot_hits
  from public.heat_presses
  where game_id = current_game.id;

  if total_heat > 0 then
    heat_hit_rate := round((hot_hits * 100.0) / total_heat);
  end if;

  -- Total drops claimed
  select count(*) into total_drops_claimed
  from public.drop_claims
  where game_id = current_game.id;

  for p in
    select
      pl.id,
      pl.user_id,
      coalesce(pr.display_name, 'Player') as display_name,
      coalesce(pr.color, '#1D4ED8') as color,
      pl.team,
      pl.status,
      pl.secret_role,
      pl.share_trail
    from public.players pl
    left join public.profiles pr on pr.id = pl.user_id
    where pl.game_id = current_game.id and pl.status <> 'left'
    order by pl.joined_at
  loop
    -- Closest call: only for players with share_trail = true
    min_distance := null;
    if p.share_trail = true then
      select min(extensions.st_distance(t1.geog, t2.geog))
      into min_distance
      from public.trail_points t1
      join public.trail_points t2
        on t2.game_id = current_game.id
        and t2.player_id in (
          select id from public.players where game_id = current_game.id and team <> p.team and status <> 'left'
        )
        and abs(extract(epoch from (t1.recorded_at - t2.recorded_at))) <= 20
      where t1.player_id = p.id;
    end if;

    -- Longest unseen streak (seconds between scheduled pings)
    unseen_max := 0;
    if p.team = 'runner' then
      with ping_times as (
        select released_at
        from public.pings
        where game_id = current_game.id and player_id = p.id and reason = 'scheduled'
        order by released_at
      ),
      ping_gaps as (
        select extract(epoch from (lead(released_at) over () - released_at)) as gap
        from ping_times
      )
      select coalesce(max(gap), duration_seconds) into unseen_max
      from ping_gaps;
    end if;

    -- Loudest moment & speed
    select coalesce(noise, 0), coalesce(smoothed_speed_mps, 0)
    into peak_noise, peak_speed
    from public.player_positions
    where player_id = p.id;

    -- Drops claimed by this player
    select count(*) into claimed_count
    from public.drop_claims
    where game_id = current_game.id and player_id = p.id;

    player_rows := player_rows || jsonb_build_array(
      jsonb_build_object(
        'player_id', p.id,
        'user_id', p.user_id,
        'display_name', p.display_name,
        'color', p.color,
        'team', p.team,
        'status', p.status,
        'secret_role', p.secret_role,
        'share_trail', p.share_trail,
        'closest_call_m', case when min_distance is not null then round(min_distance::numeric, 1) else null end,
        'longest_unseen_s', round(coalesce(unseen_max, 0)::numeric),
        'loudest_noise', peak_noise,
        'peak_speed_mps', round(coalesce(peak_speed, 0)::numeric, 1),
        'drops_claimed', claimed_count
      )
    );
  end loop;

  return jsonb_build_object(
    'game_id', current_game.id,
    'status', current_game.status,
    'winner', current_game.winner,
    'duration_s', round(duration_seconds::numeric),
    'players', player_rows,
    'heat_stats', jsonb_build_object(
      'total_presses', total_heat,
      'hot_hits', hot_hits,
      'hit_rate_pct', heat_hit_rate
    ),
    'total_drops_claimed', total_drops_claimed
  );
end;
$$;

revoke all on function public.get_game_stats(uuid) from public, anon;
grant execute on function public.get_game_stats(uuid) to authenticated;
