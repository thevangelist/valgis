import { useState, useRef, useEffect, useMemo } from 'react';
import { Upload, Download, ChevronLeft, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StudioModeSwitch } from '@/components/StudioModeSwitch';
import { Slider } from '@/components/Slider';
import { CollapsiblePanel } from '@/components/CollapsiblePanel';
import { ChipGroup } from '@/components/ChipGroup';
import { parseFits } from './lib/fits';
import { channelStats, autoStf, applyStretch } from './lib/stretch';
import { bin2x2, subtractBackground, neutralizeBackground, scnr } from './lib/astroTools';
import type { StretchKind, StfParams } from './lib/stretch';

type LinearTool = 'bin' | 'background' | 'neutralize' | 'scnr';

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
  const [tools, setTools]     = useState<LinearTool[]>([]);
  const [linked, setLinked]   = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Linear-domain pipeline. Each step is optional and deterministic.
  const processed = useMemo<FloatImage | null>(() => {
    if (!image) return null;
    let { width, height, channels } = image;
    const on = (t: LinearTool) => tools.includes(t);
    if (on('bin')) ({ planes: channels, width, height } = bin2x2(channels, width, height));
    if (on('background')) channels = channels.map(c => subtractBackground(c, width, height));
    if (on('neutralize')) channels = neutralizeBackground(channels);
    if (on('scnr')) channels = scnr(channels);
    return { ...image, width, height, channels };
  }, [image, tools]);

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

  const reset = () => { setKind('mtf'); setAmount(30); setTarget(25); setShadowClip(28); setTools([]); setLinked(true); };

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

          <CollapsiblePanel id="astro-linear" title="Linear">
            <ChipGroup<LinearTool> multiple
              chips={[
                { key: 'bin' as const, label: '2×2 bin', title: 'Sum neighbours. SNR ×2, resolution ÷2.' },
                { key: 'background' as const, label: 'Background', title: 'Fit a surface to the sky and subtract it. Removes vignetting and gradients.' },
                ...((image?.channels.length ?? 0) >= 3 ? [
                  { key: 'neutralize' as const, label: 'Neutralize', title: 'Match channel medians. Removes sky colour cast.' },
                  { key: 'scnr' as const, label: 'SCNR', title: 'Green never exceeds the red/blue mean.' },
                ] : []),
              ]}
              value={tools} onChange={(v: LinearTool[]) => setTools(v)}
            />
          </CollapsiblePanel>

          <CollapsiblePanel id="astro-stretch" title="Stretch">
            <div className="space-y-2.5">
              <ChipGroup chips={KINDS.map(k => ({ key: k.key, label: k.label, title: k.desc }))} value={kind} onChange={setKind} />
              <p className="text-[11px] text-zinc-400 leading-snug">{KINDS.find(k => k.key === kind)?.desc}</p>
              {(image?.channels.length ?? 0) >= 3 && (
                <ChipGroup chips={[{ key: 'linked', label: 'Linked', title: 'One transfer for all channels keeps colour.' }, { key: 'unlinked', label: 'Unlinked', title: 'Per-channel transfer. Auto colour balance.' }]}
                  value={linked ? 'linked' : 'unlinked'} onChange={v => setLinked(v === 'linked')} />
              )}
              <Slider label="Target brightness" value={target} min={5} max={60} defaultVal={25} onChange={setTarget} title="Where the median lands, in percent of white."/>
              <Slider label="Shadow clip (×0.1 σ)" value={shadowClip} min={0} max={50} defaultVal={28} onChange={setShadowClip} title="Black point below the median, in tenths of a sigma."/>
              {(kind === 'asinh' || kind === 'log') && (
                <Slider label="Strength" value={amount} min={1} max={500} defaultVal={30} onChange={setAmount}/>
              )}
            </div>
          </CollapsiblePanel>

          {image && stats && (
            <CollapsiblePanel id="astro-info" title="Image" defaultOpen={false}>
              <div className="space-y-1 text-[11px] text-zinc-400 tabular-nums">
                <div>{image.width} × {image.height} px, {image.channels.length === 1 ? 'mono' : `${image.channels.length} ch`}</div>
                {stats.map((st, i) => (
                  <div key={i}>ch{i}: median {fmt(st.median)}, MAD {fmt(st.mad)}, range {fmt(st.min)}–{fmt(st.max)}</div>
                ))}
              </div>
            </CollapsiblePanel>
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

const fmt = (v: number) => Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(2);
