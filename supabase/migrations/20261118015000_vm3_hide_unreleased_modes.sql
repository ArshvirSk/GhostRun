-- Migration: 20261118015000_vm3_hide_unreleased_modes.sql
-- VM3: Hide What Is Not Shipping (haunted_map, qr_tagging)
-- NOTE: Prepared locally on modes/vm3-hide-unreleased per user directive "hold till fix".

-- 1. Ensure feature flags for unreleased/unapproved modes and modifiers are strictly FALSE
insert into public.app_settings (key, value)
values
  ('feature.mode.haunted_map', 'false'::jsonb),
  ('feature.modifier.qr_tagging', 'false'::jsonb)
on conflict (key) do update set value = excluded.value;

-- 2. Update mode_catalogue() to expose ONLY the 7 verified shipping base modes
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
        'noise_meter', 'dead_drops', 'hot_cold', 'shrinking_zone', 'ai_gm'
      ),
      'parameters', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'tag_hunt', 'layer', 'base', 'name', 'Tag Hunt',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 2,
      'compatible_roles', jsonb_build_array('double_agent', 'operator'),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'shrinking_zone', 'ai_gm'
      ),
      'parameters', '{}'::jsonb
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
        'noise_meter', 'dead_drops', 'hot_cold', 'shrinking_zone', 'ai_gm'
      ),
      'parameters', jsonb_build_object('jail_radius_m', 15, 'auto_release_s', 300, 'release_hold_s', 10, 'release_radius_m', 10)
    ),
    jsonb_build_object(
      'id', 'assassin_ring', 'layer', 'base', 'name', 'Assassin Ring',
      'teams', jsonb_build_array('solo'), 'min_players', 3,
      'compatible_roles', jsonb_build_array(),
      'compatible_modifiers', jsonb_build_array('noise_meter', 'dead_drops', 'shrinking_zone', 'ai_gm'),
      'parameters', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'relay_heist', 'layer', 'base', 'name', 'Relay Heist',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 3,
      'compatible_roles', jsonb_build_array('double_agent', 'operator'),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'shrinking_zone', 'ai_gm'
      ),
      'parameters', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'territory_pulse', 'layer', 'base', 'name', 'Territory Pulse',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 2,
      'compatible_roles', jsonb_build_array('operator'),
      'compatible_modifiers', jsonb_build_array(
        'dead_drops', 'shrinking_zone', 'ai_gm'
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

revoke all on function public.mode_catalogue() from public, anon;
grant execute on function public.mode_catalogue() to authenticated;

-- 3. Update modifier_catalogue() to expose ONLY the 5 verified shipping modifiers
create or replace function public.modifier_catalogue()
returns jsonb
language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_array(
    jsonb_build_object('id', 'noise_meter', 'layer', 'modifier', 'name', 'Noise Meter', 'parameters', '{}'::jsonb),
    jsonb_build_object('id', 'dead_drops', 'layer', 'modifier', 'name', 'Dead Drops', 'parameters', '{}'::jsonb),
    jsonb_build_object('id', 'hot_cold', 'layer', 'modifier', 'name', 'Hot & Cold Hunt', 'parameters', '{}'::jsonb),
    jsonb_build_object('id', 'shrinking_zone', 'layer', 'modifier', 'name', 'Shrinking Zone', 'parameters', '{}'::jsonb),
    jsonb_build_object('id', 'ai_gm', 'layer', 'modifier', 'name', 'AI Game Master', 'parameters', jsonb_build_object('event_interval_s', 180, 'max_events', 12))
  );
$$;

revoke all on function public.modifier_catalogue() from public, anon;
grant execute on function public.modifier_catalogue() to authenticated;
