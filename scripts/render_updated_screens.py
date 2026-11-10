import os
import subprocess

ROOT_DIR = r"c:\ASK_Main\ASK\Projects\GhostRun"
SCREENSHOTS_DIR = os.path.join(ROOT_DIR, "docs", "screenshots")
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)
TEMP_DIR = os.path.join(ROOT_DIR, ".temp_renders")
os.makedirs(TEMP_DIR, exist_ok=True)

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

def render_html_to_png(html_content, output_png):
    temp_html = os.path.join(TEMP_DIR, "render_target.html")
    with open(temp_html, "w", encoding="utf-8") as f:
        f.write(html_content)
    
    cmd = [
        CHROME_PATH,
        "--headless",
        "--disable-gpu",
        "--window-size=390,844",
        f"--screenshot={output_png}",
        temp_html
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"Rendered: {output_png}")

def get_modes_html(theme):
    is_dark = theme == "dark"
    bg = "#101014" if is_dark else "#F3F0E8"
    text = "#F1EEE8" if is_dark else "#202124"
    text_muted = "#8E8E9A" if is_dark else "#5D5A62"
    surface = "#16171D" if is_dark else "#FFFFFF"
    surface_elevated = "#1F2028" if is_dark else "#E9E5DC"
    border = "#272832" if is_dark else "#DDD8CC"
    primary = "#C7F36B" if is_dark else "#557A22"
    primary_text = "#101014" if is_dark else "#FFFFFF"
    accent = "#9D7BE8" if is_dark else "#4A3B75"
    nav_bg = "#1C1D24" if is_dark else "#FFFFFF"
    nav_border = "rgba(255, 255, 255, 0.16)" if is_dark else "rgba(0, 0, 0, 0.12)"
    active_pill = "rgba(199, 243, 107, 0.16)" if is_dark else "rgba(85, 122, 34, 0.14)"

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
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex;
    flex-direction: column;
    overflow-y: scroll;
    position: relative;
  }}
  .container {{
    padding: 50px 18px 110px 18px;
  }}
  .page-title {{
    font-size: 28px;
    font-weight: 900;
    letter-spacing: -0.5px;
    margin-bottom: 4px;
  }}
  .page-sub {{
    font-size: 14px;
    color: {text_muted};
    line-height: 20px;
    margin-bottom: 16px;
  }}
  .filter-section {{
    margin-bottom: 16px;
  }}
  .filter-label {{
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 1px;
    color: {text_muted};
    margin-bottom: 8px;
  }}
  /* Full-bleed edge-to-edge horizontal chip scroll */
  .chip-scroll {{
    margin: 0 -18px;
    padding: 2px 18px;
    display: flex;
    gap: 8px;
    overflow-x: auto;
    scrollbar-width: none;
  }}
  .chip-scroll::-webkit-scrollbar {{ display: none; }}
  .chip {{
    flex-shrink: 0;
    padding: 6px 12px;
    border-radius: 16px;
    border: 1px solid {border};
    background: {surface};
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: {text_muted};
    cursor: pointer;
  }}
  .chip-active {{
    background: {surface_elevated};
    border-color: {accent};
    color: {accent};
    font-weight: 800;
  }}
  .card {{
    background: {surface};
    border: 1px solid {border};
    border-radius: 18px;
    padding: 16px;
    margin-bottom: 14px;
  }}
  .card-top {{
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 6px;
  }}
  .card-title {{
    font-size: 18px;
    font-weight: 900;
    letter-spacing: -0.2px;
  }}
  .stars {{
    font-size: 11px;
    color: {accent};
    padding: 3px 8px;
    border-radius: 6px;
    background: rgba(157, 123, 232, 0.12);
  }}
  .card-tagline {{
    font-size: 13px;
    line-height: 18px;
    color: {text_muted};
    margin-bottom: 12px;
  }}
  .badge-row {{
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }}
  .pill-badge {{
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 800;
    border: 1px solid {border};
    color: {text_muted};
  }}
  .intel-box {{
    background: {surface_elevated};
    border-radius: 8px;
    padding: 10px;
    margin-bottom: 14px;
  }}
  .intel-lbl {{
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 1px;
    color: {primary};
    margin-bottom: 3px;
  }}
  .intel-txt {{
    font-size: 12px;
    line-height: 16px;
    color: {text};
  }}
  .btn-row {{
    display: flex;
    gap: 10px;
  }}
  .btn-intel {{
    flex: 1;
    height: 40px;
    border-radius: 20px;
    background: {surface_elevated};
    border: 1px solid {border};
    color: {text};
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
  }}
  .btn-host {{
    flex: 1;
    height: 40px;
    border-radius: 20px;
    background: {primary};
    border: none;
    color: {primary_text};
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }}
  /* Floating Capsule Navbar with padding and elevation */
  .navbar {{
    position: fixed;
    bottom: 26px;
    left: 28px;
    right: 28px;
    height: 66px;
    border-radius: 36px;
    background: {nav_bg};
    border: 1.5px solid {nav_border};
    box-shadow: 0 12px 28px rgba(0,0,0,0.55);
    display: flex;
    align-items: center;
    justify-content: space-around;
    padding: 0 16px;
  }}
  .nav-tab {{
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    cursor: pointer;
  }}
  .tab-icon-wrapper {{
    width: 50px;
    height: 28px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
  }}
  .tab-active .tab-icon-wrapper {{
    background: {active_pill};
  }}
  .tab-label {{
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.5px;
    margin-top: 2px;
    color: {text_muted};
  }}
  .tab-active .tab-label {{
    color: {primary};
  }}
  .you-badge {{
    width: 22px;
    height: 22px;
    border-radius: 11px;
    background: {border};
    color: #FFFFFF;
    font-size: 11px;
    font-weight: 900;
    display: flex;
    align-items: center;
    justify-content: center;
  }}
