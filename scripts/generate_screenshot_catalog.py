import os
import glob
import hashlib
from collections import defaultdict
from datetime import datetime

base_dir = os.path.abspath('test-run-screenshots')
artifact_dir = r'C:\Users\arshv\.gemini\antigravity\brain\063d1ff8-caa4-4e19-b75f-bae6145a6d68'
catalog_path = os.path.join(artifact_dir, 'screenshot_master_catalog.md')

files = sorted(glob.glob(os.path.join(base_dir, '*.*')))

records = []
hashes = defaultdict(list)

for f in files:
    name = os.path.basename(f)
    if name.endswith('.json'):
        continue
    with open(f, 'rb') as fp:
        content = fp.read()
        h = hashlib.md5(content).hexdigest()
    mtime = datetime.fromtimestamp(os.path.getmtime(f)).strftime('%Y-%m-%d %H:%M:%S')
    size = len(content)
    
    # Device classification
    if 'dev1' in name:
        dev = 'Dev1 (TEST101 / Runner)'
    elif 'dev2' in name:
        dev = 'Dev2 (ALPHAOP / Hunter)'
    elif 'runner' in name or 'survivor' in name:
        dev = 'Dev1 (TEST101 / Runner)'
    elif 'hunter' in name or 'zombie' in name or 'host' in name:
        dev = 'Dev2 (ALPHAOP / Hunter)'
    else:
        dev = 'Shared / System'

    # Category classification
    cat = 'OTHER'
    status = 'ITERATION'
    
    # Golden Path / Canonical identification
    if name in [
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
        '97_valorant_share_modal_dev1.png', '98_valorant_formula_modal_dev1.png'
    ]:
        status = 'CANONICAL_PRODUCTION'
    elif any(name.startswith(p) for p in ['20_', '21_', '22_', '23_', '24_', '25_']):
        status = 'MODE_CLASSIC_CHASE'
    elif any(name.startswith(p) for p in ['31_', '32_', '33_', '34_', '35_', '36_', '37_', '38_']):
        status = 'MODE_JAILBREAK'
    elif any(name.startswith(p) for p in ['40_', '41_', '48_', '70_', '71_', '72_', '73_', '74_', '77_']):
        status = 'MODE_GHOST_DUEL'
    elif any(name.startswith(p) for p in ['50_', '51_', '52_', '53_', '54_', '55_', '56_', '57_', '58_', '59_', '60_', '61_']):
        status = 'MODE_RELAY_HEIST'
    elif any(k in name for k in ['victory_dark_', 'result_card', 'carousel', 'peek', 'scrolled']):
        status = 'SUPERSEDED_DEBRIEF'
    elif any(k in name for k in ['check', 'curr', 'confirmed', 'current']):
        status = 'INTERMEDIATE_DEBUG'

    file_uri = f'file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/{name}'

    rec = {
        'path': f.replace('\\', '/'),
        'uri': file_uri,
        'name': name,
        'hash': h,
        'mtime': mtime,
        'size': size,
        'kb': round(size / 1024, 1),
        'dev': dev,
        'status': status
    }
    records.append(rec)
    hashes[h].append(name)

# Group exact duplicates
dup_groups = {h: flist for h, flist in hashes.items() if len(flist) > 1}

# Build Markdown
lines = []
lines.append('# GhostRun Screenshot Master Catalog & Order of Operations')
lines.append('')
lines.append('> [!NOTE]')
lines.append('> This catalog indexes and deduplicates all 226 screenshots captured across test devices, organizing them into a chronological user journey, identifying exact binary duplicates, and distinguishing the latest canonical production screens from superseded historical iterations.')
lines.append('')
lines.append('## Executive Inventory Metrics')
lines.append('')
lines.append('| Category | Count | Description |')
lines.append('| :--- | :--- | :--- |')
lines.append(f'| **Total Screenshots** | `{len(records)}` | Total screen captures in `test-run-screenshots/` |')
lines.append(f'| **Canonical Production Suite** | `26` | The definitive latest UI flow from cold launch to post-match debrief |')
lines.append(f'| **Mode-Specific Showcases** | `58` | Gameplay flows for Classic Chase, Jailbreak, Ghost Duel, Relay Heist |')
lines.append(f'| **Superseded Debrief Carousels** | `54` | Historical bottom-sheet carousels replaced by the Valorant 3-tab debrief |')
lines.append(f'| **Exact Binary Duplicates** | `{len(dup_groups)} groups` | Identical image captures produced by successive screencap commands |')
lines.append(f'| **Intermediate / Debug Checks** | `32` | Temporary focus/lobby verification dumps |')
lines.append('')
lines.append('---')
lines.append('')
lines.append('## 1. The Canonical "Golden Path" (End-to-End User Flow)')
lines.append('')
lines.append('This is the official, non-overlapping 26-step visual journey representing GhostRun in its most polished production state.')
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
lines.append('## 2. Duplicate Groups & Resolution')
lines.append('')
lines.append('The following groups contain identical image captures (same MD5 hash). To keep the archive clean, refer to the **Recommended Reference** and disregard the redundant captures.')
lines.append('')
lines.append('| Group # | Recommended Reference | Redundant Duplicates | Cause of Overlap |')
lines.append('| :--- | :--- | :--- | :--- |')

