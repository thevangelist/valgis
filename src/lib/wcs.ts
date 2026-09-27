// Gnomonic (TAN) world coordinate system from a FITS header, as written by PinPoint, ASTAP and
// astrometry.net, and Siril (CDELT + PC matrix). CD matrix preferred, then CDELT with PC or CROTA2. Pixels are 0-based, row 0 at
// the top of the image as parseFits delivers it, so y is flipped against the FITS convention.

export interface Wcs { crpix: [number, number]; crval: [number, number]; cd: [number, number, number, number]; height: number; }

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

export function wcsFromHeader(h: Record<string, string>, height: number): Wcs | null {
  if (!/^RA---TAN/.test(h.CTYPE1 ?? '') || !/^DEC--TAN/.test(h.CTYPE2 ?? '')) return null;
  const n = (k: string) => Number(h[k]);
  const need = ['CRPIX1', 'CRPIX2', 'CRVAL1', 'CRVAL2'].map(n);
  if (need.some(Number.isNaN)) return null;
  let cd: [number, number, number, number];
  if (h.CD1_1 !== undefined) cd = [n('CD1_1'), n('CD1_2') || 0, n('CD2_1') || 0, n('CD2_2')];
  else if (h.CDELT1 !== undefined) {
    const d1 = n('CDELT1'), d2 = n('CDELT2');
    if (h.PC1_1 !== undefined) cd = [d1 * n('PC1_1'), d1 * (n('PC1_2') || 0), d2 * (n('PC2_1') || 0), d2 * n('PC2_2')];
    else {
      const rot = (n('CROTA2') || 0) * D2R, c = Math.cos(rot), s = Math.sin(rot);
      cd = [d1 * c, -d2 * s, d1 * s, d2 * c];
    }
  } else return null;
  if (cd.some(Number.isNaN)) return null;
  return { crpix: [need[0], need[1]], crval: [need[2], need[3]], cd, height };
}

// Image pixel (0-based, top row 0) to RA/Dec in degrees.
export function pixelToSky(w: Wcs, x: number, y: number): [number, number] {
  const dx = x + 1 - w.crpix[0], dy = (w.height - y) - w.crpix[1];
  const xi = (w.cd[0] * dx + w.cd[1] * dy) * D2R, eta = (w.cd[2] * dx + w.cd[3] * dy) * D2R;
  const ra0 = w.crval[0] * D2R, dec0 = w.crval[1] * D2R;
  const den = Math.cos(dec0) - eta * Math.sin(dec0);
  const ra = ra0 + Math.atan2(xi, den);
  const dec = Math.atan2((Math.sin(dec0) + eta * Math.cos(dec0)) * Math.cos(ra - ra0), den);
  return [((ra * R2D) % 360 + 360) % 360, dec * R2D];
}

export function skyToPixel(w: Wcs, ra: number, dec: number): [number, number] {
  const r = ra * D2R, d = dec * D2R, r0 = w.crval[0] * D2R, d0 = w.crval[1] * D2R;
  const den = Math.sin(d) * Math.sin(d0) + Math.cos(d) * Math.cos(d0) * Math.cos(r - r0);
  const xi = Math.cos(d) * Math.sin(r - r0) / den * R2D;
  const eta = (Math.sin(d) * Math.cos(d0) - Math.cos(d) * Math.sin(d0) * Math.cos(r - r0)) / den * R2D;
  const [a, b, c, e] = w.cd, det = a * e - b * c;
  const dx = (e * xi - b * eta) / det, dy = (a * eta - c * xi) / det;
  return [dx + w.crpix[0] - 1, w.height - (dy + w.crpix[1])];
}

// Plate scale in arcsec per pixel, from the CD matrix determinant.
export const plateScale = (w: Wcs) => Math.sqrt(Math.abs(w.cd[0] * w.cd[3] - w.cd[1] * w.cd[2])) * 3600;

export function formatRa(deg: number): string {
  const h = deg / 15, hh = Math.floor(h), m = (h - hh) * 60, mm = Math.floor(m), s = (m - mm) * 60;
  return `${pad(hh)}h ${pad(mm)}m ${s.toFixed(1).padStart(4, '0')}s`;
}
export function formatDec(deg: number): string {
  const sign = deg < 0 ? '-' : '+', a = Math.abs(deg), dd = Math.floor(a), m = (a - dd) * 60, mm = Math.floor(m), s = (m - mm) * 60;
  return `${sign}${pad(dd)}° ${pad(mm)}' ${s.toFixed(0).padStart(2, '0')}"`;
}
const pad = (v: number) => String(v).padStart(2, '0');
