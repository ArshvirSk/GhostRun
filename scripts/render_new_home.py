#!/usr/bin/env python3
"""
Render preview of the updated Play Screen and Navbar in GhostRun Afterimage Theme (Dark and Light).
"""

import os
import subprocess

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCREENSHOTS_DIR = os.path.join(ROOT_DIR, "docs", "screenshots")
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)
TEMP_DIR = os.path.join(ROOT_DIR, ".temp_renders")
os.makedirs(TEMP_DIR, exist_ok=True)

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

def generate_html(theme):
    if theme == "dark":
        bg = "#101014"
        text = "#F1EEE8"
        text_muted = "#B7B2BF"
        surface = "#1B1A22"
        surface_elevated = "#24232D"
        border = "#393743"
        primary = "#C7F36B"
        primary_text = "#101014"
        accent = "#B8A3FF"
        active_pill_bg = "#2F2E3A"
        badge_bg = "rgba(184, 163, 255, 0.12)"
    else:
        bg = "#F3F0E8"
        text = "#202124"
        text_muted = "#5D5A62"
        surface = "#FFFFFF"
        surface_elevated = "#E9E5DC"
        border = "#D8D3C9"
        primary = "#557A22"
        primary_text = "#FFFFFF"
        accent = "#6650A4"
        active_pill_bg = "rgba(85, 122, 34, 0.12)"
        badge_bg = "rgba(102, 80, 164, 0.10)"

    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    width: 390px;
    height: 844px;
    background: {bg};
    color: {text};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }}
  .container {{
    padding: 48px 22px 20px;
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }}
  .header-row {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
  }}
  .brand-group {{
    display: flex;
    align-items: center;
    gap: 8px;
  }}
  .brand-mark {{
    width: 26px;
    height: 26px;
    border-radius: 6px;
    background: {primary};
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 900;
    font-size: 15px;
    color: {primary_text};
  }}
  .brand-text {{
    font-size: 18px;
    font-weight: 900;
    letter-spacing: 2px;
    color: {text};
  }}
  .brand-text span {{
    color: {primary};
  }}
  .status-pill {{
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: 14px;
    border: 1px solid {border};
    background: {surface};
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 1px;
    color: {text_muted};
  }}
  .status-dot {{
    width: 7px;
    height: 7px;
    border-radius: 4px;
    background: {primary};
  }}
  .hero-greeting {{
    display: flex;
    flex-direction: column;
    margin-bottom: 20px;
  }}
  .hi-text {{
    font-size: 56px;
    font-weight: 900;
    line-height: 58px;
    letter-spacing: -1.5px;
    color: {text};
  }}
  .name-text {{
    font-size: 56px;
    font-weight: 900;
    line-height: 60px;
    letter-spacing: -1.5px;
    color: {text};
    margin-bottom: 12px;
  }}
  .sub-text {{
    font-size: 17px;
    font-weight: 500;
    line-height: 23px;
    color: {text_muted};
  }}
  .promo-card {{
    background: {surface};
    border-radius: 18px;
    padding: 14px 16px;
    border: 1px solid {border};
    margin-bottom: 24px;
    display: flex;
    flex-direction: column;
  }}
  .promo-header {{
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 1.2px;
    color: {accent};
    margin-bottom: 8px;
  }}
  .promo-body {{
    display: flex;
    align-items: center;
    gap: 12px;
  }}
  .og-badge {{
    border: 1.5px solid {accent};
    background: {badge_bg};
    border-radius: 7px;
    padding: 3px 7px;
    font-size: 11px;
    font-weight: 900;
    color: {accent};
  }}
  .promo-desc {{
    font-size: 13px;
    line-height: 18px;
    font-weight: 600;
    color: {text};
    flex: 1;
  }}
  .chevron {{
    font-size: 16px;
    color: {text_muted};
  }}
  .action-buttons {{
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 20px;
  }}
  .btn-host {{
    width: 100%;
    height: 56px;
    border-radius: 28px;
    background: {primary};
    color: {primary_text};
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 17px;
    font-weight: 800;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    cursor: pointer;
  }}
  .btn-join {{
    width: 100%;
    height: 56px;
    border-radius: 28px;
    background: {surface};
    border: 1px solid {border};
    color: {text};
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 17px;
    font-weight: 800;
    cursor: pointer;
  }}
  .links-row {{
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    font-size: 14px;
    font-weight: 600;
    color: {text_muted};
    margin-bottom: 90px;
  }}
  .floating-navbar {{
    position: absolute;
    bottom: 24px;
    left: 16px;
    right: 16px;
    height: 64px;
    border-radius: 36px;
    background: {surface_elevated};
    border: 1px solid {border};
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    display: flex;
    align-items: center;
    justify-content: space-around;
    padding: 0 8px;
  }}
  .tab-item {{
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 48px;
    min-width: 80px;
    border-radius: 24px;
  }}
  .tab-active {{
    background: {active_pill_bg};
    padding: 0 20px;
  }}
  .tab-icon {{
    font-size: 18px;
  }}
  .tab-label {{
    font-size: 11px;
    font-weight: 700;
    margin-top: 3px;
  }}
  .avatar-badge {{
    width: 20px;
    height: 20px;
    border-radius: 10px;
    background: {border};
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 800;
    color: {text_muted};
  }}
</style>
</head>
<body>
  <div class="container">
    <div>
      <div class="header-row">
        <div class="brand-group">
          <div class="brand-mark">G</div>
          <div class="brand-text">GHOST<span>RUN</span></div>
        </div>
        <div class="status-pill">
          <div class="status-dot"></div>
          GRID LIVE
        </div>
      </div>

      <div class="hero-greeting">
        <div class="hi-text">Hi,</div>
        <div class="name-text">Alphaop.</div>
        <div class="sub-text">Host a game or grab a code from a friend.</div>
      </div>

      <div class="promo-card">
        <div class="promo-header">TACTICAL GRID · OPERATIONAL</div>
        <div class="promo-body">
          <div class="og-badge">OG</div>
          <div class="promo-desc">Deploy outdoor chase arena.<br>Live radar tracking & ghost telemetry.</div>
          <div class="chevron">›</div>
        </div>
      </div>
    </div>

    <div>
      <div class="action-buttons">
        <div class="btn-host">Host a game</div>
        <div class="btn-join">Join with a code</div>
      </div>

      <div class="links-row">
        <span>How it works</span>
        <span>·</span>
        <span>Try a demo round</span>
      </div>
    </div>
  </div>

  <div class="floating-navbar">
    <div class="tab-item tab-active">
      <div class="tab-icon" style="color: {primary};">🗺️</div>
      <div class="tab-label" style="color: {primary};">Play</div>
    </div>
    <div class="tab-item">
      <div class="tab-icon" style="color: {text_muted};">🏆</div>
      <div class="tab-label" style="color: {text_muted};">Modes</div>
    </div>
    <div class="tab-item">
      <div class="avatar-badge">A</div>
      <div class="tab-label" style="color: {text_muted};">You</div>
    </div>
  </div>
</body>
</html>"""

for theme in ["dark", "light"]:
    html_file = os.path.join(TEMP_DIR, f"preview_{theme}.html")
    output_png = os.path.join(SCREENSHOTS_DIR, f"preview_afterimage_{theme}.png")
    with open(html_file, "w", encoding="utf-8") as f:
        f.write(generate_html(theme))

    cmd = [
        CHROME_PATH,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--window-size=390,844",
        f"--screenshot={output_png}",
        f"file:///{html_file.replace(os.sep, '/')}",
    ]
    subprocess.run(cmd, check=True)
    print(f"Rendered {theme} preview: {output_png}")
