import subprocess
import time

def run_adb(cmd):
    res = subprocess.run(f"adb {cmd}", shell=True, capture_output=True, text=True)
    return res

dev1 = "RZCWA2BC80T"
dev2 = "RZGL30WT2EJ"
zqha_id = "47c3b4f0-271f-4588-9d65-ba7236b5e4e0"
rswu_id = "26fe8f48-a331-460f-ad27-a991f08643cf"

print("0. Waking up devices...")
for d in [dev1, dev2]:
    run_adb(f"-s {d} shell input keyevent 224")
    run_adb(f"-s {d} shell input keyevent 82")
    run_adb(f"-s {d} shell input keyevent 3")
    run_adb(f"-s {d} shell input keyevent 4")
    time.sleep(0.3)

print("1. Launching live Outbreak Horde match (ZQHA) on both dev1 and dev2...")
for d in [dev1, dev2]:
    run_adb(f"-s {d} shell am force-stop com.ghostrun.app")
    time.sleep(0.5)
    run_adb(f"-s {d} shell am start -a android.intent.action.VIEW -d 'ghost-run://game/{zqha_id}' com.ghostrun.app")

time.sleep(5)

print("Capturing 99_tactical_hud_reticles_dev1.png...")
run_adb(f"-s {dev1} exec-out screencap -p > test-run-screenshots/99_tactical_hud_reticles_dev1.png")

print("Capturing 99_tactical_hud_reticles_dev2.png...")
run_adb(f"-s {dev2} exec-out screencap -p > test-run-screenshots/99_tactical_hud_reticles_dev2.png")

print("2. Launching Territory Pulse match (RSWU) on dev2...")
run_adb(f"-s {dev2} shell am force-stop com.ghostrun.app")
time.sleep(0.5)
run_adb(f"-s {dev2} shell am start -a android.intent.action.VIEW -d 'ghost-run://game/{rswu_id}' com.ghostrun.app")

time.sleep(5)

print("Capturing 100_territory_pulse_hud_dev2.png...")
run_adb(f"-s {dev2} exec-out screencap -p > test-run-screenshots/100_territory_pulse_hud_dev2.png")

print("Capture complete!")
