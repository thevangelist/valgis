// Log-scaled histogram of a linear plane between two values, for drawing under the stretch controls.
export function histogram(plane: Float32Array, lo: number, hi: number, bins = 256, maxSamples = 2_000_000): Float32Array {
  const h = new Float32Array(bins), range = hi - lo || 1, step = Math.max(1, Math.floor(plane.length / maxSamples));
  for (let i = 0; i < plane.length; i += step) {
    const b = Math.min(bins - 1, Math.floor((plane[i] - lo) / range * bins));
    if (b >= 0) h[b]++;
  }
  let max = 0;
  for (let i = 0; i < bins; i++) { h[i] = Math.log1p(h[i]); if (h[i] > max) max = h[i]; }
  if (max > 0) for (let i = 0; i < bins; i++) h[i] /= max;
  return h;
}
