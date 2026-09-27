// Combine separately filtered frames into one colour image, in the linear domain.
// Missing G is the mean of R and B (fine for near-monochrome targets). L, when present, replaces the
// brightness of the colour: each channel is scaled by L / mean(R,G,B) per pixel, colour ratios kept.

export type Role = 'L' | 'R' | 'G' | 'B' | 'mono';
export interface Frame { name: string; role: Role; width: number; height: number; channels: Float32Array[]; header?: Record<string, string>; }

// Guess the role from a FITS FILTER card. Johnson V is the green channel.
export function roleFromHeader(h?: Record<string, string>): Role {
  const f = (h?.FILTER ?? '').trim().toUpperCase();
  if (f === 'L' || f === 'LUM' || f === 'LUMINANCE' || f === 'CLEAR') return 'L';
  if (f === 'R' || f === 'RED') return 'R';
  if (f === 'G' || f === 'V' || f === 'GREEN') return 'G';
  if (f === 'B' || f === 'BLUE') return 'B';
  return 'mono';
}

export function compose(frames: Frame[]): { width: number; height: number; channels: Float32Array[]; header?: Record<string, string> } {
  if (frames.length === 0) throw new Error('no frames');
  const { width, height } = frames[0];
  if (frames.some(f => f.width !== width || f.height !== height)) throw new Error('frames differ in size; crop or bin them to match first');
  const pick = (r: Role) => frames.find(f => f.role === r)?.channels[0];
  const L = pick('L'), R = pick('R'), B = pick('B');
  let G = pick('G');
  if (frames.length === 1) return frames[0];
  if (!R && !B && !G) return { width, height, channels: [L ?? frames[0].channels[0]], header: frames[0].header };
  if (!R || !B) throw new Error('colour needs at least R and B');
  const n = width * height;
  if (!G) { G = new Float32Array(n); for (let i = 0; i < n; i++) G[i] = 0.5 * (R[i] + B[i]); }
  const out = [R, G, B].map(c => new Float32Array(c));
  if (L) {
    for (let i = 0; i < n; i++) {
      const lum = (R[i] + G[i] + B[i]) / 3;
      const k = lum > 0 ? L[i] / lum : 0;
      out[0][i] = R[i] * k; out[1][i] = G[i] * k; out[2][i] = B[i] * k;
    }
  }
  const header = { ...(frames.find(f => f.role === 'L') ?? frames[0]).header, FILTER: frames.map(f => f.role).join('+') };
  return { width, height, channels: out, header };
}
