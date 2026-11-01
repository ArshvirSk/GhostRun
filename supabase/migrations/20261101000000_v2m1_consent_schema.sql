-- V2-M1 privacy: consent records, per-game route sharing (C3), and the schema
-- readiness needed before an account can actually be deleted.
--
-- Consent choices are append-only: clients can never UPDATE or DELETE them, and
-- INSERT happens only through SECURITY DEFINER RPCs (see the next migration).
-- The latest row per (user_id, consent_type) is the current state.
--
-- players.share_trail is NULL until the player chooses in the lobby sheet. The
-- lobby blocks ready-up and start_game blocks the round until every active
-- player has chosen (C3 has no default by design).

create table public.consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  consent_type text not null check (consent_type in
    ('location', 'policy_ack', 'ghost', 'leaderboard_name', 'diagnostics')),
  granted boolean not null,
  policy_version integer,
  created_at timestamptz not null default now()
);
create index consents_user_type_idx
  on public.consents(user_id, consent_type, created_at desc);

alter table public.consents enable row level security;
-- No policies and no grants: reads and writes go through security-definer RPCs
-- only, which keeps the append-only guarantee and one central filter.

revoke all on public.consents from anon, authenticated;

alter table public.players
  add column share_trail boolean,
  add column share_choice_at timestamptz;

-- my_player_id: policy helper, same trust model as is_member/my_team. Defined
-- before the policy below because CREATE POLICY resolves it immediately.
create or replace function public.my_player_id(game_id uuid)
returns uuid
language sql stable security definer
set search_path = public, extensions
as $$
  select id from public.players
  where players.game_id = $1 and user_id = auth.uid() and status <> 'left'
  limit 1;
$$;

revoke all on function public.my_player_id(uuid) from public, anon;
grant execute on function public.my_player_id(uuid) to authenticated;

-- C3 trail rule: after a game ends, a reader sees another player's trail only
-- when that player chose to share. Everyone always sees their own. During play
-- nobody sees trails, exactly as in v1.
drop policy if exists trails_after_end on public.trail_points;
create policy trails_after_end
  on public.trail_points
  for select
  to authenticated
  using (
    public.is_member(game_id)
    and (
      player_id = public.my_player_id(game_id)
      or (
        public.game_ended(game_id)
        and exists (
          select 1 from public.players p
          where p.id = trail_points.player_id and p.share_trail = true
        )
      )
    )
  );

-- Account deletion readiness (audit C-8): v1 foreign keys were NO ACTION, so
-- deleting a profile with game history raised FK violations. Tags and targets
-- keep the shared game record with a null actor (replay shows "Deleted player");
-- a player's own rows (positions, pings, trails) cascade with the profile.

alter table public.players
  drop constraint players_user_id_fkey,
  add constraint players_user_id_fkey
    foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.targets
  alter column set_by drop not null,
  drop constraint targets_set_by_fkey,
  add constraint targets_set_by_fkey
    foreign key (set_by) references public.players(id) on delete set null;

alter table public.tags
  alter column hunter_id drop not null,
  alter column runner_id drop not null,
  drop constraint tags_hunter_id_fkey,
  drop constraint tags_runner_id_fkey,
  add constraint tags_hunter_id_fkey
    foreign key (hunter_id) references public.players(id) on delete set null,
  add constraint tags_runner_id_fkey
    foreign key (runner_id) references public.players(id) on delete set null;

-- The host of a finished game may delete their account; the row must survive
-- with a null host so the remaining players keep their replay. In-flight games
-- are reassigned by delete_my_data before the delete happens.
alter table public.games
  alter column host_id drop not null,
  drop constraint games_host_id_fkey,
  add constraint games_host_id_fkey
    foreign key (host_id) references public.profiles(id) on delete set null;


