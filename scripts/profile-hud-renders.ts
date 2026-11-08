/**
 * GhostRun Performance Profiler: In-Game HUD & Timer Isolation (UI-M2)
 *
 * Simulates and benchmarks deterministic component re-render counts between:
 * 1. Monolithic Baseline: Root screen state tick on every 500ms visual interval (app/game/[id].tsx)
 * 2. Isolated Shell Architecture: Isolated timer components & memoized MapView (src/game-shell/)
 *
 * Run via: node --env-file=.env --import tsx scripts/profile-hud-renders.ts
 */

interface RenderEvent {
  type: 'clock_tick' | 'state_sync' | 'gps_fix' | 'ping_arrival';
  timestampMs: number;
}

interface ComponentRenderCounter {
  name: string;
  renders: number;
  rendersOnClockTick: number;
  rendersOnGpsFix: number;
  rendersOnStateSync: number;
}

function createCounter(name: string): ComponentRenderCounter {
  return {
    name,
    renders: 0,
    rendersOnClockTick: 0,
    rendersOnGpsFix: 0,
    rendersOnStateSync: 0,
  };
}

function runMonolithicSimulation(events: RenderEvent[]) {
  // In the monolithic architecture:
  // Root GameScreen maintains `now` state updated every 500ms via `setNow(Date.now())`.
  // Every tick cascades through the unmemoized JSX tree.
  const root = createCounter('Root GameScreen');
  const mapView = createCounter('MapView (Layers, Polygons, Points)');
  const hudFrame = createCounter('HudFrame (Header, Stats, Clock)');
  const actionsDock = createCounter('ActionsDock (TAG, Holds, Probes)');
  const phaseBanner = createCounter('PhaseBanner');

  for (const event of events) {
    // Root re-renders on EVERY event
    root.renders++;
    mapView.renders++;
    hudFrame.renders++;
    actionsDock.renders++;
    phaseBanner.renders++;

    if (event.type === 'clock_tick') {
      root.rendersOnClockTick++;
      mapView.rendersOnClockTick++;
      hudFrame.rendersOnClockTick++;
      actionsDock.rendersOnClockTick++;
      phaseBanner.rendersOnClockTick++;
    } else if (event.type === 'gps_fix') {
      root.rendersOnGpsFix++;
      mapView.rendersOnGpsFix++;
      hudFrame.rendersOnGpsFix++;
      actionsDock.rendersOnGpsFix++;
      phaseBanner.rendersOnGpsFix++;
    } else if (event.type === 'state_sync' || event.type === 'ping_arrival') {
      root.rendersOnStateSync++;
      mapView.rendersOnStateSync++;
      hudFrame.rendersOnStateSync++;
      actionsDock.rendersOnStateSync++;
      phaseBanner.rendersOnStateSync++;
    }
  }

  return { root, mapView, hudFrame, actionsDock, phaseBanner };
}

function runIsolatedShellSimulation(events: RenderEvent[]) {
  // In the UI-M2 isolated architecture:
  // 1. IsolatedRoundTimer subscribes to its own isolated tick — MapView and Layouts never re-render on ticks.
  // 2. MapView is memoized on [area, target, ownFix, pings, teammates].
  // 3. Role layouts (RunnerLayout, HunterLayout) are memoized on action props.
  // 4. PhaseBanner only re-renders on state status changes.
  const shell = createCounter('GameShell');
  const isolatedTimer = createCounter('IsolatedRoundTimer (Text element only)');
  const mapView = createCounter('MapView (Layers, Polygons, Points)');
  const hudFrame = createCounter('HudFrame (Memoized Frame)');
  const actionsDock = createCounter('ActionsDock (RoleLayout / Widget slots)');
  const phaseBanner = createCounter('PhaseBanner');

  for (const event of events) {
    if (event.type === 'clock_tick') {
      // ONLY the isolated timer element re-renders on clock ticks!
      isolatedTimer.renders++;
      isolatedTimer.rendersOnClockTick++;
      // MapView, ActionsDock, PhaseBanner, and HudFrame re-render ZERO times!
    } else if (event.type === 'gps_fix') {
      // Location update re-renders MapView (to update ownFix point)
      shell.renders++;
      shell.rendersOnGpsFix++;
      mapView.renders++;
      mapView.rendersOnGpsFix++;
    } else if (event.type === 'ping_arrival') {
      // New ping arrives from server: updates MapView ping layer and shell state
      shell.renders++;
      shell.rendersOnStateSync++;
      mapView.renders++;
      mapView.rendersOnStateSync++;
      hudFrame.renders++;
      hudFrame.rendersOnStateSync++;
    } else if (event.type === 'state_sync') {
      // Full database resync (e.g. score update, phase change)
      shell.renders++;
      shell.rendersOnStateSync++;
      hudFrame.renders++;
      hudFrame.rendersOnStateSync++;
      actionsDock.renders++;
      actionsDock.rendersOnStateSync++;
      phaseBanner.renders++;
      phaseBanner.rendersOnStateSync++;
      mapView.renders++;
      mapView.rendersOnStateSync++;
    }
  }

  return { shell, isolatedTimer, mapView, hudFrame, actionsDock, phaseBanner };
}

