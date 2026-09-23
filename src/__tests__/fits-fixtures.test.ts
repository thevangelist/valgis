import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseFits } from '../lib/fits';

const load = (n: string) => {
  const b = readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const W = 8, H = 6;
const expectTopLeftFirst = (plane: Float32Array, f: (x: number, y: number) => number) => {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) expect(plane[y * W + x]).toBeCloseTo(f(x, y), 3);
};

describe('FITS fixtures on disk', () => {
  it('int16 with BZERO reads as unsigned, rows flipped', () => {
    const img = parseFits(load('int16.fits'));
    expect([img.width, img.height, img.channels.length]).toEqual([W, H, 1]);
    expectTopLeftFirst(img.channels[0], (x, y) => x * 1000 + (H - 1 - y) * 100);
  });
  it('float32 RGB cube gives three planes', () => {
    const img = parseFits(load('rgb32.fits'));
    expect(img.channels.length).toBe(3);
    expectTopLeftFirst(img.channels[0], x => x);
    expectTopLeftFirst(img.channels[1], (_x, y) => H - 1 - y);
    expectTopLeftFirst(img.channels[2], () => 100);
  });
  it('float64', () => {
    expectTopLeftFirst(parseFits(load('f64.fits')).channels[0], (x, y) => (x * 1000 + (H - 1 - y) * 100) / 7);
  });
  it('int32', () => {
    expectTopLeftFirst(parseFits(load('i32.fits')).channels[0], (x, y) => (x * 1000 + (H - 1 - y) * 100) * 100000);
  });
  it('uint8', () => {
    expectTopLeftFirst(parseFits(load('u8.fits')).channels[0], (x, y) => (x * 1000 + (H - 1 - y) * 100) % 256);
  });
});

import { decodeTiffPlanes } from '../lib/tiff';

describe('TIFF fixtures on disk', () => {
  it('16-bit mono keeps full precision', () => {
    const t = decodeTiffPlanes(load('mono16.tif'));
    expect([t.width, t.height, t.bits, t.channels.length]).toEqual([W, H, 16, 1]);
    expectTopLeftFirst(t.channels[0], (x, y) => x * 1000 + y * 100);
  });
  it('8-bit RGB gives three planes', () => {
    const t = decodeTiffPlanes(load('rgb8.tif'));
    expect(t.channels.length).toBe(3);
    expectTopLeftFirst(t.channels[0], x => x * 30);
    expectTopLeftFirst(t.channels[1], (_x, y) => y * 40);
    expectTopLeftFirst(t.channels[2], () => 200);
  });
});
