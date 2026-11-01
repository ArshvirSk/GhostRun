-- V2-M3: turn on the modifiers implemented in this milestone. QR Tagging stays
-- off until its camera UI ships; Hot & Cold is M4. Feature flags are read by
-- the registry and by assert_mode_config, so this is the only switch needed.

insert into public.app_settings (key, value) values
  ('feature.modifier.noise_meter', 'true'::jsonb),
  ('feature.modifier.dead_drops', 'true'::jsonb),
  ('feature.modifier.shrinking_zone', 'true'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();
