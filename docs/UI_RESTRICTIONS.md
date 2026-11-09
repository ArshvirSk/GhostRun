# GhostRun UI Restrictions — Afterimage

**Status:** Approved visual direction for UI redesign. This document constrains implementation and visual QA; it does not authorize gameplay, server, database, or RPC changes.

## 1. Identity

GhostRun uses the **Afterimage** direction: warm paper-like light surfaces, ink-dark night surfaces, spectral violet as the brand color, and restrained acid lime for primary actions and live/selected states. The result should feel uncanny, confident, and made for outdoor play—not like a generic neon tactical dashboard.

Use spectral effects as brief state cues, not as a coating on every screen. Ghost motifs should be abstract and procedural. Do not use cute or painterly characters, horror-gore imagery, copied brand assets, or compositions recognizable as another app.

## 2. Light and dark themes

Support **System / Light / Dark** appearance. System follows the operating-system preference. Explicit Light or Dark selections persist. Apply the active theme consistently to app chrome, cards, sheets, controls, onboarding, results, and maps. Dark mode is not the only designed or supported theme.

Implement colors as semantic tokens in `src/theme/tokens.ts`; components must not hard-code palette values. Initial values:

| Token             | Light     | Dark      |
| ----------------- | --------- | --------- |
| `background`      | `#F3F0E8` | `#101014` |
| `surface`         | `#FFFFFF` | `#1B1A22` |
| `surfaceElevated` | `#E9E5DC` | `#24232D` |
| `textPrimary`     | `#202124` | `#F1EEE8` |
| `textSecondary`   | `#5D5A62` | `#B7B2BF` |
| `border`          | `#D8D3C9` | `#393743` |
| `brandViolet`     | `#6650A4` | `#B8A3FF` |
| `actionLime`      | `#557A22` | `#C7F36B` |
| `hunterCoral`     | `#B94B3A` | `#FF8A75` |
| `pingViolet`      | `#6650A4` | `#B8A3FF` |

These are starting values, not a substitute for contrast testing. Adjust per-theme lightness where necessary while preserving semantic meaning. Use dark ink on bright lime buttons. Avoid pale lime as small text on light backgrounds.

## 3. Semantic color rules

- Violet identifies GhostRun's brand and spectral ping/echo information.

- Lime identifies runner/live/selected/primary-action states, with text or shape reinforcement.

- Coral identifies hunters and urgent warnings, with explicit labels/icons.

- Neutral surfaces carry most of the UI. Do not make every card, heading, icon, and divider an accent color.

- Never communicate team, selection, error, danger, or completion by color alone. Pair color with words, icons, shapes, patterns, or position.

- Keep role meanings stable across both themes. Never switch team colors to match a decorative surface.

- Keep heat/proximity overlays translucent and short-lived; they must not obscure roads, boundaries, or critical text.

## 4. Maps and outdoor legibility

The map is part of the theme, not an unrelated bright tile behind dark chrome. Provide light and dark map presentation, with app appearance as the default behavior where supported. Keep any explicit map-style preference available and understandable. Preserve attribution. Maintain visible contrast among roads, playable boundary, target, self, teammate, ping, and warning states in either appearance.

Critical game information must remain legible at a glance in daylight, in low light, and while moving. Use high-contrast labels and controls; do not rely on glow, subtle shadows, or thin color-only lines to communicate important information. Do not add flashing or strobing effects.

## 5. Layout and responsive behavior

- Respect device safe areas, status/navigation bars, and the floating bottom tab bar. Scrollable content must never be obscured by fixed controls.

- No clipped, ellipsized, or line-broken critical words in buttons, chips, labels, mode names, join codes, or team/status indicators.

- Avoid horizontal scrolling for primary choices, filters, or review data. Wrap choices intentionally or use a clear segmented control with reachable options.

- Review summaries should reflow into a vertical or compact grid on narrow screens; never compress labels into each other.

- Use flexible width and dynamic type. Test narrow phones, large text, long names, and translations/long strings.

- Keep touch targets at least 48 dp. Maintain clear pressed, selected, disabled, focus, and error states in both themes.

- Use one clear primary action per screen; secondary actions must have visibly lower emphasis.

- Keep active gameplay glanceable: prioritize map, phase, remaining time, next ping, and role-specific controls. Preserve a stable SOS location.

## 6. Typography and surfaces

Use the existing named typography variants (`display`, `title`, `body`, `label`, `mono`, `numeric`). Body copy should not default to all caps or wide tracking. Reserve mono and small caps for short metadata, timers, and tactical readouts. Respect dynamic text sizing.

Use restrained border, elevation, and radius treatments. Suggested existing scale: 12, 20, and 28 dp radii; spacing 4, 8, 12, 16, 24, 32, and 48 dp. Do not use a heavy border around every card or stack multiple competing surface treatments.

## 7. Motion, sound, and haptics

Motion must explain an event or confirm an action. Use brief ping/echo cues, a readable role reveal, and a clear tag confirmation. Reduced Motion must replace motion with stable or simple fade states. No flashing, strobing, endlessly animated backgrounds, or motion that obscures map detail. Respect audio and haptics preferences. Do not add dependencies without approval.

## 8. Screen structure

Follow the approved information architecture in `docs/UI_RESTRUCTURE.md`: **Play · Modes · You**. Keep Home focused on host/join/resume. Use Modes to explain objectives and team knowledge before hosting. Use You for profile, history, privacy, and settings. The host flow remains five steps and keeps advanced controls secondary. The lobby makes code, roster, team, and readiness clear. The game shell remains role-aware and server-authoritative.

Do not change gameplay, location-sharing rules, secrecy, permissions, server data, RPC payloads, or mode availability as part of visual implementation. Existing feature flags and deny lists remain authoritative.

## 9. Acceptance checklist

Before a screen is accepted, verify:

- Light, dark, and system appearances render correctly; user appearance choice persists.

- All visible colors come from semantic tokens; no screen-level hard-coded palette literals.

- Text and controls meet contrast requirements in both themes, with normal, selected, disabled, pressed, and warning states checked.

- Both light and dark map styles are readable and preserve attribution.

- No content is clipped, overlapped, hidden behind system bars/navigation, or dependent on horizontal scrolling for primary actions.

- Long labels, narrow screens, and larger text sizes remain usable.

- Team and event states remain distinguishable without color alone.

- Touch targets meet the 48 dp minimum and reduced motion is honored.

- Role-specific gameplay information remains limited to what the server returns.

Record device-only validation as deferred when physical testing cannot be performed; do not claim it was verified without evidence.
