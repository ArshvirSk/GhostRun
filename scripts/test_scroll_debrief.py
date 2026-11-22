import subprocess
import time

def run_adb(cmd):
    return subprocess.run(f"adb {cmd}", shell=True, capture_output=True, text=True)

devices = ["RZCWA2BC80T", "RZGL30WT2EJ"]

# 1. Force stop and relaunch result screen
for d in devices:
    run_adb(f"-s {d} shell am force-stop com.ghostrun.app")
    time.sleep(0.5)
    run_adb(f"-s {d} shell am start -a android.intent.action.VIEW -d 'ghost-run://result/47c3b4f0-271f-4588-9d65-ba7236b5e4e0' com.ghostrun.app")

time.sleep(4)

# 2. Capture initial peek state on both devices
run_adb(f"-s RZCWA2BC80T exec-out screencap -p > test-run-screenshots/75_result_peek_dev1.png")
run_adb(f"-s RZGL30WT2EJ exec-out screencap -p > test-run-screenshots/75_result_peek_dev2.png")
print("Captured 75_result_peek")

# 3. Scroll down on Debrief Sheet (drag from y=1700 to y=900)
for d in devices:
    run_adb(f"-s {d} shell input swipe 540 1700 540 900 300")

time.sleep(2)
run_adb(f"-s RZCWA2BC80T exec-out screencap -p > test-run-screenshots/76_result_scrolled_dev1.png")
run_adb(f"-s RZGL30WT2EJ exec-out screencap -p > test-run-screenshots/76_result_scrolled_dev2.png")
print("Captured 76_result_scrolled")

# 4. Scroll further down to show Section 3 (Conditional Intel) and Section 4 (Shareable Story Card)
for d in devices:
    run_adb(f"-s {d} shell input swipe 540 1700 540 800 300")

time.sleep(2)
run_adb(f"-s RZCWA2BC80T exec-out screencap -p > test-run-screenshots/77_result_storycard_dev1.png")
run_adb(f"-s RZGL30WT2EJ exec-out screencap -p > test-run-screenshots/77_result_storycard_dev2.png")
print("Captured 77_result_storycard")
