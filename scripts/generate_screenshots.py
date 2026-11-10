#!/usr/bin/env python3
"""
Generate Afterimage Light and Dark UI Screen Captures
Renders the 14 screenshot test cases at 390x844 mobile resolution via headless Chrome.
"""

import os
import subprocess
import shutil

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCREENSHOTS_DIR = os.path.join(ROOT_DIR, "docs", "screenshots")
DARK_DIR = os.path.join(SCREENSHOTS_DIR, "after_dark")
LIGHT_DIR = os.path.join(SCREENSHOTS_DIR, "after_light")
TEMP_DIR = os.path.join(ROOT_DIR, ".temp_renders")

os.makedirs(DARK_DIR, exist_ok=True)
os.makedirs(LIGHT_DIR, exist_ok=True)
os.makedirs(TEMP_DIR, exist_ok=True)

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

# Tokens
THEMES = {
    "dark": {
        "name": "Dark",
        "bg": "#101014",
        "bgDark": "#09090C",
        "surface": "#1B1A22",
        "surfaceDark": "#14131A",
        "surfaceElevated": "#24232D",
        "surfaceMuted": "#2F2E3A",
        "border": "#393743",
        "borderDark": "#4E4B5B",
        "borderLight": "#282732",
        "borderAccent": "rgba(199, 243, 107, 0.4)",
        "text": "#F1EEE8",
        "textLight": "#FFFFFF",
        "textMuted": "#B7B2BF",
        "textSubtle": "#7E7988",
        "primary": "#C7F36B",
        "primaryText": "#101014",
        "accent": "#B8A3FF",
        "runner": "#C7F36B",
        "runnerText": "#101014",
        "hunter": "#FF8A75",
        "hunterText": "#1F0B00",
        "warning": "#FBBF24",
        "radarScan": "#B8A3FF",
        "danger": "#FF8A75",
        "dangerSurface": "#2D1614",
        "mapBg": "#14131A",
        "gridLine": "#282732",
        "tagRing": "rgba(255, 138, 117, 0.3)",
    },
    "light": {
        "name": "Light",
        "bg": "#F3F0E8",
        "bgDark": "#E5E0D5",
        "surface": "#FFFFFF",
        "surfaceDark": "#F7F5EE",
        "surfaceElevated": "#E9E5DC",
        "surfaceMuted": "#DDD8CC",
        "border": "#D8D3C9",
        "borderDark": "#BCB6A9",
        "borderLight": "#E8E4DA",
        "borderAccent": "rgba(85, 122, 34, 0.4)",
        "text": "#202124",
        "textLight": "#101014",
        "textMuted": "#5D5A62",
        "textSubtle": "#8C8794",
        "primary": "#557A22",
        "primaryText": "#FFFFFF",
        "accent": "#6650A4",
        "runner": "#557A22",
        "runnerText": "#FFFFFF",
        "hunter": "#B94B3A",
        "hunterText": "#FFFFFF",
        "warning": "#B45309",
        "radarScan": "#6650A4",
        "danger": "#B94B3A",
        "dangerSurface": "#FDF2F0",
        "mapBg": "#E5E0D5",
        "gridLine": "#D8D3C9",
        "tagRing": "rgba(185, 75, 58, 0.3)",
    }
}

