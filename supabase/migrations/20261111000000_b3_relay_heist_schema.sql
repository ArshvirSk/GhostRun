-- Migration: 20261111000000_b3_relay_heist_schema.sql
-- Add relay_heist to game_mode enum

alter type public.game_mode add value if not exists 'relay_heist';
