import { describe, it, expect } from 'vitest';
import { wcsFromHeader, pixelToSky, skyToPixel, plateScale, formatRa, formatDec } from '../lib/wcs';
import { measureSource } from '../lib/photometry';

// Header values from a real Murtoinen (ACP/PinPoint) Neptune frame, 4096², 0.55"/px.
const H = {
  CTYPE1: 'RA---TAN', CTYPE2: 'DEC--TAN', CRPIX1: '2048', CRPIX2: '2048',
  CRVAL1: '2.91925935631E+000', CRVAL2: '-2.83864929175E-001',
  CD1_1: '-1.51796294626E-004', CD1_2: '-1.58587298197E-007', CD2_1: '1.58376814576E-007', CD2_2: '-1.51998032700E-004',
};

describe('wcs', () => {
  const w = wcsFromHeader(H, 4096)!;
  it('parses a CD-matrix TAN header', () => {
    expect(w).not.toBeNull();
    expect(plateScale(w)).toBeCloseTo(0.5468, 3);
  });
  it('round-trips pixel → sky → pixel', () => {
    for (const [x, y] of [[0, 0], [2047, 2047], [4095, 4095], [100, 3000]]) {
      const [ra, dec] = pixelToSky(w, x, y);
      const [x2, y2] = skyToPixel(w, ra, dec);
      expect(x2).toBeCloseTo(x, 6); expect(y2).toBeCloseTo(y, 6);
    }
  });
  it('puts the reference pixel at CRVAL, and RA grows to the left', () => {
    const [ra, dec] = pixelToSky(w, 2047, 4096 - 2048);
    expect(ra).toBeCloseTo(2.91925935631, 9); expect(dec).toBeCloseTo(-0.283864929175, 9);
    expect(pixelToSky(w, 1000, 2000)[0]).toBeGreaterThan(pixelToSky(w, 3000, 2000)[0]);
  });
  it('places Neptune where the Horizons ephemeris said it was', () => {
    // Neptune 2026-09-27 19:15 UT: RA 2.92169°, Dec -0.28186°. Measured centroid 2028.4, 2032.4 in a
    // frame taken 5 min earlier; the header above is from the previous frame, pointing drifted ~2 px.
    const [x, y] = skyToPixel(w, 2.92169, -0.28186);
    expect(Math.abs(x - 2028.4)).toBeLessThan(4); expect(Math.abs((4096 - 1 - y) - 2032.4)).toBeLessThan(4);
  });
  it('falls back to CDELT/CROTA and rejects non-TAN headers', () => {
    const alt = wcsFromHeader({ ...H, CD1_1: undefined as unknown as string, CDELT1: '-1.5e-4', CDELT2: '-1.5e-4', CROTA2: '0' }, 4096);
    alt!.cd.forEach((v, i) => expect(v).toBeCloseTo([-1.5e-4, 0, 0, -1.5e-4][i], 12));
    expect(wcsFromHeader({ ...H, CTYPE1: 'RA---SIN' }, 4096)).toBeNull();
  });
  it('reads a Siril CDELT + PC header to the same sky position as the CD form', () => {
    const siril = { CTYPE1: 'RA---TAN', CTYPE2: 'DEC--TAN', CRPIX1: '2048.', CRPIX2: '2048.', CRVAL1: '2.91925935631', CRVAL2: '-0.283864929175',
      CDELT1: '-0.000151796377467035', CDELT2: '0.000151998115211622', PC1_1: '0.999999454262109', PC1_2: '0.00104473704078636', PC2_1: '0.00104196564776804', PC2_2: '-0.999999457153647' };
    const a = pixelToSky(w, 3000, 1000), b = pixelToSky(wcsFromHeader(siril, 4096)!, 3000, 1000);
    expect(b[0]).toBeCloseTo(a[0], 6); expect(b[1]).toBeCloseTo(a[1], 6);
  });
  it('formats sexagesimal', () => {
    expect(formatRa(2.92169)).toBe('00h 11m 41.2s');
    expect(formatDec(-0.28186)).toBe('-00° 16\' 55"');
  });
});

describe('measureSource', () => {
  const w = 64, h = 64, plane = new Float32Array(w * h);
  const sigma = 8 / 2.3548, cx = 30.3, cy = 33.7, amp = 4000, sky = 775;
  let seed = 7; const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed / 2 ** 32 - 0.5) * 6; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    plane[y * w + x] = sky + amp * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma * sigma)) + noise();

  it('recovers centroid, FWHM, peak and sky of a synthetic 8 px star', () => {
    const m = measureSource(plane, w, h, 28, 36)!;
    expect(m.x).toBeCloseTo(cx, 0); expect(m.y).toBeCloseTo(cy, 0);
    expect(m.fwhm).toBeGreaterThan(6.5); expect(m.fwhm).toBeLessThan(8.5);
    expect(m.peak).toBeGreaterThan(amp * 0.9); expect(m.sky).toBeCloseTo(sky, -1);
    expect(m.snr).toBeGreaterThan(100);
  });
  it('returns null at the image edge and on empty sky', () => {
    expect(measureSource(plane, w, h, 2, 2)).toBeNull();
    const flat = new Float32Array(w * h).fill(100);
    expect(measureSource(flat, w, h, 32, 32)).toBeNull();
  });
});
