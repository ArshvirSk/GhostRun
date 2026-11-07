-- Migration: 20261116000000_b8_territory_pulse_enum.sql
-- Phase B Milestone B8: Territory Pulse (territory_pulse) Base Mode
-- Register territory_pulse enum value on game_mode

alter type public.game_mode add value if not exists 'territory_pulse';
