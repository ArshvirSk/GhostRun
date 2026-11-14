-- NF-12: Remote Push Notifications Token Management Schema

create table if not exists public.user_push_tokens (
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('android', 'ios', 'web')),
  categories jsonb not null default '{"lobby_invites":true,"game_starting":true,"scheduled_reminders":true}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

create index if not exists user_push_tokens_user_idx on public.user_push_tokens(user_id);
create index if not exists user_push_tokens_active_idx on public.user_push_tokens(is_active) where is_active = true;

alter table public.user_push_tokens enable row level security;

create policy user_push_tokens_select_own on public.user_push_tokens
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy user_push_tokens_insert_own on public.user_push_tokens
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy user_push_tokens_update_own on public.user_push_tokens
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy user_push_tokens_delete_own on public.user_push_tokens
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- RPC register_push_token
create or replace function public.register_push_token(
  p_token text,
  p_platform text,
  p_categories jsonb default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_defaults jsonb := '{"lobby_invites":true,"game_starting":true,"scheduled_reminders":true}'::jsonb;
begin
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  if trim(p_token) = '' then
    raise exception 'Token cannot be empty';
  end if;

  if p_platform not in ('android', 'ios', 'web') then
    raise exception 'Invalid platform';
  end if;

  insert into public.user_push_tokens (
    user_id,
    token,
    platform,
    categories,
    is_active,
    updated_at
  ) values (
    v_caller_id,
    trim(p_token),
    p_platform,
    coalesce(p_categories, v_defaults),
    true,
    now()
  )
  on conflict (user_id, token) do update
  set is_active = true,
      platform = excluded.platform,
      categories = coalesce(excluded.categories, public.user_push_tokens.categories),
      updated_at = now();
end;
$$;

-- RPC delete_push_token
create or replace function public.delete_push_token(
  p_token text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
begin
  if v_caller_id is null then
    return;
  end if;

  delete from public.user_push_tokens
  where user_id = v_caller_id and token = trim(p_token);
end;
$$;
