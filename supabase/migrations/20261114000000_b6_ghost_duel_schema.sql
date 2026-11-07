-- Migration: 20261114000000_b6_ghost_duel_schema.sql
-- Phase B Milestone B6: Solo Ghost Duel (ghost_duel) Base Mode
-- MODES.md §4.4, §6.2, §7.4

-- 1. Table: ghost_duel_scores -------------------------------------------------
create table if not exists public.ghost_duel_scores (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  variant text not null check (variant in ('time_trial', 'evade', 'mirror_chase')),
  area_center geography(Point, 4326) not null,
  player_time_s double precision not null,
  ghost_time_s double precision not null,
  delta_s double precision not null,
  efficiency real not null default 1.0,
  score integer not null,
  created_at timestamptz not null default now()
);

create index if not exists ghost_duel_scores_area_idx on public.ghost_duel_scores using gist(area_center);
create index if not exists ghost_duel_scores_user_idx on public.ghost_duel_scores(user_id);
create index if not exists ghost_duel_scores_ranking_idx on public.ghost_duel_scores(variant, score desc);

-- 2. Security & RLS -----------------------------------------------------------
alter table public.ghost_duel_scores enable row level security;
revoke all on public.ghost_duel_scores from public, anon;
grant select on public.ghost_duel_scores to authenticated;

drop policy if exists ghost_duel_scores_select on public.ghost_duel_scores;
create policy ghost_duel_scores_select on public.ghost_duel_scores
  for select to authenticated using (true);

-- 3. Feature Flag & App Settings ----------------------------------------------
insert into public.app_settings (key, value)
values ('feature.mode.ghost_duel', 'true'::jsonb)
on conflict (key) do update
set value = 'true'::jsonb, updated_at = now();

-- 4. RPC: get_ghost_duel_leaderboard ------------------------------------------
create or replace function public.get_ghost_duel_leaderboard(
  lat double precision,
  lng double precision,
  radius_m integer default 5000,
  variant text default 'time_trial',
  row_limit integer default 20
)
returns table (
  rank bigint,
  display_name text,
  score integer,
  player_time_s double precision,
  ghost_time_s double precision,
  delta_s double precision,
  efficiency real,
  created_at timestamptz
)
language sql
security definer
set search_path = public, extensions
as $$
  with ranked as (
    select
      gds.id,
      gds.user_id,
      gds.score,
      gds.player_time_s,
      gds.ghost_time_s,
      gds.delta_s,
      gds.efficiency,
      gds.created_at,
      row_number() over (order by gds.score desc, gds.delta_s desc, gds.created_at asc) as rank
    from public.ghost_duel_scores gds
    where gds.variant = get_ghost_duel_leaderboard.variant
      and extensions.st_dwithin(
        gds.area_center,
        extensions.st_setsrid(extensions.st_makepoint(get_ghost_duel_leaderboard.lng, get_ghost_duel_leaderboard.lat), 4326)::geography,
        get_ghost_duel_leaderboard.radius_m
      )
    limit get_ghost_duel_leaderboard.row_limit
  ),
  with_consent as (
    select
      r.*,
      coalesce(c.granted, false) as name_consent,
      pr.display_name as user_name
    from ranked r
    left join public.profiles pr on pr.id = r.user_id
    left join lateral (
      select cs.granted
      from public.consents cs
      where cs.user_id = r.user_id and cs.consent_type = 'leaderboard_name'
      order by cs.created_at desc
      limit 1
    ) c on true
  )
  select
    wc.rank,
    case when wc.name_consent then coalesce(wc.user_name, 'Runner') else 'Anonymous Runner' end as display_name,
    wc.score,
    wc.player_time_s,
    wc.ghost_time_s,
    wc.delta_s,
    wc.efficiency,
    wc.created_at
  from with_consent wc
  order by wc.rank asc;
$$;

revoke all on function public.get_ghost_duel_leaderboard(double precision, double precision, integer, text, integer) from public, anon;
grant execute on function public.get_ghost_duel_leaderboard(double precision, double precision, integer, text, integer) to authenticated;

-- 5. RPC: tag_ghost -----------------------------------------------------------
create or replace function public.tag_ghost(game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
  me public.players%rowtype;
  my_fix public.player_positions%rowtype;
  ghost_ent public.entities%rowtype;
  dist_m double precision;
  ghost_duration double precision;
  elapsed double precision;
  final_score integer;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into current_game from public.games where id = tag_ghost.game_id;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.status <> 'live' then raise exception 'The round is not live.'; end if;
  if current_game.mode_id <> 'ghost_duel' then raise exception 'tag_ghost is only for Ghost Duel.'; end if;

  select * into me from public.players where game_id = tag_ghost.game_id and user_id = caller_id and status = 'active';
  if not found then raise exception 'Active player not found.'; end if;

  select * into my_fix from public.player_positions where player_id = me.id;
  if not found or my_fix.recorded_at < now() - interval '15 seconds' then
    return jsonb_build_object('success', false, 'reason', 'stale_fix');
  end if;

  select * into ghost_ent from public.entities where game_id = tag_ghost.game_id and kind = 'ghost' limit 1;
  if not found or ghost_ent.geog is null then
    return jsonb_build_object('success', false, 'reason', 'no_ghost');
  end if;

  dist_m := extensions.st_distance(my_fix.geog, ghost_ent.geog);
  if dist_m > 10.0 then
    return jsonb_build_object('success', false, 'reason', 'out_of_range', 'distance_m', round(dist_m::numeric, 1));
  end if;

  ghost_duration := coalesce((ghost_ent.state->>'duration_s')::double precision, 240.0);
  elapsed := extract(epoch from (now() - current_game.live_at));
  final_score := greatest(100, round(1000 + ((ghost_duration - elapsed) * 10))::int);

  insert into public.ghost_duel_scores (
    game_id, user_id, variant, area_center, player_time_s, ghost_time_s, delta_s, efficiency, score
  ) values (
    current_game.id, caller_id, 'mirror_chase', current_game.area_center, elapsed, ghost_duration, ghost_duration - elapsed, 1.0, final_score
  );

  insert into public.events (game_id, type, audience, payload)
  values (
    current_game.id,
    'ghost_tagged',
    'all',
    jsonb_build_object('player_id', me.id, 'score', final_score, 'time_s', elapsed, 'message', 'Ghost caught! Hunter wins!')
  );

  perform public.end_game(current_game.id, 'hunters', 'ghost_tagged');

  return jsonb_build_object('success', true, 'score', final_score, 'distance_m', round(dist_m::numeric, 1));
end;
$$;

revoke all on function public.tag_ghost(uuid) from public, anon;
grant execute on function public.tag_ghost(uuid) to authenticated;
