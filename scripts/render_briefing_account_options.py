#!/usr/bin/env python3
"""
Render the new Beat 8 (Briefing Final Slide with Account Options) in both Light & Dark Afterimage themes.
"""

import os
import subprocess

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCREENSHOTS_DIR = os.path.join(ROOT_DIR, "docs", "screenshots")
DARK_DIR = os.path.join(SCREENSHOTS_DIR, "after_dark")
LIGHT_DIR = os.path.join(SCREENSHOTS_DIR, "after_light")
TEMP_DIR = os.path.join(ROOT_DIR, ".temp_renders")

os.makedirs(DARK_DIR, exist_ok=True)
os.makedirs(LIGHT_DIR, exist_ok=True)
os.makedirs(TEMP_DIR, exist_ok=True)

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

THEMES = {
    "dark": {
        "name": "Dark",
        "bg": "#101014",
        "bgDark": "#09090C",
        "surface": "#1B1A22",
        "surfaceDark": "#14131A",
        "surfaceElevated": "#24232D",
        "border": "#393743",
        "borderLight": "#282732",
        "borderAccent": "rgba(199, 243, 107, 0.4)",
        "text": "#F1EEE8",
        "textMuted": "#B7B2BF",
        "primary": "#C7F36B",
        "primaryText": "#101014",
        "accent": "#B8A3FF",
        "runner": "#C7F36B",
    },
    "light": {
        "name": "Light",
        "bg": "#F5F3ED",
        "bgDark": "#ECE8DF",
        "surface": "#FFFFFF",
        "surfaceDark": "#F0EDE4",
        "surfaceElevated": "#EAE5D9",
        "border": "#D5CEBE",
        "borderLight": "#E2DC CE",
        "borderAccent": "rgba(45, 106, 79, 0.4)",
        "text": "#1A1916",
        "textMuted": "#5E5950",
        "primary": "#2D6A4F",
        "primaryText": "#FFFFFF",
        "accent": "#6D4EC7",
        "runner": "#2D6A4F",
    }
}

def render_html(th):
    t = THEMES[th]
    segments = ""
    for i in range(1, 9):
        bg_col = t['primary'] if i == 8 else t['textMuted']
        segments += f'<div style="flex:1; height:3px; border-radius:2px; background:{bg_col};"></div>'

    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    width: 390px;
    height: 844px;
    background: {t['bg']};
    color: {t['text']};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }}
  .label {{
    font-family: 'SF Mono', Consolas, monospace;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
  }}
  .chip {{
    padding: 3px 8px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    background: {t['surfaceElevated']};
    color: {t['accent']};
    border: 1px solid {t['border']};
  }}
  .btn {{
    border-radius: 8px;
    font-weight: 700;
    text-align: center;
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
  }}
  .btn-primary {{
    background: {t['primary']};
    color: {t['primaryText']};
    height: 52px;
  }}
  .btn-secondary {{
    background: {t['surfaceElevated']};
    color: {t['text']};
    border: 1px solid {t['border']};
    height: 46px;
  }}
  .btn-ghost {{
    background: transparent;
    color: {t['textMuted']};
    height: 36px;
    font-size: 13px;
  }}
</style>
</head>
<body>
<!-- Top Bar -->
<div style="padding-top:48px; padding-left:16px; padding-right:16px; padding-bottom:12px; background:{t['bgDark']}; border-bottom:1px solid {t['borderLight']}; z-index:10;">
  <div style="display:flex; gap:4px; margin-bottom:8px;">{segments}</div>
  <div style="display:flex; justify-content:space-between; align-items:center; height:36px;">
    <div style="width:48px;"></div>
    <div style="display:flex; gap:6px;">
      <div class="chip">GRID READY</div>
    </div>
  </div>
</div>

<!-- Map Canvas with Radar Sweep simulation -->
<div style="flex:1; position:relative; background:{t['surfaceDark']}; overflow:hidden; display:flex; align-items:center; justify-content:center;">
  <div style="position:absolute; left:0; right:0; top:50%; height:1px; background:{t['borderLight']};"></div>
  <div style="position:absolute; top:0; bottom:0; left:50%; width:1px; background:{t['borderLight']};"></div>
  <div style="width:260px; height:260px; border:1.5px dashed {t['borderAccent']}; border-radius:50%; display:flex; align-items:center; justify-content:center;">
    <div style="width:160px; height:160px; border:1px solid {t['borderAccent']}; border-radius:50%; opacity:0.5;"></div>
  </div>
  <div style="position:absolute; width:120px; height:120px; border-radius:50%; background:radial-gradient(circle, {t['accent']} 0%, transparent 70%); opacity:0.25;"></div>
</div>

<!-- Bottom Card with Account Options -->
<div style="margin:16px; padding:18px; background:{t['surface']}; border:1px solid {t['border']}; border-radius:12px;">
  <div class="label" style="color:{t['runner']}; margin-bottom:4px; font-size:11px;">
    BEAT 08 / 08 • YOUR TURN
  </div>
  <div style="font-size:18px; font-weight:800; color:{t['text']}; margin-bottom:4px;">The grid is live</div>
  <div style="color:{t['textMuted']}; font-size:13px; line-height:18px; margin-bottom:16px;">
    Create a lobby to host your crew, or enter a 4-letter room code to join an active hunt.
  </div>

  <div style="display:flex; flex-direction:column; gap:10px;">
    <div class="btn btn-primary">Enter the Grid</div>
    <div class="btn btn-secondary">I already have an account</div>
    <div class="btn btn-ghost">← Review Briefing</div>
  </div>
</div>
</body>
</html>"""

for theme in ["dark", "light"]:
    html_content = render_html(theme)
    html_path = os.path.join(TEMP_DIR, f"briefing_beat8_{theme}.html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    out_dir = DARK_DIR if theme == "dark" else LIGHT_DIR
    out_png = os.path.join(out_dir, "briefing_account_options.png")

    cmd = [
        CHROME_PATH,
        "--headless",
        "--disable-gpu",
        "--window-size=390,844",
        "--hide-scrollbars",
        f"--screenshot={out_png}",
        f"file:///{os.path.abspath(html_path)}"
    ]
    subprocess.run(cmd, check=True)
    print(f"Rendered {out_png}")
