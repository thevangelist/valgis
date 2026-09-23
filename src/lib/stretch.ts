// Linear-data stretches for Astro mode. All signal-preserving, no reconstruction.

export interface Stats { median: number; mad: number; min: number; max: number; }

export function channelStats(data: Float32Array, maxSamples = 200_000): Stats {
  const step = Math.max(1, Math.floor(data.length / maxSamples));
  const s: number[] = [];
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < data.length; i += step) {
    const v = data[i];
    if (!Number.isFinite(v)) continue;
    s.push(v);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  s.sort((a, b) => a - b);
  const median = s[s.length >> 1] ?? 0;
  const dev = s.map(v => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = dev[dev.length >> 1] ?? 0;
  return { median, mad, min, max };
}

export interface StfParams { shadow: number; highlight: number; midtone: number; }

// PixInsight-style auto screen transfer function: clip at median - 2.8 MAD, midtone
// so the median lands at target brightness.
export function autoStf(st: Stats, target = 0.25, shadowClip = -2.8): StfParams {
  const sigma = 1.4826 * st.mad;
  const shadow = Math.max(st.min, st.median + shadowClip * sigma);
  const highlight = st.max;
  const range = highlight - shadow || 1;
  const m = (st.median - shadow) / range;
  const midtone = mtfSolve(m, target);
  return { shadow, highlight, midtone };
}

// Midtone transfer function and its inverse for the balance parameter.
export function mtf(m: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return ((m - 1) * x) / ((2 * m - 1) * x - m);
}
function mtfSolve(x: number, y: number): number {
  if (x <= 0 || y <= 0) return 0.5;
  // Solve mtf(m, x) = y for m.
  return (x * (1 - y)) / (x * (1 - y) + y * (1 - x));
}

export function asinhStretch(x: number, stretch: number): number {
  if (stretch <= 0) return x;
  return Math.asinh(x * stretch) / Math.asinh(stretch);
}

export function logStretch(x: number, k: number): number {
  if (k <= 0) return x;
  return Math.log1p(x * k) / Math.log1p(k);
}

export type StretchKind = 'linear' | 'mtf' | 'asinh' | 'log';

export interface StretchOptions { kind: StretchKind; stf: StfParams; amount: number; }

// Map one float plane to 0..255 through clip → normalise → curve.
export function applyStretch(src: Float32Array, out: Uint8ClampedArray, stride: number, offset: number, o: StretchOptions): void {
  const { shadow, highlight, midtone } = o.stf;
  const range = highlight - shadow || 1;
  for (let i = 0; i < src.length; i++) {
    let x = (src[i] - shadow) / range;
    x = x < 0 ? 0 : x > 1 ? 1 : x;
    switch (o.kind) {
      case 'mtf':   x = mtf(midtone, x); break;
      case 'asinh': x = asinhStretch(x, o.amount); break;
      case 'log':   x = logStretch(x, o.amount); break;
    }
    out[i * stride + offset] = x * 255;
  }
}
