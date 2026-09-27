// Reads what the frame says about itself (header and statistics) and turns that into a stretch
// choice plus short notes. Rules only, no models. Each note may carry a settings patch.
import type { Stats, StretchKind } from './stretch';

export interface AstroSettings { kind: StretchKind; target: number; shadowClip: number; amount: number; tools: string[]; }
export interface Advice { id: string; text: string; apply?: Partial<AstroSettings>; }

export function advise(header: Record<string, string> | undefined, stats: Stats[]): Advice[] {
  const h = header ?? {}, out: Advice[] = [];
  const n = (k: string) => { const v = Number(h[k]); return Number.isFinite(v) ? v : undefined; };
  const st = stats[0];
  const sigma = 1.4826 * st.mad || 1;
  const dynamic = (st.max - st.median) / sigma;      // how far the brightest pixel sits above the sky
  const skyOverNoise = st.median / sigma;             // bright sky (Moon, light pollution) vs read noise
  const frames = n('STACKCNT') ?? n('NCOMBINE') ?? 1;
  const air = n('AIRMASS'), temp = n('CCD-TEMP'), exp = n('EXPTIME');

  if (dynamic > 1000) out.push({ id: 'stars', text: 'Point sources dominate: asinh keeps the brightest pixels from clipping while lifting the faint ones.', apply: { kind: 'asinh', amount: 80 } });
  else if (dynamic > 300) out.push({ id: 'mixed', text: 'Stars over faint structure: Auto STF, normal preset.', apply: { kind: 'mtf', target: 25, shadowClip: 28 } });
  else out.push({ id: 'faint', text: 'Low dynamic range: hard Auto STF to pull signal out of the noise.', apply: { kind: 'mtf', target: 40, shadowClip: 15 } });

  if (skyOverNoise > 15) out.push({ id: 'sky', text: `Sky is ${skyOverNoise.toFixed(0)}× the noise: moonlight or light pollution. Background subtraction flattens it.`, apply: { tools: ['background'] } });
  if (frames <= 1) out.push({ id: 'single', text: 'Single frame. Hot-pixel removal is safe here; stacking more frames is the real fix for noise.', apply: { tools: ['hot'] } });
  else out.push({ id: 'stack', text: `Stack of ${frames} frames${exp ? `, ${fmtTime(exp * frames)} total` : ''}. Rejection already removed hot pixels.` });
  if (air !== undefined && air > 2) out.push({ id: 'airmass', text: `Airmass ${air.toFixed(1)}: taken low in the sky. Expect soft stars and colour fringing; blue suffers most.` });
  if (temp !== undefined && temp > -10) out.push({ id: 'warm', text: `Sensor at ${temp.toFixed(0)} °C. Dark current and hot pixels are high; calibrate or remove hot pixels.` });
  if (stats.length >= 3) out.push({ id: 'colour', text: 'Colour data: linked stretch keeps the sky colour honest; unlinked auto-balances it.' });
  return out;
}

// Merge every patch into one settings object. Tools accumulate, scalars take the last value.
export function autoSettings(base: AstroSettings, advice: Advice[]): AstroSettings {
  const tools = new Set(base.tools);
  let out = { ...base };
  for (const a of advice) {
    if (!a.apply) continue;
    const { tools: t, ...rest } = a.apply;
    t?.forEach(x => tools.add(x));
    out = { ...out, ...rest };
  }
  return { ...out, tools: [...tools] };
}

const fmtTime = (s: number) => s >= 3600 ? `${(s / 3600).toFixed(1)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`;
