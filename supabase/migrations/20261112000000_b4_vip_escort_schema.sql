-- Migration: 20261112000000_b4_vip_escort_schema.sql
-- Enable VIP Escort role feature flag and update mode_catalogue and role_catalogue

insert into public.app_settings (key, value)
values ('feature.role.vip', 'true'::jsonb)
on conflict (key) do update set value = 'true'::jsonb;

create or replace function public.role_catalogue()
returns jsonb
language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_array(
    jsonb_build_object('id', 'double_agent', 'name', 'Double Agent', 'layer', 'role'),
    jsonb_build_object('id', 'vip', 'name', 'VIP Escort', 'layer', 'role'),
    jsonb_build_object('id', 'operator', 'name', 'Operator', 'layer', 'role')
  );
$$;

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
      'compatible_roles', jsonb_build_array('double_agent', 'vip', 'operator'),
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
      'compatible_modifiers', jsonb_build_array('noise_meter', 'shrinking_zone'),
      'parameters', jsonb_build_object('variant', 'time_trial')
    ),
    jsonb_build_object(
      'id', 'jailbreak', 'layer', 'base', 'name', 'Jailbreak',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 5,
      'compatible_roles', jsonb_build_array('double_agent'),
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
      'compatible_roles', jsonb_build_array('double_agent'),
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
        'securing_hold_s', 20
      )
    )
  );
$$;