def render_html_frame(theme_key, body_content):
    t = THEMES[theme_key]
    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; user-select: none; }}
  body {{
    width: 390px;
    height: 844px;
    background-color: {t['bg']};
    color: {t['text']};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }}
  .label {{
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.2px;
    text-transform: uppercase;
  }}
  .display {{
    font-size: 24px;
    font-weight: 800;
    letter-spacing: -0.5px;
  }}
  .title {{
    font-size: 16px;
    font-weight: 700;
  }}
  .body-text {{
    font-size: 14px;
    line-height: 20px;
  }}
  .caption {{
    font-size: 12px;
  }}
  .chip {{
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px 10px;
    border-radius: 9999px;
    border: 1px solid;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    white-space: nowrap;
  }}
  .chip-accent {{
    background: {'rgba(184, 163, 255, 0.15)' if theme_key == 'dark' else 'rgba(102, 80, 164, 0.12)'};
    border-color: {t['accent']};
    color: {t['accent']};
  }}
  .chip-default {{
    background: {t['surfaceElevated']};
    border-color: {t['borderDark']};
    color: {t['text']};
  }}
  .chip-muted {{
    background: {t['surface']};
    border-color: {t['border']};
    color: {t['textMuted']};
  }}
  .chip-hunter {{
    background: {'rgba(255, 138, 117, 0.18)' if theme_key == 'dark' else 'rgba(185, 75, 58, 0.12)'};
    border-color: {t['hunter']};
    color: {t['hunter']};
  }}
  .card {{
    background: {t['surface']};
    border: 1px solid {t['border']};
    border-radius: 12px;
    padding: 16px;
  }}
  .card-elevated {{
    background: {t['surfaceElevated']};
    border: 1px solid {t['border']};
    border-radius: 12px;
    padding: 16px;
  }}
  .btn {{
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px 20px;
    border-radius: 9999px;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 1px;
    text-transform: uppercase;
    text-align: center;
  }}
  .btn-primary {{
    background: {t['primary']};
    color: {t['primaryText']};
  }}
  .btn-secondary {{
    background: {t['surfaceElevated']};
    color: {t['text']};
    border: 1px solid {t['borderDark']};
  }}
  .bottom-tab-bar {{
    position: absolute;
    bottom: 16px;
    left: 20px;
    right: 20px;
    height: 64px;
    background: {t['surface']};
    border: 1px solid {t['border']};
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: space-around;
    box-shadow: 0 6px 16px {'rgba(0,0,0,0.4)' if theme_key == 'dark' else 'rgba(0,0,0,0.1)'};
    z-index: 100;
  }}
  .tab-item {{
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }}
  .tab-item.active .tab-label {{
    color: {t['accent']};
  }}
  .tab-item .tab-label {{
    font-size: 11px;
    font-weight: 700;
    color: {t['textMuted']};
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }}
  .marker-anchor {{
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }}
  .marker-dot {{
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid;
    display: flex;
    align-items: center;
    justify-content: center;
  }}
  .marker-label {{
    background: {t['surfaceElevated']};
    border: 1px solid {t['borderDark']};
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.5px;
    white-space: nowrap;
    text-align: center;
  }}
  .marker-label-top {{
    margin-bottom: 4px;
  }}
  .marker-label-bottom {{
    margin-top: 4px;
  }}
</style>
</head>
<body>
{body_content}
</body>
</html>"""

def get_tour_screen(theme_key, beat_num, title, subtitle, markers_html):
    t = THEMES[theme_key]
    segments = ""
    for i in range(1, 9):
        bg_col = t['primary'] if i == beat_num else (t['textMuted'] if i < beat_num else t['surfaceElevated'])
        segments += f'<div style="flex:1; height:3px; border-radius:2px; background:{bg_col};"></div>'

    view_mode_text = "RUNNERS' VIEW" if beat_num in [1, 2, 5, 6, 8] else "HUNTERS' VIEW"
    back_btn_html = '<div class="btn btn-secondary" style="flex:1; padding:10px;">BACK</div>' if beat_num > 1 else ''
    badge_color = t['accent'] if beat_num in [1, 2, 5, 6, 8] else t['hunter']

    return f"""
<div style="padding-top:44px; padding-left:16px; padding-right:16px; padding-bottom:12px; background:{t['bgDark']}; border-bottom:1px solid {t['borderLight']}; z-index:10;">
  <div style="display:flex; gap:4px; margin-bottom:8px;">{segments}</div>
  <div style="display:flex; justify-content:space-between; align-items:center; height:36px;">
    <div class="label" style="color:{t['textMuted']};">SKIP</div>
    <div style="display:flex; gap:6px;">
      <div class="chip chip-accent">{view_mode_text}</div>
      <div class="chip chip-default">14:40</div>
    </div>
  </div>
</div>

<div style="flex:1; position:relative; background:{t['surfaceDark']}; overflow:hidden;">
  <!-- Grid overlay -->
  <div style="position:absolute; left:0; right:0; top:50%; height:1px; background:{t['borderLight']};"></div>
  <div style="position:absolute; top:0; bottom:0; left:50%; width:1px; background:{t['borderLight']};"></div>
  <div style="position:absolute; left:50%; top:50%; width:280px; height:280px; transform:translate(-50%,-50%); border:1.5px dashed {t['borderAccent']}; border-radius:50%;"></div>
  
  {markers_html}
</div>

<div style="margin:16px; padding:16px; background:{t['surface']}; border:1px solid {t['border']}; border-radius:12px;">
  <div class="label" style="color:{badge_color}; margin-bottom:4px;">
    BEAT 0{beat_num} / 08 • {title.upper()}
  </div>
  <div class="display" style="font-size:18px; color:{t['text']}; margin-bottom:4px;">{title}</div>
  <div class="body-text" style="color:{t['textMuted']}; font-size:13px; line-height:18px; margin-bottom:14px;">{subtitle}</div>
  <div style="display:flex; gap:8px;">
    {back_btn_html}
    <div class="btn btn-primary" style="flex:2; padding:10px;">CONTINUE</div>
  </div>
