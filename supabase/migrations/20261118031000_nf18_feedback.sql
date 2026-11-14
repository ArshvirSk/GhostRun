-- NF-18: In-App Feedback & Diagnostics Schema

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  category text not null check (category in ('bug', 'suggestion', 'safety', 'other')),
  message text not null check (char_length(message) between 1 and 2000),
  bundle jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists feedback_user_idx on public.feedback(user_id);
create index if not exists feedback_created_idx on public.feedback(created_at desc);

alter table public.feedback enable row level security;

create policy feedback_insert_authenticated on public.feedback
  for insert to authenticated
  with check (true);

create policy feedback_select_own on public.feedback
  for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.submit_feedback(
  p_category text,
  p_message text,
  p_bundle jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_category not in ('bug', 'suggestion', 'safety', 'other') then
    raise exception 'Invalid feedback category';
  end if;

  if char_length(trim(p_message)) < 1 or char_length(trim(p_message)) > 2000 then
    raise exception 'Feedback message must be between 1 and 2000 characters';
  end if;

  insert into public.feedback (user_id, category, message, bundle)
  values (auth.uid(), p_category, trim(p_message), coalesce(p_bundle, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;
