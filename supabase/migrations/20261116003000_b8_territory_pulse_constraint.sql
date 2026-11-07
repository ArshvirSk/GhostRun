-- Migration: 20261116003000_b8_territory_pulse_constraint.sql
-- Add territory_pulse to games_mode_id_check

alter table public.games drop constraint if exists games_mode_id_check;
alter table public.games add constraint games_mode_id_check
  check (mode_id in ('classic_chase', 'tag_hunt', 'haunted_map', 'ghost_duel', 'jailbreak', 'assassin_ring', 'relay_heist', 'territory_pulse'));
