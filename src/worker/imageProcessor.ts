import { Matrix, EigenvalueDecomposition } from 'ml-matrix';

export type FilterName =
  | 'none' | 'adaptive'
  | 'yre' | 'yrd' | 'ydt' | 'ybk' | 'yye' | 'ywe' | 'ybr'
  | 'yds' | 'lre' | 'lrd' | 'lbk' | 'lye'
  | 'lab' | 'lab2' | 'drgb' | 'yuv'
  | 'crgb' | 'rgb0'
  | 'autolevel' | 'histeq' | 'satboost';

// ─── Color Wheel types ────────────────────────────────────────────────────────

export interface WheelValue { x: number; y: number; luma: number; }

export interface ColorWheelAdjustments {
  lift:  WheelValue;  // shadows
  gamma: WheelValue;  // midtones
  gain:  WheelValue;  // highlights
}

// ─── HSL band types ───────────────────────────────────────────────────────────

export type HslBandKey = 'reds' | 'oranges' | 'yellows' | 'greens' | 'cyans' | 'blues' | 'purples' | 'magentas';

export interface HslBandAdjustment {
  hue: number;        // -180 to +180 shift
  saturation: number; // -100 to +100
  lightness: number;  // -100 to +100
  center: number;     // 0–359, hue center of the band
  halfWidth: number;  // 5–90, degrees on each side
}

export type HslAdjustments = Record<HslBandKey, HslBandAdjustment>;

export interface ProcessOptions {
  filter: FilterName;
  brightness: number;
  contrast: number;
  saturation: number;
  shadowRecovery: number;
  highlightRecovery: number;
  clarity: number;
  dehaze: number;
  noiseReduction: number;
  noiseAlgorithm: 'median' | 'gaussian' | 'bilateral';
  sharpening: number;
  sharpenAlgorithm: 'unsharp' | 'highpass' | 'laplacian';
  hslAdjustments?: HslAdjustments;
  colorWheels?: ColorWheelAdjustments;
}

// ─── Color Space Conversions ──────────────────────────────────────────────────

function rgbToYCbCr(r: number, g: number, b: number): [number, number, number] {
  return [
     0.299 * r + 0.587 * g + 0.114 * b,
    -0.168736 * r - 0.331264 * g + 0.5 * b + 128,
     0.5 * r - 0.418688 * g - 0.081312 * b + 128,
  ];
}

function yCbCrToRgb(y: number, cb: number, cr: number): [number, number, number] {
  cb -= 128; cr -= 128;
  return [y + 1.402 * cr, y - 0.344136 * cb - 0.714136 * cr, y + 1.772 * cb];
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.0721750);
  const z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883;
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const unf = (t: number) => t > 0.206897 ? t * t * t : (t - 16 / 116) / 7.787;
  const x = unf(fx) * 0.95047;
  const y = unf(fy);
  const z = unf(fz) * 1.08883;
  let r =  x * 3.2404542 - y * 1.5371385 - z * 0.4985314;
  let g = -x * 0.9692660 + y * 1.8760108 + z * 0.0415560;
  let bl = x * 0.0556434 - y * 0.2040259 + z * 1.0572252;
  const s = (c: number) => (c > 0.0031308 ? 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055 : 12.92 * c) * 255;
  return [s(r), s(g), s(bl)];
}

function rgbToYuv(r: number, g: number, b: number): [number, number, number] {
  const y =  0.299 * r + 0.587 * g + 0.114 * b;
  const u = -0.147 * r - 0.289 * g + 0.436 * b;
  const v =  0.615 * r - 0.515 * g - 0.100 * b;
  return [y, u + 111, v + 157]; // offset to keep positive
}

function yuvToRgb(y: number, u: number, v: number): [number, number, number] {
  u -= 111; v -= 157;
  return [y + 1.140 * v, y - 0.395 * u - 0.581 * v, y + 2.032 * u];
}

function rgbToRgb(r: number, g: number, b: number): [number, number, number] { return [r, g, b]; }
function rgbFromRgb(r: number, g: number, b: number): [number, number, number] { return [r, g, b]; }

// ─── Live-mode temporal smoothing state ──────────────────────────────────────
//
// Keyed by filter name. Only used when the worker receives { live: true }.
// Static image processing never touches this map.

