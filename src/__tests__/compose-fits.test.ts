import { describe, it, expect } from 'vitest';
import { compose, roleFromHeader } from '../lib/compose';
import type { Frame } from '../lib/compose';
import { writeFits } from '../lib/fitsWrite';
import { parseFits } from '../lib/fits';
import { histogram } from '../lib/histogram';

const frame = (role: Frame['role'], v: number[], header?: Record<string, string>): Frame => ({ name: role, role, width: 2, height: 2, channels: [Float32Array.from(v)], header });

describe('compose', () => {
  it('maps FILTER cards to roles, V is green', () => {
    expect(roleFromHeader({ FILTER: 'V       ' })).toBe('G');
    expect(roleFromHeader({ FILTER: 'L' })).toBe('L');
    expect(roleFromHeader({ FILTER: 'Ha' })).toBe('mono');
  });
  it('fills G from R and B and keeps the header of L', () => {
    const c = compose([frame('R', [2, 2, 2, 2], { OBJECT: 'x' }), frame('B', [4, 4, 4, 4])]);
    expect(Array.from(c.channels[1])).toEqual([3, 3, 3, 3]);
    expect(c.header?.FILTER).toBe('R+B');
  });
  it('L sets brightness while colour ratios survive', () => {
    const c = compose([frame('L', [30, 30, 30, 30], { EXPTIME: '20' }), frame('R', [2, 2, 2, 2]), frame('G', [3, 3, 3, 3]), frame('B', [4, 4, 4, 4])]);
    const [r, g, b] = c.channels.map(p => p[0]);
    expect((r + g + b) / 3).toBeCloseTo(30); expect(b / r).toBeCloseTo(2);
    expect(c.header?.EXPTIME).toBe('20');
  });
  it('refuses mismatched sizes and colour without R and B', () => {
    expect(() => compose([frame('R', [1, 1, 1, 1]), { ...frame('B', [1, 1, 1, 1]), width: 3 }])).toThrow(/size/);
    expect(() => compose([frame('R', [1, 1, 1, 1]), frame('G', [1, 1, 1, 1])])).toThrow(/R and B/);
  });
});

describe('writeFits', () => {
  it('round-trips planes and header through parseFits', () => {
    const ch = [Float32Array.from([1.5, -2, 3, 4e4]), Float32Array.from([0, 1, 2, 3])];
    const buf = writeFits(ch, 2, 2, { OBJECT: 'Neptune', EXPTIME: '2.00000000000E+001', PLTSOLVD: 'T', CTYPE1: 'RA---TAN' }, ['valgis: crop 10,10 2x2']);
    expect(buf.byteLength % 2880).toBe(0);
    const img = parseFits(buf);
    expect(img.width).toBe(2); expect(img.channels.length).toBe(2);
    expect(Array.from(img.channels[0])).toEqual(Array.from(ch[0]));
    expect(img.header.OBJECT).toBe('Neptune'); expect(Number(img.header.EXPTIME)).toBe(20); expect(img.header.CTYPE1).toBe('RA---TAN');
  });
});

describe('histogram', () => {
  it('is normalised, log-scaled and puts values in the right bin', () => {
    const h = histogram(Float32Array.from([0, 0, 0, 0, 10]), 0, 10, 10);
    expect(h[0]).toBe(1); expect(h[9]).toBeGreaterThan(0); expect(h[5]).toBe(0);
  });
});
