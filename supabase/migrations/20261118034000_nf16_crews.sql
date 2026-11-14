-- NF-16: Persistent Crews & Squad Lists Schema

create table if not exists public.crews (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint crew_name_length check (char_length(name) >= 3 and char_length(name) <= 30),
  constraint crew_code_format check (code ~ '^[A-Z0-9]{4,8}$')
);

create index if not exists crews_code_idx on public.crews(code);
create index if not exists crews_created_by_idx on public.crews(created_by);

alter table public.crews enable row level security;

create table if not exists public.crew_members (
  crew_id uuid not null references public.crews(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('captain', 'member')),
  joined_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);

create index if not exists crew_members_user_idx on public.crew_members(user_id);

alter table public.crew_members enable row level security;

-- RLS: crews
-- Authenticated users can view crews they are a member of, or find crew by code during join
create policy crews_select on public.crews
  for select to authenticated
  using (
    id in (select crew_id from public.crew_members where user_id = (select auth.uid()))
    or true -- allows resolving code for join
  );

create policy crews_insert on public.crews
  for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy crews_update on public.crews
  for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

create policy crews_delete on public.crews
  for delete to authenticated
  using (created_by = (select auth.uid()));

-- RLS: crew_members
create policy crew_members_select on public.crew_members
  for select to authenticated
  using (
    crew_id in (select crew_id from public.crew_members where user_id = (select auth.uid()))
  );

create policy crew_members_insert on public.crew_members
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy crew_members_delete on public.crew_members
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.crew_members cm
      where cm.crew_id = crew_members.crew_id
        and cm.user_id = (select auth.uid())
        and cm.role = 'captain'
    )
  );

-- RPC: create_crew
create or replace function public.create_crew(
  p_name text,
  p_code text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_new_id uuid;
  v_clean_name text := trim(p_name);
  v_clean_code text;
begin
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  if char_length(v_clean_name) < 3 or char_length(v_clean_name) > 30 then
    raise exception 'Crew name must be between 3 and 30 characters';
  end if;

  if p_code is not null and char_length(trim(p_code)) > 0 then
    v_clean_code := upper(trim(p_code));
  else
    -- Generate random 5-char code
    v_clean_code := upper(substr(md5(random()::text), 1, 5));
  end if;

  if not (v_clean_code ~ '^[A-Z0-9]{4,8}$') then
    raise exception 'Crew code must be 4 to 8 alphanumeric characters';
  end if;

  insert into public.crews (name, code, created_by)
  values (v_clean_name, v_clean_code, v_caller_id)
  returning id into v_new_id;

  insert into public.crew_members (crew_id, user_id, role)
  values (v_new_id, v_caller_id, 'captain');

  return v_new_id;
end;
$$;

-- RPC: join_crew
create or replace function public.join_crew(
  p_code text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_crew_id uuid;
  v_clean_code text := upper(trim(p_code));
begin
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  select id into v_crew_id
  from public.crews
  where code = v_clean_code;

  if v_crew_id is null then
    raise exception 'Crew code not found';
  end if;

  insert into public.crew_members (crew_id, user_id, role)
  values (v_crew_id, v_caller_id, 'member')
  on conflict (crew_id, user_id) do nothing;

  return v_crew_id;
end;
$$;

-- RPC: leave_crew
create or replace function public.leave_crew(
  p_crew_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_was_captain boolean;
  v_next_captain uuid;
begin
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  select (role = 'captain') into v_was_captain
  from public.crew_members
  where crew_id = p_crew_id and user_id = v_caller_id;

  delete from public.crew_members
  where crew_id = p_crew_id and user_id = v_caller_id;

  -- If was captain, reassign or delete crew if empty
  if v_was_captain then
    select user_id into v_next_captain
    from public.crew_members
    where crew_id = p_crew_id
    order by joined_at asc
    limit 1;

    if v_next_captain is not null then
      update public.crew_members
      set role = 'captain'
      where crew_id = p_crew_id and user_id = v_next_captain;

      update public.crews
      set created_by = v_next_captain
      where id = p_crew_id;
    else
      delete from public.crews where id = p_crew_id;
    end if;
  end if;
end;
$$;