interface EMAState {
  // Smoothed covariance (upper triangle)
  c00: number; c01: number; c02: number;
  c11: number; c12: number; c22: number;
  // Smoothed means
  m0: number; m1: number; m2: number;
  // Previous eigenvectors for sign stabilization (column-major 3×3)
  prevV: Float64Array;
  frames: number;
  // Smoothed output normalization range — prevents auto-exposure flicker
  outMin: number;
  outMax: number;
}

const liveEMA = new Map<string, EMAState>();

// ─── PCA Decorrelation Stretch ────────────────────────────────────────────────

type ToCS   = (r: number, g: number, b: number) => [number, number, number];
type FromCS = (a: number, b: number, c: number) => [number, number, number];

function decorrelationStretch(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  toCS: ToCS,
  fromCS: FromCS,
  stretchFactor: number = 2.5,
  maxSamples: number = 100_000,
  liveKey: string | null = null,
): void {
  const n = width * height;

  // Sample pixels for covariance (performance for large images)
  const step = Math.max(1, Math.floor(n / maxSamples));
  const sampleCount = Math.ceil(n / step);

  const s0 = new Float32Array(sampleCount);
  const s1 = new Float32Array(sampleCount);
  const s2 = new Float32Array(sampleCount);

  for (let si = 0, i = 0; si < sampleCount; si++, i += step) {
    const [a, b, c] = toCS(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    s0[si] = a; s1[si] = b; s2[si] = c;
  }

  // Mean
  let m0 = 0, m1 = 0, m2 = 0;
  for (let i = 0; i < sampleCount; i++) { m0 += s0[i]; m1 += s1[i]; m2 += s2[i]; }
  m0 /= sampleCount; m1 /= sampleCount; m2 /= sampleCount;

  // Covariance (3×3 symmetric)
  let c00=0, c01=0, c02=0, c11=0, c12=0, c22=0;
  for (let i = 0; i < sampleCount; i++) {
    const a = s0[i]-m0, b = s1[i]-m1, c = s2[i]-m2;
    c00+=a*a; c01+=a*b; c02+=a*c; c11+=b*b; c12+=b*c; c22+=c*c;
  }
  const inv = 1 / (sampleCount - 1);
  c00*=inv; c01*=inv; c02*=inv; c11*=inv; c12*=inv; c22*=inv;

  // ── Temporal EMA (live mode only) ─────────────────────────────────────────
  if (liveKey !== null) {
    if (!liveEMA.has(liveKey)) {
      liveEMA.set(liveKey, {
        c00, c01, c02, c11, c12, c22, m0, m1, m2,
        prevV: new Float64Array(9),
        frames: 0,
        outMin: 0, outMax: 255,
      });
    }
    const st = liveEMA.get(liveKey)!;
    // Alpha decays from 1 → 0.12 over ~8 frames so the first frame is sharp
    // and subsequent frames blend slowly for stability.
    const alpha = Math.max(0.12, 1 / (st.frames + 1));
    st.c00 = alpha*c00 + (1-alpha)*st.c00;
    st.c01 = alpha*c01 + (1-alpha)*st.c01;
    st.c02 = alpha*c02 + (1-alpha)*st.c02;
    st.c11 = alpha*c11 + (1-alpha)*st.c11;
    st.c12 = alpha*c12 + (1-alpha)*st.c12;
    st.c22 = alpha*c22 + (1-alpha)*st.c22;
    st.m0  = alpha*m0  + (1-alpha)*st.m0;
    st.m1  = alpha*m1  + (1-alpha)*st.m1;
    st.m2  = alpha*m2  + (1-alpha)*st.m2;
    st.frames++;
    c00=st.c00; c01=st.c01; c02=st.c02;
    c11=st.c11; c12=st.c12; c22=st.c22;
    m0=st.m0; m1=st.m1; m2=st.m2;
  }

  const cov = new Matrix([
    [c00, c01, c02],
    [c01, c11, c12],
    [c02, c12, c22],
  ]);

  const eig = new EigenvalueDecomposition(cov);
  const V = eig.eigenvectorMatrix;
  const eigenvalues = eig.realEigenvalues;

  // Eigenvector components (columns of V)
  let v00=V.get(0,0), v10=V.get(1,0), v20=V.get(2,0);
  let v01=V.get(0,1), v11=V.get(1,1), v21=V.get(2,1);
  let v02=V.get(0,2), v12=V.get(1,2), v22=V.get(2,2);

  // ── Sign stabilization (live mode only) ───────────────────────────────────
  // Eigenvectors are only defined up to sign. ml-matrix can flip any column
  // between frames, which inverts the colour mapping and causes a visible flash.
  // We align each column to the previous frame by flipping if dot product < 0.
  if (liveKey !== null) {
    const st = liveEMA.get(liveKey)!;
    if (st.frames > 1) {
      const p = st.prevV;
      if (p[0]*v00 + p[1]*v10 + p[2]*v20 < 0) { v00=-v00; v10=-v10; v20=-v20; }
      if (p[3]*v01 + p[4]*v11 + p[5]*v21 < 0) { v01=-v01; v11=-v11; v21=-v21; }
      if (p[6]*v02 + p[7]*v12 + p[8]*v22 < 0) { v02=-v02; v12=-v12; v22=-v22; }
    }
    const p = st.prevV;
    p[0]=v00; p[1]=v10; p[2]=v20;
    p[3]=v01; p[4]=v11; p[5]=v21;
    p[6]=v02; p[7]=v12; p[8]=v22;
  }

  const std0 = Math.sqrt(Math.abs(eigenvalues[0])) || 1;
  const std1 = Math.sqrt(Math.abs(eigenvalues[1])) || 1;
  const std2 = Math.sqrt(Math.abs(eigenvalues[2])) || 1;

  // Scale each PC so variance → 1, then multiply by stretchFactor.
  // Different stretchFactors produce different amounts of clipping after
  // RGB conversion, which is what visually distinguishes the filters.
  const sc0 = stretchFactor / std0;
  const sc1 = stretchFactor / std1;
  const sc2 = stretchFactor / std2;

  // Transform all pixels: project → scale → back-project → to RGB
  const outR = new Float32Array(n);
  const outG = new Float32Array(n);
  const outB = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const [a, b, c] = toCS(data[i*4], data[i*4+1], data[i*4+2]);
    const da = a-m0, db = b-m1, dc = c-m2;

    // Project to PC space (p = V^T · d)
    const p0 = v00*da + v10*db + v20*dc;
    const p1 = v01*da + v11*db + v21*dc;
    const p2 = v02*da + v12*db + v22*dc;

    // Scale (variance-normalise × stretchFactor)
    const q0 = p0 * sc0;
    const q1 = p1 * sc1;
    const q2 = p2 * sc2;

    // Back-project + restore mean (X_new = V · q + μ)
    const na = v00*q0 + v01*q1 + v02*q2 + m0;
    const nb = v10*q0 + v11*q1 + v12*q2 + m1;
    const nc = v20*q0 + v21*q1 + v22*q2 + m2;

    const [r, g, bv] = fromCS(na, nb, nc);
    outR[i] = r; outG[i] = g; outB[i] = bv;
  }

  // Normalization: mean ± 2.5σ across all three channels.
  // Pure min-max is dominated by single outlier pixels (specular highlights,
  // dark corners) and causes brightness pulsing on mobile auto-exposure.
  // Mean±2.5σ covers ~99 % of the output range and ignores outliers.
  let sum = 0, sum2 = 0;
  for (let i = 0; i < n; i++) {
    const r = outR[i], g = outG[i], b = outB[i];
    sum += r + g + b;
    sum2 += r*r + g*g + b*b;
  }
  const cnt  = n * 3;
  const mean = sum / cnt;
  const std  = Math.sqrt(Math.max(0, sum2 / cnt - mean * mean));
  let gMin = mean - 2.5 * std;
  let gMax = mean + 2.5 * std;

  // In live mode, smooth the normalization range with a faster EMA (α=0.25)
  // so auto-exposure changes drift in over ~4 frames instead of jumping.
  if (liveKey !== null) {
    const st = liveEMA.get(liveKey)!;
    if (st.frames > 1) {
      st.outMin = 0.25 * gMin + 0.75 * st.outMin;
      st.outMax = 0.25 * gMax + 0.75 * st.outMax;
    } else {
      st.outMin = gMin;
      st.outMax = gMax;
    }
    gMin = st.outMin;
    gMax = st.outMax;
  }

  const gRange = gMax - gMin || 1;
  for (let i = 0; i < n; i++) {
    data[i*4]   = Math.min(255, Math.max(0, Math.round((outR[i] - gMin) / gRange * 255)));
    data[i*4+1] = Math.min(255, Math.max(0, Math.round((outG[i] - gMin) / gRange * 255)));
    data[i*4+2] = Math.min(255, Math.max(0, Math.round((outB[i] - gMin) / gRange * 255)));
  }
}

