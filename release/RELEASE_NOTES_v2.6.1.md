# GhostRun v2.6.1 — Patch Release (Boot Routing & Consent Fixes) 🏃‍♂️💨👻

Welcome to **v2.6.1** of **GhostRun**!

This patch release resolves boot redirection issues and fixes the policy consent RPC parameter mapping to ensure a seamless first-run and upgrade experience.

---

## 🛠️ Fixes in v2.6.1

### 1. Boot Routing & Privacy Gate Redirection
* **Resolved Premature Step 4 Display:** Fixed an issue where booting the application with an existing authenticated session directed users to Step 4 of 4 (`/signup/before-you-play`) of the sign-up flow instead of the dedicated Privacy Policy Gate.
* **First-Run Privacy Gate (`/privacy?mode=gate`):** Corrected the redirection target for accounts requiring policy version acknowledgement to `/privacy?mode=gate`. Users can review what changed, confirm age eligibility, and accept without repeating permission primers or step indicators.
* **Welcome Hero Routing:** Users without an active session or uncompleted onboarding now cleanly route to the Hero Welcome screen (`/welcome`).

### 2. Schema Cache Error on `set_consent`
* **Resolved Schema Cache Lookup Failure:** Realigned parameter names in `app/(onboarding)/signup/before-you-play.tsx` from `p_granted` / `p_policy_version` to canonical Postgres parameters `granted` / `policy_version`. This resolves the PostgREST error:
  `consent recording failed: could not find function public.set_consent in the schema cache`
* **Profile Overwrite Guard:** Safeguarded `upsert_profile` during sign-up finalization to prevent overwriting existing operative codenames with fallback defaults.

---

## 📦 Release Artifact
* **Artifact:** `release/GhostRun-v2.6.1.apk`
* **File Size:** `173,841,508 bytes` (165.79 MB)
* **Version Name:** `2.6.1`
* **Version Code:** `7`
* **Package Name:** `com.ghostrun.app`
* **Signing Keystore:** `android/app/debug.keystore` (preserves seamless update-in-place compatibility)
* **SHA-256 Checksum:**
  ```text
  A2BECD174153A9C3FD93C8DA04C047C5E8AD15A442B5B7CD4178B18820A213BD
  ```
