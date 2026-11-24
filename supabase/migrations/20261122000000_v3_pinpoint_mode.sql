-- Migration: 20261122000000_v3_pinpoint_mode.sql
-- GhostRun v3.0 Flagship Mode: PINPOINT ("IRL OpenGuessr")
-- Adds pinpoint enum, feature flag, tables, mode catalogue entry, and scoring RPC

-- 1. Extend game_mode enum
alter type public.game_mode add value if not exists 'pinpoint';

-- 2. App Settings feature flag for Pinpoint
insert into public.app_settings (key, value) values
  ('feature.mode.pinpoint', 'true'::jsonb)
on conflict (key) do update set value = excluded.value;

-- 3. Update games_mode_id_check constraint on games table
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
    'outbreak_horde',
    'pinpoint'
  ));

-- 4. Update mode_catalogue() to include Pinpoint
create or replace function public.mode_catalogue()
returns jsonb
language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_array(
    jsonb_build_object(
      'id', 'pinpoint', 'layer', 'base', 'name', 'Pinpoint',
      'teams', jsonb_build_array('solo', 'team_a', 'team_b'), 'min_players', 1,
      'compatible_roles', jsonb_build_array('operator'),
      'compatible_modifiers', jsonb_build_array(
        'hot_cold', 'shrinking_zone', 'ai_gm'
      ),
      'parameters', jsonb_build_object(
        'radius_meters', 500,
        'photo_source', 'scout_and_swap',
        'total_rounds', 3,
        'round_duration_s', 180
      )
    ),
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

-- 5. Pinpoint Match Tables
create table if not exists public.pinpoint_games (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  radius_meters integer not null default 500 check (radius_meters between 100 and 750),
  photo_source text not null check (photo_source in ('scout_and_swap', 'host_drop', 'map_poi')),
  total_rounds integer not null default 3 check (total_rounds between 1 and 5),
  round_duration_seconds integer not null default 180 check (round_duration_seconds between 60 and 600),
  created_at timestamptz not null default now()
);

create table if not exists public.pinpoint_rounds (
  id uuid primary key default gen_random_uuid(),
  pinpoint_game_id uuid not null references public.pinpoint_games(id) on delete cascade,
  round_number integer not null,
  target_photo_url text not null,
  target_location extensions.geometry(Point, 4326) not null,
  target_heading numeric(5, 2) not null check (target_heading >= 0 and target_heading < 360),
  scouted_by_team text,
  status text not null default 'pending' check (status in ('pending', 'scouting', 'active', 'scoring', 'completed')),
  started_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.pinpoint_submissions (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.pinpoint_rounds(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  team text not null,
  submission_photo_url text,
  submission_location extensions.geometry(Point, 4326) not null,
  submission_heading numeric(5, 2) not null check (submission_heading >= 0 and submission_heading < 360),
  distance_error_meters numeric(7, 2) not null,
  heading_error_degrees numeric(5, 2) not null,
  score_proximity integer not null default 0,
  score_heading integer not null default 0,
  score_speed integer not null default 0,
  clues_unlocked integer not null default 0,
  total_score integer not null default 0,
  submitted_at timestamptz not null default now()
);

-- Indexes for performance
create index if not exists idx_pinpoint_games_game on public.pinpoint_games(game_id);
create index if not exists idx_pinpoint_rounds_game on public.pinpoint_rounds(pinpoint_game_id, round_number);
create index if not exists idx_pinpoint_submissions_round on public.pinpoint_submissions(round_id, player_id);

-- RLS
alter table public.pinpoint_games enable row level security;
alter table public.pinpoint_rounds enable row level security;
alter table public.pinpoint_submissions enable row level security;

create policy "pinpoint_games_select_players"
  on public.pinpoint_games for select
  using (exists (
    select 1 from public.players p
    where p.game_id = pinpoint_games.game_id
      and p.user_id = auth.uid()
  ));

create policy "pinpoint_rounds_select_players"
  on public.pinpoint_rounds for select
  using (exists (
    select 1 from public.pinpoint_games pg
    join public.players p on p.game_id = pg.game_id
    where pg.id = pinpoint_rounds.pinpoint_game_id
      and p.user_id = auth.uid()
  ));

create policy "pinpoint_submissions_select"
  on public.pinpoint_submissions for select
  using (exists (
    select 1 from public.pinpoint_rounds pr
    join public.pinpoint_games pg on pg.id = pr.pinpoint_game_id
    join public.players p on p.game_id = pg.game_id
    where pr.id = pinpoint_submissions.round_id
      and p.user_id = auth.uid()
  ));

create policy "pinpoint_submissions_insert"
  on public.pinpoint_submissions for insert
  with check (player_id = auth.uid());

-- 6. Server-Authoritative PostGIS Scoring Function
create or replace function public.submit_pinpoint_shot(
  p_round_id uuid,
  p_player_id uuid,
  p_team text,
  p_submission_photo_url text,
  p_lat double precision,
  p_lng double precision,
  p_heading numeric,
  p_clues_unlocked integer
) returns jsonb as $$
declare
  v_round record;
  v_sub_point extensions.geometry;
  v_dist_meters numeric;
  v_heading_diff numeric;
  v_score_prox integer;
  v_score_head integer;
  v_score_speed integer;
  v_multiplier numeric := 1.0;
  v_total_score integer;
  v_elapsed_sec numeric;
  v_k_factor numeric := 100.0;
begin
  select * into v_round from public.pinpoint_rounds where id = p_round_id;
  if not found or v_round.status != 'active' then
    raise exception 'Round is not currently active';
  end if;

  v_sub_point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326);
  v_dist_meters := extensions.st_distance(v_sub_point::extensions.geography, v_round.target_location::extensions.geography);

  -- Heading difference normalization (0 - 180 deg)
  v_heading_diff := abs(p_heading - v_round.target_heading);
  v_heading_diff := mod(v_heading_diff, 360.0);
  if v_heading_diff > 180.0 then
    v_heading_diff := 360.0 - v_heading_diff;
  end if;

  -- Proximity score (0 - 4000 pts)
  v_score_prox := round(4000.0 * exp(-1.0 * v_dist_meters / v_k_factor));
  if v_dist_meters <= 3.0 then v_score_prox := 4000; end if;
  if v_dist_meters > 400.0 then v_score_prox := 0; end if;

  -- Heading alignment score (0 - 500 pts)
  if v_heading_diff < 90.0 then
    v_score_head := round(500.0 * cos(radians(v_heading_diff)));
  else
    v_score_head := 0;
  end if;

  -- Speed bonus (0 - 500 pts)
  v_elapsed_sec := extract(epoch from (now() - coalesce(v_round.started_at, now())));
  v_score_speed := greatest(0, round(500.0 * (1.0 - (v_elapsed_sec / 180.0))));

  -- Clue penalty multiplier
  if p_clues_unlocked = 1 then v_multiplier := 0.9;
  elsif p_clues_unlocked = 2 then v_multiplier := 0.8;
  elsif p_clues_unlocked >= 3 then v_multiplier := 0.7;
  end if;

  v_total_score := least(5000, round((v_score_prox + v_score_head + v_score_speed) * v_multiplier));

  insert into public.pinpoint_submissions (
    round_id, player_id, team, submission_photo_url, submission_location,
    submission_heading, distance_error_meters, heading_error_degrees,
    score_proximity, score_heading, score_speed, clues_unlocked, total_score
  ) values (
    p_round_id, p_player_id, p_team, p_submission_photo_url, v_sub_point,
    p_heading, round(v_dist_meters, 1), round(v_heading_diff, 1),
    v_score_prox, v_score_head, v_score_speed, p_clues_unlocked, v_total_score
  );

  return jsonb_build_object(
    'distance_error_meters', round(v_dist_meters, 1),
    'heading_error_degrees', round(v_heading_diff, 1),
    'score_proximity', v_score_prox,
    'score_heading', v_score_head,
    'score_speed', v_score_speed,
    'clue_multiplier', v_multiplier,
    'total_score', v_total_score
  );
end;
$$ language plpgsql security definer;

revoke all on function public.submit_pinpoint_shot from public, anon;
grant execute on function public.submit_pinpoint_shot to authenticated;
