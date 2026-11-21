# GhostRun Release Notes - Wave v2.9.15 (Code 30)

## Pillar 2: Tactical Loudspeaker Audio & Sensory Safety Engine

### Highlights
- **Escalating Proximity Heartbeat Engine**:
  - Live matches continuously evaluate real-world distance between an active operative and their nearest opponent.
  - Three distinct escalation tiers tuned specifically for mobile loudspeakers:
    - **Tier 1 (Slow)**: $25\text{m} \le d < 50\text{m}$ initiates a rhythmic $70\text{ bpm}$ heartbeat thump paired with subtle haptic vibration.
    - **Tier 2 (Fast)**: $10\text{m} \le d < 25\text{m}$ accelerates to a high-tension $130\text{ bpm}$ heartbeat thump paired with accelerated dual-pulse haptics.
    - **Tier 3 (Danger)**: $d < 10\text{m}$ (tag threat perimeter) fires an urgent acoustic alarm paired with emergency warning haptics.
  - Heartbeat cleanly terminates upon tagging, jailing, match end, or when enemies retreat beyond $50\text{m}$.
- **Tactical Match Start Release Horn (`siren_release.wav`)**:
  - Automatically triggers a stadium-grade airhorn and rising siren blast when transitioning from `head_start` to `live` (the moment hunters are unleashed into the grid).
- **Outbreak Horde Infection Horror Cue (`infection_screech.wav`)**:
  - Synthesized FM bio-infection down-pitch screech playing immediately when a human survivor is tagged or converts to the Zombie swarm.
- **Network Radar Acoustic Chirp (`ping.wav`)**:
  - Emits a crisp sonar chirp each time an opposing network ping arrives on the radar.
- **Outdoor Loudspeaker Optimization & Pedestrian Safety Mandate**:
  - All new sound assets synthesized at 16-bit 44.1kHz PCM with boosted mid-bass frequencies calibrated to penetrate outdoor traffic noise via the device speaker.
  - Proximity Heartbeat Audio toggle added under **Settings > Alerts > Audio & Voice Telemetry** alongside the explicit Pedestrian Loudspeaker Safety Mandate discouraging in-ear earbuds during outdoor sprinting.
- **Decoupled Architecture & Test Suite**:
  - Introduced `src/lib/audioCore.ts` for pure calculation and constants.
  - Comprehensive test suite in `scripts/test-tactical-audio.ts` (56/56 passing tests).
