-- Migration: 20261110001000_b2_feature_flag.sql
-- Enable feature flag for assassin_ring mode

insert into public.app_settings (key, value) values
  ('feature.mode.assassin_ring', 'true'::jsonb)
on conflict (key) do update set value = 'true'::jsonb;