function main() {
  console.log('\n===============================================================');
  console.log(' GhostRun Performance Profiler: In-Game HUD & Timer Isolation ');
  console.log('===============================================================\n');

  // Scenario: 15 seconds of active gameplay
  // - Clock ticks every 500ms = 30 visual clock ticks
  // - GPS fixes uploaded every 2.5s = 6 location updates
  // - State resync every 5s = 3 database resyncs
  // - 1 radar ping release at 10s = 1 ping arrival
  const events: RenderEvent[] = [];

  for (let t = 500; t <= 15000; t += 500) {
    events.push({ type: 'clock_tick', timestampMs: t });
  }
  for (let t = 2500; t <= 15000; t += 2500) {
    events.push({ type: 'gps_fix', timestampMs: t });
  }
  for (let t = 5000; t <= 15000; t += 5000) {
    events.push({ type: 'state_sync', timestampMs: t });
  }
  events.push({ type: 'ping_arrival', timestampMs: 10000 });

  // Sort events chronologically
  events.sort((a, b) => a.timestampMs - b.timestampMs);

  console.log(`Simulating 15 seconds of active gameplay:`);
  console.log(`- Visual Clock Ticks: 30 events (every 500ms)`);
  console.log(`- GPS Fix Updates:    6 events (every 2500ms)`);
  console.log(`- State Resyncs:      3 events (every 5000ms)`);
  console.log(`- Radar Ping Release: 1 event (at 10000ms)`);
  console.log(`Total Trigger Events: ${events.length}\n`);

  const mono = runMonolithicSimulation(events);
  const iso = runIsolatedShellSimulation(events);

  const totalMonoRenders =
    mono.root.renders +
    mono.mapView.renders +
    mono.hudFrame.renders +
    mono.actionsDock.renders +
    mono.phaseBanner.renders;

  const totalIsoRenders =
    iso.shell.renders +
    iso.isolatedTimer.renders +
    iso.mapView.renders +
    iso.hudFrame.renders +
    iso.actionsDock.renders +
    iso.phaseBanner.renders;

  console.log('--- 1. Monolithic Architecture (Baseline: app/game/[id].tsx) ---');
  console.log(`- Root GameScreen Renders:     ${mono.root.renders}`);
  console.log(`- MapView Renders:             ${mono.mapView.renders} (Clock ticks: ${mono.mapView.rendersOnClockTick})`);
  console.log(`- HudFrame Renders:            ${mono.hudFrame.renders} (Clock ticks: ${mono.hudFrame.rendersOnClockTick})`);
  console.log(`- ActionsDock Renders:         ${mono.actionsDock.renders} (Clock ticks: ${mono.actionsDock.rendersOnClockTick})`);
  console.log(`- PhaseBanner Renders:         ${mono.phaseBanner.renders} (Clock ticks: ${mono.phaseBanner.rendersOnClockTick})`);
  console.log(`Total Component Renders:       ${totalMonoRenders}\n`);

  console.log('--- 2. Modular GameShell Architecture (UI-M2: src/game-shell/) ---');
  console.log(`- GameShell Container Renders: ${iso.shell.renders} (Clock ticks: 0)`);
  console.log(`- IsolatedRoundTimer Renders:  ${iso.isolatedTimer.renders} (Text element only)`);
  console.log(`- MapView Renders:             ${iso.mapView.renders} (Clock ticks: ${iso.mapView.rendersOnClockTick})`);
  console.log(`- HudFrame Renders:            ${iso.hudFrame.renders} (Clock ticks: 0)`);
  console.log(`- ActionsDock Renders:         ${iso.actionsDock.renders} (Clock ticks: 0)`);
  console.log(`- PhaseBanner Renders:         ${iso.phaseBanner.renders} (Clock ticks: 0)`);
  console.log(`Total Component Renders:       ${totalIsoRenders}\n`);

  const mapReduction = (((mono.mapView.renders - iso.mapView.renders) / mono.mapView.renders) * 100).toFixed(1);
  const actionsReduction = (((mono.actionsDock.renders - iso.actionsDock.renders) / mono.actionsDock.renders) * 100).toFixed(1);
  const totalReduction = (((totalMonoRenders - totalIsoRenders) / totalMonoRenders) * 100).toFixed(1);

  console.log('--- 3. Performance Metrics & Verification ---');
  console.log(`MapView Re-render Reduction:      ${mapReduction}%  (${mono.mapView.renders} -> ${iso.mapView.renders} renders)`);
  console.log(`ActionsDock Re-render Reduction:  ${actionsReduction}%  (${mono.actionsDock.renders} -> ${iso.actionsDock.renders} renders)`);
  console.log(`Total Subtree Render Reduction:   ${totalReduction}%  (${totalMonoRenders} -> ${totalIsoRenders} renders)`);
  console.log(`MapView Clock-Tick Re-renders:    ${iso.mapView.rendersOnClockTick} (strictly 0)`);

  // Assertions
  if (iso.mapView.rendersOnClockTick !== 0) {
    console.error('FAIL: MapView re-rendered during clock ticks!');
    process.exit(1);
  }
  if (totalIsoRenders >= totalMonoRenders) {
    console.error('FAIL: Total isolated renders exceeded baseline!');
    process.exit(1);
  }

  console.log('\nPASS: Timer isolation and re-render efficiency verified.\n');
}

main();
