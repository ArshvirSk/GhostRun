-- Migration: 20261111001000_b3_relay_heist_mode_id_check.sql
-- Update games_mode_id_check, mode_catalogue, and app_settings feature flag for relay_heist

alter table public.games drop constraint if exists games_mode_id_check;
alter table public.games add constraint games_mode_id_check
  check (mode_id in ('classic_chase', 'tag_hunt', 'haunted_map', 'ghost_duel', 'jailbreak', 'assassin_ring', 'relay_heist'));

insert into public.app_settings (key, value)
values ('feature.mode.relay_heist', '{"enabled": true}'::jsonb)
on conflict (key) do update
set value = '{"enabled": true}'::jsonb, updated_at = now();

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
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone'
      ),
      'parameters', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'tag_hunt', 'layer', 'base', 'name', 'Tag Hunt',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 2,
      'compatible_roles', jsonb_build_array('double_agent', 'operator'),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone'
      ),
      'parameters', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'haunted_map', 'layer', 'base', 'name', 'Haunted Map',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 1,
      'compatible_roles', jsonb_build_array(),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone'
      ),
      'parameters', jsonb_build_object('ghost_count', 2, 'ghost_speed_mps', 1.3)
    ),
    jsonb_build_object(
      'id', 'ghost_duel', 'layer', 'base', 'name', 'Ghost Duel',
      'teams', jsonb_build_array('runner'), 'min_players', 1,
      'compatible_roles', jsonb_build_array(),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'shrinking_zone'
      ),
      'parameters', jsonb_build_object('variant', 'time_trial')
    ),
    jsonb_build_object(
      'id', 'jailbreak', 'layer', 'base', 'name', 'Jailbreak',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 5,
      'compatible_roles', jsonb_build_array('double_agent', 'operator'),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone'
      ),
      'parameters', jsonb_build_object(
        'jail_radius_m', 15,
        'auto_release_s', 300,
        'release_hold_s', 10,
        'release_radius_m', 10
      )
    ),
    jsonb_build_object(
      'id', 'assassin_ring', 'layer', 'base', 'name', 'Assassin Ring',
      'teams', jsonb_build_array('solo'), 'min_players', 3,
      'compatible_roles', jsonb_build_array(),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'qr_tagging', 'shrinking_zone'
      ),
      'parameters', jsonb_build_object(
        'tag_radius_m', 15,
        'safe_zone_count', 2,
        'safe_zone_radius_m', 20,
        'safe_zone_max_s', 60,
        'safe_zone_cooldown_s', 120,
        'hunter_pulse_far_m', 100,
        'hunter_pulse_near_m', 40,
        'offline_relink_s', 180
      )
    ),
    jsonb_build_object(
      'id', 'relay_heist', 'layer', 'base', 'name', 'Relay Heist',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 3,
      'compatible_roles', jsonb_build_array('double_agent', 'operator'),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone'
      ),
      'parameters', jsonb_build_object(
        'extraction_radius_m', 25,
        'carrier_ping_multiplier', 1.5,
        'handoff_distance_m', 5,
        'handoff_timeout_s', 10,
        'handoff_cooldown_s', 20,
        'pickup_distance_m', 10,
        'securing_distance_m', 10,
        'securing_hold_s', 20,
        'drop_offline_timeout_s', 60
      )
    )
  );
$$;