// ─── Filter Dispatch ──────────────────────────────────────────────────────────

function applyDecorrelationFilter(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  filter: FilterName,
  liveKey: string | null = null,
): void {
  const lk = liveKey;
  switch (filter) {
    // YCbCr family
    case 'yre':  decorrelationStretch(data, width, height, rgbToYCbCr, yCbCrToRgb, 2.5, 100_000, lk); break;
    case 'yrd':  decorrelationStretch(data, width, height, rgbToYCbCr, yCbCrToRgb, 2.0, 100_000, lk); break;
    case 'ydt':  decorrelationStretch(data, width, height, rgbToYCbCr, yCbCrToRgb, 1.5, 100_000, lk); break;
    case 'ybk':  decorrelationStretch(data, width, height, rgbToYCbCr, yCbCrToRgb, 1.8, 100_000, lk); break;
    case 'yye':  decorrelationStretch(data, width, height, rgbToYCbCr, yCbCrToRgb, 3.5, 100_000, lk); break;
    case 'ywe':  decorrelationStretch(data, width, height, rgbToYCbCr, yCbCrToRgb, 4.0, 100_000, lk); break;
    case 'ybr':  decorrelationStretch(data, width, height, rgbToYCbCr, yCbCrToRgb, 2.2, 100_000, lk); break;
    case 'yds':  decorrelationStretch(data, width, height, rgbToYCbCr, yCbCrToRgb, 3.0, 100_000, lk); break;
    // LAB family
    case 'lre':  decorrelationStretch(data, width, height, rgbToLab, labToRgb, 2.5, 100_000, lk); break;
    case 'lrd':  decorrelationStretch(data, width, height, rgbToLab, labToRgb, 2.0, 100_000, lk); break;
    case 'lbk':  decorrelationStretch(data, width, height, rgbToLab, labToRgb, 1.8, 100_000, lk); break;
    case 'lye':  decorrelationStretch(data, width, height, rgbToLab, labToRgb, 3.5, 100_000, lk); break;
    case 'lab':  decorrelationStretch(data, width, height, rgbToLab, labToRgb, 2.2, 100_000, lk); break;
    case 'lab2': decorrelationStretch(data, width, height, rgbToLab, labToRgb, 3.5, 100_000, lk); break;
    // RGB family
    case 'drgb': decorrelationStretch(data, width, height, rgbToRgb, rgbFromRgb, 2.5, 100_000, lk); break;
    case 'crgb': decorrelationStretch(data, width, height, rgbToRgb, rgbFromRgb, 3.0, 100_000, lk); break;
    case 'rgb0': decorrelationStretch(data, width, height, rgbToRgb, rgbFromRgb, 5.0, 100_000, lk); break;
    // YUV family
    case 'yuv':  decorrelationStretch(data, width, height, rgbToYuv, yuvToRgb, 2.5, 100_000, lk); break;
    // Non-PCA tools
    case 'autolevel': applyAutoLevel(data, width * height, liveKey !== null); break;
    case 'histeq':    applyHistEq(data, width * height); break;
    case 'satboost':  applySatBoost(data, width * height, 2.0); break;

    case 'adaptive': {
      const n = width * height;
      for (let i = 0; i < n; i++) {
        const r = data[i*4], g = data[i*4+1], b = data[i*4+2];
        const greenness = g - (r + b) / 2;
        const lum = r * 0.299 + g * 0.587 + b * 0.114;
        if (greenness > 15) {
          data[i*4]   = Math.min(255, r * 1.3);
          data[i*4+1] = g * 0.4;
          data[i*4+2] = Math.min(255, b * 1.2);
        } else if (lum < 80) {
          data[i*4]   = Math.min(255, r * 1.4);
          data[i*4+1] = Math.min(255, g * 0.8);
          data[i*4+2] = b * 0.6;
        } else {
          data[i*4]   = Math.min(255, r * 1.2);
          data[i*4+1] = Math.min(255, g * 0.9);
          data[i*4+2] = Math.min(255, b * 0.8);
        }
      }
      break;
    }
  }
}

