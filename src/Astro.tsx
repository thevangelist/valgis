import { useState, useRef, useEffect, useMemo } from 'react';
import { Upload, Download, ChevronLeft, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { StudioModeSwitch } from '@/components/StudioModeSwitch';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { parseFits } from './lib/fits';
import { channelStats, autoStf, applyStretch } from './lib/stretch';
import { bin2x2, subtractBackground, neutralizeBackground, scnr } from './lib/astroTools';
import type { StretchKind, StfParams } from './lib/stretch';

interface FloatImage { width: number; height: number; channels: Float32Array[]; name: string; }

const KINDS: { key: StretchKind; label: string; desc: string }[] = [
  { key: 'linear', label: 'Linear', desc: 'Clip only. What the sensor recorded.' },
  { key: 'mtf',    label: 'Auto STF', desc: 'Median and MAD based screen transfer. Same as a PixInsight auto-stretch.' },
  { key: 'asinh',  label: 'Asinh',  desc: 'Lifts faint nebulosity without blowing out stars.' },
  { key: 'log',    label: 'Log',    desc: 'Stronger lift for very faint targets.' },
];

async function decodeFile(file: File): Promise<FloatImage> {
  if (/\.fits?$/i.test(file.name)) {
    const f = parseFits(await file.arrayBuffer());
    return { ...f, name: file.name };
  }
  const bmp = await createImageBitmap(file);
  const cvs = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = cvs.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const n = bmp.width * bmp.height;
  const channels = [0, 1, 2].map(c => {
    const p = new Float32Array(n);
    for (let i = 0; i < n; i++) p[i] = data[i * 4 + c];
    return p;
  });
  return { width: bmp.width, height: bmp.height, channels, name: file.name };
}

export default function Astro({ onBack, onMode }: { onBack: () => void; onMode: () => void }) {
  const [image, setImage]     = useState<FloatImage | null>(null);
  const [kind, setKind]       = useState<StretchKind>('mtf');
  const [amount, setAmount]   = useState(30);
  const [target, setTarget]   = useState(25);
  const [shadowClip, setShadowClip] = useState(28);
  const [busy, setBusy]       = useState(false);
  const [bin, setBin]         = useState(false);
  const [background, setBackground] = useState(false);
  const [neutralize, setNeutralize] = useState(false);
  const [green, setGreen]     = useState(false);
  const [linked, setLinked]   = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Linear-domain pipeline. Each step is optional and deterministic.
  const processed = useMemo<FloatImage | null>(() => {
    if (!image) return null;
    let { width, height, channels } = image;
    if (bin) ({ planes: channels, width, height } = bin2x2(channels, width, height));
    if (background) channels = channels.map(c => subtractBackground(c, width, height));
    if (neutralize) channels = neutralizeBackground(channels);
    if (green) channels = scnr(channels);
    return { ...image, width, height, channels };
  }, [image, bin, background, neutralize, green]);

  const stats = useMemo(() => processed?.channels.map(c => channelStats(c)) ?? null, [processed]);

  const stf: StfParams[] | null = useMemo(() => {
    if (!stats) return null;
    const per = stats.map(st => autoStf(st, target / 100, -shadowClip / 10));
    if (!linked || per.length === 1) return per;
    // Linked: one transfer for every channel, from the mean of the per-channel parameters.
    const avg = (k: keyof StfParams) => per.reduce((a, p) => a + p[k], 0) / per.length;
    const one = { shadow: avg('shadow'), highlight: avg('highlight'), midtone: avg('midtone') };
    return per.map(() => one);
  }, [stats, target, shadowClip, linked]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!processed || !stf || !canvas) return;
    const image = processed;
    const { width, height, channels } = image;
    canvas.width = width; canvas.height = height;
    const out = new Uint8ClampedArray(width * height * 4);
    const mono = channels.length === 1;
    for (let c = 0; c < 3; c++) {
      const src = mono ? channels[0] : channels[Math.min(c, channels.length - 1)];
      const p = mono ? stf[0] : stf[Math.min(c, stf.length - 1)];
      applyStretch(src, out, 4, c, { kind, stf: p, amount });
    }
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    canvas.getContext('2d')!.putImageData(new ImageData(out, width, height), 0, 0);
  }, [processed, stf, kind, amount]);

  const load = async (file: File) => {
    setBusy(true);
    try { setImage(await decodeFile(file)); }
    catch (e) { alert(`Could not read ${file.name}: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const download = () => {
    const c = canvasRef.current;
    if (!c || !image) return;
    const a = document.createElement('a');
    a.download = `valgis-astro-${kind}-${image.name.replace(/\.[^.]+$/, '')}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
  };

  const reset = () => { setKind('mtf'); setAmount(30); setTarget(25); setShadowClip(28); setBin(false); setBackground(false); setNeutralize(false); setGreen(false); setLinked(true); };

  return (
    <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
      <header className="bg-black border-b border-zinc-800 px-3 md:px-6 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 md:gap-4">
          <button onClick={onBack} className="flex items-center rounded-md" aria-label="Back to home">
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Valgis" className="h-7 md:h-8" />
          </button>
          <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft size={16} /><span className="hidden md:inline">Home</span></Button>
          <StudioModeSwitch mode="astro" onChange={m => m === 'rockart' && onMode()} />
        </div>
        <div className="flex gap-2">
          {image && <Button variant="outline" onClick={reset} aria-label="Reset stretch"><RotateCcw size={14}/><span className="hidden lg:inline">Reset</span></Button>}
          <Button variant="primary" onClick={download} disabled={!image}><Download size={14}/><span className="hidden sm:inline">Download</span></Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-80 bg-zinc-900 border-r border-zinc-800 overflow-y-auto p-3 space-y-3">
          <label className={`flex flex-col items-center justify-center w-full px-3 py-4 bg-zinc-800 rounded-lg border-2 border-dashed border-zinc-700 hover:border-primary cursor-pointer transition ${busy ? 'opacity-50' : ''}`}>
            <Upload size={20} className="mb-1.5"/>
            <span className="text-[11px]">{busy ? 'Reading…' : 'Open FITS, TIFF, PNG or JPEG'}</span>
            <input type="file" accept=".fits,.fit,.fts,image/*" className="hidden" onChange={e => e.target.files?.[0] && load(e.target.files[0])}/>
          </label>

          <section className="bg-zinc-900 rounded-lg border border-zinc-700/60 p-3 space-y-2">
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Linear</h2>
            <Check label="2×2 bin" hint="Sum neighbours. SNR ×2, resolution ÷2." checked={bin} onChange={setBin}/>
            <Check label="Background extraction" hint="Fit a surface to the sky and subtract it. Removes vignetting and gradients." checked={background} onChange={setBackground}/>
            {(image?.channels.length ?? 0) >= 3 && <>
              <Check label="Neutralize background" hint="Match channel medians. Removes sky colour cast." checked={neutralize} onChange={setNeutralize}/>
              <Check label="SCNR green" hint="Green never exceeds the red/blue mean." checked={green} onChange={setGreen}/>
            </>}
          </section>

          <section className="bg-zinc-900 rounded-lg border border-zinc-700/60 p-3 space-y-2.5">
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Stretch</h2>
            <ToggleGroup value={[kind]} onValueChange={v => v.length && setKind(v[v.length - 1] as StretchKind)} className="flex flex-wrap gap-1">
              {KINDS.map(k => (
                <ToggleGroupItem key={k.key} value={k.key} title={k.desc}
                  className="h-6 px-2 text-xs font-medium rounded-md border border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white aria-pressed:bg-zinc-600 aria-pressed:border-zinc-500 aria-pressed:text-white transition-colors">
                  {k.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-[11px] text-zinc-400 leading-snug">{KINDS.find(k => k.key === kind)?.desc}</p>

            {(image?.channels.length ?? 0) >= 3 && (
              <Check label="Linked channels" hint="One transfer for all channels keeps colour. Unlinked auto-balances." checked={linked} onChange={setLinked}/>
            )}
            <Row label="Target brightness" value={`${target} %`}>
              <Slider min={5} max={60} value={[target]} onValueChange={([v]) => setTarget(v)} aria-label="Target brightness"/>
            </Row>
            <Row label="Shadow clip" value={`${(shadowClip / 10).toFixed(1)} σ`}>
              <Slider min={0} max={50} value={[shadowClip]} onValueChange={([v]) => setShadowClip(v)} aria-label="Shadow clip"/>
            </Row>
            {(kind === 'asinh' || kind === 'log') && (
              <Row label="Strength" value={String(amount)}>
                <Slider min={1} max={500} value={[amount]} onValueChange={([v]) => setAmount(v)} aria-label="Stretch strength"/>
              </Row>
            )}
          </section>

          {image && stats && (
            <section className="bg-zinc-900 rounded-lg border border-zinc-700/60 p-3 space-y-1 text-[11px] text-zinc-400 tabular-nums">
              <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">Image</h2>
              <div>{image.width} × {image.height} px, {image.channels.length === 1 ? 'mono' : `${image.channels.length} ch`}</div>
              {stats.map((st, i) => (
                <div key={i}>ch{i}: median {fmt(st.median)}, MAD {fmt(st.mad)}, range {fmt(st.min)}–{fmt(st.max)}</div>
              ))}
            </section>
          )}
        </aside>

        <main className="flex-1 flex items-center justify-center p-4 overflow-hidden bg-black">
          {image
            ? <canvas ref={canvasRef} className="max-w-full max-h-full object-contain border border-zinc-800" />
            : <div className="text-center text-zinc-400">
                <Upload size={64} className="mx-auto mb-4 opacity-30"/>
                <p className="text-lg mb-2">Open a FITS frame to begin</p>
                <p className="text-sm">Linear data in, honest stretch out. Nothing is reconstructed.</p>
              </div>}
        </main>
      </div>
    </div>
  );
}

function Check({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer" title={hint}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-0.5 accent-cyan-400"/>
      <span className="text-xs text-zinc-300 leading-snug">{label}<span className="block text-[10px] text-zinc-400">{hint}</span></span>
    </label>
  );
}

function Row({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <div>
      <div className="flex justify-between mb-1.5">
        <span className="text-xs font-medium text-zinc-300">{label}</span>
        <span className="text-xs text-zinc-400 tabular-nums">{value}</span>
      </div>
      {children}
    </div>
  );
}

const fmt = (v: number) => Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(2);
