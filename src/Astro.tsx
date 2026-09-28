import { useState, useRef, useEffect, useMemo, Fragment } from 'react';
import { Upload, Download, RotateCcw, Crop, Wand2, Save, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StudioShell, InfoBar, EmptyState } from '@/components/studio/StudioShell';
import { StudioHeader } from '@/components/studio/StudioHeader';
import { Slider } from '@/components/Slider';
import { useWorkerClient } from './hooks/useWorkerClient';
import { isSuperseded } from './lib/workerClient';
import { useAdjustments, adjustmentsToOptions } from './hooks/useAdjustments';
import { TonePanel, EnhancementPanel, DetailPanel } from '@/components/panels/AdjustmentPanels';
import { CollapsiblePanel } from '@/components/CollapsiblePanel';
import { ChipGroup } from '@/components/ChipGroup';
import { parseFits } from './lib/fits';
import { decodeTiffPlanes } from './lib/tiff';
import { decodeToImage, isSupportedImage, IMAGE_ACCEPT } from './lib/decode';
import { UploadDrop } from '@/components/UploadDrop';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { channelStats, autoStf, applyStretch, NEUTRAL_LEVELS } from './lib/stretch';
import type { Levels } from './lib/stretch';
import { SectionRule } from '@/components/panels/AdjustmentPanels';
import { wcsFromHeader, pixelToSky, plateScale, formatRa, formatDec } from './lib/wcs';
import { measureSource } from './lib/photometry';
import { advise, autoSettings } from './lib/advice';
import { compose, roleFromHeader } from './lib/compose';
import type { Frame, Role } from './lib/compose';
import { writeFits } from './lib/fitsWrite';
import { histogram } from './lib/histogram';
import type { Measurement } from './lib/photometry';
import { binN, removeRowNoise, fixBadColumns, removeHotPixels, subtractBackground, neutralizeBackground, scnr } from './lib/astroTools';
import type { StretchKind, StfParams } from './lib/stretch';

type LinearTool = 'bin2' | 'bin4' | 'rows' | 'columns' | 'hot' | 'background' | 'neutralize' | 'scnr';

interface FloatImage { width: number; height: number; channels: Float32Array[]; name: string; header?: Record<string, string>; }
interface Rect { x: number; y: number; w: number; h: number; }

