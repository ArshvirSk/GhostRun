"""
GhostRun Tactical Map Asset Generator
Generates high-precision, supersampled, transparent PNG map markers and pointers
strictly following docs/UI_RESTRICTIONS.md (Afterimage visual direction).
"""

import math
from PIL import Image, ImageDraw, ImageFilter

# 4x supersampling factor for crisp vector-like anti-aliasing
SCALE = 4
SIZE = 128 * SCALE
CENTER = SIZE // 2

def hex_to_rgba(hex_code, alpha=255):
    hex_code = hex_code.lstrip('#')
    r = int(hex_code[0:2], 16)
    g = int(hex_code[2:4], 16)
    b = int(hex_code[4:6], 16)
    return (r, g, b, alpha)

# GhostRun Design Tokens
COLOR_RUNNER = hex_to_rgba('#C7F36B')      # Acid Lime
COLOR_HUNTER = hex_to_rgba('#FF8A75')      # Hunter Coral
COLOR_VIOLET = hex_to_rgba('#B8A3FF')      # Spectral Violet
COLOR_CYAN   = hex_to_rgba('#38BDF8')      # Tactical Cyan
COLOR_INK    = hex_to_rgba('#101014')      # Afterimage Dark Ink
COLOR_WHITE  = hex_to_rgba('#FFFFFF')

def create_runner_pointer():
    """Directional tactical chevron with forward heading cone for Runners."""
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. Forward heading cone (subtle 35-degree vision arc)
    arc_radius = int(SIZE * 0.44)
    cone_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    cone_draw = ImageDraw.Draw(cone_layer)
    cone_draw.pieslice(
        [CENTER - arc_radius, CENTER - arc_radius, CENTER + arc_radius, CENTER + arc_radius],
        start=270 - 24, end=270 + 24,
        fill=hex_to_rgba('#C7F36B', 38)
    )
    # Arc outer boundary tick
    cone_draw.arc(
        [CENTER - arc_radius, CENTER - arc_radius, CENTER + arc_radius, CENTER + arc_radius],
        start=270 - 24, end=270 + 24,
        fill=hex_to_rgba('#C7F36B', 120),
        width=int(2 * SCALE)
    )
    img = Image.alpha_composite(img, cone_layer)
    draw = ImageDraw.Draw(img)

    # 2. Main tactical chevron (pointing up/North)
    # Coordinates relative to CENTER
    tip = (CENTER, int(CENTER - 32 * SCALE))
    left_wing = (int(CENTER - 22 * SCALE), int(CENTER + 20 * SCALE))
    notch = (CENTER, int(CENTER + 10 * SCALE))
    right_wing = (int(CENTER + 22 * SCALE), int(CENTER + 20 * SCALE))

    # Outer dark stroke for high sunlight contrast on both light and dark maps
    outer_points = [
        (tip[0], tip[1] - 4 * SCALE),
        (left_wing[0] - 4 * SCALE, left_wing[1] + 3 * SCALE),
        (notch[0], notch[1] + 2 * SCALE),
        (right_wing[0] + 4 * SCALE, right_wing[1] + 3 * SCALE)
    ]
    draw.polygon(outer_points, fill=COLOR_INK)

    # Main Lime Body
    body_points = [tip, left_wing, notch, right_wing]
    draw.polygon(body_points, fill=COLOR_RUNNER)

    # Center tactical spine / groove
    spine_points = [
        tip,
        (int(CENTER - 6 * SCALE), int(CENTER + 8 * SCALE)),
        notch,
        (int(CENTER + 6 * SCALE), int(CENTER + 8 * SCALE))
    ]
    draw.polygon(spine_points, fill=hex_to_rgba('#9DC745'))

    # Cockpit dot
    dot_r = int(3.5 * SCALE)
    draw.ellipse([CENTER - dot_r, int(CENTER - 2 * SCALE) - dot_r, CENTER + dot_r, int(CENTER - 2 * SCALE) + dot_r], fill=COLOR_INK)

    # Downsample with Lanczos for anti-aliasing
    return img.resize((128, 128), Image.Resampling.LANCZOS)

