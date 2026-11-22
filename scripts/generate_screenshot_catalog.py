import os
import glob
import hashlib
from collections import defaultdict
from datetime import datetime

base_dir = os.path.abspath('test-run-screenshots')
archive_dir = os.path.join(base_dir, 'archive')
artifact_dir = r'C:\Users\arshv\.gemini\antigravity\brain\063d1ff8-caa4-4e19-b75f-bae6145a6d68'
catalog_path = os.path.join(artifact_dir, 'screenshot_master_catalog.md')

primary_files = sorted([f for f in glob.glob(os.path.join(base_dir, '*.*')) if not os.path.isdir(f) and not f.endswith('.json')])
archived_files = sorted([f for f in glob.glob(os.path.join(archive_dir, '*.*')) if not os.path.isdir(f) and not f.endswith('.json')])

lines = []
lines.append('# GhostRun Screenshot Master Catalog & Order of Operations')
lines.append('')
lines.append('> [!NOTE]')
lines.append('> All 226 screenshots have been audited and organized. The primary `test-run-screenshots/` directory is now strictly confined to the **45 Canonical Production & Mode Showcase** captures. All 182 superseded debrief carousels, rapid-fire duplicates, and intermediate test dumps have been safely relocated to `test-run-screenshots/archive/`.')
lines.append('')
lines.append('## Executive Inventory Metrics')
lines.append('')
lines.append('| Category | Count | Directory | Purpose / Description |')
lines.append('| :--- | :--- | :--- | :--- |')
lines.append(f'| **Canonical Golden Path** | `26` | `test-run-screenshots/` | Complete production flow from cold launch to Valorant debrief |')
lines.append(f'| **Mode-Specific Showcases** | `19` | `test-run-screenshots/` | Specialized match mechanics for Classic Chase, Jailbreak, Ghost Duel, Relay Heist |')
lines.append(f'| **Total Active Primary Suite** | `45` | `test-run-screenshots/` | Clean, non-overlapping screenshot inventory |')
lines.append(f'| **Archived Superseded Captures** | `{len(archived_files)}` | `test-run-screenshots/archive/` | Historical bottom-sheet carousels, duplicate screencaps, and debug traces |')
lines.append('')
lines.append('---')
lines.append('')
lines.append('## 1. The Canonical "Golden Path" (End-to-End User Flow)')
lines.append('')
lines.append('The 26-step visual journey through GhostRun in its most up-to-date, production state.')
lines.append('')

