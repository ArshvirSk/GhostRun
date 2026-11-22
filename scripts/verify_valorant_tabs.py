import subprocess
import time
import sys

def run_adb(cmd):
    res = subprocess.run(f"adb {cmd}", shell=True, capture_output=True, text=True)
    if res.returncode != 0 and res.stderr:
        print(f"ADB Error ({cmd}): {res.stderr.strip()}", file=sys.stderr)
    return res

devices = ["RZCWA2BC80T", "RZGL30WT2EJ"]

print("1. Installing release APK on devices...")
apk_path = "android/app/build/outputs/apk/release/app-release.apk"
for d in devices:
    print(f"Installing on {d}...")
    subprocess.run(f"adb -s {d} install -r {apk_path}", shell=True, check=True)

print("2. Launching ResultScreen on both devices...")
for d in devices:
    run_adb(f"-s {d} shell am force-stop com.ghostrun.app")
    time.sleep(0.5)
    run_adb(f"-s {d} shell am start -a android.intent.action.VIEW -d 'ghost-run://result/47c3b4f0-271f-4588-9d65-ba7236b5e4e0' com.ghostrun.app")

time.sleep(5)

print("3. Capturing Tab 1 (SUMMARY) on both devices...")
run_adb("-s RZCWA2BC80T exec-out screencap -p > test-run-screenshots/93_valorant_summary_dev1.png")
run_adb("-s RZGL30WT2EJ exec-out screencap -p > test-run-screenshots/93_valorant_summary_dev2.png")

print("4. Switching to Tab 2 (OPERATIVES) on both devices...")
# Tab 2 button is at x=540, y=~340 (under banner)
# Let's tap at x=540, y=340
for d in devices:
    run_adb(f"-s {d} shell input tap 540 340")

time.sleep(1.5)
run_adb("-s RZCWA2BC80T exec-out screencap -p > test-run-screenshots/94_valorant_operatives_dev1.png")
run_adb("-s RZGL30WT2EJ exec-out screencap -p > test-run-screenshots/94_valorant_operatives_dev2.png")

print("5. Expanding Operative Drawer on dev2...")
# Hunter row is around y=440
run_adb("-s RZGL30WT2EJ shell input tap 540 440")
time.sleep(1)
run_adb("-s RZGL30WT2EJ exec-out screencap -p > test-run-screenshots/95_valorant_drawer_dev2.png")

print("6. Switching to Tab 3 (TACTICAL MAP) on dev2...")
# Tab 3 button is around x=880, y=340
run_adb("-s RZGL30WT2EJ shell input tap 900 340")
time.sleep(2)
run_adb("-s RZGL30WT2EJ exec-out screencap -p > test-run-screenshots/96_valorant_map_dev2.png")

print("7. Testing Top Share Button on dev1...")
# Top share button is at top right: around x=1000, y=140
run_adb("-s RZCWA2BC80T shell input tap 1000 145")
time.sleep(1.5)
run_adb("-s RZCWA2BC80T exec-out screencap -p > test-run-screenshots/97_valorant_share_modal_dev1.png")

print("Verification complete!")