// ─── Tonal Adjustments ────────────────────────────────────────────────────────

function applyTonal(
  data: Uint8ClampedArray,
  n: number,
  brightness: number,
  contrast: number,
  saturation: number,
  shadowRecovery: number,
  highlightRecovery: number,
  dehaze: number,
): void {
  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const brightnessScale = brightness / 100;
  const satScale = saturation / 100;

  for (let i = 0; i < n; i++) {
    let r = data[i*4], g = data[i*4+1], b = data[i*4+2];
    const lum = r * 0.299 + g * 0.587 + b * 0.114;

    // Shadow recovery
    if (shadowRecovery > 0 && lum < 128) {
      const boost = (1 - lum / 128) * (shadowRecovery / 100) * 0.5;
      r = Math.min(255, r * (1 + boost));
      g = Math.min(255, g * (1 + boost));
      b = Math.min(255, b * (1 + boost));
    }
    // Highlight recovery
    if (highlightRecovery > 0 && lum > 200) {
      const red = ((lum - 200) / 55) * (highlightRecovery / 100) * 0.3;
      r = Math.max(0, r * (1 - red));
      g = Math.max(0, g * (1 - red));
      b = Math.max(0, b * (1 - red));
    }

    // Brightness (luminance-only to avoid hue shift)
    r *= brightnessScale; g *= brightnessScale; b *= brightnessScale;

    // Saturation via desaturate-blend
    if (satScale !== 1) {
      const gray = r * 0.299 + g * 0.587 + b * 0.114;
      r = gray + (r - gray) * satScale;
      g = gray + (g - gray) * satScale;
      b = gray + (b - gray) * satScale;
    }

    // Contrast
    r = contrastFactor * (r - 128) + 128;
    g = contrastFactor * (g - 128) + 128;
    b = contrastFactor * (b - 128) + 128;

    // Dehaze
    if (dehaze > 0) {
      const l2 = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
      const df = 1 + (dehaze / 100) * (1 - l2);
      r *= df; g *= df; b *= df;
    }

    data[i*4]   = Math.min(255, Math.max(0, r));
    data[i*4+1] = Math.min(255, Math.max(0, g));
    data[i*4+2] = Math.min(255, Math.max(0, b));
  }
}

