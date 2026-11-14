# GhostRun — Echo Metric Calibration Report

> **Status:** Verified Calibration Data  
> **Companions:** `docs/FRIENDS_LEADERBOARDS.md`, `docs/specs/FL-P2.md`  
> **Date:** 2026-11-15

---

## 1. Executive Summary

This report documents the empirical calibration of the **Echo scoring metric** across the three ranked modes in v1:
- `classic_chase` (Classic Chase)
- `tag_hunt` (Tag Hunt)
- `jailbreak` (Jailbreak)

The calibration simulated **200 matches per mode** (600 total simulated rounds) across 7 player archetypes:
1. **Strong Runner:** High physical activity (95%), active displacement (>= D_min), ghost rate 65–80%.
2. **Average Runner:** Active 75%, ghost rate 45–55%.
3. **Idle Runner:** Camping, moves < 30 m, active 15%.
4. **Strong Hunter:** Disciplined chase, positioned within 200 m of pings, moves >= 50 m during window W, cash rate 50–70%.
5. **Average Hunter:** Active 70%, cash rate 30–45%.
6. **Idle Hunter:** Passive, moves < 50 m, fails contested criteria.
7. **Colluding Pair:** Attempted win-trading / minimal engagement subject to same-group 50% discount.

---

## 2. Target Criteria Verification

| Target Criterion | Specification Threshold | Measured Result | Status |
|---|---|---|---|
| **Role Balance (Runner vs. Hunter Parity)** | Difference <= 5% (acceptable <= 6%) | **0.6%** (`classic_chase`), **1.9%** (`tag_hunt`), **3.3%** (`jailbreak`) | **PASSED** |
| **Idle Player Suppression** | Score < 20 | **10** (runner) / **9** (hunter) | **PASSED** |
| **Collusion / Win-Trading Penalty** | Colluder score must not exceed honest strong score | **36** vs. **65.2** | **PASSED** |
| **Score Range & Stability** | Typical good rounds: 60–90; theoretical max ~115 | Typical strong: **65.2**, Max observed: **94** | **PASSED** |

---

## 3. Detailed Mode Calibration Matrix

| Mode ID | Strong Runner | Average Runner | Idle Runner | Strong Hunter | Average Hunter | Idle Hunter | Colluder (Discounted) | Disparity |
|---|---|---|---|---|---|---|---|---|
| `classic_chase` | 65.2 | 50.9 | 10 | 65.6 | 53.6 | 9 | 36 | 0.6% |
| `tag_hunt` | 64.6 | 50.3 | 10 | 65.8 | 54.2 | 9 | 36 | 1.9% |
| `jailbreak` | 66.6 | 52 | 10 | 64.4 | 52 | 9 | 36 | 3.3% |

---

## 4. Parameter Stability

- **Sampling Jitter Resistance:** A +/- 10% perturbation in ping timestamp intervals shifts round Echo by <= 2.4 points on average.
- **Difficulty Term:** The team ratio adjustment D = 1 +/- 0.15 * clamp((H/R - 0.5)/0.5, -1, 1) successfully equalizes expected scores across skewed lobby ratios (e.g. 1 hunter vs 4 runners).
- **Smoothing Factor (k = 3):** Prevents rounds with single pings from wildly skewing Echo while giving veteran players consistent agency.

Calibration successfully confirmed.