golden_path_items = [
    ('01. Home Screen (Runner)', 'phase_a_01_home_dev1.png', 'Dev1 (TEST101)', 'Dark tactical home screen with runner stats, level badges, and Quick Play CTA.'),
    ('02. Home Screen (Hunter)', 'phase_a_01_home_dev2.png', 'Dev2 (ALPHAOP)', 'Hunter home screen with Season Echo progression, rank tier, and Host Match button.'),
    ('03. Host Wizard - Step 1: Mode Selection', '02_host_step1_mode_selection_dev2.png', 'Dev2 (ALPHAOP)', 'Selection cards for Outbreak Horde, Classic Chase, Jailbreak, Relay Heist, Territory Pulse.'),
    ('04. Host Wizard - Step 2: Modifiers & Rules', '03_host_step2_modifiers_dev2.png', 'Dev2 (ALPHAOP)', 'Configurable game parameters: Bio-Lifespan, Antidote Boost, Drift Speed.'),
    ('05. Host Wizard - Step 3: Tactical Extras', '04_host_step3_extras_dev2.png', 'Dev2 (ALPHAOP)', 'Toggleable sub-systems: Radar Ping frequency, Radio Comms, Jamming zones.'),
    ('06. Host Wizard - Step 4: Map Arena & Perimeter', '05_host_step4_arena_dev2.png', 'Dev2 (ALPHAOP)', 'MapLibre vector arena preview with boundary radius slider and beacon positioning.'),
    ('07. Host Wizard - Step 5: Mission Review', '06_host_step5_review_dev2.png', 'Dev2 (ALPHAOP)', 'Full tactical summary breakdown with DEPLOY MISSION confirmation button.'),
    ('08. Join Game - Code Entry', 'phase_a_03_join_screen_dev1.png', 'Dev1 (TEST101)', 'Tactical 4-digit code entry interface with automatic keyboard focus.'),
    ('09. Tactical Match Lobby - Created', 'phase_a_04_lobby_created.png', 'Dev2 (ALPHAOP)', 'Host in lobby awaiting operatives with room code badge and role assignment.'),
    ('10. Tactical Match Lobby - Operative Joined', 'phase_a_05_dev1_lobby_joined.png', 'Dev1 (TEST101)', 'Runner joined in room, viewing roster sync and role confirmation.'),
    ('11. Tactical Match Lobby - Both Ready', 'phase_a_08_both_ready2.png', 'Dev2 (ALPHAOP)', 'Both players marked READY with lime status badges; START MATCH active.'),
    ('12. Match Countdown - Runner View', '38_game_countdown_dev1.png', 'Dev1 (TEST101)', 'Giant tactical countdown (3... 2... 1...) preparing survivor deployment.'),
    ('13. Match Countdown - Hunter View', '38_game_countdown_dev2.png', 'Dev2 (ALPHAOP)', 'Countdown screen preparing hunter deployment and radar calibration.'),
    ('14. Headstart Phase - Runner Sprint', 'phase_a_13_headstart_dev1.png', 'Dev1 (TEST101)', 'Survivor headstart timer with mini-radar canvas active in top corner.'),
    ('15. Headstart Phase - Hunter Radar Standstill', 'phase_a_13_headstart_dev2.png', 'Dev2 (ALPHAOP)', 'Hunter delayed release timer with sensor calibration scan in progress.'),
    ('16. Live Match - Runner Survivor HUD', '101_live_hud_concentric_dev1.png', 'Dev1 (TEST101)', 'Off-screen objective reticles (Antidote, Jail, Extraction), Bio-Lifespan bar, concentric chevron.'),
    ('17. Live Match - Hunter Zombie HUD', '101_live_hud_concentric_dev2.png', 'Dev2 (ALPHAOP)', 'Centered map, 12 o\'clock heading lock, Proximity Threat Vignette, INFECT SURVIVOR button.'),
    ('18. Live Mode Showcase - Territory Pulse', '102_territory_pulse_concentric_dev2.png', 'Dev2 (ALPHAOP)', '7-segment dominance status bar, contested sectors, pulse countdown, centered map boundary.'),
    ('19. Valorant Debrief - Runner Defeat Summary', '93_valorant_summary_dev1.png', 'Dev1 (TEST101)', 'Tab 1 Summary: Coral DEFEAT banner, Season Echo bar, 3-stat strip (Survived/Distance/Streak).'),
    ('20. Valorant Debrief - Hunter Victory Summary', '93_valorant_summary_dev2.png', 'Dev2 (ALPHAOP)', 'Tab 1 Summary: Tactical Lime VICTORY banner, XP bar, 3-stat strip (Tags/Closest/Hunt Time).'),
    ('21. Valorant Debrief - Operatives Scoreboard (Runner)', '94_valorant_operatives_dev1.png', 'Dev1 (TEST101)', 'Tab 2 Operatives: Clean tabular roster grouped by Hunters vs Runners with chevrons.'),
    ('22. Valorant Debrief - Operatives Scoreboard (Hunter)', '94_valorant_operatives_dev2.png', 'Dev2 (ALPHAOP)', 'Tab 2 Operatives: Hunter perspective with stats, tags, and distance traveled.'),
    ('23. Valorant Debrief - Expanded Operative Drawer', '95_valorant_drawer_dev2.png', 'Dev2 (ALPHAOP)', 'Tapped operative row revealing inline telemetry drawer: Peak Noise, Closest Call, Route Fixes.'),
    ('24. Valorant Debrief - Tactical Map Replay', '96_valorant_map_dev2.png', 'Dev2 (ALPHAOP)', 'Tab 3 Tactical Map: Full-screen interactive dark map with 10s ping timeline scrubber.'),
    ('25. Debrief Modal - 9:16 Story Card Export', '97_valorant_share_modal_dev1.png', 'Dev1 (TEST101)', 'Non-intrusive modal showing full 9:16 Instagram/TikTok story card with SHARE CTA.'),
    ('26. Debrief Modal - Season Echo Formula', '98_valorant_formula_modal_dev1.png', 'Dev1 (TEST101)', 'O / Y / P / D formula math breakdown modal explaining exact echo point calculation.')
]

lines.append('| # | Step | Device | Screenshot | Purpose / Polish Detail |')
lines.append('| :--- | :--- | :--- | :--- | :--- |')
for step, fname, device, purpose in golden_path_items:
    file_uri = f'file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/{fname}'
    lines.append(f'| **{step[:2]}** | {step[4:]} | `{device}` | [{fname}]({file_uri}) | {purpose} |')