def create_hunter_pointer():
    """Aggressive interceptor chevron with targeting reticle for Hunters."""
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. Forward sweep cone
    arc_radius = int(SIZE * 0.44)
    cone_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    cone_draw = ImageDraw.Draw(cone_layer)
    cone_draw.pieslice(
        [CENTER - arc_radius, CENTER - arc_radius, CENTER + arc_radius, CENTER + arc_radius],
        start=270 - 28, end=270 + 28,
        fill=hex_to_rgba('#FF8A75', 38)
    )
    cone_draw.arc(
        [CENTER - arc_radius, CENTER - arc_radius, CENTER + arc_radius, CENTER + arc_radius],
        start=270 - 28, end=270 + 28,
        fill=hex_to_rgba('#FF8A75', 130),
        width=int(2 * SCALE)
    )
    img = Image.alpha_composite(img, cone_layer)
    draw = ImageDraw.Draw(img)

    # 2. Interceptor Delta Chevron
    tip = (CENTER, int(CENTER - 34 * SCALE))
    left_fin = (int(CENTER - 24 * SCALE), int(CENTER + 22 * SCALE))
    notch = (CENTER, int(CENTER + 12 * SCALE))
    right_fin = (int(CENTER + 24 * SCALE), int(CENTER + 22 * SCALE))

    # Outer dark stroke
    outer_points = [
        (tip[0], tip[1] - 4 * SCALE),
        (left_fin[0] - 4 * SCALE, left_fin[1] + 3 * SCALE),
        (notch[0], notch[1] + 2 * SCALE),
        (right_fin[0] + 4 * SCALE, right_fin[1] + 3 * SCALE)
    ]
    draw.polygon(outer_points, fill=COLOR_INK)

    # Main Coral Body
    body_points = [tip, left_fin, notch, right_fin]
    draw.polygon(body_points, fill=COLOR_HUNTER)

    # Center predatory faceted facet
    left_facet = [tip, left_fin, notch]
    draw.polygon(left_facet, fill=hex_to_rgba('#E06F5C'))

    # Crosshair targeting notch
    draw.line([CENTER, int(CENTER - 18 * SCALE), CENTER, int(CENTER - 4 * SCALE)], fill=COLOR_INK, width=int(2.5 * SCALE))

    return img.resize((128, 128), Image.Resampling.LANCZOS)

def create_teammate_marker():
    """Tactical operative circular pin with team pulse aura."""
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. Subtle radar ping aura ring
    outer_r = int(SIZE * 0.40)
    draw.ellipse(
        [CENTER - outer_r, CENTER - outer_r, CENTER + outer_r, CENTER + outer_r],
        outline=hex_to_rgba('#38BDF8', 90),
        width=int(2 * SCALE)
    )

    # 2. Outer dark border circle
    base_r = int(SIZE * 0.26)
    draw.ellipse(
        [CENTER - base_r - int(3 * SCALE), CENTER - base_r - int(3 * SCALE),
         CENTER + base_r + int(3 * SCALE), CENTER + base_r + int(3 * SCALE)],
        fill=COLOR_INK
    )

    # 3. Main Cyan team disc
    draw.ellipse(
        [CENTER - base_r, CENTER - base_r, CENTER + base_r, CENTER + base_r],
        fill=COLOR_CYAN
    )

    # 4. White core eye
    core_r = int(base_r * 0.45)
    draw.ellipse(
        [CENTER - core_r, CENTER - core_r, CENTER + core_r, CENTER + core_r],
        fill=COLOR_WHITE
    )

    # 5. Heading tick (pointing top)
    tick_w = int(2.5 * SCALE)
    draw.polygon([
        (CENTER, int(CENTER - base_r - 7 * SCALE)),
        (CENTER - int(5 * SCALE), int(CENTER - base_r + 2 * SCALE)),
        (CENTER + int(5 * SCALE), int(CENTER - base_r + 2 * SCALE))
    ], fill=COLOR_WHITE)

    return img.resize((128, 128), Image.Resampling.LANCZOS)

