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

// Sum n×n blocks.
export function binN(planes: Planes, w: number, h: number, n: 2 | 4): { planes: Planes; width: number; height: number } {
  let r = bin2x2(planes, w, h);
  if (n === 4) r = bin2x2(r.planes, r.width, r.height);
  return r;
}

// Pixels within k·σ of the median: sky, not stars. σ from MAD.
function skyLimit(plane: Float32Array, k = 3): number {
  const st = channelStats(plane);
  return st.median + k * 1.4826 * st.mad;
}

function medianOf(vals: number[]): number {
  if (!vals.length) return 0;
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1];
}

// Row-wise readout offset: subtract each row's sky median, add the global median back.
export function removeRowNoise(plane: Float32Array, w: number, h: number): Float32Array {
  const limit = skyLimit(plane, 10);   // exclude stars only; row offsets are a few σ and must stay in
  const global = channelStats(plane).median;
  const out = new Float32Array(plane.length);
  const row: number[] = [];
  for (let y = 0; y < h; y++) {
    row.length = 0;
    for (let x = 0; x < w; x += 2) { const v = plane[y * w + x]; if (v <= limit) row.push(v); }
    const d = row.length > 8 ? global - medianOf(row) : 0;
    for (let x = 0; x < w; x++) out[y * w + x] = plane[y * w + x] + d;
  }
  return out;
}

// Columns whose sky median deviates more than k·σ from their neighbours are replaced by the
// average of the adjacent columns. Returns the column indices that were fixed.
export function fixBadColumns(plane: Float32Array, w: number, h: number, k = 6): { plane: Float32Array; columns: number[] } {
  const limit = skyLimit(plane);
  const colMed = new Float32Array(w);
  const col: number[] = [];
  for (let x = 0; x < w; x++) {
    col.length = 0;
    for (let y = 0; y < h; y += 2) { const v = plane[y * w + x]; if (v <= limit) col.push(v); }
    colMed[x] = medianOf(col);
  }
  const resid = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const l = colMed[Math.max(0, x - 2)], r = colMed[Math.min(w - 1, x + 2)];
    resid[x] = colMed[x] - (l + r) / 2;
  }
  const st = channelStats(resid);
  const sigma = 1.4826 * st.mad || 1;
  const bad: number[] = [];
  for (let x = 0; x < w; x++) if (Math.abs(resid[x] - st.median) > k * sigma) bad.push(x);
  const out = new Float32Array(plane);
  for (const x of bad) {
    const l = x > 0 ? x - 1 : x + 1, r = x < w - 1 ? x + 1 : x - 1;
    for (let y = 0; y < h; y++) out[y * w + x] = (plane[y * w + l] + plane[y * w + r]) / 2;
  }
  return { plane: out, columns: bad };
}

// Isolated pixels far above their 3×3 neighbourhood median are replaced by that median.
// Stars span several pixels, so a single-pixel spike is a hot pixel or a cosmic ray.
export function removeHotPixels(plane: Float32Array, w: number, h: number, threshold = 8): { plane: Float32Array; count: number } {
  const st = channelStats(plane);
  const sigma = 1.4826 * st.mad || 1;
  const out = new Float32Array(plane);
  const nb: number[] = [];
  let count = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    nb.length = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) nb.push(plane[i + dy * w + dx]);
    // Isolated: brighter than every neighbour by the threshold. A star's edge pixel has a bright neighbour.
    let maxNb = -Infinity;
    for (const v of nb) if (v > maxNb) maxNb = v;
    if (plane[i] - maxNb > threshold * sigma) { out[i] = medianOf(nb); count++; }
  }
  return { plane: out, count };
}