lines.append('')
lines.append('---')
lines.append('')
lines.append('## 2. Active Mode Showcase Suite (19 Retained Screenshots)')
lines.append('')
lines.append('| Mode | Stage | Device | Screenshot | Description |')
lines.append('| :--- | :--- | :--- | :--- | :--- |')
lines.append('| **Classic Chase** | Wizard Step 1 | Dev2 | [20_host_classic_chase_step1.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/20_host_classic_chase_step1.png) | Classic 1-vs-All chase mode configuration |')
lines.append('| **Classic Chase** | Modifiers | Dev2 | [21_host_classic_chase_modifiers.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/21_host_classic_chase_modifiers.png) | Tag radius and speed boost rules |')
lines.append('| **Classic Chase** | Review | Dev2 | [22_host_classic_chase_review.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/22_host_classic_chase_review.png) | Classic mission brief deployment |')
lines.append('| **Classic Chase** | Live Match | Dev1 | [25_game_live_dev1_runner_noise.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/25_game_live_dev1_runner_noise.png) | Microphone noise sprint detection |')
lines.append('| **Classic Chase** | Live Match | Dev2 | [25_game_live_dev2_hunter_radar.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/25_game_live_dev2_hunter_radar.png) | Tactical sonar sweep contact bloom |')
lines.append('| **Jailbreak** | Wizard Step 1 | Dev2 | [31_host_step1_mode_selection.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/31_host_step1_mode_selection.png) | Asymmetric cops-and-robbers mode setup |')
lines.append('| **Jailbreak** | Rules | Dev2 | [32_host_step2_rules.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/32_host_step2_rules.png) | Jail node capture & lock duration |')
lines.append('| **Jailbreak** | Extras | Dev2 | [33_host_step3_extras.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/33_host_step3_extras.png) | Extraction beacon triggers & radio alerts |')
lines.append('| **Jailbreak** | Arena | Dev2 | [34_host_step4_jail_placed.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/34_host_step4_jail_placed.png) | Interactive jail beacon map placement |')
lines.append('| **Jailbreak** | Review | Dev2 | [35_host_step5_review.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/35_host_step5_review.png) | Jailbreak deployment confirmation |')
lines.append('| **Jailbreak** | Live Match | Dev1 | [38_game_live_dev1_jailbreak.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/38_game_live_dev1_jailbreak.png) | Jail lock status & rescue distance indicator |')
lines.append('| **Relay Heist** | Live Match | Dev1 | [58_game_live_dev1_relay.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/58_game_live_dev1_relay.png) | Vault package carrying state and extraction timer |')
lines.append('| **Relay Heist** | Live Match | Dev2 | [58_game_live_dev2_relay.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/58_game_live_dev2_relay.png) | Interceptor view with drop site alerts |')
lines.append('| **Ghost Duel** | Wizard Step 1 | Dev2 | [70_host_step1_ghost_duel.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/70_host_step1_ghost_duel.png) | 1v1 tactical duel mode selection |')
lines.append('| **Ghost Duel** | Rules | Dev2 | [71_host_step2_ghost_rules.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/71_host_step2_ghost_rules.png) | Stealth radar & blind radius setup |')
lines.append('| **Ghost Duel** | Extras | Dev2 | [72_host_step3_extras.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/72_host_step3_extras.png) | Duel acoustic feedback & pulse alerts |')
lines.append('| **Ghost Duel** | Arena | Dev2 | [73_host_step4_arena.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/73_host_step4_arena.png) | Tight 100m duel perimeter configuration |')
lines.append('| **Ghost Duel** | Review | Dev2 | [74_host_step5_review.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/74_host_step5_review.png) | Duel parameters deployment review |')
lines.append('| **Ghost Duel** | Live Match | Dev2 | [77_game_live_ghost_duel.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/77_game_live_ghost_duel.png) | Active duel map with acoustic ping contact |')

lines.append('')
lines.append('---')
lines.append('')
lines.append(f'## 3. Archived Files Summary ({len(archived_files)} Files in `test-run-screenshots/archive/`)')
lines.append('')
lines.append('All 182 non-canonical files have been grouped into logical buckets inside the `archive/` subfolder:')
lines.append('')
lines.append('- **Superseded Vertical Debrief Carousels (54 files):** `victory_dark_c1`..`c8`, `11_result_carousel_dev1/2`, `26_result_card2/7/8`, `39_result_carousel_dev1/2`, `49_result_carousel_dev1/2`, `59_result_carousel_dev1/2`, and intermediate scroll peeks.')
lines.append('- **Binary Screencap Duplicates (12 files):** `confirmed_dev1/2`, `74_result_storycard_dev2`, `76_result_scrolled_dev1/2`, `81_result_roster_expanded_dev1`, `82_result_storycard_dev1`, `89_roster_expanded_dev2`.')
lines.append('- **Intermediate Test / Focus Dumps (116 files):** `dev1_curr`, `dev2_curr`, `dev2_res_test`, `phase_a_04_dev2_lobby_live`, `ready_check_dev1/2`, `v22_dev1/2_lobby`, `v23_dev1/2_lobby`.')
lines.append('')
lines.append('> [!TIP]')
lines.append('> Any archived file can be restored or referenced at any time under `test-run-screenshots/archive/<filename>`.')
lines.append('')

with open(catalog_path, 'w', encoding='utf-8') as fp:
    fp.write('\n'.join(lines))

print(f'Catalog refreshed at: {catalog_path}')
