// Aperture measurement of one point source. Sky from an annulus median, centroid and FWHM from
// intensity moments above the sky. No fitting, no model: what the pixels contain.

export interface Measurement {
  x: number; y: number;      // centroid, 0-based pixels
  peak: number;              // brightest pixel above sky
  flux: number;              // sum above sky inside the aperture
  sky: number; skySigma: number;
  fwhm: number;              // geometric mean of both axes, pixels
  fwhmX: number; fwhmY: number;
  snr: number;
}

export function measureSource(plane: Float32Array, w: number, h: number, x0: number, y0: number, r = 8, annulus = [12, 20]): Measurement | null {
  const [rIn, rOut] = annulus;
  const cx0 = Math.round(x0), cy0 = Math.round(y0);
  if (cx0 - rOut < 0 || cy0 - rOut < 0 || cx0 + rOut >= w || cy0 + rOut >= h) return null;
  const ring: number[] = [];
  for (let y = -rOut; y <= rOut; y++) for (let x = -rOut; x <= rOut; x++) {
    const d = Math.hypot(x, y);
    if (d >= rIn && d <= rOut) ring.push(plane[(cy0 + y) * w + cx0 + x]);
  }
  ring.sort((a, b) => a - b);
  const sky = ring[ring.length >> 1];
  const dev = ring.map(v => Math.abs(v - sky)).sort((a, b) => a - b);
  const skySigma = 1.4826 * dev[dev.length >> 1];

  // Two passes: recentre on the first-pass centroid so an off-centre click still measures the star.
  let cx = cx0, cy = cy0, out: Measurement | null = null;
  for (let pass = 0; pass < 2; pass++) {
    let s = 0, sx = 0, sy = 0, sxx = 0, syy = 0, peak = 0, n = 0;
    const bx = Math.round(cx), by = Math.round(cy);
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      if (Math.hypot(x, y) > r) continue;
      const v = plane[(by + y) * w + bx + x] - sky;
      if (v <= 0) continue;
      s += v; sx += v * x; sy += v * y; n++;
      if (v > peak) peak = v;
    }
    if (s <= 0) return null;
    const mx = sx / s, my = sy / s;
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      if (Math.hypot(x, y) > r) continue;
      const v = plane[(by + y) * w + bx + x] - sky;
      if (v <= 0) continue;
      sxx += v * (x - mx) ** 2; syy += v * (y - my) ** 2;
    }
    const fwhmX = 2.3548 * Math.sqrt(sxx / s), fwhmY = 2.3548 * Math.sqrt(syy / s);
    cx = bx + mx; cy = by + my;
    out = { x: cx, y: cy, peak, flux: s, sky, skySigma, fwhmX, fwhmY, fwhm: Math.sqrt(fwhmX * fwhmY), snr: s / (skySigma * Math.sqrt(n) || 1) };
  }
  return out;
}
