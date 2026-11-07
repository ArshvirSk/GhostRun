-- Migration: 20261118005000_c4_privacy_consent_audit.sql
-- Phase C Milestone C4: Privacy, consent and replay sharing audit (docs/MODES.md §7.4, §7.5)
-- Fixes heat_presses.hunter_id FK with ON DELETE SET NULL for account deletion safety.
-- Upgrades delete_my_data to purge contributed ghost_library routes.
-- Upgrades export_my_data to include ghost contributions, ghost duel scores, drops, and heat presses.

-- 1. Foreign Key safety on heat_presses -----------------------------------------
alter table public.heat_presses
  alter column hunter_id drop not null;

alter table public.heat_presses
  drop constraint if exists heat_presses_hunter_id_fkey;

alter table public.heat_presses
  add constraint heat_presses_hunter_id_fkey
  foreign key (hunter_id) references public.players(id) on delete set null;

-- 2. Upgrade export_my_data ----------------------------------------------------
create or replace function public.export_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  bundle jsonb;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(pr) from public.profiles pr where pr.id = caller_id),
    'consents', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at)
      from public.consents c where c.user_id = caller_id
    ), '[]'::jsonb),
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
        'game_id', p.game_id, 'team', p.team, 'status', p.status,
        'share_trail', p.share_trail, 'share_choice_at', p.share_choice_at,
        'joined_at', p.joined_at, 'tagged_at', p.tagged_at,
        'game', jsonb_build_object(
          'code', g.code, 'mode', g.mode, 'status', g.status,
          'winner', g.winner, 'end_reason', g.end_reason,
          'created_at', g.created_at, 'ended_at', g.ended_at
        )
      ) order by p.joined_at)
      from public.players p
      join public.games g on g.id = p.game_id
      where p.user_id = caller_id
    ), '[]'::jsonb),
    'trail_points', coalesce((
      select jsonb_agg(jsonb_build_object(
        'game_id', tp.game_id,
        'longitude', extensions.st_x(tp.geog::extensions.geometry),
        'latitude', extensions.st_y(tp.geog::extensions.geometry),
        'accuracy_m', tp.accuracy_m, 'recorded_at', tp.recorded_at
      ) order by tp.recorded_at)
      from (
        select tp.* from public.trail_points tp
        join public.players p on p.id = tp.player_id
        where p.user_id = caller_id
        order by tp.recorded_at desc
        limit 50000
      ) tp
    ), '[]'::jsonb),
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object(
        'game_id', t.game_id, 'as', case when hunter.user_id = caller_id
          then 'hunter' else 'runner' end,
        'distance_m', t.distance_m, 'tagged_at', t.tagged_at
      ) order by t.tagged_at)
      from public.tags t
      left join public.players hunter on hunter.id = t.hunter_id
      left join public.players runner on runner.id = t.runner_id
      where hunter.user_id = caller_id or runner.user_id = caller_id
    ), '[]'::jsonb),
    'sos_events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.id)
      from (
        select e.* from public.events e
        where e.type = 'sos' and e.payload->>'user_id' = caller_id::text
        order by e.id desc
        limit 500
      ) e
    ), '[]'::jsonb),
    'ghost_contributions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ghost_id', gc.ghost_id,
        'created_at', gc.created_at,
        'duration_s', gl.duration_s
      ) order by gc.created_at desc)
      from public.ghost_contributions gc
      join public.ghost_library gl on gl.id = gc.ghost_id
      where gc.user_id = caller_id
    ), '[]'::jsonb),
    'ghost_duel_scores', coalesce((
      select jsonb_agg(to_jsonb(gds) order by gds.created_at desc)
      from public.ghost_duel_scores gds
      where gds.user_id = caller_id
    ), '[]'::jsonb),
    'drop_claims', coalesce((
      select jsonb_agg(jsonb_build_object(
        'game_id', dc.game_id,
        'entity_id', dc.entity_id,
        'item_type', dc.item_type,
        'claimed_at', dc.claimed_at
      ) order by dc.claimed_at desc)
      from public.drop_claims dc
      join public.players p on p.id = dc.player_id
      where p.user_id = caller_id
    ), '[]'::jsonb),
    'heat_presses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'game_id', hp.game_id,
        'variant', hp.variant,
        'result', hp.result,
        'pressed_at', hp.pressed_at
      ) order by hp.pressed_at desc)
      from public.heat_presses hp
      join public.players p on p.id = hp.hunter_id
      where p.user_id = caller_id
    ), '[]'::jsonb)
  ) into bundle;

  return bundle;
end;
$$;

revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- 3. Upgrade delete_my_data ----------------------------------------------------
create or replace function public.delete_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  rec record;
  next_host uuid;
  active_runners integer;
  active_hunters integer;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not exists (select 1 from public.profiles where id = caller_id) then
    raise exception 'No profile to delete.';
  end if;

  -- Step 1: leave every in-flight round exactly as leave_game would.
  for rec in
    select p.id as player_id, p.game_id, p.team
    from public.players p
    join public.games g on g.id = p.game_id
    where p.user_id = caller_id
      and p.status = 'active'
      and g.status in ('countdown', 'head_start', 'live')
    for update of p
  loop
    update public.players p
      set status = 'left', is_ready = false
    where p.id = rec.player_id;

    insert into public.events (game_id, type, payload)
      values (rec.game_id, 'player_left', jsonb_build_object('user_id', caller_id));

    select count(*) filter (where p.team = 'runner'), count(*) filter (where p.team = 'hunter')
      into active_runners, active_hunters
    from public.players p
    where p.game_id = rec.game_id and p.status = 'active';

    if active_hunters = 0 then
      update public.games set status = 'ended', winner = 'runners',
        end_reason = 'all_hunters_left', ended_at = now()
      where id = rec.game_id and status in ('countdown', 'head_start', 'live');
      insert into public.events (game_id, type, payload)
        values (rec.game_id, 'game_ended',
          jsonb_build_object('winner', 'runners', 'reason', 'all_hunters_left'));
    elsif active_runners = 0 then
      update public.games set status = 'ended', winner = 'hunters',
        end_reason = 'all_tagged', ended_at = now()
      where id = rec.game_id and status in ('countdown', 'head_start', 'live');
      insert into public.events (game_id, type, payload)
        values (rec.game_id, 'game_ended',
          jsonb_build_object('winner', 'hunters', 'reason', 'all_tagged'));
    end if;
  end loop;

  -- Step 2: hand over unfinished games the player hosted.
  for rec in
    select g.id from public.games g
    where g.host_id = caller_id and g.status not in ('ended', 'cancelled')
  loop
    select p.user_id into next_host
    from public.players p
    where p.game_id = rec.id and p.user_id <> caller_id and p.status <> 'left'
    order by p.joined_at limit 1;
    update public.games set host_id = next_host where id = rec.id;
  end loop;

  -- Step 3: purge any anonymous ghost library entries contributed by caller (docs/MODES.md §7.4.8)
  delete from public.ghost_library gl
  where gl.id in (
    select gc.ghost_id from public.ghost_contributions gc
    where gc.user_id = caller_id
  );

  -- Step 4: the delete itself. players.user_id cascades to positions, pings,
  -- trails, consents, and contributions; tags and heat_presses lose their
  -- actor and stay as anonymized history.
  begin
    delete from auth.users where id = caller_id;
    return jsonb_build_object('deleted', true, 'account_removed', true, 'at', now());
  exception when insufficient_privilege then
    delete from public.profiles where id = caller_id;
    return jsonb_build_object('deleted', true, 'account_removed', false, 'at', now());
  end;
end;
$$;

revoke all on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;