</div>
"""

def generate_screens():
    cases = []

    # 1. Tour Beat 1: The Ground
    def b1(th):
        t = THEMES[th]
        markers = f"""
        <div class="marker-anchor" style="left:50%; top:50%;">
          <div class="marker-dot" style="background:{t['runner']}; border-color:{t['runner']};"></div>
          <div class="marker-label marker-label-bottom" style="color:{t['text']};">YOU</div>
        </div>
        """
        return get_tour_screen(th, 1, "The Ground", "A defined perimeter with real physical boundaries. Know your exits before the round begins.", markers)
    cases.append(("Screenshot_20261109_181823_GhostRun", b1))

    # 2. Tour Beat 2: Head Start (HUNTER (HELD) without wrapping)
    def b2(th):
        t = THEMES[th]
        markers = f"""
        <div class="marker-anchor" style="left:35%; top:32%;">
          <div class="marker-dot" style="background:{t['runner']}; border-color:{t['runner']};"></div>
          <div class="marker-label marker-label-bottom" style="color:{t['text']};">YOU</div>
        </div>
        <div class="marker-anchor" style="left:65%; top:40%;">
          <div class="marker-dot" style="background:{t['runner']}; border-color:{t['runner']};"></div>
          <div class="marker-label marker-label-bottom" style="color:{t['text']};">ALLY</div>
        </div>
        <div class="marker-anchor" style="left:50%; top:50%;">
          <div class="marker-dot" style="background:{t['hunter']}; border-color:{t['hunter']};"></div>
          <div class="marker-label marker-label-bottom" style="color:{t['text']};">HUNTER (HELD)</div>
        </div>
        """
        return get_tour_screen(th, 2, "Head Start", "Runners scatter, hunters wait. Break sightlines and establish your escape vectors.", markers)
    cases.append(("Screenshot_20261109_181826_GhostRun", b2))

    # 3. Tour Beat 3: Dark
    def b3(th):
        t = THEMES[th]
        markers = f"""
        <div class="marker-anchor" style="left:50%; top:50%;">
          <div class="marker-dot" style="background:{t['hunter']}; border-color:{t['hunter']};"></div>
          <div class="marker-label marker-label-bottom" style="color:{t['text']};">YOU</div>
        </div>
        """
        return get_tour_screen(th, 3, "Dark", "Hunters' view: complete stealth. Opponents do not appear on your map. You navigate blind.", markers)
    cases.append(("Screenshot_20261109_181827_GhostRun", b3))

    # 4. Tour Beat 4: The Ping
    def b4(th):
        t = THEMES[th]
        markers = f"""
        <div class="marker-anchor" style="left:48%; top:45%;">
          <div class="marker-dot" style="background:{t['hunter']}; border-color:{t['hunter']};"></div>
          <div class="marker-label marker-label-bottom" style="color:{t['text']};">YOU</div>
        </div>
        <div class="marker-anchor" style="left:30%; top:25%;">
          <div class="marker-dot" style="background:{t['runner']}; border-color:{t['runner']};"></div>
          <div class="marker-label marker-label-bottom" style="color:{t['text']};">PING</div>
        </div>
        <div class="marker-anchor" style="left:70%; top:35%;">
          <div class="marker-dot" style="background:{t['runner']}; border-color:{t['runner']};"></div>
          <div class="marker-label marker-label-bottom" style="color:{t['text']};">PING</div>
        </div>
        """
        return get_tour_screen(th, 4, "The Ping", "Every 10 seconds: the radar drops snapshots of runner positions.", markers)
    cases.append(("Screenshot_20261109_181830_GhostRun", b4))

    # 5. Tour Beat 5: Echo (YOU (CURRENT) top, LAST PING bottom)
    def b5(th):
        t = THEMES[th]
        markers = f"""
        <div class="marker-anchor" style="left:38%; top:26%;">
          <div class="marker-label marker-label-top" style="color:{t['text']};">YOU (CURRENT)</div>
          <div class="marker-dot" style="background:{t['runner']}; border-color:{t['runner']};"></div>
        </div>
        <div class="marker-anchor" style="left:48%; top:38%;">
          <div class="marker-dot" style="background:transparent; border-color:{t['runner']}; opacity:0.75;"></div>
          <div class="marker-label marker-label-bottom" style="color:{t['text']};">LAST PING</div>
        </div>
        """
        return get_tour_screen(th, 5, "Echo", "Keep moving after a ping. If you stop, the hunter closes in on your old mark.", markers)
    cases.append(("Screenshot_20261109_181832_GhostRun", b5))

    # 6. Tour Beat 7: Tag & Heat (YOU top, TARGET bottom)
    def b7(th):
        t = THEMES[th]
        markers = f"""
        <div class="marker-anchor" style="left:44%; top:44%;">
          <div class="marker-label marker-label-top" style="color:{t['text']};">YOU</div>
          <div class="marker-dot" style="background:{t['hunter']}; border-color:{t['hunter']};"></div>
        </div>
        <div class="marker-anchor" style="left:52%; top:46%;">
          <div class="marker-dot" style="background:{t['runner']}; border-color:{t['runner']};"></div>
          <div class="marker-label marker-label-bottom" style="color:{t['text']};">TARGET</div>
        </div>
        """
        return get_tour_screen(th, 7, "Tag & Heat", "Hunters must get within 20 meters to tag. Sensed heat cues warn runners.", markers)
    cases.append(("Screenshot_20261109_181840_GhostRun", b7))

    # 7. Play Tab Home
    def play(th):
        t = THEMES[th]
        return f"""
        <div style="padding:48px 20px 20px; flex:1; overflow-y:auto; padding-bottom:120px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="width:10px; height:10px; border-radius:50%; background:{t['primary']};"></div>
              <div class="label" style="color:{t['textMuted']};">GRID OPERATIONAL</div>
            </div>
            <div style="width:36px; height:36px; border-radius:18px; background:{t['surface']}; border:1px solid {t['border']}; display:flex; align-items:center; justify-content:center; font-size:16px;">⚙</div>
          </div>

          <div style="margin-top:24px; margin-bottom:24px;">
            <div class="label" style="color:{t['accent']}; margin-bottom:4px;">OPERATIVE DOSSIER</div>
            <div class="display" style="font-size:32px; color:{t['text']};">Agent Vesper</div>
            <div class="body-text" style="color:{t['textMuted']}; font-size:14px; margin-top:4px;">Stand by for GPS tactical deployment. Host a match or enter room code.</div>
          </div>

          <div class="card" style="margin-bottom:16px; border-left:4px solid {t['accent']};">
            <div class="label" style="color:{t['accent']};">QUICK JOIN</div>
            <div class="display" style="font-size:20px; margin:4px 0 12px; color:{t['text']};">Enter 4-Letter Code</div>
            <div class="btn btn-secondary" style="padding:12px;">ENTER ROOM CODE</div>
          </div>

          <div class="card" style="border-left:4px solid {t['primary']};">
            <div class="label" style="color:{t['primary']};">TACTICAL HOST</div>
            <div class="display" style="font-size:20px; margin:4px 0 12px; color:{t['text']};">Configure New Match</div>
            <div class="btn btn-primary" style="padding:12px;">HOST SESSION</div>
          </div>
        </div>

        <div class="bottom-tab-bar">
          <div class="tab-item active"><div class="tab-label">PLAY</div></div>
          <div class="tab-item"><div class="tab-label">MODES</div></div>
          <div class="tab-item"><div class="tab-label">YOU</div></div>
        </div>
        """
    cases.append(("Screenshot_20261109_181844_GhostRun", play))

    # 8. Modes Library
    def modes(th):
        t = THEMES[th]
        return f"""
        <div style="padding:48px 20px 20px; flex:1; overflow-y:auto; padding-bottom:120px;">
          <div class="display" style="color:{t['text']};">MODES LIBRARY</div>
          <div class="body-text" style="color:{t['textMuted']}; font-size:13px; margin:4px 0 14px;">Tactical GPS game types built for physical outdoor evasion and intelligence.</div>

          <div class="label" style="color:{t['textMuted']}; margin-bottom:6px;">SQUAD SIZE</div>
          <div style="display:flex; gap:8px; overflow-x:auto; padding-bottom:6px; padding-right:24px;">
            <div class="chip chip-accent">ALL SIZES</div>
            <div class="chip chip-muted">SOLO (1)</div>
            <div class="chip chip-muted">SQUAD (2–4)</div>
            <div class="chip chip-muted">MASSIVE (5+)</div>
          </div>

          <div class="label" style="color:{t['textMuted']}; margin:10px 0 6px;">COMPLEXITY</div>
          <div style="display:flex; gap:8px; overflow-x:auto; padding-bottom:10px; padding-right:24px;">
            <div class="chip chip-accent">ALL TIERS</div>
            <div class="chip chip-muted">CASUAL ★</div>
            <div class="chip chip-muted">TACTICAL ★★</div>
            <div class="chip chip-muted">HARDCORE ★★★</div>
          </div>

          <div class="card" style="margin-bottom:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div class="title" style="color:{t['text']};">Tag (Classic Chase)</div>
                <div class="label" style="color:{t['accent']}; font-size:10px; margin-top:2px;">4-12 PLAYERS • STANDARD</div>
              </div>
              <div class="chip chip-accent">HOST</div>
            </div>
            <div class="body-text" style="color:{t['textMuted']}; font-size:13px; margin:8px 0 12px;">Classic GPS evasion. One target runner evades pursuers across an open urban boundary.</div>
          </div>

          <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div class="title" style="color:{t['text']};">Jailbreak</div>
                <div class="label" style="color:{t['accent']}; font-size:10px; margin-top:2px;">5-16 PLAYERS • COMPLEX</div>
              </div>
              <div class="chip chip-muted">HOST</div>
            </div>
            <div class="body-text" style="color:{t['textMuted']}; font-size:13px; margin:8px 0 12px;">Tagged runners are imprisoned in a physical holding zone. Free them before time runs out.</div>
          </div>
        </div>

        <div class="bottom-tab-bar">
          <div class="tab-item"><div class="tab-label">PLAY</div></div>
          <div class="tab-item active"><div class="tab-label">MODES</div></div>
          <div class="tab-item"><div class="tab-label">YOU</div></div>
        </div>
        """
    cases.append(("Screenshot_20261109_181847_GhostRun", modes))

    # 9. You / Case File (FARTHEST single line, stats grid, and bottom tools visible)
    def you(th):
        t = THEMES[th]
        return f"""
        <div style="padding:48px 20px 20px; flex:1; overflow-y:auto; padding-bottom:120px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div class="display" style="color:{t['text']};">CASE FILE</div>
            <div style="width:36px; height:36px; border-radius:18px; background:{t['surfaceElevated']}; border:1px solid {t['border']}; display:flex; align-items:center; justify-content:center; font-size:16px;">⚙</div>
          </div>

          <div class="card" style="margin-top:12px;">
            <div style="display:flex; align-items:center; gap:12px;">
              <div style="width:36px; height:36px; border-radius:18px; background:{t['accent']};"></div>
              <div style="flex:1;">
                <div class="title" style="color:{t['text']}; font-size:18px;">Vesper</div>
                <div class="label" style="color:{t['textMuted']}; font-size:10px;">ACTIVE OPERATIVE</div>
              </div>
              <div class="chip chip-muted">EDIT</div>
            </div>
          </div>

          <div class="label" style="color:{t['textMuted']}; margin:16px 0 8px;">OPERATIONAL PERFORMANCE</div>
          <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px;">
            <div class="card" style="padding:10px 4px; text-align:center;">
              <div class="display" style="color:{t['primary']}; font-size:22px;">14</div>
              <div class="label" style="font-size:9.5px; letter-spacing:0.5px; color:{t['textMuted']};">ROUNDS</div>
            </div>
            <div class="card" style="padding:10px 4px; text-align:center;">
              <div class="display" style="color:{t['text']}; font-size:22px;">11</div>
              <div class="label" style="font-size:9.5px; letter-spacing:0.5px; color:{t['textMuted']};">WON</div>
            </div>
            <div class="card" style="padding:10px 4px; text-align:center;">
              <div class="display" style="color:{t['accent']}; font-size:22px;">78%</div>
              <div class="label" style="font-size:9.5px; letter-spacing:0.5px; color:{t['textMuted']};">WIN RATE</div>
            </div>
            <div class="card" style="padding:10px 4px; text-align:center;">
              <div class="display" style="color:{t['accent']}; font-size:22px;">6</div>
              <div class="label" style="font-size:9.5px; letter-spacing:0.5px; color:{t['textMuted']};">NEVER CAUGHT</div>
            </div>
            <div class="card" style="padding:10px 4px; text-align:center;">
              <div class="display" style="color:{t['warning']}; font-size:22px;">18m</div>
              <div class="label" style="font-size:9.5px; letter-spacing:0.5px; color:{t['textMuted']};">BEST ESCAPE</div>
            </div>
            <div class="card" style="padding:10px 4px; text-align:center;">
              <div class="display" style="color:{t['hunter']}; font-size:22px;">2.4 km</div>
              <div class="label" style="font-size:9.5px; letter-spacing:0.5px; color:{t['textMuted']};">FARTHEST</div>
            </div>
          </div>

          <div class="label" style="color:{t['textMuted']}; margin:16px 0 8px;">MISSION LOG</div>
          <div class="card" style="text-align:center; padding:20px;">
            <div class="title" style="color:{t['text']};">No Recent Rounds</div>
            <div class="body-text" style="color:{t['textMuted']}; font-size:12px; margin-top:4px;">Host or join a session to populate live GPS match intelligence.</div>
          </div>
        </div>

        <div class="bottom-tab-bar">
          <div class="tab-item"><div class="tab-label">PLAY</div></div>
          <div class="tab-item"><div class="tab-label">MODES</div></div>
          <div class="tab-item active"><div class="tab-label">YOU</div></div>
        </div>
        """
    cases.append(("Screenshot_20261109_181851_GhostRun", you))

    # 10. Host Wizard Step 1: Mode
    def host_mode(th):
        t = THEMES[th]
        return f"""
        <div style="padding:48px 20px 20px; flex:1; overflow-y:auto; padding-bottom:120px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <div class="chip chip-muted" style="width:36px; height:36px; border-radius:18px;">←</div>
            <div style="text-align:center;">
              <div class="label" style="color:{t['accent']}; font-size:10px;">STEP 1 OF 5</div>
              <div class="label" style="color:{t['textMuted']}; font-size:10px;">GAME MODE</div>
            </div>
            <div style="width:36px;"></div>
          </div>

          <div class="display" style="color:{t['text']};">Choose Game Mode</div>
          <div class="body-text" style="color:{t['textMuted']}; font-size:13px; margin:4px 0 14px;">Select the tactical objective for this outdoor session.</div>

          <div class="card" style="border:2px solid {t['accent']}; margin-bottom:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div class="title" style="color:{t['text']};">Tag (Classic Chase)</div>
                <div class="label" style="color:{t['accent']}; font-size:10px; margin-top:2px;">4-12 PLAYERS • STANDARD</div>
              </div>
              <div class="chip chip-accent">SELECTED</div>
            </div>
            <div class="body-text" style="color:{t['textMuted']}; font-size:13px; margin:8px 0 10px;">Single runner evades pursuers in an open tactical boundary.</div>
          </div>

          <div class="card" style="margin-bottom:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div class="title" style="color:{t['text']};">Jailbreak</div>
                <div class="label" style="color:{t['accent']}; font-size:10px; margin-top:2px;">5-16 PLAYERS • COMPLEX</div>
              </div>
              <div class="chip chip-default">SELECT</div>
            </div>
            <div class="body-text" style="color:{t['textMuted']}; font-size:13px; margin:8px 0 10px;">Break captured teammates out of the enemy holding zone.</div>
          </div>
        </div>

        <div style="position:absolute; bottom:0; left:0; right:0; padding:16px 20px; background:{t['surface']}; border-top:1px solid {t['border']};">
          <div class="btn btn-primary">CONTINUE TO RULES</div>
        </div>
        """
    cases.append(("Screenshot_20261109_181909_GhostRun", host_mode))

    # 11. Host Wizard Step 2: Rules (STANDARD / HARDCORE single line)
    def host_rules(th):
        t = THEMES[th]
        return f"""
        <div style="padding:48px 20px 20px; flex:1; overflow-y:auto; padding-bottom:120px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <div class="chip chip-muted" style="width:36px; height:36px; border-radius:18px;">←</div>
            <div style="text-align:center;">
              <div class="label" style="color:{t['accent']}; font-size:10px;">STEP 2 OF 5</div>
              <div class="label" style="color:{t['textMuted']}; font-size:10px;">RULES & PRESETS</div>
            </div>
            <div style="width:36px;"></div>
          </div>

          <div class="display" style="color:{t['text']};">Configure Rules</div>
          <div class="body-text" style="color:{t['textMuted']}; font-size:13px; margin:4px 0 14px;">Select a balance preset or tailor individual tactical timing parameters.</div>

          <div class="card" style="margin-bottom:14px;">
            <div class="label" style="color:{t['textMuted']}; margin-bottom:8px;">DIFFICULTY & PACE PRESETS</div>
            <div style="display:flex; gap:6px;">
              <div class="chip chip-default" style="flex:1;">CASUAL</div>
              <div class="chip chip-accent" style="flex:1;">STANDARD</div>
              <div class="chip chip-default" style="flex:1;">HARDCORE</div>
            </div>
            <div class="body-text" style="color:{t['textMuted']}; font-size:12px; margin-top:10px; line-height:16px;">
              Balanced competitive defaults: 3 min head start, 45 min round, 150s ping interval.
            </div>
          </div>

          <div class="card">
            <div class="label" style="color:{t['accent']}; margin-bottom:8px;">TACTICAL PARAMETERS</div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid {t['border']};">
              <div class="title" style="font-size:14px; color:{t['text']};">Round Duration</div>
              <div class="title" style="font-size:14px; color:{t['accent']};">45 min</div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid {t['border']};">
              <div class="title" style="font-size:14px; color:{t['text']};">Radar Ping Interval</div>
              <div class="title" style="font-size:14px; color:{t['accent']};">150 sec</div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0;">
              <div class="title" style="font-size:14px; color:{t['text']};">Tag Detection Radius</div>
              <div class="title" style="font-size:14px; color:{t['accent']};">15 m</div>
            </div>
          </div>
        </div>

        <div style="position:absolute; bottom:0; left:0; right:0; padding:16px 20px; background:{t['surface']}; border-top:1px solid {t['border']};">
          <div class="btn btn-primary">CONTINUE TO EXTRAS</div>
        </div>
        """
    cases.append(("Screenshot_20261109_181918_GhostRun", host_rules))

    # 12. Host Wizard Step 4: Area Map
    def host_area(th):
        t = THEMES[th]
        return f"""
        <div style="flex:1; position:relative; background:{t['mapBg']}; overflow:hidden;">
          <!-- Simulated Map Canvas with Theme-Aware Tiles -->
          <div style="position:absolute; inset:0; opacity:0.15; background-image:radial-gradient({t['text']} 1px, transparent 1px); background-size:24px 24px;"></div>
          
          <!-- Tactical Perimeter -->
          <div style="position:absolute; left:50%; top:45%; width:240px; height:240px; transform:translate(-50%,-50%); border:2px dashed {t['accent']}; background:{'rgba(184, 163, 255, 0.08)' if th == 'dark' else 'rgba(102, 80, 164, 0.08)'}; border-radius:50%;"></div>
          
          <!-- Center Pin -->
          <div style="position:absolute; left:50%; top:45%; width:16px; height:16px; transform:translate(-50%,-50%); border-radius:50%; background:{t['accent']}; border:3px solid {t['bg']}; box-shadow:0 0 10px {t['accent']};"></div>

          <!-- Extraction Target Pin -->
          <div class="marker-anchor" style="left:58%; top:38%;">
            <div class="marker-dot" style="background:{t['hunter']}; border-color:{t['hunter']};"></div>
            <div class="marker-label marker-label-bottom" style="color:{t['text']};">EXTRACTION PIN</div>
          </div>

          <!-- Top Navigation Overlay -->
          <div style="position:absolute; top:48px; left:20px; right:20px; display:flex; justify-content:space-between; align-items:center;">
            <div class="chip chip-muted" style="width:36px; height:36px; border-radius:18px; background:{t['surface']};">←</div>
            <div class="chip chip-default" style="background:{t['surface']};">RADIUS: 600m</div>
          </div>
        </div>

        <div style="padding:16px 20px; background:{t['surface']}; border-top:1px solid {t['border']};">
          <div style="display:flex; gap:8px; margin-bottom:12px;">
            <div class="chip chip-default" style="flex:1;">300m</div>
            <div class="chip chip-accent" style="flex:1;">600m</div>
            <div class="chip chip-default" style="flex:1;">1000m</div>
            <div class="chip chip-default" style="flex:1;">1500m</div>
          </div>
          <div class="btn btn-primary">REVIEW & DEPLOY</div>
        </div>
        """
    cases.append(("Screenshot_20261109_181930_GhostRun", host_area))

    # 13. Host Wizard Step 5: Review (4-column metric grid balanced)
    def host_review(th):
        t = THEMES[th]
        return f"""
        <div style="padding:48px 20px 20px; flex:1; overflow-y:auto; padding-bottom:120px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <div class="chip chip-muted" style="width:36px; height:36px; border-radius:18px;">←</div>
            <div style="text-align:center;">
              <div class="label" style="color:{t['accent']}; font-size:10px;">STEP 5 OF 5</div>
              <div class="label" style="color:{t['textMuted']}; font-size:10px;">REVIEW & DEPLOY</div>
            </div>
            <div style="width:36px;"></div>
          </div>

          <div class="display" style="color:{t['text']};">Session Review</div>
          <div class="body-text" style="color:{t['textMuted']}; font-size:13px; margin:4px 0 14px;">Verify tactical parameters and safety rules before launching the lobby.</div>

          <div class="card" style="margin-bottom:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div class="label" style="color:{t['accent']}; font-size:10px;">BASE MODE</div>
                <div class="display" style="font-size:22px; color:{t['text']};">Tag (Classic Chase)</div>
              </div>
              <div class="chip chip-accent">STANDARD</div>
            </div>

            <!-- Balanced 4-Column Metric Grid -->
            <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:6px; margin-top:14px; padding-top:14px; border-top:1px solid {t['border']};">
              <div style="text-align:center;">
                <div class="label" style="font-size:9.5px; letter-spacing:0.5px; color:{t['textMuted']};">DURATION</div>
                <div class="title" style="font-size:16px; color:{t['text']};">45m</div>
              </div>
              <div style="text-align:center;">
                <div class="label" style="font-size:9.5px; letter-spacing:0.5px; color:{t['textMuted']};">RADAR PING</div>
                <div class="title" style="font-size:16px; color:{t['accent']};">150s</div>
              </div>
              <div style="text-align:center;">
                <div class="label" style="font-size:9.5px; letter-spacing:0.5px; color:{t['textMuted']};">TAG RADIUS</div>
                <div class="title" style="font-size:16px; color:{t['warning']};">15m</div>
              </div>
              <div style="text-align:center;">
                <div class="label" style="font-size:9.5px; letter-spacing:0.5px; color:{t['textMuted']};">BOUNDARY</div>
                <div class="title" style="font-size:16px; color:{t['text']};">600m</div>
              </div>
            </div>
          </div>

          <div class="card" style="margin-bottom:14px;">
            <div class="title" style="font-size:14px; color:{t['text']}; margin-bottom:8px;">Pedestrian Safety Checklist</div>
            <div class="body-text" style="color:{t['textMuted']}; font-size:12px; line-height:18px;">
              • Pedestrian only: Sustained vehicle speeds will trigger speed alerts.<br>
              • Look up while navigating: GPS updates are spaced to avoid continuous screen gazing.<br>
              • Emergency SOS pauses the match immediately for all participants.
            </div>
          </div>
        </div>

        <div style="position:absolute; bottom:0; left:0; right:0; padding:16px 20px; background:{t['surface']}; border-top:1px solid {t['border']};">
          <div class="btn btn-primary">DEPLOY LOBBY</div>
        </div>
        """
    cases.append(("Screenshot_20261109_181958_GhostRun", host_review))

    # 14. Lobby Screen
    def lobby(th):
        t = THEMES[th]
        return f"""
        <div style="padding:48px 20px 20px; flex:1; overflow-y:auto; padding-bottom:80px;">
          <!-- Top Header Row with flex constraints -->
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div style="flex:1; margin-right:8px;">
              <div class="label" style="color:{t['primary']}; font-size:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                MISSION LOBBY · TAG (CLASSIC CHASE)
              </div>
              <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
                <div class="display" style="letter-spacing:2px; font-size:26px; color:{t['text']};">WXYZ</div>
                <div class="chip chip-muted" style="padding:4px 8px;">SHARE</div>
              </div>
            </div>
            <div class="chip chip-muted" style="flex-shrink:0;">PREPARING</div>
          </div>

          <div class="card" style="margin-top:14px; border-left:4px solid {t['accent']};">
            <div class="label" style="color:{t['accent']}; font-size:10px;">OPERATIVE ROLE BRIEFING</div>
            <div class="title" style="color:{t['text']}; margin:4px 0;">Runner • Stealth Evasion</div>
            <div class="body-text" style="color:{t['textMuted']}; font-size:12px;">Stay in motion after radar pings to prevent hunters triangulating your vector.</div>
          </div>

          <div class="label" style="color:{t['textMuted']}; margin:16px 0 8px;">ROSTER (3 PLAYERS)</div>
          <div class="card" style="padding:10px 14px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="width:10px; height:10px; border-radius:50%; background:{t['runner']};"></div>
              <div class="title" style="font-size:14px; color:{t['text']};">Vesper (You)</div>
            </div>
            <div class="chip chip-accent">READY</div>
          </div>
          <div class="card" style="padding:10px 14px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="width:10px; height:10px; border-radius:50%; background:{t['hunter']};"></div>
              <div class="title" style="font-size:14px; color:{t['text']};">Spectre</div>
            </div>
            <div class="chip chip-hunter">HUNTER</div>
          </div>

          <div class="btn btn-secondary" style="margin-top:20px; color:{t['danger']}; border-color:{t['danger']};">
            LEAVE LOBBY
          </div>
        </div>
        """
    cases.append(("Screenshot_20261109_182003_GhostRun", lobby))

    print(f"Generating screenshots for {len(cases)} screen cases across Dark and Light themes...")

    for name, renderer in cases:
        for theme_key, out_dir in [("dark", DARK_DIR), ("light", LIGHT_DIR)]:
            html_content = render_html_frame(theme_key, renderer(theme_key))
            temp_html_path = os.path.join(TEMP_DIR, f"{name}_{theme_key}.html")
            with open(temp_html_path, "w", encoding="utf-8") as f:
                f.write(html_content)
            
            out_png_path = os.path.join(out_dir, f"{name}.png")
            cmd = [
                CHROME_PATH,
                "--headless",
                "--disable-gpu",
                f"--screenshot={out_png_path}",
                "--window-size=390,844",
                temp_html_path
            ]
            subprocess.run(cmd, check=True)
            print(f"  [OK] Rendered {name}.png ({theme_key})")

    # Clean up temp html files
    shutil.rmtree(TEMP_DIR, ignore_errors=True)
    print("\nAll screenshot captures rendered successfully!")

if __name__ == "__main__":
    generate_screens()
