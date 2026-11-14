-- NF-26: Admin Console & Remote Config Schema

create table if not exists public.admin_users (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

create table if not exists public.remote_config_flags (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

alter table public.remote_config_flags enable row level security;

-- RLS: remote_config_flags readable by everyone so app can adapt to disabled modes/kill-switches
create policy remote_config_flags_select on public.remote_config_flags
  for select to authenticated, anon
  using (true);

-- Function to check admin status
create or replace function public.is_admin_user()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return false;
  end if;
  return exists (select 1 from public.admin_users where user_id = v_uid);
end;
$$;

-- RLS: admin_users select
create policy admin_users_select on public.admin_users
  for select to authenticated
  using (public.is_admin_user());

-- Default flags seed
insert into public.remote_config_flags (key, value, description)
values
  ('disabled_modes', '[]'::jsonb, 'Array of mode IDs currently disabled for maintenance'),
  ('min_app_version', '"2.7.0"'::jsonb, 'Minimum supported client version'),
  ('push_notifications_enabled', 'true'::jsonb, 'Global kill-switch for remote push notifications'),
  ('scheduled_games_enabled', 'true'::jsonb, 'Toggle for scheduled match creation')
on conflict (key) do nothing;

-- RPC: set_remote_config_flag
create or replace function public.set_remote_config_flag(
  p_key text,
  p_value jsonb,
  p_description text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_admin_user() then
    raise exception 'Unauthorized: Admin privileges required';
  end if;

  insert into public.remote_config_flags (key, value, description, updated_at, updated_by)
  values (p_key, p_value, p_description, now(), v_uid)
  on conflict (key) do update
  set value = excluded.value,
      description = coalesce(excluded.description, public.remote_config_flags.description),
      updated_at = now(),
      updated_by = v_uid;
end;
$$;

-- RPC: get_system_health_metrics
create or replace function public.get_system_health_metrics()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_users_count integer;
  v_active_games_count integer;
  v_reports_count integer;
  v_push_tokens_count integer;
begin
  if not public.is_admin_user() then
    raise exception 'Unauthorized: Admin privileges required';
  end if;

  select count(*) into v_users_count from public.profiles;
  select count(*) into v_active_games_count from public.games where status in ('lobby', 'countdown', 'live');
  select count(*) into v_reports_count from public.player_reports;
  select count(*) into v_push_tokens_count from public.user_push_tokens where is_active = true;

  return jsonb_build_object(
    'total_users', v_users_count,
    'active_games', v_active_games_count,
    'total_reports', v_reports_count,
    'active_push_tokens', v_push_tokens_count,
    'generated_at', now()
  );
end;
$$;
