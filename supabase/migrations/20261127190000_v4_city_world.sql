-- GhostRun v4.0: Persistent City World (Daily Pinpoint Bounties & Crew Turf Control)

create table if not exists public.city_bounties (
  id uuid primary key default gen_random_uuid(),
  bounty_date date not null default (now() at time zone 'utc')::date,
  sector_key text not null,
  slot_index integer not null check (slot_index between 1 and 5),
  title text not null,
  photo_url text not null,
  location extensions.geometry(Point, 4326) not null,
  heading numeric(5, 2) not null default 0 check (heading >= 0 and heading < 360),
  source text not null default 'osm_wiki' check (source in ('osm_wiki', 'community_scout')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (bounty_date, sector_key, slot_index)
);

create index if not exists idx_city_bounties_date_sector
  on public.city_bounties (bounty_date, sector_key);

create table if not exists public.city_bounty_claims (
  id uuid primary key default gen_random_uuid(),
  bounty_id uuid not null references public.city_bounties(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  crew_id uuid references public.crews(id) on delete set null,
  submission_photo_url text not null,
  submission_location extensions.geometry(Point, 4326) not null,
  submission_heading numeric(5, 2) not null default 0,
  distance_error_meters numeric(7, 2) not null,
  heading_error_degrees numeric(5, 2) not null,
  score integer not null default 0,
  echo_pts_awarded integer not null default 0,
  claimed_at timestamptz not null default now(),
  unique (bounty_id, user_id)
);

create index if not exists idx_city_bounty_claims_bounty
  on public.city_bounty_claims (bounty_id, score desc);

create table if not exists public.city_turf_zones (
  zone_key text primary key,
  center_location extensions.geometry(Point, 4326) not null,
  owner_user_id uuid references public.profiles(id) on delete set null,
  owner_crew_id uuid references public.crews(id) on delete set null,
  owner_name text not null,
  owner_color text not null default '#C8FF00',
  control_score integer not null default 0,
  captured_at timestamptz not null default now()
);

alter table public.city_bounties enable row level security;
alter table public.city_bounty_claims enable row level security;
alter table public.city_turf_zones enable row level security;

create policy "city_bounties_select_auth"
  on public.city_bounties for select to authenticated using (true);

create policy "city_bounty_claims_select_auth"
  on public.city_bounty_claims for select to authenticated using (true);

create policy "city_turf_zones_select_auth"
  on public.city_turf_zones for select to authenticated using (true);

-- Fetch today's bounties + nearby turf zones for a coordinate
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
    'tag', c.tag
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

-- Idempotently seed daily bounties for the player's local sector
create or replace function public.seed_daily_city_bounties(
  p_lat double precision,
  p_lng double precision,
  p_bounties jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'utc')::date;
  v_sector text := to_char(round(p_lat::numeric, 2), 'FM9990.00') || '_' || to_char(round(p_lng::numeric, 2), 'FM9990.00');
  v_existing integer := 0;
  v_item jsonb;
  v_idx integer := 0;
begin
  if v_uid is null then
    raise exception 'Authentication is required.';
  end if;

  select count(*) into v_existing
  from public.city_bounties
  where bounty_date = v_today and sector_key = v_sector;

  if v_existing = 0 and jsonb_typeof(p_bounties) = 'array' then
    for v_item in select * from jsonb_array_elements(p_bounties) loop
      v_idx := v_idx + 1;
      exit when v_idx > 3;
      insert into public.city_bounties (
        bounty_date,
        sector_key,
        slot_index,
        title,
        photo_url,
        location,
        heading,
        source,
        created_by
      ) values (
        v_today,
        v_sector,
        v_idx,
        coalesce(nullif(v_item->>'title', ''), 'City Landmark #' || v_idx),
        coalesce(nullif(v_item->>'targetPhotoUrl', ''), 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?auto=format&fit=crop&w=600&q=80'),
        extensions.st_setsrid(
          extensions.st_makepoint(
            coalesce((v_item->>'longitude')::double precision, p_lng),
            coalesce((v_item->>'latitude')::double precision, p_lat)
          ),
          4326
        ),
        mod(greatest(0, coalesce((v_item->>'heading')::numeric, 0)), 360.0),
        'osm_wiki',
        v_uid
      )
      on conflict (bounty_date, sector_key, slot_index) do nothing;
    end loop;
  end if;

  return public.get_city_world_state(p_lat, p_lng, 1500);
end;
$$;

-- Claim a Daily City Bounty with server-authoritative PostGIS scoring + Crew Turf capture
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

  select display_name, coalesce(avatar_color, '#C8FF00')
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

  -- Contest/Capture the 250m Turf Zone centered on this bounty
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

revoke all on function public.get_city_world_state(double precision, double precision, integer) from public, anon;
grant execute on function public.get_city_world_state(double precision, double precision, integer) to authenticated;

revoke all on function public.seed_daily_city_bounties(double precision, double precision, jsonb) from public, anon;
grant execute on function public.seed_daily_city_bounties(double precision, double precision, jsonb) to authenticated;

revoke all on function public.claim_city_bounty(uuid, text, double precision, double precision, numeric) from public, anon;
grant execute on function public.claim_city_bounty(uuid, text, double precision, double precision, numeric) to authenticated;
