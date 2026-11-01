-- Safe, zero-leak health ping RPC callable by anon and authenticated roles
-- Used by keep-alive cron jobs (e.g. GitHub Actions, cron-job.org) to keep
-- the PostgreSQL database awake and prevent 7-day free-tier pausing.

create or replace function public.health_ping()
returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'status', 'ok',
    'app', 'ghostrun',
    'server_time', now()
  );
$$;

revoke all on function public.health_ping() from public;
grant execute on function public.health_ping() to anon, authenticated;
