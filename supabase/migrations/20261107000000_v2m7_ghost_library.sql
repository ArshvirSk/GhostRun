-- V2-M7 (v2.2): Ghost Library & Consent C4 Infrastructure
--
-- MODES.md §6.1, §7.4.4, §7.4.5:
-- - ghost_library: anonymized, trimmed, simplified paths from opted-in players.
--   Zero direct client selects (server RPC only).
-- - ghost_contributions: private user lookup for viewing and deleting contributions.
-- - preview_ghost: returns trimmed/simplified geometry without saving.
-- - contribute_ghost: trims first/last 150m, simplifies (Douglas-Peucker 5-10m),
--   validates >= 300m trimmed length (>= 600m total), stores in library & contributions.
-- - delete_my_ghosts: self-service deletion of user contributions.
-- - Retention: 90 days for ghost_library.

-- 1. Tables -------------------------------------------------------------------

create table if not exists public.ghost_library (
  id uuid primary key default gen_random_uuid(),
  area_center geography(Point, 4326) not null,
  area_radius int not null,
  path geography(LineString, 4326) not null,
  duration_s int not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ghost_contributions (
  ghost_id uuid primary key references public.ghost_library(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists ghost_library_center_idx on public.ghost_library using gist(area_center);
create index if not exists ghost_library_created_idx on public.ghost_library(created_at);
create index if not exists ghost_contributions_user_idx on public.ghost_contributions(user_id);

-- 2. Security & RLS -----------------------------------------------------------

alter table public.ghost_library enable row level security;
alter table public.ghost_contributions enable row level security;

-- ghost_library is never directly selectable by clients. Server RPCs only.
revoke all on public.ghost_library from public, anon, authenticated;

-- ghost_contributions is visible and deletable only by its owner
revoke all on public.ghost_contributions from public, anon, authenticated;
grant select, delete on public.ghost_contributions to authenticated;

drop policy if exists ghost_contrib_owner_select on public.ghost_contributions;
create policy ghost_contrib_owner_select on public.ghost_contributions
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists ghost_contrib_owner_delete on public.ghost_contributions;
create policy ghost_contrib_owner_delete on public.ghost_contributions
  for delete to authenticated
  using (user_id = auth.uid());

-- 3. RPC: preview_ghost -------------------------------------------------------

create or replace function public.preview_ghost(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  p_id uuid;
  g_status public.game_status;
  full_line geometry;
  total_len real;
  start_frac real;
  end_frac real;
  trimmed_geom geometry;
  simplified_geom geometry;
  duration int;
  pt_count int;
begin
  if caller_id is null then
    raise exception 'Authentication required.';
  end if;

  select g.status into g_status
  from public.games g
  where g.id = preview_ghost.game_id;

  if g_status is null or g_status <> 'ended' then
    raise exception 'Game has not ended or does not exist.';
  end if;

  select p.id into p_id
  from public.players p
  where p.game_id = preview_ghost.game_id and p.user_id = caller_id;

  if p_id is null then
    raise exception 'Caller is not a member of this game.';
  end if;

  -- Build line from ordered trail points
  select
    extensions.st_makeline(tp.geog::geometry order by tp.recorded_at asc),
    extract(epoch from (max(tp.recorded_at) - min(tp.recorded_at)))::int,
    count(*)
  into full_line, duration, pt_count
  from public.trail_points tp
  where tp.game_id = preview_ghost.game_id and tp.player_id = p_id;

  if full_line is null or pt_count < 5 then
    return jsonb_build_object(
      'can_contribute', false,
      'reason', 'Trail has too few points to preview.',
      'original_length_m', 0,
      'trimmed_length_m', 0,
      'duration_s', 0,
      'coordinates', '[]'::jsonb
    );
  end if;

  total_len := extensions.st_length(full_line::geography);

  -- Minimum 600m total so at least 300m remains after trimming 150m from start & end
  if total_len < 600.0 then
    return jsonb_build_object(
      'can_contribute', false,
      'reason', 'Trail is too short (minimum 600 m needed for privacy trimming).',
      'original_length_m', round(total_len::numeric, 1),
      'trimmed_length_m', 0,
      'duration_s', duration,
      'coordinates', '[]'::jsonb
    );
  end if;

  start_frac := 150.0 / total_len;
  end_frac := (total_len - 150.0) / total_len;

  trimmed_geom := extensions.st_linesubstring(full_line, start_frac, end_frac);
  -- Douglas-Peucker simplification with ~0.00008 deg (~8-9m tolerance)
  simplified_geom := extensions.st_simplify(trimmed_geom, 0.00008);

  return jsonb_build_object(
    'can_contribute', true,
    'reason', null,
    'original_length_m', round(total_len::numeric, 1),
    'trimmed_length_m', round(extensions.st_length(simplified_geom::geography)::numeric, 1),
    'duration_s', duration,
    'geojson', extensions.st_asgeojson(simplified_geom)::jsonb
  );
end;
$$;

revoke all on function public.preview_ghost(uuid) from public, anon;
grant execute on function public.preview_ghost(uuid) to authenticated;

-- 4. RPC: contribute_ghost ----------------------------------------------------

create or replace function public.contribute_ghost(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  p_id uuid;
  target_game record;
  full_line geometry;
  total_len real;
  start_frac real;
  end_frac real;
  trimmed_geom geometry;
  simplified_geom geometry;
  trimmed_path geography;
  duration int;
  pt_count int;
  new_ghost_id uuid;
  trimmed_len real;
begin
  if caller_id is null then
    raise exception 'Authentication required.';
  end if;

  select * into target_game
  from public.games g
  where g.id = contribute_ghost.game_id;

  if target_game.id is null or target_game.status <> 'ended' then
    raise exception 'Game has not ended or does not exist.';
  end if;

  select p.id into p_id
  from public.players p
  where p.game_id = contribute_ghost.game_id and p.user_id = caller_id;

  if p_id is null then
    raise exception 'Caller is not a player in this game.';
  end if;

  -- Check if already contributed for this game
  if exists (
    select 1 from public.ghost_contributions gc
    join public.ghost_library gl on gl.id = gc.ghost_id
    where gc.user_id = caller_id and gl.area_center = target_game.area_center and gl.created_at >= target_game.created_at
  ) then
    -- Allow re-contribution or ignore
    null;
  end if;

  -- Build line from ordered trail points
  select
    extensions.st_makeline(tp.geog::geometry order by tp.recorded_at asc),
    extract(epoch from (max(tp.recorded_at) - min(tp.recorded_at)))::int,
    count(*)
  into full_line, duration, pt_count
  from public.trail_points tp
  where tp.game_id = contribute_ghost.game_id and tp.player_id = p_id;

  if full_line is null or pt_count < 5 then
    raise exception 'Trail has insufficient points to contribute.';
  end if;

  total_len := extensions.st_length(full_line::geography);

  if total_len < 600.0 then
    raise exception 'Trail is too short (%m). Minimum 600m required for privacy trimming.', round(total_len);
  end if;

  start_frac := 150.0 / total_len;
  end_frac := (total_len - 150.0) / total_len;

  trimmed_geom := extensions.st_linesubstring(full_line, start_frac, end_frac);
  simplified_geom := extensions.st_simplify(trimmed_geom, 0.00008);
  trimmed_path := simplified_geom::geography;
  trimmed_len := extensions.st_length(trimmed_path);

  if trimmed_len < 300.0 then
    raise exception 'Trimmed route is under 300m (%m).', round(trimmed_len);
  end if;

  -- Store anonymized route in library
  insert into public.ghost_library (
    area_center,
    area_radius,
    path,
    duration_s
  ) values (
    target_game.area_center,
    target_game.area_radius,
    trimmed_path,
    duration
  ) returning id into new_ghost_id;

  -- Record private contribution pointer for user self-service deletion
  insert into public.ghost_contributions (
    ghost_id,
    user_id
  ) values (
    new_ghost_id,
    caller_id
  );

  -- Record C4 consent grant
  insert into public.consents (user_id, consent_type, granted)
    values (caller_id, 'ghost', true);

  return jsonb_build_object(
    'success', true,
    'ghost_id', new_ghost_id,
    'trimmed_length_m', round(trimmed_len::numeric, 1),
    'duration_s', duration
  );
end;
$$;

revoke all on function public.contribute_ghost(uuid) from public, anon;
grant execute on function public.contribute_ghost(uuid) to authenticated;

-- 5. RPC: delete_my_ghosts ----------------------------------------------------

create or replace function public.delete_my_ghosts(ghost_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  deleted_count int;
begin
  if caller_id is null then
    raise exception 'Authentication required.';
  end if;

  if ghost_ids is null then
    -- Delete all contributions for this user
    with deleted as (
      delete from public.ghost_library gl
      where gl.id in (
        select gc.ghost_id from public.ghost_contributions gc
        where gc.user_id = caller_id
      )
      returning gl.id
    )
    select count(*) into deleted_count from deleted;

    delete from public.ghost_contributions where user_id = caller_id;
  else
    -- Delete only specified ghost ids belonging to caller
    with deleted as (
      delete from public.ghost_library gl
      where gl.id in (
        select gc.ghost_id from public.ghost_contributions gc
        where gc.user_id = caller_id and gc.ghost_id = any(ghost_ids)
      )
      returning gl.id
    )
    select count(*) into deleted_count from deleted;

    delete from public.ghost_contributions
    where user_id = caller_id and ghost_id = any(ghost_ids);
  end if;

  return jsonb_build_object(
    'deleted_count', deleted_count
  );
end;
$$;

revoke all on function public.delete_my_ghosts(uuid[]) from public, anon;
grant execute on function public.delete_my_ghosts(uuid[]) to authenticated;

-- 6. RPC: list_my_ghosts ------------------------------------------------------

create or replace function public.list_my_ghosts()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'ghost_id', gl.id,
    'area_radius', gl.area_radius,
    'duration_s', gl.duration_s,
    'length_m', round(extensions.st_length(gl.path)::numeric, 1),
    'created_at', gl.created_at
  ) order by gl.created_at desc), '[]'::jsonb)
  from public.ghost_contributions gc
  join public.ghost_library gl on gl.id = gc.ghost_id
  where gc.user_id = auth.uid();
$$;

revoke all on function public.list_my_ghosts() from public, anon;
grant execute on function public.list_my_ghosts() to authenticated;

-- 7. Update cleanup_old_games retention (90 days for ghosts) -------------------

create or replace function public.cleanup_old_games()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cutoff timestamptz := now() - interval '30 days';
  ghost_cutoff timestamptz := now() - interval '90 days';
  games_count int := 0;
  ghosts_count int := 0;
begin
  -- 30-day retention on ended games
  with deleted_games as (
    delete from public.games
    where status = 'ended' and ended_at < cutoff
    returning id
  )
  select count(*) into games_count from deleted_games;

  -- 90-day retention on ghost library entries
  with deleted_ghosts as (
    delete from public.ghost_library
    where created_at < ghost_cutoff
    returning id
  )
  select count(*) into ghosts_count from deleted_ghosts;

  return jsonb_build_object(
    'deleted_games', games_count,
    'deleted_ghosts', ghosts_count,
    'cleaned_at', now()
  );
end;
$$;
