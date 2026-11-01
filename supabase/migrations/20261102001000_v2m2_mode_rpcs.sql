-- V2-M2 mode registry and validation.
--
-- One server-side catalogue is the source of truth for modes, roles, modifiers,
-- their compatible combinations and their default parameters. create_game,
-- start_game and set_game_modes all validate against it, so a modified client
-- cannot store or start an incompatible configuration. Feature flags come last:
-- an unimplemented item reports "not available yet" while an invalid pairing
-- still reports the compatibility error.

create or replace function public.mode_catalogue()
returns jsonb
language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_array(
    jsonb_build_object(
      'id', 'classic_chase', 'layer', 'base', 'name', 'Classic Chase',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 2,
      'compatible_roles', jsonb_build_array('double_agent', 'vip', 'operator'),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone'
      ),
      'parameters', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'tag_hunt', 'layer', 'base', 'name', 'Tag Hunt',
      'teams', jsonb_build_array('runner', 'hunter'), 'min_players', 2,
      'compatible_roles', jsonb_build_array('double_agent', 'operator'),
      'compatible_modifiers', jsonb_build_array(
        'noise_meter', 'dead_drops', 'hot_cold', 'qr_tagging', 'shrinking_zone'
      ),
      'parameters', '{}'::jsonb
    )
  );
$$;

create or replace function public.role_catalogue()
returns jsonb
language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_array(
    jsonb_build_object('id', 'double_agent', 'name', 'Double Agent', 'layer', 'role'),
    jsonb_build_object('id', 'vip', 'name', 'VIP Escort', 'layer', 'role'),
    jsonb_build_object('id', 'operator', 'name', 'Operator', 'layer', 'role')
  );
$$;

create or replace function public.modifier_catalogue()
returns jsonb
language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_array(
    jsonb_build_object(
      'id', 'noise_meter', 'name', 'Noise Meter', 'layer', 'modifier',
      'parameters', jsonb_build_object('walking_threshold_mps', 1.6, 'jog_threshold_mps', 2.8)
    ),
    jsonb_build_object(
      'id', 'dead_drops', 'name', 'Dead Drops', 'layer', 'modifier',
      'parameters', jsonb_build_object('drops', 6, 'spacing_m', 150, 'inset_m', 60)
    ),
    jsonb_build_object(
      'id', 'hot_cold', 'name', 'Hot & Cold Hunt', 'layer', 'modifier',
      'parameters', jsonb_build_object(
        'variant', 'proximity', 'heat_charges', 6, 'cooldown_s', 10
      )
    ),
    jsonb_build_object(
      'id', 'qr_tagging', 'name', 'QR Tagging', 'layer', 'modifier',
      'parameters', jsonb_build_object('token_ttl_s', 20)
    ),
    jsonb_build_object(
      'id', 'shrinking_zone', 'name', 'Shrinking Zone', 'layer', 'modifier',
      'parameters', jsonb_build_object('stages', jsonb_build_array(100, 70, 45))
    )
  );
$$;

revoke all on function public.mode_catalogue(),
  public.role_catalogue(), public.modifier_catalogue() from public, anon, authenticated;

-- get_mode_registry: what the lobby may offer, with enabled flags.
create or replace function public.get_mode_registry()
returns jsonb
language sql stable security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'modes', (
      select jsonb_agg(mode || jsonb_build_object(
        'enabled', public.feature_enabled('feature.mode.' || (mode->>'id'))
      ) order by mode->>'name')
      from jsonb_array_elements(public.mode_catalogue()) mode
    ),
    'roles', (
      select jsonb_agg(role || jsonb_build_object(
        'enabled', public.feature_enabled('feature.role.' || (role->>'id'))
      ) order by role->>'name')
      from jsonb_array_elements(public.role_catalogue()) role
    ),
    'modifiers', (
      select jsonb_agg(modifier || jsonb_build_object(
        'enabled', public.feature_enabled('feature.modifier.' || (modifier->>'id'))
      ) order by modifier->>'name')
      from jsonb_array_elements(public.modifier_catalogue()) modifier
    )
  );
