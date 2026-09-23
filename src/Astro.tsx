import { useState, useRef, useEffect, useMemo } from 'react';
import { Upload, Download, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StudioShell, InfoBar, EmptyState } from '@/components/studio/StudioShell';
import { StudioHeader } from '@/components/studio/StudioHeader';
import { Slider } from '@/components/Slider';
import { CollapsiblePanel } from '@/components/CollapsiblePanel';
import { ChipGroup } from '@/components/ChipGroup';
import { parseFits } from './lib/fits';
import { decodeTiffPlanes } from './lib/tiff';
import { decodeToImage, isSupportedImage, IMAGE_ACCEPT } from './lib/decode';
import { UploadDrop } from '@/components/UploadDrop';
import { LoadingOverlay } from '@/components/LoadingOverlay';
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

const FITS_EXT = /\.(fits?|fts)$/i;
const ASTRO_ACCEPT = `.fits,.fit,.fts,${IMAGE_ACCEPT}`;
const isAstroFile = (f: File) => FITS_EXT.test(f.name) || isSupportedImage(f);

async function decodeFile(file: File, onStatus: (m: string) => void): Promise<FloatImage> {
  if (FITS_EXT.test(file.name)) {
    onStatus('Reading FITS…');
    const f = parseFits(await file.arrayBuffer());
    return { ...f, name: file.name };
  }
  if (/\.tiff?$/i.test(file.name)) {
    onStatus('Reading TIFF…');
    const t = decodeTiffPlanes(await file.arrayBuffer());
    return { width: t.width, height: t.height, channels: t.channels, name: file.name };
  }
  const img = await decodeToImage(file, onStatus);
  const cvs = document.createElement('canvas');
  cvs.width = img.naturalWidth; cvs.height = img.naturalHeight;
  const ctx = cvs.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, cvs.width, cvs.height);
  const n = cvs.width * cvs.height;
  const channels = [0, 1, 2].map(c => {
    const p = new Float32Array(n);
    for (let i = 0; i < n; i++) p[i] = data[i * 4 + c];
    return p;
  });
  return { width: cvs.width, height: cvs.height, channels, name: file.name };
}

export default function Astro({ onBack, onMode }: { onBack: () => void; onMode: () => void }) {
  const [image, setImage]     = useState<FloatImage | null>(null);
  const [kind, setKind]       = useState<StretchKind>('mtf');
  const [amount, setAmount]   = useState(30);
  const [target, setTarget]   = useState(25);
  const [shadowClip, setShadowClip] = useState(28);
  const [busy, setBusy]       = useState('');
  const [tools, setTools]     = useState<LinearTool[]>([]);
  const [linked, setLinked]   = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
    setBusy('Loading…');
    try { setImage(await decodeFile(file, setBusy)); }
    catch (e) { alert(`Could not read ${file.name}: ${(e as Error).message}`); }
    finally { setBusy(''); }
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

  const header = (
    <StudioHeader
      mode="astro" onMode={m => m === 'rockart' && onMode()} onBack={onBack}
      sidebarOpen={sidebarOpen} onSidebarToggle={() => setSidebarOpen(o => !o)}
      actions={<>
        {image && <Button variant="outline" onClick={reset} aria-label="Reset stretch"><RotateCcw size={14}/><span className="hidden lg:inline">Reset</span></Button>}
        <Button variant="primary" onClick={download} disabled={!image}><Download size={14}/><span className="hidden sm:inline">Download</span></Button>
      </>}
    />
  );

  const sidebar = (
    <>
      <UploadDrop accept={ASTRO_ACCEPT} isSupported={isAstroFile} onFile={load} label="Upload or Drop FITS / Image"/>

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
          <p className="text-[11px] text-muted-foreground leading-snug">{KINDS.find(k => k.key === kind)?.desc}</p>
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
          <div className="space-y-1 text-[11px] text-muted-foreground tabular-nums">
            {stats.map((st, i) => (
              <div key={i}>ch{i}: median {fmt(st.median)}, MAD {fmt(st.mad)}, range {fmt(st.min)}–{fmt(st.max)}</div>
            ))}
          </div>
        </CollapsiblePanel>
      )}
    </>
  );

  return (
    <StudioShell header={header} sidebar={sidebar} sidebarOpen={sidebarOpen} onSidebarClose={() => setSidebarOpen(false)}
      overlay={busy && <LoadingOverlay message={busy}/>}>
      {processed && (
        <InfoBar left={`${processed.width} × ${processed.height} px · ${processed.channels.length === 1 ? 'mono' : `${processed.channels.length} ch`}`}
          right={<span className="text-foreground font-medium">{KINDS.find(k => k.key === kind)?.label}</span>}/>
      )}
      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
        {image
          ? <canvas ref={canvasRef} className="max-w-full max-h-full object-contain border border-border shadow-2xl" />
          : <EmptyState icon={<Upload size={64}/>} title="Open a FITS frame or a photo to begin" hint="Linear data in, honest stretch out. Nothing is reconstructed."/>}
      </div>
    </StudioShell>
  );
}

const fmt = (v: number) => Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(2);
