import { describe, it, expect } from 'vitest';
import { DEFAULT_ADJUSTMENTS, adjustmentsToOptions, isGroupDirty, ADJUSTMENT_GROUPS } from '../hooks/useAdjustments';

describe('adjustments', () => {
  it('bypassed groups map to neutral values', () => {
    const a = { ...DEFAULT_ADJUSTMENTS, brightness: 150, shadowRecovery: 40, sharpening: 30, toneEnabled: false, enhancementEnabled: false, detailEnabled: false };
    const o = adjustmentsToOptions(a, { filter: 'none' });
    expect([o.brightness, o.shadowRecovery, o.sharpening, o.preNormalize]).toEqual([100, 0, 0, 0]);
  });
  it('enabled groups pass through', () => {
    const o = adjustmentsToOptions({ ...DEFAULT_ADJUSTMENTS, brightness: 150 }, { filter: 'yre' });
    expect(o.brightness).toBe(150);
    expect(o.filter).toBe('yre');
  });
  it('dirty is per group and respects custom defaults', () => {
    const a = { ...DEFAULT_ADJUSTMENTS, contrast: 120 };
    expect(isGroupDirty(a, 'tone')).toBe(true);
    expect(isGroupDirty(a, 'enhancement')).toBe(false);
    const astroDefaults = { ...DEFAULT_ADJUSTMENTS, preNormalize: 0, postNormalize: 0 };
    expect(isGroupDirty(astroDefaults, 'tone', astroDefaults)).toBe(false);
    expect(isGroupDirty(astroDefaults, 'tone')).toBe(true);
  });
  it('groups cover every slider key exactly once', () => {
    const keys = Object.values(ADJUSTMENT_GROUPS).flat();
    expect(new Set(keys).size).toBe(keys.length);
    const enabledKeys = ['toneEnabled', 'enhancementEnabled', 'detailEnabled'];
    expect(keys.length + enabledKeys.length).toBe(Object.keys(DEFAULT_ADJUSTMENTS).length);
  });
});
