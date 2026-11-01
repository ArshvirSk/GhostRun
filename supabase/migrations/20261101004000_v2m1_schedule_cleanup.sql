-- V2-M1 retention scheduling follow-up: pg_cron was not enabled, so the
-- previous migration only raised a notice. Enable it and register the daily
-- cleanup. If the hosted role refuses CREATE EXTENSION, enable pg_cron from
-- Dashboard -> Database -> Extensions and rerun just the SELECT below.

create extension if not exists pg_cron;

select cron.schedule(
  'cleanup-games',
  '0 3 * * *',
  'select public.cleanup_old_games()'
);
