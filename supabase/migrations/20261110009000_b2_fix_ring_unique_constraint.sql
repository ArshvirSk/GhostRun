-- Migration: 20261110009000_b2_fix_ring_unique_constraint.sql
-- Drop the overly restrictive (game_id, hunter_player_id, status) unique constraint on ring_assignments
-- and replace with partial unique index on active status, allowing a hunter to eliminate multiple preys.

alter table public.ring_assignments drop constraint if exists ring_assignments_game_id_hunter_player_id_status_key;

-- Clean up any orphaned duplicate active assignments from aborted simulator test runs
with dupes_prey as (
  select id,
         row_number() over (partition by game_id, prey_player_id order by assigned_at desc, id desc) as rn
  from public.ring_assignments
  where status = 'active'
)
update public.ring_assignments
set status = 'relinked'
where id in (select id from dupes_prey where rn > 1);

with dupes_hunter as (
  select id,
         row_number() over (partition by game_id, hunter_player_id order by assigned_at desc, id desc) as rn
  from public.ring_assignments
  where status = 'active'
)
update public.ring_assignments
set status = 'relinked'
where id in (select id from dupes_hunter where rn > 1);

create unique index if not exists ring_assignments_active_hunter_uq
  on public.ring_assignments (game_id, hunter_player_id)
  where status = 'active';

create unique index if not exists ring_assignments_active_prey_uq
  on public.ring_assignments (game_id, prey_player_id)
  where status = 'active';
