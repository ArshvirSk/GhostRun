-- Migration: 20261118005100_c4_fix_export_my_data.sql
-- Phase C Milestone C4: Fix export_my_data sos_events aggregate grouping subquery

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
