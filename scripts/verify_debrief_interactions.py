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

# Capture initial peek
run_adb(f"-s RZCWA2BC80T exec-out screencap -p > test-run-screenshots/78_result_peek_dev1.png")
run_adb(f"-s RZGL30WT2EJ exec-out screencap -p > test-run-screenshots/78_result_peek_dev2.png")
print("Captured 78_result_peek")

# 2. Tap on "Formula Breakdown" in Section 1 on dev2
# On dev2, formula button is around x=540, y=1750 (in initial peek view)
# Let's scroll slightly so the Formula Breakdown button is well in view
run_adb(f"-s RZGL30WT2EJ shell input swipe 540 1600 540 1300 200")
time.sleep(1)
# Tap formula button
run_adb(f"-s RZGL30WT2EJ shell input tap 540 1520")
time.sleep(1)
run_adb(f"-s RZGL30WT2EJ exec-out screencap -p > test-run-screenshots/79_result_formula_dev2.png")
print("Captured 79_result_formula")

# 3. Scroll down to show Operative Roster on dev1
run_adb(f"-s RZCWA2BC80T shell input swipe 540 1600 540 1000 200")
time.sleep(1)
run_adb(f"-s RZCWA2BC80T exec-out screencap -p > test-run-screenshots/80_result_roster_dev1.png")
print("Captured 80_result_roster")

# 4. Tap on first player (ALPHAOP) in roster to expand inline telemetry
# Tap at x=400, y=1200 on dev1
run_adb(f"-s RZCWA2BC80T shell input tap 400 1200")
time.sleep(1)
run_adb(f"-s RZCWA2BC80T exec-out screencap -p > test-run-screenshots/81_result_roster_expanded_dev1.png")
print("Captured 81_result_roster_expanded")

# 5. Scroll down to show Shareable Story Card on dev1
run_adb(f"-s RZCWA2BC80T shell input swipe 540 1800 540 800 200")
time.sleep(1)
run_adb(f"-s RZCWA2BC80T exec-out screencap -p > test-run-screenshots/82_result_storycard_dev1.png")
print("Captured 82_result_storycard")

# 6. Test Role Rotation Toggle on dev1
# Tap "Keep Roles" at x=780, y=1980 (or around thumb zone role toggle)
run_adb(f"-s RZCWA2BC80T shell input tap 780 1980")
time.sleep(1)
run_adb(f"-s RZCWA2BC80T exec-out screencap -p > test-run-screenshots/83_result_role_toggle_dev1.png")
print("Captured 83_result_role_toggle")
