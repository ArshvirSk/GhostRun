-- Fix get_city_world_state to select c.code instead of non-existent c.tag on public.crews
create or replace function public.get_city_world_state(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 1500
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'utc')::date;
  v_sector text := to_char(round(p_lat::numeric, 2), 'FM9990.00') || '_' || to_char(round(p_lng::numeric, 2), 'FM9990.00');
  v_point extensions.geometry := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326);
  v_bounties jsonb;
  v_turf jsonb;
  v_my_crew jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication is required.';
  end if;

  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'code', c.code
  )
  into v_my_crew
  from public.crew_members cm
  join public.crews c on c.id = cm.crew_id
  where cm.user_id = v_uid
  limit 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', cb.id,
      'slot_index', cb.slot_index,
      'title', cb.title,
      'photo_url', cb.photo_url,
      'latitude', extensions.st_y(cb.location::extensions.geometry),
      'longitude', extensions.st_x(cb.location::extensions.geometry),
      'heading', cb.heading,
      'source', cb.source,
      'claim_count', (select count(*) from public.city_bounty_claims cbc where cbc.bounty_id = cb.id),
      'top_score', coalesce((select max(cbc.score) from public.city_bounty_claims cbc where cbc.bounty_id = cb.id), 0),
      'my_claim', (
        select jsonb_build_object(
          'score', cbc.score,
          'distance_error_meters', cbc.distance_error_meters,
          'heading_error_degrees', cbc.heading_error_degrees,
          'echo_pts_awarded', cbc.echo_pts_awarded,
          'submission_photo_url', cbc.submission_photo_url
        )
        from public.city_bounty_claims cbc
        where cbc.bounty_id = cb.id and cbc.user_id = v_uid
        limit 1
      )
    )
    order by cb.slot_index asc
  ), '[]'::jsonb)
  into v_bounties
  from public.city_bounties cb
  where cb.bounty_date = v_today
    and (
      cb.sector_key = v_sector
      or extensions.st_dwithin(cb.location::extensions.geography, v_point::extensions.geography, p_radius_m)
    );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'zone_key', tz.zone_key,
      'latitude', extensions.st_y(tz.center_location::extensions.geometry),
      'longitude', extensions.st_x(tz.center_location::extensions.geometry),
      'owner_name', tz.owner_name,
      'owner_color', tz.owner_color,
      'owner_crew_id', tz.owner_crew_id,
      'control_score', tz.control_score,
      'captured_at', tz.captured_at
    )
  ), '[]'::jsonb)
  into v_turf
  from public.city_turf_zones tz
  where extensions.st_dwithin(tz.center_location::extensions.geography, v_point::extensions.geography, greatest(p_radius_m, 2000));

  return jsonb_build_object(
    'sector_key', v_sector,
    'bounty_date', v_today,
    'my_crew', v_my_crew,
    'bounties', v_bounties,
    'turf_zones', v_turf
  );
end;
$$;
