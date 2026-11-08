import React from 'react';

export type Role = 'runner' | 'hunter' | 'operator' | 'spectator' | 'solo';
export type Phase = 'countdown' | 'head_start' | 'live' | 'ended' | 'paused';
export type Slot = 'top' | 'banner' | 'overlay' | 'actions' | 'sheet' | 'mapLayer';

export interface HudWidgetProps {
  gameId: string;
  phase: Phase;
  myRole: Role;
  [key: string]: unknown;
}

export interface HudWidget {
  id: string;
  slot: Slot;
  roles: Role[];
  phases: Phase[];
  priority: number; // shell enforces max 3 in 'actions'
  Component: React.ComponentType<HudWidgetProps>;
}

export type ParamType = 'number' | 'boolean' | 'enum' | 'slider';

export interface ParamDef {
  key: string;
  label: string;
  type: ParamType;
  defaultValue: unknown;
  description?: string;
  options?: { value: string | number; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  advanced?: boolean;
}

export interface PlacementDef {
  kind: string;
  label: string;
  required: boolean;
  minDistanceToCenterM?: number;
  placedBy: 'host' | 'server' | 'player';
  visibleTo: 'all' | 'team' | 'none';
}

export interface TourBeatDef {
  id: string;
  durationMs: number;
  title: string;
  subtitle: string;
  description: string;
}

export interface ResultSectionProps {
  gameId: string;
  stats?: Record<string, unknown>;
  recap?: Record<string, unknown>;
}

export interface ReplayLayerDef {
  id: string;
  name: string;
  color: string;
  defaultVisible: boolean;
}

export interface RecapStatDef {
  key: string;
  label: string;
  format?: 'distance' | 'time' | 'number' | 'percent';
}

export interface ModeRuleSection {
  title: string;
  body: string;
}

export interface ModeRules {
  summary: string;
  sections: ModeRuleSection[];
}

export interface ModeBriefing {
  codename: string;
  intel: string[];
}

export interface ModeModule {
  id: string; // equals server mode_id / modifier id / role id
  layer: 'base' | 'modifier' | 'role';
  name: string;
  tagline: string;
  minPlayers: number;
  idealPlayers: string;
  difficulty: 1 | 2 | 3;
  complexity: 'low' | 'high';
  safetyNotes: string[];
  featureFlag: string;
  params: ParamDef[];
  presets?: Record<'casual' | 'standard' | 'hardcore', Record<string, unknown>>;
  placements?: PlacementDef[];
  compatibleWith: string[];
  incompatibleWith?: { id: string; reason: string }[];
  rules: ModeRules;
  briefing: ModeBriefing;
  tourBeat?: TourBeatDef;
  hudWidgets?: HudWidget[];
  ResultSection?: React.ComponentType<ResultSectionProps>;
  replayLayers?: ReplayLayerDef[];
  recapStats?: RecapStatDef[];
}
