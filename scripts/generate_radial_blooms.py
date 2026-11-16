import math
import os
from PIL import Image

SIZE = 256
CENTER = SIZE / 2.0
RADIUS = SIZE / 2.0

os.makedirs('assets/map/fx', exist_ok=True)

def generate_bloom(filename, r_base, g_base, b_base, r_core, g_core, b_core):
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    pixels = img.load()

    for y in range(SIZE):
        for x in range(SIZE):
            dx = (x + 0.5) - CENTER
            dy = (y + 0.5) - CENTER
            dist = math.sqrt(dx * dx + dy * dy)
            t = dist / RADIUS

            if t >= 1.0:
                pixels[x, y] = (0, 0, 0, 0)
                continue

            # Smooth radiant drop-off: high center energy decaying to 0 at edge
            # Quadratic falloff multiplied by cosine gives silky-smooth radiance
            falloff = ((1.0 - t) ** 1.8) * math.cos(t * math.pi * 0.5)
            alpha = int(255 * min(1.0, max(0.0, falloff * 0.95)))

            # Interpolate core color into base perimeter color
            core_t = min(1.0, t / 0.35)
            r = int(r_core * (1.0 - core_t) + r_base * core_t)
            g = int(g_core * (1.0 - core_t) + g_base * core_t)
            b = int(b_core * (1.0 - core_t) + b_base * core_t)

            pixels[x, y] = (r, g, b, alpha)

    img.save(filename, "PNG")
    print(f"Generated {filename}")

# 1. Hunter / Zombie: Radiant Red (#FF2A55) with hot orange/coral center
generate_bloom(
    'assets/map/fx/radial-bloom-hunter.png',
    r_base=255, g_base=42, b_base=85,
    r_core=255, g_core=140, b_core=120
)

# 2. Runner / Normal: Radiant Tactical Cyan / Blue (#00F0FF / #38BDF8) with luminous white-blue center
generate_bloom(
    'assets/map/fx/radial-bloom-runner.png',
    r_base=0, g_base=240, b_base=255,
    r_core=200, g_core=248, b_core=255
)