def create_extraction_target():
    """Concentric tactical extraction zone bullseye with crosshair ticks."""
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. Outer radar boundary circle (Acid Lime, semi-translucent)
    r1 = int(SIZE * 0.44)
    draw.ellipse([CENTER - r1, CENTER - r1, CENTER + r1, CENTER + r1], outline=hex_to_rgba('#C7F36B', 140), width=int(2.5 * SCALE))

    # 2. Middle segmented pulsing ring
    r2 = int(SIZE * 0.31)
    draw.ellipse([CENTER - r2, CENTER - r2, CENTER + r2, CENTER + r2], outline=hex_to_rgba('#C7F36B', 220), width=int(3 * SCALE))

    # 3. Inner extraction bullseye ring with dark stroke
    r3 = int(SIZE * 0.17)
    draw.ellipse([CENTER - r3 - int(2*SCALE), CENTER - r3 - int(2*SCALE), CENTER + r3 + int(2*SCALE), CENTER + r3 + int(2*SCALE)], fill=COLOR_INK)
    draw.ellipse([CENTER - r3, CENTER - r3, CENTER + r3, CENTER + r3], fill=COLOR_RUNNER)

    # 4. Center beacon dot
    r_core = int(SIZE * 0.07)
    draw.ellipse([CENTER - r_core, CENTER - r_core, CENTER + r_core, CENTER + r_core], fill=COLOR_INK)

    # 5. Tactical crosshair tick marks (N, S, E, W)
    tick_len = int(8 * SCALE)
    tick_width = int(2.5 * SCALE)
    # North
    draw.line([CENTER, CENTER - r1 - tick_len, CENTER, CENTER - r1 + int(4*SCALE)], fill=COLOR_RUNNER, width=tick_width)
    # South
    draw.line([CENTER, CENTER + r1 - int(4*SCALE), CENTER, CENTER + r1 + tick_len], fill=COLOR_RUNNER, width=tick_width)
    # East
    draw.line([CENTER + r1 - int(4*SCALE), CENTER, CENTER + r1 + tick_len, CENTER], fill=COLOR_RUNNER, width=tick_width)
    # West
    draw.line([CENTER - r1 - tick_len, CENTER, CENTER - r1 + int(4*SCALE), CENTER], fill=COLOR_RUNNER, width=tick_width)

    return img.resize((128, 128), Image.Resampling.LANCZOS)

def create_radar_ghost_ping():
    """Spectral violet delayed enemy radar ping ripple."""
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. Outer dissipation ring (faint violet)
    r_out = int(SIZE * 0.44)
    draw.ellipse([CENTER - r_out, CENTER - r_out, CENTER + r_out, CENTER + r_out], outline=hex_to_rgba('#B8A3FF', 80), width=int(2 * SCALE))

    # 2. Main active pulse ring
    r_mid = int(SIZE * 0.28)
    draw.ellipse([CENTER - r_mid, CENTER - r_mid, CENTER + r_mid, CENTER + r_mid], outline=hex_to_rgba('#B8A3FF', 200), width=int(3 * SCALE))

    # 3. Inner afterimage core (Spectral Violet with dark stroke)
    r_core = int(SIZE * 0.12)
    draw.ellipse([CENTER - r_core - int(2*SCALE), CENTER - r_core - int(2*SCALE), CENTER + r_core + int(2*SCALE), CENTER + r_core + int(2*SCALE)], fill=COLOR_INK)
    draw.ellipse([CENTER - r_core, CENTER - r_core, CENTER + r_core, CENTER + r_core], fill=COLOR_VIOLET)

    # 4. Center diamond pip
    r_pip = int(SIZE * 0.05)
    draw.polygon([
        (CENTER, CENTER - r_pip),
        (CENTER + r_pip, CENTER),
        (CENTER, CENTER + r_pip),
        (CENTER - r_pip, CENTER)
    ], fill=COLOR_WHITE)

    return img.resize((128, 128), Image.Resampling.LANCZOS)

if __name__ == '__main__':
    assets = {
        'assets/map/pointers/runner-pointer.png': create_runner_pointer(),
        'assets/map/pointers/hunter-pointer.png': create_hunter_pointer(),
        'assets/map/pointers/teammate-marker.png': create_teammate_marker(),
        'assets/map/markers/extraction-target.png': create_extraction_target(),
        'assets/map/markers/radar-ghost-ping.png': create_radar_ghost_ping(),
    }

    for path, img in assets.items():
        img.save(path, format='PNG')
        print(f"Generated {path}: size={img.size}, mode={img.mode}")
