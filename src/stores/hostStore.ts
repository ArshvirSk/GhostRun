import { create } from 'zustand';
import { getModeModule } from '../modes/registry';

export type PresetType = 'casual' | 'standard' | 'hardcore' | 'custom';
export type BoundaryPenalty = 'warn' | 'extra_ping';

export interface HostRulesState {
  headStartS: number;
  durationS: number;
  pingIntervalS: number;
  tagRadiusM: number;
  boundaryGraceS: number;
  boundaryPenalty: BoundaryPenalty;
  curfewMinutes: number | null;
}

export interface HostState {
  // Step 1: Mode
  mode: string;
  setMode: (modeId: string) => void;

  // Step 2: Rules & Presets
  preset: PresetType;
  rules: HostRulesState;
  modeParams: Record<string, any>;
  applyPreset: (preset: PresetType) => void;
  setRule: <K extends keyof HostRulesState>(key: K, value: HostRulesState[K]) => void;
  setModeParam: (namespace: string, key: string, value: any) => void;

  // Step 3: Extras (Modifiers & Roles)
  selectedModifiers: string[];
  selectedRoles: string[];
  toggleModifier: (modId: string) => void;
  toggleRole: (roleId: string) => void;

  // Step 4: Area & Placements
  center: [number, number]; // [lng, lat]
  centerMode: 'my_location' | 'custom';
  radius: number;
  placements: Record<string, [number, number]>; // kind -> [lng, lat]
  setCenter: (center: [number, number], mode?: 'my_location' | 'custom') => void;
  setRadius: (radius: number) => void;
  setPlacement: (kind: string, coords: [number, number]) => void;
  clearPlacement: (kind: string) => void;

  // Build Payload
  buildCreateGamePayload: () => {
    mode: string;
    lat: number;
    lng: number;
    radius_m: number;
    settings: {
      head_start_s: number;
      duration_s: number;
      ping_interval_s: number;
      tag_radius_m: number;
      boundary_grace_s: number;
      boundary_penalty: BoundaryPenalty;
      roles?: string[];
      modifiers?: string[];
      mode_params: Record<string, any>;
    };
  };

  // Reset
  reset: () => void;
}

export const PRESET_VALUES: Record<'casual' | 'standard' | 'hardcore', HostRulesState> = {
  casual: {
    headStartS: 240,
    durationS: 3600,
    pingIntervalS: 90,
    tagRadiusM: 25,
    boundaryGraceS: 45,
    boundaryPenalty: 'warn',
    curfewMinutes: null,
  },
  standard: {
    headStartS: 180,
    durationS: 2700,
    pingIntervalS: 150,
    tagRadiusM: 20,
    boundaryGraceS: 30,
    boundaryPenalty: 'warn',
    curfewMinutes: null,
  },
  hardcore: {
    headStartS: 90,
    durationS: 1800,
    pingIntervalS: 240,
    tagRadiusM: 15,
    boundaryGraceS: 15,
    boundaryPenalty: 'extra_ping',
    curfewMinutes: null,
  },
};

const DEFAULT_CENTER: [number, number] = [-97, 38];

