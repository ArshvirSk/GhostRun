-- V2-M4: Hot & Cold Hunt schema.
-- Shared hunter charge pool (team_resources), individual press audit (heat_presses),
-- and the time-windowed view (heat_press_feed) that hunters read during live play.

create table if not exists public.team_resources (
  game_id uuid not null references public.games(id) on delete cascade,
  team text not null check (team in ('runner', 'hunter')),
  heat_charges integer not null default 6,
  heat_updated_at timestamptz not null default now(),
  primary key (game_id, team)
);

alter table public.team_resources enable row level security;

drop policy if exists team_resources_own_team on public.team_resources;
create policy team_resources_own_team on public.team_resources for select to authenticated
  using (public.is_member(game_id) and team = public.my_team(game_id)::text);

revoke all on public.team_resources from anon, authenticated;
grant select on public.team_resources to authenticated;

-- Every press, for marks and post-game replay.
create table if not exists public.heat_presses (
  id bigserial primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  hunter_id uuid not null references public.players(id),
  variant text not null check (variant in ('proximity', 'trend')),
  result text not null check (result in ('hot', 'cold', 'no_change')),
  hunter_geog extensions.geography(Point, 4326) not null,
  nearest_runner_m real,              -- replay only, never exposed during play
  pressed_at timestamptz not null default now()
);

create index if not exists heat_presses_game_hunter_idx
  on public.heat_presses(game_id, hunter_id, pressed_at desc);

create index if not exists heat_presses_pressed_at_idx
  on public.heat_presses(game_id, pressed_at desc);

alter table public.heat_presses enable row level security;

-- Base table: readable only when the game has ended (for recap / replay).
drop policy if exists heat_presses_replay on public.heat_presses;
create policy heat_presses_replay on public.heat_presses for select to authenticated
  using (public.is_member(game_id) and public.game_ended(game_id));

revoke all on public.heat_presses from anon, authenticated;
grant select on public.heat_presses to authenticated;

-- During play, hunters read this owner-rights view. It enforces membership, hunter
-- role, and a 5-minute fading window. nearest_runner_m is strictly excluded.
create or replace view public.heat_press_feed
with (security_barrier = true) as
select
  id,
  game_id,
  hunter_id,
  variant,
  result,
  hunter_geog,
  pressed_at
from public.heat_presses
where public.is_member(game_id)
  and public.my_team(game_id) = 'hunter'
  and pressed_at >= now() - interval '5 minutes';

revoke all on public.heat_press_feed from anon, authenticated;
grant select on public.heat_press_feed to authenticated;
