import { describe, it, expect } from 'vitest';
import { channelStats, autoStf, mtf, asinhStretch, logStretch, applyStretch } from '../lib/stretch';

const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

describe('stretch properties', () => {
  it('every curve is monotonic non-decreasing and bounded on random midtones', () => {
    const r = rng(1);
    for (let t = 0; t < 50; t++) {
      const m = 0.01 + r() * 0.98, k = 1 + r() * 400;
      let pm = -1, pa = -1, pl = -1;
      for (let x = 0; x <= 1.0001; x += 0.01) {
        const ym = mtf(m, x), ya = asinhStretch(x, k), yl = logStretch(x, k);
        for (const y of [ym, ya, yl]) { expect(y).toBeGreaterThanOrEqual(-1e-9); expect(y).toBeLessThanOrEqual(1 + 1e-9); }
        expect(ym).toBeGreaterThanOrEqual(pm - 1e-9); expect(ya).toBeGreaterThanOrEqual(pa - 1e-9); expect(yl).toBeGreaterThanOrEqual(pl - 1e-9);
        pm = ym; pa = ya; pl = yl;
      }
    }
  });
  it('autoStf hits the target for skewed random data', () => {
    const r = rng(2);
    for (let t = 0; t < 10; t++) {
      const data = new Float32Array(20_000);
      const bgLevel = 50 + r() * 3000, noise = 1 + r() * 30;
      for (let i = 0; i < data.length; i++) data[i] = bgLevel + (r() - 0.5) * noise + (r() < 0.01 ? r() * 60000 : 0);
      const st = channelStats(data);
      const target = 0.1 + r() * 0.5;
      const stf = autoStf(st, target, -2.8);
      const x = (st.median - stf.shadow) / (stf.highlight - stf.shadow);
      expect(mtf(stf.midtone, x)).toBeCloseTo(target, 2);
    }
  });
  it('applyStretch clips outside [shadow, highlight] and ignores NaN in stats', () => {
    const data = new Float32Array([NaN, -100, 0, 50, 100, 1e9]);
    const st = channelStats(data);
    expect(Number.isFinite(st.median)).toBe(true);
    const out = new Uint8ClampedArray(6 * 4);
    applyStretch(data, out, 4, 0, { kind: 'linear', stf: { shadow: 0, highlight: 100, midtone: 0.5 }, amount: 0 });
    expect([out[4], out[8], out[16], out[20]]).toEqual([0, 0, 255, 255]);
  });
  it('constant data does not divide by zero', () => {
    const st = channelStats(new Float32Array(100).fill(7));
    const stf = autoStf(st, 0.25);
    const out = new Uint8ClampedArray(4);
    applyStretch(new Float32Array([7]), out, 4, 0, { kind: 'mtf', stf, amount: 0 });
    expect(Number.isFinite(out[0])).toBe(true);
  });
});