export const useHostStore = create<HostState>((set, get) => ({
  mode: 'classic_chase',
  preset: 'standard',
  rules: { ...PRESET_VALUES.standard },
  modeParams: {},
  selectedModifiers: [],
  selectedRoles: [],
  center: DEFAULT_CENTER,
  centerMode: 'my_location',
  radius: 600,
  placements: {},

  setMode: (modeId: string) => {
    const mod = getModeModule(modeId);
    if (!mod) return;

    // Prune modifiers and roles incompatible with new mode
    const currentModifiers = get().selectedModifiers;
    const currentRoles = get().selectedRoles;
    const validModifiers = currentModifiers.filter((mId) => {
      const mMod = getModeModule(mId);
      return mMod ? mMod.compatibleWith.includes(modeId) : false;
    });
    const validRoles = currentRoles.filter((rId) => {
      const rMod = getModeModule(rId);
      return rMod ? rMod.compatibleWith.includes(modeId) : false;
    });

    // Default mode params for special modes
    const nextModeParams: Record<string, any> = {};
    if (modeId === 'ghost_duel') {
      nextModeParams.ghost_duel = { variant: 'time_trial' };
    } else if (modeId === 'territory_pulse') {
      nextModeParams.territory_pulse = { pulse_interval_s: 90, dominance_pct: 70 };
    } else if (modeId === 'jailbreak') {
      nextModeParams.jailbreak = {
        jail_radius_m: 10,
        auto_release_s: 300,
        release_hold_s: 10,
        release_radius_m: 10,
      };
    }

    set({
      mode: modeId,
      selectedModifiers: validModifiers,
      selectedRoles: validRoles,
      modeParams: nextModeParams,
      placements: {}, // reset placements when mode switches
      rules: {
        ...get().rules,
        headStartS: modeId === 'ghost_duel' ? 0 : get().rules.headStartS || 180,
      },
    });
  },

  applyPreset: (presetKey: PresetType) => {
    if (presetKey === 'custom') {
      set({ preset: 'custom' });
      return;
    }
    const template = PRESET_VALUES[presetKey];
    set({
      preset: presetKey,
      rules: {
        ...template,
        headStartS: get().mode === 'ghost_duel' ? 0 : template.headStartS,
      },
    });
  },

  setRule: (key, value) => {
    set((state) => ({
      preset: 'custom',
      rules: {
        ...state.rules,
        [key]: value,
      },
    }));
  },

  setModeParam: (namespace: string, key: string, value: any) => {
    set((state) => ({
      modeParams: {
        ...state.modeParams,
        [namespace]: {
          ...(state.modeParams[namespace] || {}),
          [key]: value,
        },
      },
    }));
  },

  toggleModifier: (modId: string) => {
    set((state) => {
      const exists = state.selectedModifiers.includes(modId);
      return {
        selectedModifiers: exists
          ? state.selectedModifiers.filter((id) => id !== modId)
          : [...state.selectedModifiers, modId],
      };
    });
  },

  toggleRole: (roleId: string) => {
    set((state) => {
      const exists = state.selectedRoles.includes(roleId);
      return {
        selectedRoles: exists
          ? state.selectedRoles.filter((id) => id !== roleId)
          : [...state.selectedRoles, roleId],
      };
    });
  },

  setCenter: (center: [number, number], mode = 'custom') => {
    set({ center, centerMode: mode });
  },

  setRadius: (radius: number) => {
    set({ radius });
  },

  setPlacement: (kind: string, coords: [number, number]) => {
    set((state) => ({
      placements: {
        ...state.placements,
        [kind]: coords,
      },
    }));
  },

  clearPlacement: (kind: string) => {
    set((state) => {
      const next = { ...state.placements };
      delete next[kind];
      return { placements: next };
    });
  },

  buildCreateGamePayload: () => {
    const state = get();
    const isGhostDuel = state.mode === 'ghost_duel';

    const modeParamsCombined: Record<string, any> = {
      ...state.modeParams,
    };

    if (state.rules.curfewMinutes) {
      modeParamsCombined.safety = {
        curfew_at: new Date(Date.now() + state.rules.curfewMinutes * 60 * 1000).toISOString(),
      };
    }

    if (state.mode === 'territory_pulse' && !modeParamsCombined.territory_pulse) {
      modeParamsCombined.territory_pulse = { pulse_interval_s: 90, dominance_pct: 70 };
    }

    if (state.mode === 'ghost_duel' && !modeParamsCombined.ghost_duel) {
      modeParamsCombined.ghost_duel = { variant: 'time_trial' };
    }

    if (state.mode === 'jailbreak' && !modeParamsCombined.jailbreak) {
      modeParamsCombined.jailbreak = {
        jail_radius_m: 10,
        auto_release_s: 300,
        release_hold_s: 10,
        release_radius_m: 10,
      };
    }

    return {
      mode: state.mode,
      lat: state.center[1],
      lng: state.center[0],
      radius_m: state.radius,
      settings: {
        head_start_s: isGhostDuel ? 0 : state.rules.headStartS,
        duration_s: state.rules.durationS,
        ping_interval_s: state.rules.pingIntervalS,
        tag_radius_m: state.rules.tagRadiusM,
        boundary_grace_s: state.rules.boundaryGraceS,
        boundary_penalty: state.rules.boundaryPenalty,
        ...(state.selectedRoles.length > 0 ? { roles: state.selectedRoles } : {}),
        ...(state.selectedModifiers.length > 0 ? { modifiers: state.selectedModifiers } : {}),
        mode_params: modeParamsCombined,
      },
    };
  },

  reset: () => {
    set({
      mode: 'classic_chase',
      preset: 'standard',
      rules: { ...PRESET_VALUES.standard },
      modeParams: {},
      selectedModifiers: [],
      selectedRoles: [],
      center: DEFAULT_CENTER,
      centerMode: 'my_location',
      radius: 600,
      placements: {},
    });
  },
}));
