import { describe, it, expect } from 'vitest';
import { parseFits } from '../lib/fits';
import { channelStats, autoStf, mtf, asinhStretch, applyStretch } from '../lib/stretch';

function makeFits(width: number, height: number, bitpix: number, values: number[], extra: string[] = []): ArrayBuffer {
  const cards = [
    'SIMPLE  =                    T', `BITPIX  = ${String(bitpix).padStart(20)}`, 'NAXIS   =                    2',
    `NAXIS1  = ${String(width).padStart(20)}`, `NAXIS2  = ${String(height).padStart(20)}`, ...extra, 'END',
  ].map(c => c.padEnd(80));
  const headerLen = Math.ceil(cards.length * 80 / 2880) * 2880;
  const bytesPer = Math.abs(bitpix) / 8;
  const dataLen = Math.ceil(values.length * bytesPer / 2880) * 2880;
  const buf = new ArrayBuffer(headerLen + dataLen);
  const u8 = new Uint8Array(buf);
  u8.fill(32, 0, headerLen);
  const head = cards.join('');
  for (let i = 0; i < head.length; i++) u8[i] = head.charCodeAt(i);
  const dv = new DataView(buf, headerLen);
  values.forEach((v, i) => {
    if (bitpix === 16) dv.setInt16(i * 2, v, false);
    else if (bitpix === -32) dv.setFloat32(i * 4, v, false);
    else dv.setUint8(i, v);
  });
  return buf;
}

describe('parseFits', () => {
  it('reads 16-bit with BZERO and flips rows', () => {
    const img = parseFits(makeFits(2, 2, 16, [-32768, -32767, 0, 32767], ['BZERO   =                32768', 'BSCALE  =                    1']));
    expect(img.width).toBe(2);
    expect(Array.from(img.channels[0])).toEqual([32768, 65535, 0, 1]);
  });
  it('reads float32', () => {
    const img = parseFits(makeFits(3, 1, -32, [0.5, 1.5, 2.5]));
    expect(Array.from(img.channels[0])).toEqual([0.5, 1.5, 2.5]);
  });
  it('rejects unsupported NAXIS', () => {
    expect(() => parseFits(makeFits(1, 1, 8, [1], ['NAXIS   =                    1']))).toThrow();
  });
});

describe('stretch', () => {
  it('mtf maps midtone to 0.5 and keeps endpoints', () => {
    expect(mtf(0.5, 0.5)).toBeCloseTo(0.5);
    expect(mtf(0.2, 0)).toBe(0);
    expect(mtf(0.2, 1)).toBe(1);
  });
  it('autoStf places the median at the target brightness', () => {
    const data = new Float32Array(10_000);
    for (let i = 0; i < data.length; i++) data[i] = 1000 + (i % 100) - 50 + (i % 7 === 0 ? 5000 : 0);
    const st = channelStats(data);
    const stf = autoStf(st, 0.25);
    const x = (st.median - stf.shadow) / (stf.highlight - stf.shadow);
    expect(mtf(stf.midtone, x)).toBeCloseTo(0.25, 2);
  });
  it('asinh is monotonic and bounded', () => {
    let prev = -1;
    for (let x = 0; x <= 1; x += 0.05) {
      const y = asinhStretch(x, 50);
      expect(y).toBeGreaterThanOrEqual(prev);
      expect(y).toBeLessThanOrEqual(1);
      prev = y;
    }
  });
  it('applyStretch writes into the requested channel only', () => {
    const src = new Float32Array([0, 50, 100]);
    const out = new Uint8ClampedArray(12);
    applyStretch(src, out, 4, 1, { kind: 'linear', stf: { shadow: 0, highlight: 100, midtone: 0.5 }, amount: 0 });
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 0, 128, 0, 0, 0, 255, 0, 0]);
  });
});

import { bin2x2, subtractBackground, neutralizeBackground, scnr } from '../lib/astroTools';

describe('astro tools', () => {
  it('bin2x2 sums blocks', () => {
    const p = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const r = bin2x2([p], 4, 4);
    expect(r.width).toBe(2);
    expect(Array.from(r.planes[0])).toEqual([14, 22, 46, 54]);
  });
  it('subtractBackground flattens a linear gradient', () => {
    const w = 40, h = 40, p = new Float32Array(w * h);
    for (let i = 0; i < p.length; i++) p[i] = 100 + (i % w) * 2 + Math.floor(i / w);
    p[w * 20 + 20] = 5000;
    const out = subtractBackground(p, w, h);
    const st = channelStats(out);
    expect(st.mad).toBeLessThan(1);
    expect(out[w * 20 + 20]).toBeGreaterThan(4000);
  });
  it('neutralizeBackground equalises channel medians', () => {
    const mk = (v: number) => new Float32Array(100).fill(v);
    const out = neutralizeBackground([mk(10), mk(30), mk(20)]);
    expect(out.map(p => p[0])).toEqual([20, 20, 20]);
  });
  it('scnr caps green at the red/blue mean', () => {
    const out = scnr([new Float32Array([10]), new Float32Array([50]), new Float32Array([20])]);
    expect(out[1][0]).toBe(15);
  });
});
