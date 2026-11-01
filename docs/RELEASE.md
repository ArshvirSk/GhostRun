# GhostRun — Release Checklist & Release Hygiene

> Companion to `docs/MODES.md`, `docs/DECISIONS.md`, and `docs/V2_VERIFY.md`.
> This document defines the mandatory pre-flight checklist, versioning rules, signing requirements, and verification procedures before publishing any GhostRun APK release.

---

## 1. Pre-Flight Verification Checklist

Run all automated checks prior to building any release artifact:

```bash
# 1. Format check
npm run format:check

# 2. Strict TypeScript compilation
npm run typecheck

# 3. Expo ESLint validation
npm run lint

# 4. Auth & cooldown unit tests
npm run test:cooldown

# 5. Database RLS and Secrecy Matrix verification (116+ checks)
npm run rls

# 6. End-to-end multi-player simulation scenarios
npm run sim
```

All 6 test suites **must pass 100%** with zero errors or unhandled rejections.

---

## 2. Versioning Policy

Every release must increment both the semantic version string and the Android integer `versionCode` in lockstep across all configuration files:

1. `package.json`: `"version": "X.Y.Z"`
2. `app.json`: `"version": "X.Y.Z"`
3. `android/app/build.gradle`:
   - `versionCode <N>` (monotonically increasing integer)
   - `versionName "X.Y.Z"`

---

## 3. Keystore Consistency & Update-in-Place Requirement

> [!WARNING]
> **Android Keystore Rule:** The identical signing keystore file and key alias **must** be reused across all APK releases. If an APK is compiled with a different keystore, Android's package manager will fail with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, forcing players to uninstall the previous build and losing local offline cached data.

- **Development/Preview Keystore:** `android/app/debug.keystore` (used for internal preview APK distribution).
- **Production Keystore:** Stored securely outside version control; specified via `signingConfigs.release` or CI secrets.

---

## 4. Standalone APK Compilation

Compile the standalone Android release APK using Gradle:

```powershell
cd android
.\gradlew.bat clean assembleRelease
cd ..
```

Compiled artifact location:
`android/app/build/outputs/apk/release/app-release.apk`

---

## 5. Checksum Verification

Calculate and document the SHA-256 hash of the generated APK:

```powershell
Get-FileHash android\app\build\outputs\apk\release\app-release.apk -Algorithm SHA256
```

Always record the SHA-256 hash in the release notes and `CHANGELOG.md` to guarantee binary integrity.

---

## 6. GitHub Release Publishing

1. Create a clean tag: `git tag vX.Y.Z && git push origin vX.Y.Z`
2. Create GitHub Release via GitHub CLI:

```powershell
gh release create vX.Y.Z "android/app/build/outputs/apk/release/app-release.apk#GhostRun-vX.Y.Z.apk" `
  --title "GhostRun vX.Y.Z" `
  --notes-file docs/RELEASE_NOTES.md
```

3. Confirm that the release is marked as public, immutable, and the APK artifact is downloadable.
