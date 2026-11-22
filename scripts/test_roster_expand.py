import subprocess
import time

def run_adb(cmd):
    return subprocess.run(f"adb {cmd}", shell=True, capture_output=True, text=True)

# 1. First scroll to top on dev1
run_adb("-s RZCWA2BC80T shell input swipe 540 500 540 1800 200")
time.sleep(1)

# 2. Scroll gently by 280px to bring Roster into view
run_adb("-s RZCWA2BC80T shell input swipe 540 1400 540 1120 200")
time.sleep(1)
run_adb("-s RZCWA2BC80T exec-out screencap -p > test-run-screenshots/84_result_roster_view_dev1.png")
print("Captured 84_result_roster_view")

# 3. Tap operative row (around y=1500)
run_adb("-s RZCWA2BC80T shell input tap 400 1500")
time.sleep(1)
run_adb("-s RZCWA2BC80T exec-out screencap -p > test-run-screenshots/85_result_roster_expanded_dev1.png")
print("Captured 85_result_roster_expanded")
