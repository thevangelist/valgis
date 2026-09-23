import { useReducer } from 'react';
import type { ProcessOptions } from '../worker/imageProcessor';

// The tonal, enhancement and detail sliders shared by every Studio mode.
export interface Adjustments {
  brightness: number; contrast: number; saturation: number;
  preNormalize: number; postNormalize: number;
  shadowRecovery: number; highlightRecovery: number; clarity: number; dehaze: number;
  noiseReduction: number; noiseAlgorithm: ProcessOptions['noiseAlgorithm'];
  sharpening: number; sharpenAlgorithm: ProcessOptions['sharpenAlgorithm'];
  toneEnabled: boolean; enhancementEnabled: boolean; detailEnabled: boolean;
}

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  brightness: 100, contrast: 100, saturation: 100, preNormalize: 100, postNormalize: 100,
  shadowRecovery: 0, highlightRecovery: 0, clarity: 0, dehaze: 0,
  noiseReduction: 0, noiseAlgorithm: 'median', sharpening: 0, sharpenAlgorithm: 'unsharp',
  toneEnabled: true, enhancementEnabled: true, detailEnabled: true,
};

export const ADJUSTMENT_GROUPS = {
  tone:        ['brightness', 'contrast', 'saturation', 'preNormalize', 'postNormalize'],
  enhancement: ['shadowRecovery', 'highlightRecovery', 'clarity', 'dehaze'],
  detail:      ['noiseReduction', 'noiseAlgorithm', 'sharpening', 'sharpenAlgorithm'],
} as const satisfies Record<string, readonly (keyof Adjustments)[]>;
export type AdjustmentGroup = keyof typeof ADJUSTMENT_GROUPS;

export function isGroupDirty(a: Adjustments, g: AdjustmentGroup, defaults: Adjustments = DEFAULT_ADJUSTMENTS): boolean {
  return ADJUSTMENT_GROUPS[g].some(k => a[k] !== defaults[k]);
}

type Action =
  | { type: 'set'; patch: Partial<Adjustments> }
  | { type: 'reset'; keep?: (keyof Adjustments)[] };

function reducer(state: Adjustments, a: Action): Adjustments {
  switch (a.type) {
    case 'set': return { ...state, ...a.patch };
    case 'reset': {
      const next = { ...DEFAULT_ADJUSTMENTS };
      for (const k of a.keep ?? []) (next as Record<string, unknown>)[k] = state[k];
      return next;
    }
  }
}

export function useAdjustments(initial: Partial<Adjustments> = {}) {
  const [adj, dispatch] = useReducer(reducer, { ...DEFAULT_ADJUSTMENTS, ...initial });
  const set = <K extends keyof Adjustments>(key: K, value: Adjustments[K]) => dispatch({ type: 'set', patch: { [key]: value } as Partial<Adjustments> });
  const patch = (p: Partial<Adjustments>) => dispatch({ type: 'set', patch: p });
  const reset = (keep?: (keyof Adjustments)[]) => dispatch({ type: 'reset', keep });
  const resetGroup = (g: AdjustmentGroup) => {
    const defaults = { ...DEFAULT_ADJUSTMENTS, ...initial };
    const p: Partial<Adjustments> = {};
    for (const k of ADJUSTMENT_GROUPS[g]) (p as Record<string, unknown>)[k] = defaults[k];
    dispatch({ type: 'set', patch: p });
  };
  return { adj, set, patch, reset, resetGroup, defaults: { ...DEFAULT_ADJUSTMENTS, ...initial } as Adjustments };
}

// Bypassed groups fall back to their neutral values so the worker sees one flat option set.
export function adjustmentsToOptions(a: Adjustments, rest: Pick<ProcessOptions, 'filter' | 'hslAdjustments' | 'colorWheels'>): ProcessOptions {
  const t = a.toneEnabled, e = a.enhancementEnabled, d = a.detailEnabled;
  return {
    ...rest,
    brightness: t ? a.brightness : 100, contrast: t ? a.contrast : 100, saturation: t ? a.saturation : 100,
    preNormalize: t ? a.preNormalize : 0, postNormalize: t ? a.postNormalize : 0,
    shadowRecovery: e ? a.shadowRecovery : 0, highlightRecovery: e ? a.highlightRecovery : 0,
    clarity: e ? a.clarity : 0, dehaze: e ? a.dehaze : 0,
    noiseReduction: d ? a.noiseReduction : 0, noiseAlgorithm: a.noiseAlgorithm,
    sharpening: d ? a.sharpening : 0, sharpenAlgorithm: a.sharpenAlgorithm,
  };
}