// ─── Clarity (local contrast) ─────────────────────────────────────────────────

function applyClarity(data: Uint8ClampedArray, width: number, height: number, amount: number): void {
  if (amount === 0) return;
  const temp = new Uint8ClampedArray(data);
  const s = amount / 100 * 0.3;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = temp[idx + c];
        const laplacian = center * 5
          - temp[((y-1)*width+x)*4+c]
          - temp[((y+1)*width+x)*4+c]
          - temp[(y*width+x-1)*4+c]
          - temp[(y*width+x+1)*4+c];
        data[idx + c] = Math.min(255, Math.max(0, center + laplacian * s));
      }
    }
  }
}

// ─── Noise Reduction ──────────────────────────────────────────────────────────

function applyNoiseReduction(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  algorithm: 'median' | 'gaussian' | 'bilateral',
  strength: number,
): void {
  if (strength === 0 || width * height > 10_000_000) return;
  const temp = new Uint8ClampedArray(data);
  const radius = Math.max(1, Math.min(3, Math.floor(strength / 33)));
  const mix = strength / 100;

  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      const idx = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const orig = temp[idx + c];
        let filtered = orig;

        if (algorithm === 'median') {
          const vals: number[] = [];
          for (let dy = -radius; dy <= radius; dy++)
            for (let dx = -radius; dx <= radius; dx++)
              vals.push(temp[((y+dy)*width+(x+dx))*4+c]);
          vals.sort((a, b) => a - b);
          filtered = vals[vals.length >> 1];
        } else if (algorithm === 'gaussian') {
          let sum = 0, w = 0;
          for (let dy = -radius; dy <= radius; dy++)
            for (let dx = -radius; dx <= radius; dx++) {
              const wt = Math.exp(-(dx*dx+dy*dy) / (2*radius*radius));
              sum += temp[((y+dy)*width+(x+dx))*4+c] * wt;
              w += wt;
            }
          filtered = sum / w;
        } else {
          let sum = 0, w = 0;
          for (let dy = -radius; dy <= radius; dy++)
            for (let dx = -radius; dx <= radius; dx++) {
              const v = temp[((y+dy)*width+(x+dx))*4+c];
              const sw = Math.exp(-(dx*dx+dy*dy) / (2*radius*radius));
              const rw = Math.exp(-((v-orig)**2) / 5000);
              sum += v * sw * rw; w += sw * rw;
            }
          filtered = sum / w;
        }

        data[idx + c] = Math.round(orig + (filtered - orig) * mix);
      }
    }
  }
}