// Header cards worth showing as-is. Siril adds STACKCNT and LIVETIME to a stack, ACP adds CALSTAT.
const HEADER_KEYS = ['OBJECT', 'DATE-OBS', 'EXPTIME', 'LIVETIME', 'STACKCNT', 'FILTER', 'XBINNING', 'CCD-TEMP', 'AIRMASS', 'FOCALLEN', 'INSTRUME', 'CALSTAT', 'PLTSOLVD', 'PROGRAM'];

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
  const [frames, setFrames]   = useState<Frame[]>([]);
  // One frame shows as-is; several combine into LRGB in the linear domain. On a bad set the first
  // frame stays visible and the panel shows why.
  const { image, composeError } = useMemo<{ image: FloatImage | null; composeError: string }>(() => {
    if (frames.length === 0) return { image: null, composeError: '' };
    try { return { image: { ...compose(frames), name: frames.map(f => f.name).join('+') }, composeError: '' }; }
    catch (e) { return { image: { ...frames[0] }, composeError: (e as Error).message }; }
  }, [frames]);
  const [kind, setKind]       = useState<StretchKind>('mtf');
  const [amount, setAmount]   = useState(30);
  const [target, setTarget]   = useState(25);
  const [shadowClip, setShadowClip] = useState(28);
  const [busy, setBusy]       = useState('');
  const [tools, setTools]     = useState<LinearTool[]>([]);
  const [linked, setLinked]   = useState(true);
  const [levels, setLevels]   = useState<Levels>(NEUTRAL_LEVELS);
  const setLevel = (k: keyof Levels, v: number) => setLevels(l => ({ ...l, [k]: v }));
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [crop, setCrop]       = useState<Rect | null>(null);
  const [cropping, setCropping] = useState(false);
  const [measure, setMeasure] = useState<Measurement | null>(null);
  const [autoApplied, setAutoApplied] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const { adj, set: setAdj, reset: resetAdj, resetGroup, defaults: adjDefaults } = useAdjustments({ preNormalize: 0, postNormalize: 0 });
  const client = useWorkerClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Linear-domain pipeline. Each step is optional and deterministic.
  const processed = useMemo<FloatImage | null>(() => {
    if (!image) return null;
    let { width, height, channels } = image;
    if (crop) {
      const { x, y, w, h } = crop;
      channels = channels.map(c => { const o = new Float32Array(w * h); for (let r = 0; r < h; r++) o.set(c.subarray((y + r) * width + x, (y + r) * width + x + w), r * w); return o; });
      width = w; height = h;
    }
    const on = (t: LinearTool) => tools.includes(t);
    if (on('bin4')) ({ planes: channels, width, height } = binN(channels, width, height, 4));
    else if (on('bin2')) ({ planes: channels, width, height } = binN(channels, width, height, 2));
    if (on('hot')) channels = channels.map(c => removeHotPixels(c, width, height).plane);
    if (on('columns')) channels = channels.map(c => fixBadColumns(c, width, height).plane);
    if (on('rows')) channels = channels.map(c => removeRowNoise(c, width, height));
    if (on('background')) channels = channels.map(c => subtractBackground(c, width, height));
    if (on('neutralize')) channels = neutralizeBackground(channels);
    if (on('scnr')) channels = scnr(channels);
    return { ...image, width, height, channels };
  }, [image, tools, crop]);

  const stats = useMemo(() => processed?.channels.map(c => channelStats(c)) ?? null, [processed]);
  const advice = useMemo(() => image ? advise(image.header, image.channels.map(c => channelStats(c))) : [], [image]);
  const applyAuto = (ids?: string[]) => {
    const picked = ids ? advice.filter(a => ids.includes(a.id)) : advice;
    const s = autoSettings({ kind, target, shadowClip, amount, tools }, picked);
    setKind(s.kind); setTarget(s.target); setShadowClip(s.shadowClip); setAmount(s.amount); setTools(s.tools as LinearTool[]);
    setAutoApplied(a => [...new Set([...a, ...picked.filter(p => p.apply).map(p => p.id)])]);
  };

  const stf: StfParams[] | null = useMemo(() => {
    if (!stats) return null;
    const per = stats.map(st => autoStf(st, target / 100, -shadowClip / 10));
    if (!linked || per.length === 1) return per;
    // Linked: one transfer for every channel, from the mean of the per-channel parameters.
    const avg = (k: keyof StfParams) => per.reduce((a, p) => a + p[k], 0) / per.length;
    const one = { shadow: avg('shadow'), highlight: avg('highlight'), midtone: avg('midtone') };
    return per.map(() => one);
  }, [stats, target, shadowClip, linked]);

  // Stretched 8-bit frame, then the shared tonal / enhancement / detail chain in the worker.
  const stretched = useMemo(() => {
    if (!processed || !stf) return null;
    const { width, height, channels } = processed;
    const out = new Uint8ClampedArray(width * height * 4);
    const mono = channels.length === 1;
    for (let c = 0; c < 3; c++) {
      const src = mono ? channels[0] : channels[Math.min(c, channels.length - 1)];
      const p = mono ? stf[0] : stf[Math.min(c, stf.length - 1)];
      applyStretch(src, out, 4, c, { kind, stf: p, amount, levels });
    }
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    return { width, height, out };
  }, [processed, stf, kind, amount, levels]);

  useEffect(() => {
    if (!stretched) return;
    const { width, height, out } = stretched;
    const opts = adjustmentsToOptions(adj, { filter: 'none' });
    setEditing(true);
    const timer = setTimeout(() => {
      client.process({ pixels: out.slice().buffer, width, height, options: opts }, 'edit')
        .then(r => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d')!.putImageData(r.image, 0, 0);
          setEditing(false);
        })
        .catch(e => { if (!isSuperseded(e)) { console.error(e); setEditing(false); } });
    }, 100);
    return () => clearTimeout(timer);
  }, [stretched, adj]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stage: nearest-neighbour zoom, pan by ref, cursor readout, crop drag, click to measure ──
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef    = useRef<HTMLDivElement>(null);
  const readoutRef  = useRef<HTMLSpanElement>(null);
  const view = useRef({ zoom: 1, panX: 0, panY: 0 });
  const drag = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean; rect?: Rect } | null>(null);
  const [zoom, setZoomState] = useState(1);
  const MAX_ZOOM = 32;
  // Pan is clamped so the image never leaves the viewport entirely.
  const applyView = () => {
    const { zoom } = view.current, c = canvasRef.current;
    if (c) {
      const lx = Math.max(0, (c.offsetWidth * zoom - c.offsetWidth) / 2), ly = Math.max(0, (c.offsetHeight * zoom - c.offsetHeight) / 2);
      view.current.panX = Math.min(lx, Math.max(-lx, view.current.panX));
      view.current.panY = Math.min(ly, Math.max(-ly, view.current.panY));
    }
    const { panX, panY } = view.current;
    if (frameRef.current) frameRef.current.style.transform = `scale(${zoom}) translate(${panX / zoom}px, ${panY / zoom}px)`;
  };
  // Zoom about a viewport point (default: centre) so what is under the pointer stays put.
  const setZoom = (z: number, at?: { clientX: number; clientY: number }) => {
    const next = Math.min(Math.max(z, 1), MAX_ZOOM), v = view.current, k = next / v.zoom;
    const box = viewportRef.current?.getBoundingClientRect();
    if (at && box) {
      const px = at.clientX - (box.left + box.width / 2), py = at.clientY - (box.top + box.height / 2);
      v.panX = px - k * (px - v.panX); v.panY = py - k * (py - v.panY);
    }
    v.zoom = next;
    if (next === 1) v.panX = v.panY = 0;
    applyView(); setZoomState(next);
  };
  // 1:1 shows one image pixel per screen pixel; fit shows the whole frame.
  const zoomOneToOne = (at?: { clientX: number; clientY: number }) => { const c = canvasRef.current; if (c) setZoom(c.width / c.offsetWidth, at); };
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); setZoom(view.current.zoom * (e.deltaY < 0 ? 1.25 : 0.8), e); };
    // Pinch: distance between two touches scales the zoom about their midpoint.
    let pinch: { d: number; zoom: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: TouchEvent) => { if (e.touches.length === 2) pinch = { d: dist(e.touches), zoom: view.current.zoom }; };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const t = e.touches;
      setZoom(pinch.zoom * dist(t) / pinch.d, { clientX: (t[0].clientX + t[1].clientX) / 2, clientY: (t[0].clientY + t[1].clientY) / 2 });
    };
    const onTouchEnd = () => { pinch = null; };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === '+' || e.key === '=') setZoom(view.current.zoom * 1.25);
      else if (e.key === '-') setZoom(view.current.zoom * 0.8);
      else if (e.key === '0') setZoom(1);
      else if (e.key === '1') zoomOneToOne();
      else return;
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    window.addEventListener('keydown', onKey);
    return () => { el.removeEventListener('wheel', onWheel); el.removeEventListener('touchstart', onTouchStart); el.removeEventListener('touchmove', onTouchMove); el.removeEventListener('touchend', onTouchEnd); window.removeEventListener('keydown', onKey); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Mouse position → pixel in the processed image (0-based), via the canvas's on-screen rect.
  const toPixel = (e: { clientX: number; clientY: number }) => {
    const c = canvasRef.current;
    if (!c || !processed) return null;
    const r = c.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * c.width), y = Math.floor((e.clientY - r.top) / r.height * c.height);
    return x >= 0 && y >= 0 && x < c.width && y < c.height ? { x, y } : null;
  };
  const wcs = useMemo(() => image?.header ? wcsFromHeader(image.header, image.height) : null, [image]);
  // Processed pixel → original frame pixel (undo bin and crop) for the header WCS.
  const toOriginal = (x: number, y: number) => {
    const f = image && processed ? (crop ? crop.w : image.width) / processed.width : 1;
    return { x: x * f + (crop?.x ?? 0), y: y * f + (crop?.y ?? 0), f };
  };
  const describe = (x: number, y: number) => {
    if (!processed) return '';
    const vals = processed.channels.map(c => fmt(c[y * processed.width + x])).join(' ');
    let s = `${x}, ${y}  ${vals} ADU`;
    if (wcs) { const o = toOriginal(x, y); const [ra, dec] = pixelToSky(wcs, o.x, o.y); s += `  ${formatRa(ra)} ${formatDec(dec)}`; }
    return s;
  };
  const onMouseDown = (e: React.MouseEvent) => {
    const p = toPixel(e);
    drag.current = { x: e.clientX, y: e.clientY, panX: view.current.panX, panY: view.current.panY, moved: false, rect: cropping && p ? { x: p.x, y: p.y, w: 0, h: 0 } : undefined };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.hypot(dx, dy) > 3) d.moved = true;
      if (d.rect) { const p = toPixel(e); if (p) { d.rect.w = p.x - d.rect.x; d.rect.h = p.y - d.rect.y; drawCropOverlay(d.rect); } }
      else if (view.current.zoom > 1) { view.current.panX = d.panX + dx; view.current.panY = d.panY + dy; applyView(); }
    }
    const p = toPixel(e);
    if (readoutRef.current) readoutRef.current.textContent = p ? describe(p.x, p.y) : '';
  };
  const onMouseUp = (e: React.MouseEvent) => {
    const d = drag.current; drag.current = null;
    if (!d || !processed) return;
    if (d.rect && d.moved) {
      const r = normRect(d.rect);
      if (r.w > 4 && r.h > 4) { const o = toOriginal(r.x, r.y); setCrop({ x: Math.round(o.x), y: Math.round(o.y), w: Math.round(r.w * o.f), h: Math.round(r.h * o.f) }); setMeasure(null); }
      drawCropOverlay(null); setCropping(false);
    } else if (!d.moved) {
      const p = toPixel(e);
      if (p) setMeasure(measureSource(processed.channels[0], processed.width, processed.height, p.x, p.y));
    }
  };
  const overlayRef = useRef<HTMLDivElement>(null);
  const drawCropOverlay = (r: Rect | null) => {
    const o = overlayRef.current, c = canvasRef.current;
    if (!o || !c) return;
    if (!r) { o.style.display = 'none'; return; }
    const n = normRect(r), sx = c.offsetWidth / c.width, sy = c.offsetHeight / c.height;
    Object.assign(o.style, { display: 'block', left: `${n.x * sx}px`, top: `${n.y * sy}px`, width: `${n.w * sx}px`, height: `${n.h * sy}px` });
  };

  useEffect(() => { if (image && autoApplied.length === 0 && advice.some(a => a.apply)) applyAuto(); }, [image]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async (file: File) => {
    setBusy('Loading…');
    try {
      const f = await decodeFile(file, setBusy);
      const frame: Frame = { ...f, role: roleFromHeader(f.header) };
      // Same size joins the set as another channel; a different size starts over.
      setFrames(fs => fs.length && fs[0].width === f.width && fs[0].height === f.height ? [...fs, frame] : [frame]);
      setAutoApplied([]); setCrop(null); setMeasure(null); setZoom(1);
    }
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

  const saveFits = () => {
    if (!processed || !image) return;
    const history = [`valgis astro: ${[crop && `crop ${crop.x},${crop.y} ${crop.w}x${crop.h}`, ...tools].filter(Boolean).join(', ') || 'no linear changes'}`];
    const blob = new Blob([writeFits(processed.channels, processed.width, processed.height, image.header, history)], { type: 'application/fits' });
    const a = document.createElement('a');
    a.download = `valgis-${image.name.replace(/\.[^.]+$/, '')}.fits`;
    a.href = URL.createObjectURL(blob); a.click(); URL.revokeObjectURL(a.href);
  };
  const histRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = histRef.current;
    if (!c || !processed || !stats || !stf) return;
    const ctx = c.getContext('2d')!, W = c.width, H = c.height;
    const lo = Math.min(...stats.map(s => s.min)), hi = Math.max(...stats.map(s => s.max));
    ctx.clearRect(0, 0, W, H);
    const colours = processed.channels.length === 1 ? ['#bbb'] : ['#e66', '#6d6', '#69f'];
    processed.channels.forEach((ch, i) => {
      const h = histogram(ch, lo, hi, W);
      ctx.fillStyle = colours[i]; ctx.globalAlpha = 0.6;
      for (let x = 0; x < W; x++) ctx.fillRect(x, H - h[x] * H, 1, h[x] * H);
    });
    ctx.globalAlpha = 1; ctx.fillStyle = '#fff';
    const mark = (v: number) => ctx.fillRect(Math.round((v - lo) / (hi - lo || 1) * (W - 1)), 0, 1, H);
    mark(stf[0].shadow); mark(stf[0].highlight);
  }, [processed, stats, stf]);

  const reset = () => { setAutoApplied(['reset']); setCrop(null); setMeasure(null); setZoom(1); setKind('mtf'); setAmount(30); setTarget(25); setShadowClip(28); setTools([]); setLinked(true); setLevels(NEUTRAL_LEVELS); resetAdj(['preNormalize', 'postNormalize']); };

  const header = (
    <StudioHeader
      mode="astro" onMode={m => m === 'rockart' && onMode()} onBack={onBack}
      sidebarOpen={sidebarOpen} onSidebarToggle={() => setSidebarOpen(o => !o)}
      actions={<>
        {image && <Button variant="outline" onClick={() => applyAuto()} title="Choose stretch and linear tools from the header and statistics. See Recommendations for why."><Wand2 size={14}/><span className="hidden lg:inline">Auto</span></Button>}
        {image && <Button variant={cropping ? 'primary' : 'outline'} onClick={() => setCropping(c => !c)} aria-label="Crop" title="Drag a rectangle on the image to crop. Click again to cancel."><Crop size={14}/><span className="hidden lg:inline">{crop ? `${crop.w}×${crop.h}` : 'Crop'}</span></Button>}
        {image && <span className="inline-flex items-center gap-0.5">
          <Button variant="outline" onClick={() => setZoom(zoom * 0.8)} disabled={zoom <= 1} aria-label="Zoom out" title="Zoom out (-)"><ZoomOut size={14}/></Button>
          <Button variant="outline" onClick={() => zoom > 1 ? setZoom(1) : zoomOneToOne()} title={zoom > 1 ? 'Fit to view (0)' : 'One image pixel per screen pixel (1). Double-click does the same at the pointer.'} className="tabular-nums min-w-[3.5rem]">{zoom > 1 ? `${zoom.toFixed(1)}×` : 'Fit'}</Button>
          <Button variant="outline" onClick={() => setZoom(zoom * 1.25)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in" title="Zoom in (+). Wheel zooms at the pointer, drag pans, pinch on touch."><ZoomIn size={14}/></Button>
        </span>}
        {image && <Button variant="outline" onClick={reset} aria-label="Reset stretch"><RotateCcw size={14}/><span className="hidden lg:inline">Reset</span></Button>}
        {image && <Button variant="outline" onClick={saveFits} title="Save the linear result (after crop, bin, tools, LRGB) as float32 FITS with the header kept."><Save size={14}/><span className="hidden lg:inline">FITS</span></Button>}
        <Button variant="primary" onClick={download} disabled={!image}><Download size={14}/><span className="hidden sm:inline">Download</span></Button>
      </>}
    />
  );

  const sidebar = (
    <>
      <UploadDrop accept={ASTRO_ACCEPT} isSupported={isAstroFile} onFile={load} label="Open FITS (.fits .fit .fts), TIFF or photo"/>

      {frames.length > 0 && (
        <CollapsiblePanel id="astro-channels" title="Channels" headerExtra={composeError ? <span className="text-[10px] text-destructive">{composeError}</span> : undefined}>
          <div className="space-y-1.5">
            {frames.map((f, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px]">
                <span className="flex-1 truncate text-muted-foreground" title={f.name}>{f.name}</span>
                <ChipGroup<Role> chips={(['L', 'R', 'G', 'B', 'mono'] as Role[]).map(r => ({ key: r, label: r }))} value={f.role}
                  onChange={r => setFrames(fs => fs.map((x, j) => j === i ? { ...x, role: r } : x))}/>
                <button className="text-muted-foreground hover:text-foreground" aria-label="Remove frame" onClick={() => setFrames(fs => fs.filter((_, j) => j !== i))}><X size={12}/></button>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground leading-snug">Drop more frames of the same size to add channels. V counts as G; missing G is the mean of R and B; L sets the brightness.</p>
          </div>
        </CollapsiblePanel>
      )}

      {image && advice.length > 0 && (
        <CollapsiblePanel id="astro-advice" title="Recommendations">
          <ul className="space-y-1.5 text-[11px] leading-snug text-muted-foreground">
            {advice.map(a => (
              <li key={a.id} className="flex gap-2">
                <span className="flex-1">{a.text}</span>
                {a.apply && (autoApplied.includes(a.id)
                  ? <span className="text-primary shrink-0">applied</span>
                  : <button className="text-primary underline shrink-0" onClick={() => applyAuto([a.id])}>apply</button>)}
              </li>
            ))}
          </ul>
        </CollapsiblePanel>
      )}

      <CollapsiblePanel id="astro-linear" title="Linear" dirty={tools.length > 0} onReset={() => setTools([])}>
        <ChipGroup<LinearTool> multiple
          chips={[
            { key: 'bin2' as const, label: 'Bin 2', title: 'Sum 2×2 neighbours. SNR ×2, resolution ÷2.' },
            { key: 'bin4' as const, label: 'Bin 4', title: 'Sum 4×4 neighbours. SNR ×4, resolution ÷4. For read-noise limited frames.' },
            { key: 'hot' as const, label: 'Hot pixels', title: 'Isolated spikes above 8 σ replaced by the neighbourhood median. Stars are untouched.' },
            { key: 'columns' as const, label: 'Bad columns', title: 'Columns whose sky level deviates from their neighbours are interpolated.' },
            { key: 'rows' as const, label: 'Row noise', title: 'Subtract each row\'s sky median. Removes readout banding.' },
            { key: 'background' as const, label: 'Background', title: 'Fit a surface to the sky and subtract it. Removes vignetting and gradients.' },
            ...((image?.channels.length ?? 0) >= 3 ? [
              { key: 'neutralize' as const, label: 'Neutralize', title: 'Match channel medians. Removes sky colour cast.' },
              { key: 'scnr' as const, label: 'SCNR', title: 'Green never exceeds the red/blue mean.' },
            ] : []),
          ]}
          value={tools} onChange={(v: LinearTool[]) => setTools(v)}
        />
      </CollapsiblePanel>

      <CollapsiblePanel id="astro-stretch" title="Stretch"
        dirty={kind !== 'mtf' || amount !== 30 || target !== 25 || shadowClip !== 28 || !linked || levels !== NEUTRAL_LEVELS}
        onReset={() => { setKind('mtf'); setAmount(30); setTarget(25); setShadowClip(28); setLinked(true); setLevels(NEUTRAL_LEVELS); }}>
        <div className="space-y-2.5">
          <ChipGroup chips={KINDS.map(k => ({ key: k.key, label: k.label, title: k.desc }))} value={kind} onChange={setKind} />
          <p className="text-[11px] text-muted-foreground leading-snug">{KINDS.find(k => k.key === kind)?.desc}</p>
          {(image?.channels.length ?? 0) >= 3 && (
            <ChipGroup chips={[{ key: 'linked', label: 'Linked', title: 'One transfer for all channels keeps colour.' }, { key: 'unlinked', label: 'Unlinked', title: 'Per-channel transfer. Auto colour balance.' }]}
              value={linked ? 'linked' : 'unlinked'} onChange={v => setLinked(v === 'linked')} />
          )}
          <ChipGroup chips={[
              { key: 'gentle', label: 'Gentle', title: 'Median at 15 %, clip 3 σ. Bright targets.' },
              { key: 'normal', label: 'Normal', title: 'Median at 25 %, clip 2.8 σ.' },
              { key: 'hard',   label: 'Hard',   title: 'Median at 40 %, clip 1.5 σ. Faint, read-noise limited frames.' },
            ]} value={target === 15 && shadowClip === 30 ? 'gentle' : target === 40 && shadowClip === 15 ? 'hard' : target === 25 && shadowClip === 28 ? 'normal' : 'custom' as 'gentle'}
            onChange={k => { if (k === 'gentle') { setTarget(15); setShadowClip(30); } else if (k === 'hard') { setTarget(40); setShadowClip(15); } else { setTarget(25); setShadowClip(28); } }} />
          <Slider label="Target brightness" value={target} min={5} max={60} defaultVal={25} onChange={setTarget} title="Where the median lands, in percent of white."/>
          <Slider label="Shadow clip (×0.1 σ)" value={shadowClip} min={0} max={50} defaultVal={28} onChange={setShadowClip} title="Black point below the median, in tenths of a sigma."/>
          {(kind === 'asinh' || kind === 'log') && (
            <Slider label="Strength" value={amount} min={1} max={500} defaultVal={30} onChange={setAmount}/>
          )}
          <canvas ref={histRef} width={256} height={40} className="w-full h-10 rounded bg-black/40" title="Log histogram of the linear data. White lines: black and white points of the stretch."/>
          <SectionRule>Levels</SectionRule>
          <Slider label="Exposure (EV ×0.1)" value={Math.round(levels.exposure * 10)} min={-50} max={50} defaultVal={0} onChange={v => setLevel('exposure', v / 10)} title="Linear gain in stops, before the stretch."
            gradient="linear-gradient(to right, #111 0%, #666 50%, #fff 100%)"/>
          <Slider label="Black point (%)" value={Math.round(levels.black * 100)} min={-50} max={50} defaultVal={0} onChange={v => setLevel('black', v / 100)} title="Shift the auto black point by a fraction of the range."
            gradient="linear-gradient(to right, #000 0%, #444 100%)"/>
          <Slider label="White point (%)" value={Math.round(levels.white * 100)} min={-90} max={50} defaultVal={0} onChange={v => setLevel('white', v / 100)} title="Shift the auto white point. Negative brightens faint detail."
            gradient="linear-gradient(to right, #999 0%, #fff 100%)"/>
          <Slider label="Gamma (×0.01)" value={Math.round(levels.gamma * 100)} min={20} max={300} defaultVal={100} onChange={v => setLevel('gamma', v / 100)} title="Applied after the curve. Above 1 lifts midtones."
            gradient="linear-gradient(to right, #222 0%, #888 40%, #eee 100%)"/>
        </div>
      </CollapsiblePanel>

      <TonePanel adj={adj} set={setAdj} resetGroup={resetGroup} defaults={adjDefaults} normalize={false}/>
      <EnhancementPanel adj={adj} set={setAdj} resetGroup={resetGroup} defaults={adjDefaults}/>
      <DetailPanel adj={adj} set={setAdj} resetGroup={resetGroup} defaults={adjDefaults}/>

      {image && stats && (
        <CollapsiblePanel id="astro-info" title="Image" defaultOpen={false}>
          <div className="space-y-1 text-[11px] text-muted-foreground tabular-nums">
            {stats.map((st, i) => (
              <div key={i}>ch{i}: median {fmt(st.median)}, MAD {fmt(st.mad)}, range {fmt(st.min)}–{fmt(st.max)}</div>
            ))}
            {wcs && <div>plate scale {plateScale(wcs).toFixed(3)}″/px{crop ? `, crop ${crop.x},${crop.y} ${crop.w}×${crop.h}` : ''}</div>}
            {measure && (
              <div className="pt-1 text-foreground">
                <div>source at {measure.x.toFixed(1)}, {measure.y.toFixed(1)}: FWHM {measure.fwhm.toFixed(1)} px{wcs ? ` = ${(measure.fwhm * plateScale(wcs) * toOriginal(0, 0).f).toFixed(2)}″` : ''}</div>
                <div>peak {fmt(measure.peak)}, flux {fmt(measure.flux)}, sky {fmt(measure.sky)} ± {fmt(measure.skySigma)}, SNR {measure.snr.toFixed(0)}</div>
              </div>
            )}
            {image?.header && (
              <div className="pt-1 grid grid-cols-[auto_1fr] gap-x-2">
                {HEADER_KEYS.filter(k => image.header![k] !== undefined).map(k => <Fragment key={k}><span>{k}</span><span className="text-foreground truncate" title={image.header![k]}>{image.header![k]}</span></Fragment>)}
              </div>
            )}
          </div>
        </CollapsiblePanel>
      )}
    </>
  );

  return (
    <StudioShell header={header} sidebar={sidebar} sidebarOpen={sidebarOpen} onSidebarClose={() => setSidebarOpen(false)}
      overlay={busy && <LoadingOverlay message={busy}/>}>
      {processed && (
        <InfoBar left={<>{`${processed.width} × ${processed.height} px · ${processed.channels.length === 1 ? 'mono' : `${processed.channels.length} ch`}`}{image?.header?.TRUNCATD && <span className="ml-2 text-destructive">truncated file, {image.header.TRUNCATD}</span>}</>}
          right={<><span ref={readoutRef} className="tabular-nums whitespace-pre"/><span className="text-foreground font-medium">{KINDS.find(k => k.key === kind)?.label}</span></>}/>
      )}
      <div ref={viewportRef} className={`flex-1 flex items-center justify-center p-4 overflow-hidden select-none ${cropping ? 'cursor-crosshair' : zoom > 1 ? 'cursor-grab' : 'cursor-default'}`}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
        onDoubleClick={e => { if (cropping) return; zoom > 1 ? setZoom(1) : zoomOneToOne(e); }} onMouseLeave={() => { drag.current = null; if (readoutRef.current) readoutRef.current.textContent = ''; }}>
        {image
          ? <div ref={frameRef} className="relative max-w-full max-h-full flex items-center justify-center" style={{ transformOrigin: 'center center' }}>
              <canvas ref={canvasRef} className="max-w-full max-h-full object-contain border border-border shadow-2xl" style={{ maxHeight: 'calc(100vh - 120px)', imageRendering: 'pixelated' }}/>
              <div ref={overlayRef} className="absolute border border-primary bg-primary/10 pointer-events-none" style={{ display: 'none' }}/>
              {editing && <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-white">Processing…</div>}
            </div>
          : <EmptyState icon={<Upload size={64}/>} title="Open a FITS frame or a stack to begin" hint="A single calibrated frame from the observatory (.fts) or a Siril stack (.fit), 16-bit TIFF, or a photo. Linear data in, honest stretch out. Hover for pixel values and RA/Dec, click a star to measure it."/>}
      </div>
    </StudioShell>
  );
}

const fmt = (v: number) => Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(2);
const normRect = (r: Rect): Rect => ({ x: Math.min(r.x, r.x + r.w), y: Math.min(r.y, r.y + r.h), w: Math.abs(r.w), h: Math.abs(r.h) });