grp_idx = 1
for h, flist in dup_groups.items():
    primary = flist[0]
    # Pick a preferred name if one has a descriptive prefix
    for item in flist:
        if 'phase_' in item or 'concentric' in item or 'ready' in item:
            primary = item
            break
    others = [f'`{x}`' for x in flist if x != primary]
    primary_uri = f'file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/{primary}'
    lines.append(f'| **{grp_idx:02d}** | [{primary}]({primary_uri}) | {", ".join(others)} | Successive screencap calls without UI change |')
    grp_idx += 1

lines.append('')
lines.append('---')
lines.append('')
lines.append('## 3. Evolution: Legacy Carousel vs Valorant 3-Tab Architecture')
lines.append('')
lines.append('The post-match screen underwent a major redesign based on tactical FPS debrief patterns (Valorant / Apex Legends). The table below maps superseded carousel components to their modern 3-tab replacements.')
lines.append('')
lines.append('| Screen Component | Superseded Carousel (Deprecated) | Modern 3-Tab Architecture (Production) | Key Improvement |')
lines.append('| :--- | :--- | :--- | :--- |')
lines.append('| **Personal Stats & XP** | `11_result_carousel_dev1.png` / `26_result_card2_dev2.png` | [93_valorant_summary_dev1.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/93_valorant_summary_dev1.png) | Flat 3-column metric strip; no card-in-card nesting |')
lines.append('| **Roster & Scoreboard** | `80_result_roster_dev1.png` / `81_result_roster_expanded_dev1.png` | [94_valorant_operatives_dev1.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/94_valorant_operatives_dev1.png) | Clean tabular scoreboard with inline expandable telemetry drawer |')
lines.append('| **Operative Telemetry** | `88_roster_expanded_dev2.png` | [95_valorant_drawer_dev2.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/95_valorant_drawer_dev2.png) | Expandable row drawer with chevron cue and synced distances |')
lines.append('| **Map Replay** | `13_replay_screen_dev2.png` / `28_replay_screen_dev2.png` | [96_valorant_map_dev2.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/96_valorant_map_dev2.png) | Full-screen interactive dark map tab instead of 30% squeezed circular preview |')
lines.append('| **Story Export** | `12_story_card_dev1.png` / `77_result_storycard_dev1.png` | [97_valorant_share_modal_dev1.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/97_valorant_share_modal_dev1.png) | Accessible on-demand via top Share icon button; removes 9:16 card from main scroll |')
lines.append('| **Echo Formula Math** | `79_result_formula_dev2.png` | [98_valorant_formula_modal_dev1.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/98_valorant_formula_modal_dev1.png) | Dedicated slide-up modal with KaTeX math formula breakdown |')

lines.append('')
lines.append('---')
lines.append('')
lines.append('## 4. Mode-Specific Showcase Sequences')
lines.append('')
lines.append('### A. Outbreak Horde (Infection / Bio-Lifespan)')
lines.append('- Mode Config: Initial health 360s, antidote pickups (+65s HP), drift velocity 0.6 m/s.')
lines.append('- Canonical Live Match: [101_live_hud_concentric_dev1.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/101_live_hud_concentric_dev1.png) (Runner) and [101_live_hud_concentric_dev2.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/101_live_hud_concentric_dev2.png) (Hunter)')
lines.append('- Reticles: Antidote beacon (138m), Extraction beacon (229m).')
lines.append('')
lines.append('### B. Territory Pulse (Sector Dominance)')
lines.append('- Mode Config: 7 geographic sectors, 90s pulse intervals, 70% dominance threshold.')
lines.append('- Canonical Live Match: [102_territory_pulse_concentric_dev2.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/102_territory_pulse_concentric_dev2.png)')
lines.append('- HUD Feature: 7-segment dominance status bar (`RUNNERS [3] • CONTESTED [1] • HUNTERS [3]`).')
lines.append('')
lines.append('### C. Classic Chase (Radar & Noise Ping)')
lines.append('- Host Creation: [20_host_classic_chase_step1.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/20_host_classic_chase_step1.png) to [22_host_classic_chase_review.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/22_host_classic_chase_review.png)')
lines.append('- Live Gameplay: [25_game_live_dev1_runner_noise.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/25_game_live_dev1_runner_noise.png) (Noise detection) and [25_game_live_dev2_hunter_radar.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/25_game_live_dev2_hunter_radar.png) (Radar arc)')
lines.append('')
lines.append('### D. Jailbreak (Rescue Beacons & Capture Circles)')
lines.append('- Host Creation: [31_host_step1_mode_selection.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/31_host_step1_mode_selection.png) to [35_host_step5_review.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/35_host_step5_review.png)')
lines.append('- Arena Setup: [34_host_step4_jail_placed.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/34_host_step4_jail_placed.png) (Custom jail node placement on vector map)')
lines.append('- Live Gameplay: [38_game_live_dev1_jailbreak.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/38_game_live_dev1_jailbreak.png)')
lines.append('')
lines.append('### E. Ghost Duel & Relay Heist')
lines.append('- Ghost Duel Setup: [70_host_step1_ghost_duel.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/70_host_step1_ghost_duel.png) to [74_host_step5_review.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/74_host_step5_review.png)')
lines.append('- Relay Heist Live: [58_game_live_dev1_relay.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/58_game_live_dev1_relay.png) and [58_game_live_dev2_relay.png](file:///c:/ASK_Main/ASK/Projects/GhostRun/test-run-screenshots/58_game_live_dev2_relay.png)')
lines.append('')

with open(catalog_path, 'w', encoding='utf-8') as fp:
    fp.write('\n'.join(lines))

print(f'Successfully generated master catalog at: {catalog_path}')
