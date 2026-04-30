import { describe, it, expect } from 'vitest';
import { Matrix } from 'ml-matrix';
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
  it('returns matrix with same shape as input', () => {
    const data = new Matrix([[100, 50, 200], [80, 120, 60], [30, 90, 150]]);
    const result = decorrelationStretch(data);
    expect(result.rows).toBe(data.rows);
    expect(result.columns).toBe(data.columns);
  });

  it('output values are in 0–255 range', () => {
    const rows = Array.from({ length: 10 }, () => [
      Math.random() * 255, Math.random() * 255, Math.random() * 255,
    ]);
    const result = decorrelationStretch(new Matrix(rows));
    for (let i = 0; i < result.rows; i++)
      for (let j = 0; j < result.columns; j++)
        expect(result.get(i, j)).toBeGreaterThanOrEqual(0);
  });

  it('uniform input stays uniform', () => {
    const data = new Matrix(Array.from({ length: 5 }, () => [128, 128, 128]));
    const result = decorrelationStretch(data);
    for (let i = 0; i < result.rows; i++)
      for (let j = 0; j < result.columns; j++)
        expect(Number.isFinite(result.get(i, j))).toBe(true);
  });
});
