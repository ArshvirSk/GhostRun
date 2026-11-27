-- Fix claim_city_bounty to select profiles.color instead of non-existent avatar_color
create or replace function public.claim_city_bounty(
  p_bounty_id uuid,
  p_photo_url text,
  p_lat double precision,
  p_lng double precision,
  p_heading numeric
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_bounty public.city_bounties%rowtype;
  v_sub_point extensions.geometry;
  v_dist_m numeric;
  v_heading_diff numeric;
  v_score_prox integer;
  v_score_head integer;
  v_total_score integer;
  v_echo_pts integer;
  v_crew_id uuid;
  v_crew_name text;
  v_profile_name text;
  v_profile_color text;
  v_b_lat double precision;
  v_b_lng double precision;
  v_zone_key text;
  v_prev_control integer;
  v_turf_flipped boolean := false;
begin
  if v_uid is null then
    raise exception 'Authentication is required.';
  end if;

  select * into v_bounty from public.city_bounties where id = p_bounty_id;
  if not found then
    raise exception 'Daily bounty not found.';
  end if;

  v_sub_point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326);
  v_dist_m := extensions.st_distance(v_sub_point::extensions.geography, v_bounty.location::extensions.geography);

  v_heading_diff := abs(coalesce(p_heading, 0) - v_bounty.heading);
  v_heading_diff := mod(v_heading_diff, 360.0);
  if v_heading_diff > 180.0 then
    v_heading_diff := 360.0 - v_heading_diff;
  end if;

  v_score_prox := round(4000.0 * exp(-1.0 * v_dist_m / 100.0));
  if v_dist_m <= 5.0 then v_score_prox := 4000; end if;
  if v_dist_m > 500.0 then v_score_prox := 0; end if;

  if v_heading_diff < 90.0 then
    v_score_head := round(1000.0 * cos(radians(v_heading_diff)));
  else
    v_score_head := 0;
  end if;

  v_total_score := least(5000, greatest(0, v_score_prox + v_score_head));
  v_echo_pts := greatest(25, round(v_total_score / 50.0));

  select cm.crew_id, c.name
  into v_crew_id, v_crew_name
  from public.crew_members cm
  join public.crews c on c.id = cm.crew_id
  where cm.user_id = v_uid
  limit 1;

  select display_name, coalesce(color, '#C8FF00')
  into v_profile_name, v_profile_color
  from public.profiles
  where id = v_uid;

  insert into public.city_bounty_claims (
    bounty_id, user_id, crew_id, submission_photo_url, submission_location,
    submission_heading, distance_error_meters, heading_error_degrees,
    score, echo_pts_awarded
  ) values (
    p_bounty_id, v_uid, v_crew_id, p_photo_url, v_sub_point,
    mod(greatest(0, coalesce(p_heading, 0)), 360.0),
    round(v_dist_m, 1), round(v_heading_diff, 1),
    v_total_score, v_echo_pts
  )
  on conflict (bounty_id, user_id) do update
  set
    submission_photo_url = excluded.submission_photo_url,
    submission_location = excluded.submission_location,
    submission_heading = excluded.submission_heading,
    distance_error_meters = excluded.distance_error_meters,
    heading_error_degrees = excluded.heading_error_degrees,
    score = greatest(city_bounty_claims.score, excluded.score),
    claimed_at = now();

  v_b_lat := extensions.st_y(v_bounty.location::extensions.geometry);
  v_b_lng := extensions.st_x(v_bounty.location::extensions.geometry);
  v_zone_key := 'turf_' || to_char(round(v_b_lat::numeric, 3), 'FM9990.000') || '_' || to_char(round(v_b_lng::numeric, 3), 'FM9990.000');

  select control_score into v_prev_control
  from public.city_turf_zones
  where zone_key = v_zone_key;

  if v_prev_control is null or v_total_score >= v_prev_control then
    insert into public.city_turf_zones (
      zone_key, center_location, owner_user_id, owner_crew_id,
      owner_name, owner_color, control_score, captured_at
    ) values (
      v_zone_key,
      v_bounty.location,
      v_uid,
      v_crew_id,
      coalesce(v_crew_name, v_profile_name, 'Operative'),
      coalesce(v_profile_color, '#C8FF00'),
      v_total_score,
      now()
    )
    on conflict (zone_key) do update
    set
      owner_user_id = excluded.owner_user_id,
      owner_crew_id = excluded.owner_crew_id,
      owner_name = excluded.owner_name,
      owner_color = excluded.owner_color,
      control_score = excluded.control_score,
      captured_at = now();
    v_turf_flipped := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'bounty_id', p_bounty_id,
    'score', v_total_score,
    'distance_error_meters', round(v_dist_m, 1),
    'heading_error_degrees', round(v_heading_diff, 1),
    'echo_pts_awarded', v_echo_pts,
    'turf_flipped', v_turf_flipped,
    'turf_zone_key', v_zone_key
  );
end;
$$;