// ─── Sharpening ───────────────────────────────────────────────────────────────

function applySharpening(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  algorithm: 'unsharp' | 'highpass' | 'laplacian',
  strength: number,
): void {
  if (strength === 0 || width * height > 15_000_000) return;
  const temp = new Uint8ClampedArray(data);
  const amt = strength / 100;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = temp[idx + c];
        const top    = temp[((y-1)*width+x)*4+c];
        const bottom = temp[((y+1)*width+x)*4+c];
        const left   = temp[(y*width+x-1)*4+c];
        const right  = temp[(y*width+x+1)*4+c];
        let val = center;

        if (algorithm === 'unsharp') {
          val = center + (center - (top+bottom+left+right+center)/5) * amt;
        } else if (algorithm === 'highpass') {
          val = center + (center*5-top-bottom-left-right) * amt * 0.5;
        } else {
          const tl=temp[((y-1)*width+x-1)*4+c], tr=temp[((y-1)*width+x+1)*4+c];
          const bl=temp[((y+1)*width+x-1)*4+c], br=temp[((y+1)*width+x+1)*4+c];
          val = center + (center*9-top-bottom-left-right-tl-tr-bl-br) * amt * 0.2;
        }

        data[idx + c] = Math.min(255, Math.max(0, val));
      }
    }
  }
}

// ─── Auto Level ───────────────────────────────────────────────────────────────

// Separate EMA for auto-level bounds (live mode only)
interface ALState { minR:number; maxR:number; minG:number; maxG:number; minB:number; maxB:number; frames:number; }
const autoLevelEMA = { state: null as ALState | null };

function applyAutoLevel(data: Uint8ClampedArray, n: number, live = false): void {
  // Use mean±2.5σ per channel instead of absolute min/max to reject outliers.
  let sumR=0,sumR2=0,sumG=0,sumG2=0,sumB=0,sumB2=0;
  for (let i = 0; i < n; i++) {
    const r=data[i*4], g=data[i*4+1], b=data[i*4+2];
    sumR+=r; sumR2+=r*r; sumG+=g; sumG2+=g*g; sumB+=b; sumB2+=b*b;
  }
  const stdR = Math.sqrt(Math.max(0, sumR2/n - (sumR/n)**2));
  const stdG = Math.sqrt(Math.max(0, sumG2/n - (sumG/n)**2));
  const stdB = Math.sqrt(Math.max(0, sumB2/n - (sumB/n)**2));
  let minR=sumR/n-2.5*stdR, maxR=sumR/n+2.5*stdR;
  let minG=sumG/n-2.5*stdG, maxG=sumG/n+2.5*stdG;
  let minB=sumB/n-2.5*stdB, maxB=sumB/n+2.5*stdB;

  if (live) {
    const st = autoLevelEMA.state;
    if (st && st.frames > 0) {
      minR = 0.25*minR + 0.75*st.minR; maxR = 0.25*maxR + 0.75*st.maxR;
      minG = 0.25*minG + 0.75*st.minG; maxG = 0.25*maxG + 0.75*st.maxG;
      minB = 0.25*minB + 0.75*st.minB; maxB = 0.25*maxB + 0.75*st.maxB;
    }
    autoLevelEMA.state = { minR, maxR, minG, maxG, minB, maxB, frames: (st?.frames ?? 0) + 1 };
  }

  const rR=maxR-minR||1, rG=maxG-minG||1, rB=maxB-minB||1;
  for (let i = 0; i < n; i++) {
    data[i*4]   = Math.min(255, Math.max(0, Math.round((data[i*4]   - minR) / rR * 255)));
    data[i*4+1] = Math.min(255, Math.max(0, Math.round((data[i*4+1] - minG) / rG * 255)));
    data[i*4+2] = Math.min(255, Math.max(0, Math.round((data[i*4+2] - minB) / rB * 255)));
  }
}

