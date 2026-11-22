import os
import glob
import shutil

base_dir = os.path.abspath('test-run-screenshots')
archive_dir = os.path.join(base_dir, 'archive')
os.makedirs(archive_dir, exist_ok=True)

# 45 files to keep in primary folder:
# 26 Canonical Golden Path + 19 Key Mode Showcases
canonical_files = set([
    # Canonical Golden Path (26)
    'phase_a_01_home_dev1.png', 'phase_a_01_home_dev2.png',
    '02_host_step1_mode_selection_dev2.png', '03_host_step2_modifiers_dev2.png',
    '04_host_step3_extras_dev2.png', '05_host_step4_arena_dev2.png',
    '06_host_step5_review_dev2.png', 'phase_a_03_join_screen_dev1.png',
    'phase_a_04_lobby_created.png', 'phase_a_05_dev1_lobby_joined.png',
    'phase_a_08_both_ready2.png', '38_game_countdown_dev1.png',
    '38_game_countdown_dev2.png', 'phase_a_13_headstart_dev1.png',
    'phase_a_13_headstart_dev2.png', '101_live_hud_concentric_dev1.png',
    '101_live_hud_concentric_dev2.png', '102_territory_pulse_concentric_dev2.png',
    '93_valorant_summary_dev1.png', '93_valorant_summary_dev2.png',
    '94_valorant_operatives_dev1.png', '94_valorant_operatives_dev2.png',
    '95_valorant_drawer_dev2.png', '96_valorant_map_dev2.png',
    '97_valorant_share_modal_dev1.png', '98_valorant_formula_modal_dev1.png',
    # Mode Showcases (19)
    '20_host_classic_chase_step1.png', '21_host_classic_chase_modifiers.png', '22_host_classic_chase_review.png',
    '25_game_live_dev1_runner_noise.png', '25_game_live_dev2_hunter_radar.png',
    '31_host_step1_mode_selection.png', '32_host_step2_rules.png', '33_host_step3_extras.png',
    '34_host_step4_jail_placed.png', '35_host_step5_review.png', '38_game_live_dev1_jailbreak.png',
    '58_game_live_dev1_relay.png', '58_game_live_dev2_relay.png',
    '70_host_step1_ghost_duel.png', '71_host_step2_ghost_rules.png', '72_host_step3_extras.png',
    '73_host_step4_arena.png', '74_host_step5_review.png', '77_game_live_ghost_duel.png'
])

all_files = [f for f in glob.glob(os.path.join(base_dir, '*.*')) if not f.endswith('.json') and not os.path.isdir(f)]

moved_count = 0
for f in all_files:
    fname = os.path.basename(f)
    if fname not in canonical_files:
        dest = os.path.join(archive_dir, fname)
        shutil.move(f, dest)
        moved_count += 1

print(f'Archived {moved_count} superseded/duplicate files to {archive_dir}.')
print(f'Retained {len(canonical_files)} clean, canonical screenshots in {base_dir}.')
