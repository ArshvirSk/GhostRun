# GhostRun Release Notes - Wave v2.9.14 (Code 29)

## Outbreak Horde Live Gameplay & Dynamic Zone Radar Wave

### Highlights
- **Procedural Dynamic Zone Engine on Tactical Radar Canvas**:
  - Outbreak Horde now projects drifting Antidote stations (emerald `#10B981`, `medkit` icon) and Drop Pods (cyan `#00F0FF`, `cube` icon) in real time onto the `TacticalRadarCanvas`.
  - Inner radar zone badges render directional dotted trajectories, active remaining charges (`ANTIDOTE (3)`), and high-contrast metric distance tags.
- **MapLibre Procedural GeoJSON Layers**:
  - Registered `OutbreakZonesMapLayer` in `outbreakHordeWidgets` under `slot: 'mapLayer'`. Operatives on standard visual maps see live procedural zone boundary circles and pulsing core markers.
- **Biological Lifespan Decay & Terminal Infection Conversion**:
  - Live matches enforce `-1 HP/s` biological lifespan decay for human survivors.
  - Terminal infection conversion: reaching 0 HP triggers instant conversion into the Zombie swarm (`team = 'hunter'`).
  - Database RPC `apply_tag` converts human survivors tagged by zombies into the hunter swarm; upon 0 active runners, hunters win with reason `all_infected`.
- **Antidote Station Decontamination**:
  - Proximity detection triggers upon entering an active Antidote station perimeter: restores `+65 HP` bio-health (up to `360s` maximum), decrements station charges, and delivers confirmation haptics (`triggerHaptic('tagConfirmed')`).
- **Ability Drawer Bio-Currency Purchases**:
  - `AbilityDrawerWidget` wired directly to `actions.deductBioHealth`: purchasing Cloak (`-35s`), Haste (`-25s`), or Decoy (`-20s`) accurately debits the operative's live bio-lifespan.
- **Multi-Device Target Deployment**:
  - Deployed to both connected physical devices (`RZCWA2BC80T` and `RZGL30WT2EJ`).