// ─── Histogram Equalization ───────────────────────────────────────────────────

function applyHistEq(data: Uint8ClampedArray, n: number): void {
  for (let c = 0; c < 3; c++) {
    const hist = new Int32Array(256);
    for (let i = 0; i < n; i++) hist[data[i*4+c]]++;
    const cdf = new Float32Array(256);
    cdf[0] = hist[0];
    for (let v = 1; v < 256; v++) cdf[v] = cdf[v-1] + hist[v];
    const cdfMin = cdf.find(v => v > 0) ?? 0;
    const scale = 255 / (n - cdfMin || 1);
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.round((cdf[v] - cdfMin) * scale);
    for (let i = 0; i < n; i++) data[i*4+c] = lut[data[i*4+c]];
  }
}

// ─── Saturation Boost ─────────────────────────────────────────────────────────

function applySatBoost(data: Uint8ClampedArray, n: number, factor: number): void {
  for (let i = 0; i < n; i++) {
    const r = data[i*4], g = data[i*4+1], b = data[i*4+2];
    const gray = r * 0.299 + g * 0.587 + b * 0.114;
    data[i*4]   = Math.min(255, Math.max(0, gray + (r - gray) * factor));
    data[i*4+1] = Math.min(255, Math.max(0, gray + (g - gray) * factor));
    data[i*4+2] = Math.min(255, Math.max(0, gray + (b - gray) * factor));
  }
}

// ─── Color Wheels (Lift / Gamma / Gain) ──────────────────────────────────────

function wheelToRgbShift(x: number, y: number): [number, number, number] {
  const dist = Math.sqrt(x * x + y * y);
  if (dist < 0.001) return [0, 0, 0];
  const hue = ((Math.atan2(-y, x) * 180 / Math.PI) + 360) % 360;
  // Pure hue color at that angle (normalized 0-1)
  const [r, g, b] = hslToRgb(hue, 1, 0.5);
  // Center-subtracted: how far each channel deviates from neutral
  return [(r / 255 - 0.5) * dist, (g / 255 - 0.5) * dist, (b / 255 - 0.5) * dist];
}

function applyColorWheels(data: Uint8ClampedArray, n: number, wheels: ColorWheelAdjustments): void {
  const { lift, gamma, gain } = wheels;
  const allNeutral =
    lift.x  === 0 && lift.y  === 0 && lift.luma  === 0 &&
    gamma.x === 0 && gamma.y === 0 && gamma.luma === 0 &&
    gain.x  === 0 && gain.y  === 0 && gain.luma  === 0;
  if (allNeutral) return;

  const [lr, lg, lb] = wheelToRgbShift(lift.x,  lift.y);
  const [mr, mg, mb] = wheelToRgbShift(gamma.x, gamma.y);
  const [hr, hg, hb] = wheelToRgbShift(gain.x,  gain.y);

  // Scale: full wheel deflection (dist=1) maps to ~60 RGB units max shift
  const COLOR_SCALE = 120;
  // Luma scale: ±100 maps to ±0.25 in normalised space
  const LUMA_SCALE = 0.0025;

  const lL = lift.luma  * LUMA_SCALE;
  const mL = gamma.luma * LUMA_SCALE;
  const hL = gain.luma  * LUMA_SCALE;

  for (let i = 0; i < n; i++) {
    const rn = data[i*4]   / 255;
    const gn = data[i*4+1] / 255;
    const bn = data[i*4+2] / 255;

    const luma = 0.2126 * rn + 0.7152 * gn + 0.0722 * bn;

    // Tonal weights: smooth bell curves that overlap for natural blending
    const wL = Math.pow(1 - luma, 2);
    const wM = Math.sin(Math.PI * luma);
    const wH = Math.pow(luma, 2);

    const dr = (lr * wL + mr * wM + hr * wH) * COLOR_SCALE + (lL * wL + mL * wM + hL * wH) * 255;
    const dg = (lg * wL + mg * wM + hg * wH) * COLOR_SCALE + (lL * wL + mL * wM + hL * wH) * 255;
    const db = (lb * wL + mb * wM + hb * wH) * COLOR_SCALE + (lL * wL + mL * wM + hL * wH) * 255;

    data[i*4]   = Math.min(255, Math.max(0, data[i*4]   + dr));
    data[i*4+1] = Math.min(255, Math.max(0, data[i*4+1] + dg));
    data[i*4+2] = Math.min(255, Math.max(0, data[i*4+2] + db));
  }
}

