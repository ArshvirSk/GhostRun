import subprocess
import time
import sys

def run_adb(cmd):
    res = subprocess.run(f"adb {cmd}", shell=True, capture_output=True, text=True)
    if res.returncode != 0 and res.stderr:
        print(f"ADB Error ({cmd}): {res.stderr.strip()}", file=sys.stderr)
    return res

dev1 = "RZCWA2BC80T"
dev2 = "RZGL30WT2EJ"
apk = "android/app/build/outputs/apk/release/app-release.apk"

print("Installing APK on dev1 and dev2...")
subprocess.run(f"adb -s {dev1} install -r {apk}", shell=True, check=True)
subprocess.run(f"adb -s {dev2} install -r {apk}", shell=True, check=True)

print("Launching ResultScreen on both devices...")
for d in [dev1, dev2]:
    run_adb(f"-s {d} shell am force-stop com.ghostrun.app")
time.sleep(0.5)

for d in [dev1, dev2]:
    run_adb(f"-s {d} shell am start -a android.intent.action.VIEW -d 'ghost-run://result/47c3b4f0-271f-4588-9d65-ba7236b5e4e0' com.ghostrun.app")

print("Waiting for ResultScreen to load...")
time.sleep(6)

print("1. Capturing Tab 1 (SUMMARY)...")
run_adb(f"-s {dev1} exec-out screencap -p > test-run-screenshots/93_valorant_summary_dev1.png")
run_adb(f"-s {dev2} exec-out screencap -p > test-run-screenshots/93_valorant_summary_dev2.png")

print("2. Opening 9:16 Story Export Modal on dev1 at (960, 125)...")
run_adb(f"-s {dev1} shell input tap 960 125")
time.sleep(1.5)
run_adb(f"-s {dev1} exec-out screencap -p > test-run-screenshots/97_valorant_share_modal_dev1.png")
# Dismiss share modal by tapping the close button (top right of modal, around 950, 480 or back key)
run_adb(f"-s {dev1} shell input tap 950 480")
time.sleep(0.8)

print("3. Switching both to Tab 2 (OPERATIVES)...")
run_adb(f"-s {dev1} shell input tap 540 480")
run_adb(f"-s {dev2} shell input tap 540 480")
time.sleep(1.2)
run_adb(f"-s {dev1} exec-out screencap -p > test-run-screenshots/94_valorant_operatives_dev1.png")
run_adb(f"-s {dev2} exec-out screencap -p > test-run-screenshots/94_valorant_operatives_dev2.png")

print("4. Expanding Runner (TEST101) Drawer on dev2...")
run_adb(f"-s {dev2} shell input tap 540 1095")
time.sleep(1.2)
run_adb(f"-s {dev2} exec-out screencap -p > test-run-screenshots/95_valorant_drawer_dev2.png")

print("5. Switching dev2 to Tab 3 (TACTICAL MAP)...")
run_adb(f"-s {dev2} shell input tap 900 480")
time.sleep(3.0)
run_adb(f"-s {dev2} exec-out screencap -p > test-run-screenshots/96_valorant_map_dev2.png")

print("All screenshots successfully captured!")
