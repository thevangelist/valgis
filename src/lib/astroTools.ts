// Linear-domain tools for Astro mode. Each is deterministic arithmetic on the measured data.
import { Matrix, solve } from 'ml-matrix';
import { channelStats } from './stretch';

export type Planes = Float32Array[];

// Sum 2×2 blocks. SNR doubles, resolution halves. Odd edges are dropped.
export function bin2x2(planes: Planes, w: number, h: number): { planes: Planes; width: number; height: number } {
  const W = w >> 1, H = h >> 1;
  const out = planes.map(src => {
    const dst = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (2 * y) * w + 2 * x;
      dst[y * W + x] = src[i] + src[i + 1] + src[i + w] + src[i + w + 1];
    }
    return dst;
  });
  return { planes: out, width: W, height: H };
}

// Fit a quadratic surface to background pixels (below median + 1σ) and subtract it,
// keeping the median level. Removes vignetting and light-pollution gradients.
export function subtractBackground(plane: Float32Array, w: number, h: number): Float32Array {
  const st = channelStats(plane);
  const limit = st.median + 1.4826 * st.mad;
  const step = Math.max(1, Math.floor(plane.length / 20_000));
  const rows: number[][] = [], rhs: number[] = [];
  for (let i = 0; i < plane.length; i += step) {
    const v = plane[i];
    if (!(v <= limit)) continue;
    const x = (i % w) / w - 0.5, y = Math.floor(i / w) / h - 0.5;
    rows.push([1, x, y, x * x, y * y, x * y]);
    rhs.push(v);
  }
  if (rows.length < 12) return plane;
  const A = new Matrix(rows), b = Matrix.columnVector(rhs);
  const coef = solve(A.transpose().mmul(A), A.transpose().mmul(b)).to1DArray();
  const out = new Float32Array(plane.length);
  for (let i = 0; i < plane.length; i++) {
    const x = (i % w) / w - 0.5, y = Math.floor(i / w) / h - 0.5;
    const bg = coef[0] + coef[1] * x + coef[2] * y + coef[3] * x * x + coef[4] * y * y + coef[5] * x * y;
    out[i] = plane[i] - bg + st.median;
  }
  return out;
}

// Shift each channel so background medians match. Removes colour cast from the sky.
export function neutralizeBackground(planes: Planes): Planes {
  if (planes.length < 3) return planes;
  const meds = planes.map(p => channelStats(p).median);
  const target = meds.reduce((a, v) => a + v, 0) / meds.length;
  return planes.map((p, c) => {
    const d = target - meds[c];
    const out = new Float32Array(p.length);
    for (let i = 0; i < p.length; i++) out[i] = p[i] + d;
    return out;
  });
}

// Subtractive chromatic noise reduction: green never exceeds the mean of red and blue.
export function scnr(planes: Planes): Planes {
  if (planes.length < 3) return planes;
  const [r, g, b] = planes;
  const out = new Float32Array(g.length);
  for (let i = 0; i < g.length; i++) out[i] = Math.min(g[i], (r[i] + b[i]) / 2);
  return [r, out, b, ...planes.slice(3)];
}
