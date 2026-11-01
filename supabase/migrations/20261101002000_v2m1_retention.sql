-- V2-M1 retention: MODES.md 7.4.9 in one job. A game ended more than 30 days
-- ago is deleted whole, which cascades its trails, pings, tags, events,
-- positions and (once they exist) heat presses. Consent rows are profile-scoped
-- and survive; accounts live until the player deletes them.
--
-- prune_old_trails() (m8) is kept as-is for compatibility. cleanup_old_games
-- supersedes it in the schedule.

create or replace function public.cleanup_old_games()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  deleted_count integer;
  trail_count integer;
  ping_count integer;
  event_count integer;
begin
  select coalesce(sum(
    (select count(*) from public.trail_points tp where tp.game_id = g.id)
  ), 0) into trail_count
  from public.games g
  where g.status in ('ended', 'cancelled')
    and coalesce(g.ended_at, g.created_at) < now() - interval '30 days';

  select coalesce(sum(
    (select count(*) from public.pings pi where pi.game_id = g.id)
  ), 0) into ping_count
  from public.games g
  where g.status in ('ended', 'cancelled')
    and coalesce(g.ended_at, g.created_at) < now() - interval '30 days';

  select coalesce(sum(
    (select count(*) from public.events e where e.game_id = g.id)
  ), 0) into event_count
  from public.games g
  where g.status in ('ended', 'cancelled')
    and coalesce(g.ended_at, g.created_at) < now() - interval '30 days';

  delete from public.games g
  where g.status in ('ended', 'cancelled')
    and coalesce(g.ended_at, g.created_at) < now() - interval '30 days';
  get diagnostics deleted_count = row_count;

  return jsonb_build_object(
    'games_deleted', deleted_count,
    'trails_deleted', trail_count,
    'pings_deleted', ping_count,
    'events_deleted', event_count
  );
end;
$$;

revoke all on function public.cleanup_old_games() from public, anon, authenticated;
grant execute on function public.cleanup_old_games() to service_role, postgres;

-- Schedule daily at 03:00 server time. pg_cron is normally available on
-- hosted Supabase; if the extension is missing or the plan blocks scheduling,
-- the block notices and the migration still applies. Fallback: enable the
-- pg_cron extension in Dashboard -> Database -> Extensions, then run
--   select cron.schedule('cleanup-games', '0 3 * * *',
--     $job$select public.cleanup_old_games()$job$);
-- CREATE EXTENSION is not allowed inside a DO block, so this only schedules
-- when pg_cron is already enabled (Dashboard -> Database -> Extensions).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'cleanup-games',
      '0 3 * * *',
      'select public.cleanup_old_games()'
    );
  else
    raise notice 'pg_cron is not enabled; enable it and run: select cron.schedule(''cleanup-games'', ''0 3 * * *'', ''select public.cleanup_old_games()'');';
  end if;
exception when others then
  raise notice 'cleanup-games schedule not installed (%). Schedule it manually: select cron.schedule(''cleanup-games'', ''0 3 * * *'', ''select public.cleanup_old_games()'' );', sqlerrm;
end $$;
