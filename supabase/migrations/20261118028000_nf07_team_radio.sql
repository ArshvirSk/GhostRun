-- NF-07 & NF-08: Team Radio Comms & Report/Block Moderation Schema

-- 1. Blocks table
create table if not exists public.blocks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  blocked_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_user_id)
);

create index if not exists blocks_user_idx on public.blocks(user_id);
create index if not exists blocks_blocked_idx on public.blocks(blocked_user_id);

alter table public.blocks enable row level security;

create policy blocks_select_own on public.blocks
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy blocks_insert_own on public.blocks
  for insert to authenticated
  with check (user_id = (select auth.uid()) and blocked_user_id <> (select auth.uid()));

create policy blocks_delete_own on public.blocks
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- 2. Team Messages table
create table if not exists public.team_messages (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  team text not null,
  sender_player_id uuid not null references public.players(id) on delete cascade,
  sender_user_id uuid not null references public.profiles(id) on delete cascade,
  sender_name text not null,
  kind text not null check (kind in ('text', 'chip', 'system')),
  body text not null check (char_length(body) between 1 and 200),
  created_at timestamptz not null default now()
);

create index if not exists team_messages_game_team_created_idx
  on public.team_messages(game_id, team, created_at asc);

alter table public.team_messages enable row level security;

create policy team_messages_select_team_members on public.team_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.players p
      where p.game_id = team_messages.game_id
        and p.user_id = (select auth.uid())
        and (
          p.team::text = team_messages.team
          or coalesce(p.secret_role, '') = 'operator'
        )
    )
    and not exists (
      select 1 from public.blocks b
      where b.user_id = (select auth.uid())
        and b.blocked_user_id = team_messages.sender_user_id
    )
  );

-- 3. Reports table
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  game_id uuid references public.games(id) on delete set null,
  message_id uuid references public.team_messages(id) on delete set null,
  reason text not null,
  details text,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed', 'actioned')),
  created_at timestamptz not null default now()
);

create index if not exists reports_reporter_idx on public.reports(reporter_user_id);
create index if not exists reports_reported_idx on public.reports(reported_user_id);

alter table public.reports enable row level security;

create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (reporter_user_id = (select auth.uid()));

create policy reports_select_own on public.reports
  for select to authenticated
  using (reporter_user_id = (select auth.uid()));

-- 4. RPC send_team_message
create or replace function public.send_team_message(
  p_game_id uuid,
  p_kind text,
  p_body text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_caller_id uuid := auth.uid();
  v_player record;
  v_game record;
  v_recent_1s integer;
  v_recent_60s integer;
  v_clean_body text;
  v_new_msg record;
begin
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_game from public.games where id = p_game_id;
  if not found then
    raise exception 'Game not found';
  end if;

  select p.*, pr.display_name into v_player
  from public.players p
  join public.profiles pr on pr.id = p.user_id
  where p.game_id = p_game_id and p.user_id = v_caller_id;

  if not found then
    raise exception 'Player not in this game';
  end if;

  if v_player.status not in ('active', 'tagged') then
    raise exception 'Player cannot send messages in current status';
  end if;

  if p_kind not in ('text', 'chip', 'system') then
    raise exception 'Invalid message kind';
  end if;

  v_clean_body := trim(p_body);
  if char_length(v_clean_body) < 1 or char_length(v_clean_body) > 200 then
    raise exception 'Message length must be between 1 and 200 characters';
  end if;

  -- Rate limit: max 1 per second
  select count(*) into v_recent_1s
  from public.team_messages
  where sender_player_id = v_player.id
    and created_at >= (now() - interval '1 second');

  if v_recent_1s >= 1 then
    raise exception 'Rate limit exceeded: wait a moment before sending again';
  end if;

  -- Rate limit: max 20 per minute
  select count(*) into v_recent_60s
  from public.team_messages
  where sender_player_id = v_player.id
    and created_at >= (now() - interval '60 seconds');

  if v_recent_60s >= 20 then
    raise exception 'Rate limit exceeded: too many radio messages this minute';
  end if;

  insert into public.team_messages (
    game_id,
    team,
    sender_player_id,
    sender_user_id,
    sender_name,
    kind,
    body
  ) values (
    p_game_id,
    v_player.team::text,
    v_player.id,
    v_caller_id,
    v_player.display_name,
    p_kind,
    v_clean_body
  )
  returning * into v_new_msg;

  return jsonb_build_object(
    'id', v_new_msg.id,
    'game_id', v_new_msg.game_id,
    'team', v_new_msg.team,
    'sender_player_id', v_new_msg.sender_player_id,
    'sender_user_id', v_new_msg.sender_user_id,
    'sender_name', v_new_msg.sender_name,
    'kind', v_new_msg.kind,
    'body', v_new_msg.body,
    'created_at', v_new_msg.created_at
  );
end;
$$;

-- 5. RPC block_user
create or replace function public.block_user(p_target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
begin
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;
  if v_caller_id = p_target_user_id then
    raise exception 'Cannot block self';
  end if;

  insert into public.blocks (user_id, blocked_user_id)
  values (v_caller_id, p_target_user_id)
  on conflict do nothing;
end;
$$;

-- 6. RPC unblock_user
create or replace function public.unblock_user(p_target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
begin
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.blocks
  where user_id = v_caller_id and blocked_user_id = p_target_user_id;
end;
$$;

-- 7. RPC report_player
create or replace function public.report_player(
  p_reported_user_id uuid,
  p_game_id uuid,
  p_message_id uuid,
  p_reason text,
  p_details text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_report_id uuid;
begin
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.reports (
    reporter_user_id,
    reported_user_id,
    game_id,
    message_id,
    reason,
    details
  ) values (
    v_caller_id,
    p_reported_user_id,
    p_game_id,
    p_message_id,
    p_reason,
    p_details
  )
  returning id into v_report_id;

  return v_report_id;
end;
$$;
