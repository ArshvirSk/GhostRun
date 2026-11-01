-- V2-M2 mode framework schema.
--
-- v1 keeps the games.mode enum so the released APK never loses its field.
-- v2 adds mode_id text as the canonical selector (defaulted to classic_chase,
-- kept in sync by the RPCs) plus roles/modifiers/mode_params. Existing games
-- therefore read as classic_chase with no roles and no modifiers.
--
-- Secret per-player state (secret_role, status_detail) is hidden with
-- column-level grants: clients keep their SELECT on the safe columns only, and
-- the owner reads a secret role through get_my_role(). This is stronger than a
-- row policy because teammates share the same row.

alter table public.games
  add column mode_id text not null default 'classic_chase'
    check (mode_id in ('classic_chase', 'tag_hunt')),
  add column roles text[] not null default '{}',
  add column modifiers text[] not null default '{}',
  add column mode_params jsonb not null default '{}';

update public.games set mode_id = mode::text where mode_id <> mode::text;

alter table public.players
  add column secret_role text,
  add column is_remote boolean not null default false,
  add column status_detail jsonb not null default '{}';

-- players: keep row reads for members, restrict columns. secret_role and
-- status_detail are owner-only through RPCs.
revoke select on public.players from authenticated;
grant select (
  id, game_id, user_id, team, status, is_ready, last_tag_attempt_at,
  joined_at, tagged_at, share_trail, share_choice_at, is_remote
) on public.players to authenticated;

-- entities: NPCs, items, drops, zones. Visible only when the row's own
-- visible_to matches the caller (or 'all'). 'owner' visibility stays closed
-- until an owner column exists; nothing in v2.0 uses it.
create table public.entities (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  kind text not null,
  team text check (team in ('runner', 'hunter')),
  geog extensions.geography(Point, 4326),
  state jsonb not null default '{}',
  visible_to text not null default 'none'
    check (visible_to in ('none', 'runner', 'hunter', 'all', 'owner')),
  updated_at timestamptz not null default now()
);
create index entities_game_kind_idx on public.entities(game_id, kind);

alter table public.entities enable row level security;
create policy entities_visible_to_caller on public.entities for select to authenticated
  using (
    public.is_member(game_id)
    and (
      visible_to = 'all'
      or (visible_to = 'runner' and public.my_team(game_id) = 'runner')
      or (visible_to = 'hunter' and public.my_team(game_id) = 'hunter')
    )
  );
revoke all on public.entities from anon, authenticated;
grant select on public.entities to authenticated;

-- player_resources: owner-only economy (charges, cooldowns, tokens).
create table public.player_resources (
  player_id uuid primary key references public.players(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  tokens integer not null default 0,
  charges jsonb not null default '{}',
  cooldowns jsonb not null default '{}'
);
create index player_resources_game_idx on public.player_resources(game_id);

alter table public.player_resources enable row level security;
create policy player_resources_own on public.player_resources for select to authenticated
  using (
    public.is_member(game_id)
    and player_id = public.my_player_id(game_id)
  );
revoke all on public.player_resources from anon, authenticated;
grant select on public.player_resources to authenticated;

-- team_resources: shared pool for team-wide abilities (Hot & Cold charges).
create table public.team_resources (
  game_id uuid not null references public.games(id) on delete cascade,
  team text not null check (team in ('runner', 'hunter')),
  heat_charges integer not null default 6,
  heat_updated_at timestamptz not null default now(),
  primary key (game_id, team)
);

alter table public.team_resources enable row level security;
create policy team_resources_own_team on public.team_resources for select to authenticated
  using (public.is_member(game_id) and team = public.my_team(game_id)::text);
revoke all on public.team_resources from anon, authenticated;
grant select on public.team_resources to authenticated;

-- events.target_player: a row with a target is readable only by that player,
-- regardless of audience. Existing rows stay NULL and behave exactly as before.
alter table public.events add column target_player uuid references public.players(id) on delete cascade;
create index events_target_idx on public.events(target_player) where target_player is not null;

drop policy events_audience_read on public.events;
create policy events_audience_read on public.events for select to authenticated
  using (
    public.is_member(game_id)
    and (
      (
        target_player is null
        and (audience = 'all' or audience = public.my_team(game_id)::text)
      )
      or target_player = public.my_player_id(game_id)
    )
  );

-- Server-side feature flags. Clients never read the table; the registry RPC
-- exposes only what is enabled. Unfinished modes/modifiers default off.
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

insert into public.app_settings (key, value) values
  ('feature.mode.classic_chase', 'true'::jsonb),
  ('feature.mode.tag_hunt', 'true'::jsonb),
  ('feature.role.double_agent', 'false'::jsonb),
  ('feature.role.vip', 'false'::jsonb),
  ('feature.role.operator', 'false'::jsonb),
  ('feature.modifier.noise_meter', 'false'::jsonb),
  ('feature.modifier.dead_drops', 'false'::jsonb),
  ('feature.modifier.qr_tagging', 'false'::jsonb),
  ('feature.modifier.shrinking_zone', 'false'::jsonb),
  ('feature.modifier.hot_cold', 'false'::jsonb)
on conflict (key) do nothing;

create or replace function public.feature_enabled(setting_key text)
returns boolean
language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(
    (select value from public.app_settings where key = setting_key),
    'false'::jsonb
  ) = 'true'::jsonb;
$$;

revoke all on function public.feature_enabled(text) from public, anon, authenticated;

-- Owner-only read of secret per-player state.
create or replace function public.get_my_role(game_id uuid)
returns jsonb
language sql stable security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'role', p.secret_role,
    'status_detail', p.status_detail,
    'is_remote', p.is_remote
  )
  from public.players p
  where p.game_id = get_my_role.game_id
    and p.user_id = auth.uid()
    and p.status <> 'left';
$$;

revoke all on function public.get_my_role(uuid) from public, anon;
grant execute on function public.get_my_role(uuid) to authenticated;