</style>
</head>
<body>
<div class="container">
  <div class="page-title">MODES LIBRARY</div>
  <div class="page-sub">Tactical GPS game types built for physical outdoor evasion and intelligence.</div>

  <!-- SQUAD SIZE (Full-bleed horizontal scroll) -->
  <div class="filter-section">
    <div class="filter-label">SQUAD SIZE</div>
    <div class="chip-scroll">
      <div class="chip chip-active">ALL SIZES</div>
      <div class="chip">SOLO (1)</div>
      <div class="chip">SQUAD (2–4)</div>
      <div class="chip">MASSIVE (5+)</div>
    </div>
  </div>

  <!-- COMPLEXITY (Full-bleed horizontal scroll) -->
  <div class="filter-section">
    <div class="filter-label">COMPLEXITY</div>
    <div class="chip-scroll">
      <div class="chip chip-active">ALL TIERS</div>
      <div class="chip">CASUAL ★</div>
      <div class="chip">TACTICAL ★★</div>
      <div class="chip">HARDCORE ★★★</div>
    </div>
  </div>

  <!-- Mode 1: Classic Chase -->
  <div class="card">
    <div class="card-top">
      <span class="card-title">Classic Chase</span>
      <span class="stars">★★★</span>
    </div>
    <div class="card-tagline">Outrun delayed radar pings and reach the secret extraction target.</div>
    <div class="badge-row">
      <span class="pill-badge">PLAYERS: 4–12 PLAYERS</span>
      <span class="pill-badge">BASE</span>
    </div>
    <div class="intel-box">
      <div class="intel-lbl">MISSION BRIEF:</div>
      <div class="intel-txt">Infiltration target is kept secret from hunting squad.</div>
    </div>
    <div class="btn-row">
      <button class="btn-intel">Intel Dossier</button>
      <button class="btn-host">▶ Host Mode</button>
    </div>
  </div>

  <!-- Mode 2: Tag Hunt -->
  <div class="card">
    <div class="card-top">
      <span class="card-title">Tag Hunt</span>
      <span class="stars">★★★</span>
    </div>
    <div class="card-tagline">Pure survival pursuit with no extraction target. Outlast the clock.</div>
  </div>
</div>

<!-- Floating Capsule Navbar with 'Modes' Active -->
<div class="navbar">
  <div class="nav-tab">
    <div class="tab-icon-wrapper">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="{text_muted}">
        <path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/>
      </svg>
    </div>
    <span class="tab-label">Play</span>
  </div>
  <div class="nav-tab tab-active">
    <div class="tab-icon-wrapper">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="{primary}">
        <path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z"/>
      </svg>
    </div>
    <span class="tab-label">Modes</span>
  </div>
  <div class="nav-tab">
    <div class="tab-icon-wrapper">
      <div class="you-badge">A</div>
    </div>
    <span class="tab-label">You</span>
  </div>
</div>
</body>
</html>"""

if __name__ == "__main__":
    render_html_to_png(get_modes_html("dark"), os.path.join(SCREENSHOTS_DIR, "preview_modes_dark.png"))
    render_html_to_png(get_modes_html("light"), os.path.join(SCREENSHOTS_DIR, "preview_modes_light.png"))
    print("Modes preview renders completed!")
