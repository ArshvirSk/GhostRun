-- Migration: 20261120163000_v3_outbreak_horde_mode.sql
-- Add outbreak_horde to public.game_mode enum and update games_mode_id_check & mode_catalogue

-- 1. Extend game_mode enum
alter type public.game_mode add value if not exists 'outbreak_horde';

-- 2. App Settings feature flag for Outbreak Horde
insert into public.app_settings (key, value) values
  ('feature.mode.outbreak_horde', 'true'::jsonb)
on conflict (key) do update set value = excluded.value;

-- 2. Update games_mode_id_check constraint on games table
alter table public.games drop constraint if exists games_mode_id_check;
alter table public.games add constraint games_mode_id_check
  check (mode_id in (
    'classic_chase',
    'tag_hunt',
    'haunted_map',
    'ghost_duel',
    'jailbreak',
    'assassin_ring',
    'relay_heist',
    'territory_pulse',
    'outbreak_horde'
  ));

-- 3. Update mode_catalogue() to include Outbreak Horde
create or replace function public.mode_catalogue()
returns jsonb
language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_array(
    jsonb_build_object(
      'id', 'outbreak_horde', 'layer', 'base', 'name', 'Outbreak Horde',
      'teams', jsonb_build_array('human', 'zombie'), 'min_players', 2,
      'compatible_roles', jsonb_build_array('operator', 'vip'),
      'compatible_modifiers', jsonb_build_array(
        'shrinking_zone', 'ai_gm'
      ),
      'parameters', jsonb_build_object(
        'initial_lifespan_s', 360,
        'decay_rate_s', 1,
        'antidote_cure_pct', 50,
        'drop_interval_s', 60
      )
    ),
    jsonb_build_object(
      'id', 'classic_chase', 'layer', 'base', 'name', 'Classic Chase',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 2,
      'compatible_roles', jsonb_build_array('double_agent', 'vip', 'operator'),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'shrinking_zone', 'ai_gm', 'qr_tagging'
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
