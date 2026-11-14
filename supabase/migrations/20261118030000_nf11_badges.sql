-- NF-11: Badges & Personal Records Schema

create table if not exists public.player_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  badge_id text not null,
  game_id uuid references public.games(id) on delete set null,
  metadata jsonb default '{}'::jsonb,
  earned_at timestamptz not null default now(),
  unique (user_id, badge_id)
);

create index if not exists player_badges_user_idx on public.player_badges(user_id);
create index if not exists player_badges_badge_idx on public.player_badges(badge_id);

alter table public.player_badges enable row level security;

create policy player_badges_select_all on public.player_badges
  for select to authenticated
  using (true);

-- RPC award_match_badges
create or replace function public.award_match_badges(
  p_game_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_game record;
  v_player record;
  v_matches_count integer;
  v_awarded jsonb := '[]'::jsonb;
begin
  select * into v_game from public.games where id = p_game_id;
  select * into v_player from public.players where game_id = p_game_id and user_id = p_user_id;

  if not found then
    return v_awarded;
  end if;

  select count(distinct game_id) into v_matches_count
  from public.players
  where user_id = p_user_id;

  -- 1. First Deployment
  if v_matches_count >= 1 then
    insert into public.player_badges (user_id, badge_id, game_id, metadata)
    values (p_user_id, 'first_deployment', p_game_id, jsonb_build_object('matches', v_matches_count))
    on conflict do nothing;
  end if;

  -- 2. Veteran (10+ matches)
  if v_matches_count >= 10 then
    insert into public.player_badges (user_id, badge_id, game_id, metadata)
    values (p_user_id, 'veteran_operative', p_game_id, jsonb_build_object('matches', v_matches_count))
    on conflict do nothing;
  end if;

  -- 3. Victorious Hunt / Clean Sweep
  if v_player.team = 'hunter' and v_game.winner = 'hunters' then
    insert into public.player_badges (user_id, badge_id, game_id, metadata)
    values (p_user_id, 'clean_sweep', p_game_id, '{}'::jsonb)
    on conflict do nothing;
  end if;

  -- 4. Elusive Runner / Escape
  if v_player.team = 'runner' and v_game.winner = 'runners' and v_player.status = 'active' then
    insert into public.player_badges (user_id, badge_id, game_id, metadata)
    values (p_user_id, 'ghost_whisperer', p_game_id, '{}'::jsonb)
    on conflict do nothing;
  end if;

  select jsonb_agg(jsonb_build_object(
    'badge_id', badge_id,
    'earned_at', earned_at
  )) into v_awarded
  from public.player_badges
  where user_id = p_user_id and game_id = p_game_id;

  return coalesce(v_awarded, '[]'::jsonb);
end;
$$;
