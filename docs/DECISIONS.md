# GhostRun — Decisions

## 2026-10-28 — Use OpenFreeMap Liberty for the initial map style

**Decision:** Use `https://tiles.openfreemap.org/styles/liberty` as the default MapLibre style, overridable through `EXPO_PUBLIC_MAP_STYLE_URL`.

**Reason:** It is compatible with MapLibre Native and does not require an API key, which keeps M0 setup simple and avoids adding a third-party credential. MapLibre's attribution control remains visible.

**Trade-off:** OpenFreeMap is a community-operated public service offered without an availability guarantee. Revisit the provider if field testing shows reliability issues or the app needs an SLA-backed map service.
