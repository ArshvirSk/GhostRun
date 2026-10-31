import os
from PIL import Image, ImageDraw

def create_circular_mask(size):
    # Create 4x supersampled mask for ultra-crisp antialiasing
    scale = 4
    mask = Image.new('L', (size * scale, size * scale), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size * scale - 1, size * scale - 1), fill=255)
    return mask.resize((size, size), Image.Resampling.LANCZOS)

def generate_icons():
    src_path = os.path.abspath('assets/logos/android-chrome-512x512.png')
    res_root = os.path.abspath('android/app/src/main/res')
    
    if not os.path.exists(src_path):
        raise FileNotFoundError(f"Source logo not found at {src_path}")
        
    img = Image.open(src_path).convert('RGBA')
    
    densities = {
        'mipmap-mdpi': (48, 108),
        'mipmap-hdpi': (72, 162),
        'mipmap-xhdpi': (96, 216),
        'mipmap-xxhdpi': (144, 324),
        'mipmap-xxxhdpi': (192, 432),
    }
    
    for folder, (launcher_size, fg_size) in densities.items():
        folder_path = os.path.join(res_root, folder)
        os.makedirs(folder_path, exist_ok=True)
        
        # 1. Standard ic_launcher.webp
        launcher_img = img.resize((launcher_size, launcher_size), Image.Resampling.LANCZOS)
        launcher_path = os.path.join(folder_path, 'ic_launcher.webp')
        launcher_img.save(launcher_path, 'WEBP', quality=100)
        print(f"Generated {launcher_path} ({launcher_size}x{launcher_size})")
        
        # 2. Round ic_launcher_round.webp
        mask = create_circular_mask(launcher_size)
        round_img = launcher_img.copy()
        round_img.putalpha(mask)
        round_path = os.path.join(folder_path, 'ic_launcher_round.webp')
        round_img.save(round_path, 'WEBP', quality=100)
        print(f"Generated {round_path} ({launcher_size}x{launcher_size} round)")
        
        # 3. Adaptive foreground ic_launcher_foreground.webp
        fg_img = Image.new('RGBA', (fg_size, fg_size), (0, 0, 0, 0))
        # Place logo in center within safe zone (68% of total width)
        inner_size = int(fg_size * 0.68)
        inner_logo = img.resize((inner_size, inner_size), Image.Resampling.LANCZOS)
        offset = (fg_size - inner_size) // 2
        fg_img.paste(inner_logo, (offset, offset), inner_logo)
        fg_path = os.path.join(folder_path, 'ic_launcher_foreground.webp')
        fg_img.save(fg_path, 'WEBP', quality=100)
        print(f"Generated {fg_path} ({fg_size}x{fg_size} foreground)")
        
    # 4. Create mipmap-anydpi-v26 for Android 8.0+
    anydpi_dir = os.path.join(res_root, 'mipmap-anydpi-v26')
    os.makedirs(anydpi_dir, exist_ok=True)
    
    adaptive_xml = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/splashscreen_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
'''
    with open(os.path.join(anydpi_dir, 'ic_launcher.xml'), 'w', encoding='utf-8') as f:
        f.write(adaptive_xml)
        
    with open(os.path.join(anydpi_dir, 'ic_launcher_round.xml'), 'w', encoding='utf-8') as f:
        f.write(adaptive_xml)
        
    print("Created mipmap-anydpi-v26/ic_launcher.xml and ic_launcher_round.xml")
    print("All Android launcher icons successfully updated!")

if __name__ == '__main__':
    generate_icons()
