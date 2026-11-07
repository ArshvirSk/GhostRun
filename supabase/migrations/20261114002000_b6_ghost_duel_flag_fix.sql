-- Fix feature.mode.ghost_duel in app_settings to 'true'::jsonb (boolean jsonb matching feature_enabled)
insert into public.app_settings (key, value)
values ('feature.mode.ghost_duel', 'true'::jsonb)
on conflict (key) do update
set value = 'true'::jsonb, updated_at = now();
