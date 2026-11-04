-- Migration: 20261111004000_b3_relay_heist_flag_fix.sql
-- Fix feature.mode.relay_heist in app_settings to 'true'::jsonb (boolean jsonb matching feature_enabled)

insert into public.app_settings (key, value)
values ('feature.mode.relay_heist', 'true'::jsonb)
on conflict (key) do update
set value = 'true'::jsonb, updated_at = now();
