-- Migration: 20261110002000_b2_mode_id_check.sql
-- Update games_mode_id_check constraint to include assassin_ring

alter table public.games drop constraint if exists games_mode_id_check;
alter table public.games add constraint games_mode_id_check
  check (mode_id in ('classic_chase', 'tag_hunt', 'haunted_map', 'ghost_duel', 'jailbreak', 'assassin_ring'));