// ─── Targeted HSL ────────────────────────────────────────────────────────────

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0)
        : max === g ? (b - r) / d + 2
        :             (r - g) / d + 4;
  return [h * 60, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1/6) return p + (q - p) * 6 * t;
  if (t < 1/2) return q;
  if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) { const v = l * 255; return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hn = h / 360;
  return [hue2rgb(p, q, hn + 1/3) * 255, hue2rgb(p, q, hn) * 255, hue2rgb(p, q, hn - 1/3) * 255];
}

function bandWeight(pixelHue: number, center: number, halfWidth: number): number {
  let d = Math.abs(pixelHue - center) % 360;
  if (d > 180) d = 360 - d;
  if (d >= halfWidth) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * d / halfWidth));
}

function applyHSLAdjustments(data: Uint8ClampedArray, n: number, adj: HslAdjustments): void {
  const bands = Object.keys(adj) as HslBandKey[];
  if (bands.every(k => adj[k].hue === 0 && adj[k].saturation === 0 && adj[k].lightness === 0)) return;

  for (let i = 0; i < n; i++) {
    const [h, s, l] = rgbToHsl(data[i*4], data[i*4+1], data[i*4+2]);
    let dH = 0, dS = 0, dL = 0;
    for (const key of bands) {
      const a = adj[key];
      if (a.hue === 0 && a.saturation === 0 && a.lightness === 0) continue;
      const w = bandWeight(h, a.center, a.halfWidth);
      if (w === 0) continue;
      dH += w * a.hue;
      dS += w * (a.saturation / 100);
      dL += w * (a.lightness / 100);
    }
    const nh = ((h + dH) % 360 + 360) % 360;
    const ns = Math.min(1, Math.max(0, s + dS));
    const nl = Math.min(1, Math.max(0, l + dL));
    const [nr, ng, nb] = hslToRgb(nh, ns, nl);
    data[i*4]   = Math.min(255, Math.max(0, nr));
    data[i*4+1] = Math.min(255, Math.max(0, ng));
    data[i*4+2] = Math.min(255, Math.max(0, nb));
  }
}

// ─── Worker Entry Point ───────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent) => {
  const { pixels, width, height, options, live } = e.data as {
    pixels: ArrayBuffer;
    width: number;
    height: number;
    options: ProcessOptions;
    live?: boolean;
  };

  const data = new Uint8ClampedArray(pixels);
  const n = width * height;

  const {
    filter, brightness, contrast, saturation,
    shadowRecovery, highlightRecovery, clarity, dehaze,
    noiseReduction, noiseAlgorithm, sharpening, sharpenAlgorithm,
    hslAdjustments,
    colorWheels,
  } = options;

  // liveKey enables EMA + sign stabilization for that filter.
  // Static image processing passes null → fresh PCA every time.
  const liveKey = live ? filter : null;

  if (filter !== 'none') {
    applyDecorrelationFilter(data, width, height, filter, liveKey);
  }

  applyTonal(data, n, brightness, contrast, saturation, shadowRecovery, highlightRecovery, dehaze);
  if (colorWheels) applyColorWheels(data, n, colorWheels);
  if (hslAdjustments) applyHSLAdjustments(data, n, hslAdjustments);

  if (clarity > 0) applyClarity(data, width, height, clarity);
  if (noiseReduction > 0) applyNoiseReduction(data, width, height, noiseAlgorithm, noiseReduction);
  if (sharpening > 0) applySharpening(data, width, height, sharpenAlgorithm, sharpening);

  (self as unknown as Worker).postMessage({ pixels: data.buffer, width, height }, [data.buffer]);
};
