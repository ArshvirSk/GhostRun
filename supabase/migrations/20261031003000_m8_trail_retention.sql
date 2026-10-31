-- M8 trail retention: 30-day trail retention policy (§9 Privacy & Retention promise)
-- Prunes trail_points older than 30 days.

create index if not exists trail_points_recorded_at_idx
  on public.trail_points(recorded_at);

create or replace function public.prune_old_trails()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  deleted_count integer;
begin
  delete from public.trail_points
    where recorded_at < now() - interval '30 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.prune_old_trails() from public, anon;
grant execute on function public.prune_old_trails() to service_role, postgres;

-- To schedule daily pruning in Supabase with pg_cron:
-- select cron.schedule('prune-trails', '0 3 * * *', 'select public.prune_old_trails()');
