import subprocess
import time

apk = 'android/app/build/outputs/apk/release/app-release.apk'
subprocess.run(f'adb -s RZGL30WT2EJ install -r {apk}', shell=True, check=True)
subprocess.run('adb -s RZGL30WT2EJ shell am force-stop com.ghostrun.app', shell=True)
time.sleep(0.5)
subprocess.run("adb -s RZGL30WT2EJ shell am start -a android.intent.action.VIEW -d 'ghost-run://result/47c3b4f0-271f-4588-9d65-ba7236b5e4e0' com.ghostrun.app", shell=True)
time.sleep(4)

# Tap OPERATIVES tab at (540, 480)
subprocess.run('adb -s RZGL30WT2EJ shell input tap 540 480', shell=True)
time.sleep(1)

# Tap ALPHAOP row at (540, 780) to expand drawer
subprocess.run('adb -s RZGL30WT2EJ shell input tap 540 780', shell=True)
time.sleep(1)

subprocess.run('adb -s RZGL30WT2EJ exec-out screencap -p > test-run-screenshots/95_valorant_drawer_dev2.png', shell=True)
print('Recaptured 95_valorant_drawer_dev2.png')
