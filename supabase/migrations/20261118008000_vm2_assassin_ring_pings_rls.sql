-- Migration: 20261118008000_vm2_assassin_ring_pings_rls.sql
-- VM2: Restricts direct SELECT queries on public.pings for assassin_ring mode.
-- During live play in assassin_ring, players can only read pings of their assigned prey,
-- preserving asymmetric secrecy against modified clients.

create or replace function public.ping_is_accessible_to_member(
  p_game_id uuid,
  p_player_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.games g
    where g.id = p_game_id
      and (
        -- When match is ended or cancelled, all pings are readable by members for replay
        g.status in ('ended', 'cancelled')
        -- Non-assassin_ring modes use standard runner/hunter ping visibility
        or g.mode_id <> 'assassin_ring'
        -- A player can always read their own pings
        or p_player_id in (
          select p.id from public.players p
          where p.game_id = p_game_id and p.user_id = p_user_id
        )
        -- In assassin_ring, a player can read pings of their assigned prey only
        or p_player_id in (
          select ra.prey_player_id from public.ring_assignments ra
          join public.players p on p.id = ra.hunter_player_id
          where ra.game_id = p_game_id
            and p.user_id = p_user_id
            and ra.status = 'active'
        )
      )
  );
$$;

revoke all on function public.ping_is_accessible_to_member(uuid, uuid, uuid) from public, anon;
grant execute on function public.ping_is_accessible_to_member(uuid, uuid, uuid) to authenticated;

drop policy if exists pings_member_read on public.pings;
create policy pings_member_read on public.pings for select to authenticated
  using (
    public.is_member(game_id)
    and public.ping_is_visible(game_id, released_at)
    and public.ping_is_accessible_to_member(game_id, player_id, auth.uid())
  );
