-- V2-M7: Add haunted_map and ghost_duel to game_mode enum and update games_mode_id_check

alter type public.game_mode add value if not exists 'haunted_map';
alter type public.game_mode add value if not exists 'ghost_duel';

alter table public.games drop constraint if exists games_mode_id_check;
alter table public.games add constraint games_mode_id_check
  check (mode_id in ('classic_chase', 'tag_hunt', 'haunted_map', 'ghost_duel'));
