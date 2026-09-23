import { describe, it, expect } from 'vitest';
import { _test } from '../worker/imageProcessor';

const { rgbToYCbCr, yCbCrToRgb, rgbToLab, labToRgb, rgbToYuv, yuvToRgb, rgbToHsl, hslToRgb, bandWeight, decorrelationStretch } = _test;

const approx = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;
const roundtrip = (r: number, g: number, b: number, forward: Function, backward: Function) => {
  const [x, y, z] = forward(r, g, b) as [number, number, number];
  const [r2, g2, b2] = backward(x, y, z) as [number, number, number];
  return approx(r, r2) && approx(g, g2) && approx(b, b2);
};

describe('Color space roundtrips', () => {
  const samples = [[0, 0, 0], [255, 255, 255], [128, 0, 0], [0, 128, 64], [200, 150, 80]];

  it('YCbCr roundtrip', () => {
    for (const [r, g, b] of samples)
      expect(roundtrip(r, g, b, rgbToYCbCr, yCbCrToRgb)).toBe(true);
  });

  it('Lab roundtrip', () => {
    for (const [r, g, b] of samples)
      expect(roundtrip(r, g, b, rgbToLab, labToRgb)).toBe(true);
  });

  it('YUV roundtrip', () => {
    for (const [r, g, b] of samples)
      expect(roundtrip(r, g, b, rgbToYuv, yuvToRgb)).toBe(true);
  });

  it('HSL roundtrip', () => {
    for (const [r, g, b] of samples)
      expect(roundtrip(r, g, b, rgbToHsl, hslToRgb)).toBe(true);
  });
});

describe('bandWeight', () => {
  it('returns 1 at center', () => {
    expect(bandWeight(90, 90, 30)).toBe(1);
  });

  it('returns 0 outside range', () => {
    expect(bandWeight(200, 90, 30)).toBe(0);
  });

  it('wraps around 360', () => {
    expect(bandWeight(5, 355, 20)).toBeGreaterThan(0);
  });
});

describe('decorrelationStretch', () => {
  const makeImage = (w: number, h: number, fill: (i: number) => [number, number, number]) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const [r, g, b] = fill(i);
      data[i*4] = r; data[i*4+1] = g; data[i*4+2] = b; data[i*4+3] = 255;
    }
    return data;
  };
  const run = (data: Uint8ClampedArray, w: number, h: number) =>
    decorrelationStretch(data, w, h, rgbToYCbCr, yCbCrToRgb, 2.5, 100_000, null, true);

  it('keeps buffer length and alpha', () => {
    const data = makeImage(4, 4, i => [i * 15, 255 - i * 10, (i * 37) % 256]);
    run(data, 4, 4);
    expect(data.length).toBe(64);
    for (let i = 0; i < 16; i++) expect(data[i*4+3]).toBe(255);
  });

  it('increases spread of a low-contrast input', () => {
    const fill = (i: number): [number, number, number] => [100 + i, 110 + (i % 5), 120 + (i % 3)];
    const data = makeImage(8, 8, fill);
    const spread = (d: Uint8ClampedArray) => {
      let min = 255, max = 0;
      for (let i = 0; i < 64; i++) for (let c = 0; c < 3; c++) {
        min = Math.min(min, d[i*4+c]); max = Math.max(max, d[i*4+c]);
      }
      return max - min;
    };
    const before = spread(data);
    run(data, 8, 8);
    expect(spread(data)).toBeGreaterThan(before);
  });

  it('uniform input stays finite and uniform', () => {
    const data = makeImage(5, 5, () => [128, 128, 128]);
    run(data, 5, 5);
    const first = data[0];
    for (let i = 0; i < 25; i++) for (let c = 0; c < 3; c++) expect(data[i*4+c]).toBe(first);
  });
});

describe('pipeline stages on a synthetic image', () => {
  const W = 16, H = 16, N = W * H;
  const image = () => {
    const d = new Uint8ClampedArray(N * 4);
    for (let i = 0; i < N; i++) {
      d[i*4] = 90 + (i % W) * 3; d[i*4+1] = 80 + Math.floor(i / W) * 2; d[i*4+2] = 70 + (i % 7) * 4; d[i*4+3] = 255;
    }
    return d;
  };
  const allFinite = (d: Uint8ClampedArray) => { for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) return false; return true; };

  it.each([
    ['ycbcr', rgbToYCbCr, yCbCrToRgb, true],
    ['lab',   rgbToLab,   labToRgb,   false],
    ['yuv',   rgbToYuv,   yuvToRgb,   true],
  ] as const)('%s stretch produces finite output and keeps alpha', (_n, to, from, lin) => {
    const d = image();
    decorrelationStretch(d, W, H, to, from, 2.5, 100_000, null, lin);
    expect(allFinite(d)).toBe(true);
    for (let i = 0; i < N; i++) expect(d[i*4+3]).toBe(255);
  });

  it('live mode is stable across repeated frames of the same scene', () => {
    const a = image(); decorrelationStretch(a, W, H, rgbToYCbCr, yCbCrToRgb, 2.5, 100_000, 'test');
    let b = image();
    for (let f = 0; f < 10; f++) { b = image(); decorrelationStretch(b, W, H, rgbToYCbCr, yCbCrToRgb, 2.5, 100_000, 'test'); }
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    expect(diff / a.length).toBeLessThan(2);
  });

  it('pre and post normalize run at 0 and 100 strength without NaN', () => {
    const d = image();
    _test.applyPreNormalize(d, N, 0, false);
    _test.applyPreNormalize(d, N, 100, false);
    _test.applyPostNormalize(d, N, 100, 'yre', null);
    _test.applyPostNormalize(d, N, 100, 'lab2', 'k');
    expect(allFinite(d)).toBe(true);
  });
});
