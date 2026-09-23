import { describe, it, expect } from 'vitest';
import { parseFits } from '../lib/fits';

function fitsWith(cards: string[], data = new Uint8Array(2880)): ArrayBuffer {
  const all = ['SIMPLE  =                    T', 'BITPIX  =                    8', 'NAXIS   =                    2',
    'NAXIS1  =                    4', 'NAXIS2  =                    1', ...cards, 'END'].map(c => c.padEnd(80));
  const head = all.join('');
  const headerLen = Math.ceil(head.length / 2880) * 2880;
  const buf = new ArrayBuffer(headerLen + data.length);
  const u8 = new Uint8Array(buf); u8.fill(32, 0, headerLen);
  for (let i = 0; i < head.length; i++) u8[i] = head.charCodeAt(i);
  u8.set(data, headerLen);
  return buf;
}

describe('FITS header parsing', () => {
  it('keeps slashes inside quoted strings and drops comments outside', () => {
    const h = parseFits(fitsWith(["DATE-OBS= '2026/09/22T19:58:52' / [ISO] start", "TELESCOP= 'ACP->Driver/TheSky' / name"])).header;
    expect(h['DATE-OBS']).toBe('2026/09/22T19:58:52');
    expect(h.TELESCOP).toBe('ACP->Driver/TheSky');
  });
  it('unescapes doubled quotes', () => {
    expect(parseFits(fitsWith(["OBSERVER= 'O''Brien'"])).header.OBSERVER).toBe("O'Brien");
  });
  it('ignores COMMENT and HISTORY cards', () => {
    const h = parseFits(fitsWith(['COMMENT this is a comment with = sign', 'HISTORY stacked 2 frames'])).header;
    expect(h.COMMENT).toBeUndefined();
    expect(h.HISTORY).toBeUndefined();
  });
  it('numeric values keep the trailing comment out', () => {
    expect(parseFits(fitsWith(['EXPTIME =   9.00000000000E+001 / [sec] Duration'])).header.EXPTIME).toBe('9.00000000000E+001');
  });
  it('header spanning two blocks still finds the data', () => {
    const many = Array.from({ length: 40 }, (_, i) => `KEY${String(i).padStart(4, '0')}= ${String(i).padStart(20)}`);
    const data = new Uint8Array(2880); data.set([1, 2, 3, 4]);
    const img = parseFits(fitsWith(many, data));
    expect(Array.from(img.channels[0])).toEqual([1, 2, 3, 4]);
  });
  it('throws on missing END and on truncated data', () => {
    expect(() => parseFits(new ArrayBuffer(2880))).toThrow(/END/);
    const short = fitsWith(['NAXIS1  =                 4000', 'NAXIS2  =                 4000']);
    expect(() => parseFits(short)).toThrow(/shorter/);
  });
  it('rejects unknown BITPIX', () => {
    expect(() => parseFits(fitsWith(['BITPIX  =                   64']))).toThrow(/BITPIX/);
  });
});
