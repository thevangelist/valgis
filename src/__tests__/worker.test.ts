import { describe, it, expect } from 'vitest';
import { processImage, resetLiveState } from '../worker/imageProcessor';
import type { ProcessOptions } from '../worker/imageProcessor';

const BASE: ProcessOptions = {
  filter: 'none', brightness: 100, contrast: 100, saturation: 100,
  shadowRecovery: 0, highlightRecovery: 0, clarity: 0, dehaze: 0,
  noiseReduction: 0, noiseAlgorithm: 'median', sharpening: 0, sharpenAlgorithm: 'unsharp',
  preNormalize: 0, postNormalize: 0,
};

function run(options: Partial<ProcessOptions>, w = 8, h = 8, live = false, fill = (i: number) => [100 + (i % 7) * 10, 90, 80]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const [r, g, b] = fill(i); data[i*4] = r; data[i*4+1] = g; data[i*4+2] = b; data[i*4+3] = 255; }
  const progress: string[] = [];
  const result = processImage(data, w, h, { ...BASE, ...options }, live, s => progress.push(s));
  return { result, data, progress };
}

describe('worker pipeline', () => {
  it('reports nothing skipped for a small image', () => {
    expect(run({ noiseReduction: 20, sharpening: 20 }).result.skipped).toEqual([]);
  });
  it('filter none with neutral options is identity', () => {
    const { data } = run({});
    expect(data[0]).toBe(100); expect(data[1]).toBe(90); expect(data[2]).toBe(80); expect(data[3]).toBe(255);
  });
  it('brightness 50 halves', () => {
    const { data } = run({ brightness: 50 });
    expect(data[0]).toBe(50);
  });
  it('reports progress stages for static jobs and none for live', () => {
    expect(run({ sharpening: 10 }).progress).toEqual(['Tone', 'Sharpening']);
    expect(run({ sharpening: 10 }, 8, 8, true).progress).toEqual([]);
  });
  it('every PCA filter produces finite output in range', () => {
    for (const f of ['yre', 'lab', 'yuv', 'crgb', 'adaptive', 'autolevel', 'histeq', 'satboost'] as const) {
      const { data } = run({ filter: f, preNormalize: 100, postNormalize: 100 }, 16, 16, false, i => [50 + (i * 37) % 150, 40 + (i * 11) % 100, 60 + (i * 5) % 80]);
      for (let i = 0; i < data.length; i += 4) expect(data[i + 3]).toBe(255);
    }
  });
  it('contrast 100 is neutral, 0 flattens, 200 steepens', () => {
    expect(run({ contrast: 100 }).data[0]).toBe(100);
    const flat = run({ contrast: 0 }).data, steep = run({ contrast: 200 }).data;
    expect(Math.abs(flat[0] - 128)).toBeLessThan(Math.abs(100 - 128));
    expect(Math.abs(steep[0] - 128)).toBeGreaterThan(Math.abs(100 - 128));
  });
  it('live mode is deterministic for a repeated frame after reset', () => {
    resetLiveState();
    const a = run({ filter: 'yre' }, 16, 16, true, i => [50 + (i * 37) % 150, 40 + (i * 11) % 100, 60]).data;
    resetLiveState();
    const b = run({ filter: 'yre' }, 16, 16, true, i => [50 + (i * 37) % 150, 40 + (i * 11) % 100, 60]).data;
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
