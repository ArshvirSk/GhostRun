-- M8 SOS: broadcast emergency distress event to all players with player's last position
-- PRD F-37: "SOS / 'I need help' button that alerts everyone with the player's last position"

create or replace function public.send_sos(game_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  me public.players%rowtype;
  caller_name text;
  last_pos public.player_positions%rowtype;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into me from public.players p
    where p.game_id = send_sos.game_id and p.user_id = caller_id and p.status <> 'left';
  if not found then raise exception 'You are not an active member of this game.'; end if;

  select display_name into caller_name from public.profiles where id = caller_id;
  select * into last_pos from public.player_positions where player_id = me.id;

  insert into public.events (game_id, type, audience, payload)
  values (
    send_sos.game_id,
    'sos',
    'all',
    jsonb_build_object(
      'player_id', me.id,
      'user_id', caller_id,
      'display_name', caller_name,
      'longitude', case when last_pos.geog is not null then extensions.st_x(last_pos.geog::extensions.geometry) else null end,
      'latitude', case when last_pos.geog is not null then extensions.st_y(last_pos.geog::extensions.geometry) else null end,
      'sent_at', now()
    )
  );
end;
$$;

revoke all on function public.send_sos(uuid) from public, anon;
grant execute on function public.send_sos(uuid) to authenticated;
