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
