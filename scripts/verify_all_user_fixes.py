import subprocess
import time

def run_adb(cmd):
    return subprocess.run(f"adb {cmd}", shell=True, capture_output=True, text=True)

devices = ["RZCWA2BC80T", "RZGL30WT2EJ"]

# 1. Force stop and restart result screen on both devices
for d in devices:
    run_adb(f"-s {d} shell am force-stop com.ghostrun.app")
    time.sleep(0.5)
    run_adb(f"-s {d} shell am start -a android.intent.action.VIEW -d 'ghost-run://result/47c3b4f0-271f-4588-9d65-ba7236b5e4e0' com.ghostrun.app")

time.sleep(4)

# 2. Capture initial peek state on both devices
run_adb(f"-s RZCWA2BC80T exec-out screencap -p > test-run-screenshots/90_peek_dev1.png")
run_adb(f"-s RZGL30WT2EJ exec-out screencap -p > test-run-screenshots/90_peek_dev2.png")
print("Captured 90_peek")

# 3. Scroll down on Debrief Sheet to show Story Card on both devices
for d in devices:
    run_adb(f"-s {d} shell input swipe 540 1600 540 700 300")

time.sleep(2)
run_adb(f"-s RZCWA2BC80T exec-out screencap -p > test-run-screenshots/91_storycard_dev1.png")
run_adb(f"-s RZGL30WT2EJ exec-out screencap -p > test-run-screenshots/91_storycard_dev2.png")
print("Captured 91_storycard")

# 4. Tap "Export Story Card (9:16)" on dev1 (button is around x=300, y=1400 on dev1 when scrolled)
run_adb(f"-s RZCWA2BC80T shell input tap 300 1380")
time.sleep(2)
run_adb(f"-s RZCWA2BC80T exec-out screencap -p > test-run-screenshots/92_story_modal_dev1.png")
print("Captured 92_story_modal")
