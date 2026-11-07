-- Migration: 20261118000000_c2_ai_game_master_catalogue.sql
-- Phase C Milestone C2: AI Game Master (narration and events)
-- Adds ai_gm modifier to modifier_catalogue, mode_catalogue, and app_settings feature flags

-- 1. Enable feature flag in app_settings
insert into public.app_settings (key, value)
values ('feature.modifier.ai_gm', 'true'::jsonb)
on conflict (key) do update set value = 'true'::jsonb;

-- 2. Update modifier_catalogue with ai_gm
create or replace function public.modifier_catalogue()
returns jsonb
language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_array(
    jsonb_build_object(
      'id', 'noise_meter', 'name', 'Noise Meter', 'layer', 'modifier',
      'parameters', jsonb_build_object('walking_threshold_mps', 1.6, 'jog_threshold_mps', 2.8)
    ),
    jsonb_build_object(
      'id', 'dead_drops', 'name', 'Dead Drops', 'layer', 'modifier',
      'parameters', jsonb_build_object('drops', 6, 'spacing_m', 150, 'inset_m', 60)
    ),
    jsonb_build_object(
      'id', 'hot_cold', 'name', 'Hot & Cold Hunt', 'layer', 'modifier',
      'parameters', jsonb_build_object(
        'variant', 'proximity', 'heat_charges', 6, 'cooldown_s', 10
      )
    ),
    jsonb_build_object(
      'id', 'qr_tagging', 'name', 'QR Tagging', 'layer', 'modifier',
      'parameters', jsonb_build_object('token_ttl_s', 20)
    ),
    jsonb_build_object(
      'id', 'shrinking_zone', 'name', 'Shrinking Zone', 'layer', 'modifier',
      'parameters', jsonb_build_object('stages', jsonb_build_array(100, 70, 45))
    ),
    jsonb_build_object(
      'id', 'ai_gm', 'name', 'AI Game Master', 'layer', 'modifier',
      'parameters', jsonb_build_object('event_interval_s', 180, 'max_events', 12, 'tts_enabled', true)
    )
  );
$$;

revoke all on function public.modifier_catalogue() from public, anon, authenticated;

-- 3. Update mode_catalogue with ai_gm across all compatible base modes
create or replace function public.mode_catalogue()
returns jsonb
language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_array(
    jsonb_build_object(
      'id', 'classic_chase', 'layer', 'base', 'name', 'Classic Chase',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 2,
      'compatible_roles', jsonb_build_array('double_agent', 'vip', 'operator'),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone', 'ai_gm'
      ),
      'parameters', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'tag_hunt', 'layer', 'base', 'name', 'Tag Hunt',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 2,
      'compatible_roles', jsonb_build_array('double_agent', 'operator'),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone', 'ai_gm'
      ),
      'parameters', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'haunted_map', 'layer', 'base', 'name', 'Haunted Map',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 1,
      'compatible_roles', jsonb_build_array(),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone', 'ai_gm'
      ),
      'parameters', jsonb_build_object('ghost_count', 2, 'ghost_speed_mps', 1.3)
    ),
    jsonb_build_object(
      'id', 'ghost_duel', 'layer', 'base', 'name', 'Ghost Duel',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 1,
      'compatible_roles', jsonb_build_array(),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'shrinking_zone', 'ai_gm'
      ),
      'parameters', jsonb_build_object('variant', 'time_trial')
    ),
    jsonb_build_object(
      'id', 'jailbreak', 'layer', 'base', 'name', 'Jailbreak',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 5,
      'compatible_roles', jsonb_build_array('double_agent', 'operator'),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone', 'ai_gm'
      ),
      'parameters', jsonb_build_object('jail_radius_m', 15, 'auto_release_s', 300, 'release_hold_s', 10, 'release_radius_m', 10)
    ),
    jsonb_build_object(
      'id', 'assassin_ring', 'layer', 'base', 'name', 'Assassin Ring',
      'teams', jsonb_build_array('solo'), 'min_players', 3,
      'compatible_roles', jsonb_build_array(),
      'compatible_modifiers', jsonb_build_array('noise_meter', 'dead_drops', 'qr_tagging', 'shrinking_zone', 'ai_gm'),
      'parameters', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'relay_heist', 'layer', 'base', 'name', 'Relay Heist',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 3,
      'compatible_roles', jsonb_build_array('double_agent', 'operator'),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone', 'ai_gm'
      ),
      'parameters', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'territory_pulse', 'layer', 'base', 'name', 'Territory Pulse',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 2,
      'compatible_roles', jsonb_build_array('operator'),
      'compatible_modifiers', jsonb_build_array(
        'dead_drops', 'shrinking_zone', 'qr_tagging', 'ai_gm'
      ),
      'parameters', jsonb_build_object(
        'pulse_interval_s', 90,
        'zone_radius_m', 60,
        'zone_count', 7,
        'dominance_pct', 70
      )
    )
  );
$$;

revoke all on function public.mode_catalogue() from public, anon, authenticated;