$$;

revoke all on function public.get_mode_registry() from public, anon;
grant execute on function public.get_mode_registry() to authenticated;

-- assert_mode_config: existence, duplicates, compatibility, then flags.
create or replace function public.assert_mode_config(
  p_mode_id text,
  p_roles text[],
  p_modifiers text[]
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  mode_doc jsonb;
  item text;
  deduped integer;
  normalized_roles text[] := coalesce(p_roles, '{}');
  normalized_modifiers text[] := coalesce(p_modifiers, '{}');
begin
  select def into mode_doc
  from jsonb_array_elements(public.mode_catalogue()) def
  where def->>'id' = p_mode_id;
  if mode_doc is null then
    raise exception 'Unknown game mode: %.', coalesce(p_mode_id, 'null');
  end if;
  if not public.feature_enabled('feature.mode.' || p_mode_id) then
    raise exception 'That game mode is not available yet.';
  end if;

  select count(distinct r) into deduped from unnest(normalized_roles) r;
  if deduped <> cardinality(normalized_roles) then
    raise exception 'A role can only be chosen once.';
  end if;
  select count(distinct m) into deduped from unnest(normalized_modifiers) m;
  if deduped <> cardinality(normalized_modifiers) then
    raise exception 'A modifier can only be chosen once.';
  end if;

  foreach item in array normalized_roles loop
    if not exists (
      select 1 from jsonb_array_elements(public.role_catalogue()) r where r->>'id' = item
    ) then
      raise exception 'Unknown role: %.', item;
    end if;
    if not (mode_doc->'compatible_roles' ? item) then
      raise exception '% cannot be combined with %.', (mode_doc->>'name'), item;
    end if;
    if not public.feature_enabled('feature.role.' || item) then
      raise exception 'The % role is not available yet.', item;
    end if;
  end loop;

  foreach item in array normalized_modifiers loop
    if not exists (
      select 1 from jsonb_array_elements(public.modifier_catalogue()) m where m->>'id' = item
    ) then
      raise exception 'Unknown modifier: %.', item;
    end if;
    if not (mode_doc->'compatible_modifiers' ? item) then
      raise exception '% cannot be combined with %.', (mode_doc->>'name'), item;
    end if;
    if not public.feature_enabled('feature.modifier.' || item) then
      raise exception 'The % modifier is not available yet.', item;
    end if;
  end loop;
end;
$$;

revoke all on function public.assert_mode_config(text, text[], text[]) from public, anon, authenticated;

-- create_game: same signature as v1, now stores and validates the v2 config.
create or replace function public.create_game(
  mode public.game_mode,
  lat double precision,
  lng double precision,
  radius_m integer default 600,
  settings jsonb default '{}'::jsonb
)
returns table (game_id uuid, code text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  new_id uuid;
  new_code text;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  attempt integer := 0;
  chosen_mode public.game_mode := create_game.mode;
  chosen_settings jsonb := coalesce(create_game.settings, '{}'::jsonb);
  chosen_roles text[] := '{}';
  chosen_modifiers text[] := '{}';
  chosen_params jsonb := coalesce(create_game.settings->'mode_params', '{}'::jsonb);
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if not exists (select 1 from public.profiles where id = caller_id) then
    raise exception 'Create a profile before creating a game.';
  end if;
  if chosen_mode is null then raise exception 'Choose a game mode.'; end if;
  if create_game.lat not between -90 and 90 or create_game.lng not between -180 and 180 then
    raise exception 'Map centre coordinates are invalid.';
  end if;
  if create_game.radius_m not between 100 and 5000 then
    raise exception 'Area radius must be 100-5000 metres.';
  end if;
  if jsonb_typeof(chosen_params) <> 'object' then
    raise exception 'Mode parameters must be an object.';
  end if;

  if jsonb_typeof(chosen_settings->'roles') = 'array' then
    select coalesce(array_agg(value), '{}') into chosen_roles
    from jsonb_array_elements_text(chosen_settings->'roles') value;
  end if;
  if jsonb_typeof(chosen_settings->'modifiers') = 'array' then
    select coalesce(array_agg(value), '{}') into chosen_modifiers
    from jsonb_array_elements_text(chosen_settings->'modifiers') value;
  end if;

  perform public.assert_mode_config(chosen_mode::text, chosen_roles, chosen_modifiers);

  loop
    attempt := attempt + 1;
    new_code := '';
    for i in 1..4 loop
      new_code := new_code || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
    end loop;
    exit when not exists (
      select 1 from public.games g
      where g.code = new_code and g.status not in ('ended', 'cancelled')
    );
    if attempt >= 20 then raise exception 'Could not allocate a game code. Try again.'; end if;
  end loop;

  insert into public.games (
    code, host_id, mode, mode_id, roles, modifiers, mode_params,
    area_center, area_radius_m,
    head_start_s, duration_s, ping_interval_s, tag_radius_m, target_radius_m,
    boundary_grace_s, boundary_penalty
  ) values (
    new_code, caller_id, chosen_mode, chosen_mode::text, chosen_roles, chosen_modifiers,
    chosen_params,
    extensions.st_setsrid(extensions.st_makepoint(create_game.lng, create_game.lat), 4326)::extensions.geography,
    create_game.radius_m,
    coalesce((chosen_settings->>'head_start_s')::integer, 180),
    coalesce((chosen_settings->>'duration_s')::integer, 2700),
    coalesce((chosen_settings->>'ping_interval_s')::integer, 150),
    coalesce((chosen_settings->>'tag_radius_m')::integer, 20),
    coalesce((chosen_settings->>'target_radius_m')::integer, 25),
    coalesce((chosen_settings->>'boundary_grace_s')::integer, 30),
    coalesce(chosen_settings->>'boundary_penalty', 'warn')
  ) returning id into new_id;

  insert into public.players (game_id, user_id) values (new_id, caller_id);
  insert into public.events (game_id, type, payload)
    values (new_id, 'player_joined', jsonb_build_object('user_id', caller_id));
  return query select new_id, new_code;
exception
  when check_violation or invalid_text_representation then
    raise exception 'Game settings are invalid. Check the allowed ranges and try again.';
end;
$$;

-- set_game_modes: host changes modifiers/roles/params in the lobby.
create or replace function public.set_game_modes(
  game_id uuid,
  modifiers text[],
  roles text[],
  mode_params jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  current_game public.games%rowtype;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into current_game from public.games g where g.id = set_game_modes.game_id for update;
  if not found then raise exception 'Game not found.'; end if;
  if current_game.host_id <> caller_id then
    raise exception 'Only the host can change the mode setup.';
  end if;
  if current_game.status not in ('lobby', 'target_selection') then
    raise exception 'The mode setup is locked once the round starts.';
  end if;
  if jsonb_typeof(coalesce(mode_params, '{}'::jsonb)) <> 'object' then
    raise exception 'Mode parameters must be an object.';
  end if;

  perform public.assert_mode_config(
    current_game.mode_id,
    coalesce(set_game_modes.roles, '{}'),
    coalesce(set_game_modes.modifiers, '{}')
  );

  update public.games g set
    modifiers = coalesce(set_game_modes.modifiers, '{}'),
    roles = coalesce(set_game_modes.roles, '{}'),
    mode_params = coalesce(set_game_modes.mode_params, '{}'::jsonb)
  where g.id = current_game.id;

  insert into public.events (game_id, type, payload) values (
    current_game.id,
    'mode_config_changed',
    jsonb_build_object(
      'modifiers', to_jsonb(coalesce(set_game_modes.modifiers, '{}')),
      'roles', to_jsonb(coalesce(set_game_modes.roles, '{}'))
    )
  );
end;
$$;

revoke all on function public.create_game(public.game_mode, double precision, double precision, integer, jsonb),
  public.set_game_modes(uuid, text[], text[], jsonb) from public, anon;
grant execute on function public.create_game(public.game_mode, double precision, double precision, integer, jsonb),
  public.set_game_modes(uuid, text[], text[], jsonb) to authenticated;
