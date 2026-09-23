import { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Download, RotateCcw, Eye, ZoomIn, ZoomOut, Maximize2, RefreshCw, Maximize, Palette } from 'lucide-react';
import { useImageProcessor, processOnce } from './hooks/useImageProcessor';
import type { ProcessOptions } from './hooks/useImageProcessor';
import type { HslBandKey, HslBandAdjustment, HslAdjustments, WheelValue, ColorWheelAdjustments } from './worker/imageProcessor';
import { ColorWheel } from './components/ColorWheel';
import { HueRangePicker } from './components/HueRangePicker';
import { Slider as ShadSlider } from '@/components/ui/slider';
import { Slider } from '@/components/Slider';
import { CollapsiblePanel } from '@/components/CollapsiblePanel';
import { ChipGroup } from '@/components/ChipGroup';
import { UploadDrop } from '@/components/UploadDrop';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { decodeToImage, exportFormatOf, isSupportedImage, IMAGE_ACCEPT } from '@/lib/decode';
import { Button } from '@/components/ui/button';
import { StudioShell, InfoBar, EmptyState } from '@/components/studio/StudioShell';
import { StudioHeader, HeaderOptionGroup } from '@/components/studio/StudioHeader';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

type FilterName = ProcessOptions['filter'];

// ─── HSL band definitions ─────────────────────────────────────────────────────

const HSL_BANDS: { key: HslBandKey; label: string; color: string; textColor: string }[] = [
  { key: 'reds',     label: 'Reds',     color: '#e05252', textColor: '#fff' },
  { key: 'oranges',  label: 'Oranges',  color: '#e07c30', textColor: '#fff' },
  { key: 'yellows',  label: 'Yellows',  color: '#d4b800', textColor: '#000' },
  { key: 'greens',   label: 'Greens',   color: '#3da84a', textColor: '#fff' },
  { key: 'cyans',    label: 'Cyans',    color: '#2ab4c0', textColor: '#000' },
  { key: 'blues',    label: 'Blues',    color: '#3b6fd4', textColor: '#fff' },
  { key: 'purples',  label: 'Purples',  color: '#7b4ec8', textColor: '#fff' },
  { key: 'magentas', label: 'Magentas', color: '#c0348a', textColor: '#fff' },
];

const BAND_DEFAULTS: Record<HslBandKey, { center: number; halfWidth: number }> = {
  reds: { center: 0, halfWidth: 45 }, oranges: { center: 30, halfWidth: 45 },
  yellows: { center: 60, halfWidth: 45 }, greens: { center: 120, halfWidth: 45 },
  cyans: { center: 180, halfWidth: 45 }, blues: { center: 210, halfWidth: 45 },
  purples: { center: 270, halfWidth: 45 }, magentas: { center: 300, halfWidth: 45 },
};

const defaultBand = (key: HslBandKey): HslBandAdjustment => ({
  hue: 0, saturation: 0, lightness: 0,
  center: BAND_DEFAULTS[key].center, halfWidth: BAND_DEFAULTS[key].halfWidth,
});
const defaultHslAdjustments = (): HslAdjustments => ({
  reds: defaultBand('reds'), oranges: defaultBand('oranges'),
  yellows: defaultBand('yellows'), greens: defaultBand('greens'),
  cyans: defaultBand('cyans'), blues: defaultBand('blues'),
  purples: defaultBand('purples'), magentas: defaultBand('magentas'),
});

// Flat lookup: filter key → { name, desc, group }
const filterMeta: Record<string, { name: string; desc: string; group: string }> = {};

const lightingPresets = {
  none:         { name: 'No Preset',               desc: 'Manual adjustment — start from defaults.',                                                                    settings: { brightness:100,contrast:100,saturation:100,shadowRecovery:0, highlightRecovery:0, clarity:0, dehaze:0 } },
  hardLight:    { name: 'Hard Direct Light',        desc: 'Harsh sun or flash. High contrast, blown highlights, deep shadows.',                                      settings: { brightness:100,contrast:85, saturation:95, shadowRecovery:40,highlightRecovery:50,clarity:10,dehaze:0 } },
  softLight:    { name: 'Soft / Diffused',          desc: 'Overcast or shade. Low contrast, flat. Boosts punch and clarity.',                                        settings: { brightness:105,contrast:125,saturation:115,shadowRecovery:0, highlightRecovery:0, clarity:25,dehaze:15} },
  goldenHour:   { name: 'Golden Hour',              desc: 'Early/late sun. Warm tones, good contrast. Balances colour cast.',                                        settings: { brightness:100,contrast:110,saturation:105,shadowRecovery:15,highlightRecovery:10,clarity:15,dehaze:0 } },
  cave:         { name: 'Low Light / Interior',     desc: 'Caves, overhangs, dimly lit spaces. Maximum shadow recovery and brightness boost.',                        settings: { brightness:135,contrast:115,saturation:105,shadowRecovery:80,highlightRecovery:0, clarity:30,dehaze:25} },
  filteredLight:{ name: 'Filtered / Canopy',        desc: 'Mixed or dappled light. Green colour cast, uneven exposure. Reduces green, adds dehaze.',                  settings: { brightness:110,contrast:115,saturation:85, shadowRecovery:25,highlightRecovery:20,clarity:20,dehaze:30} },
  rakingLight:  { name: 'Raking / Side Light',      desc: 'Strong directional side lighting. Good for texture and surface detail.',                                  settings: { brightness:100,contrast:105,saturation:100,shadowRecovery:35,highlightRecovery:15,clarity:35,dehaze:0 } },
  backlit:      { name: 'Backlit / Silhouette',     desc: 'Light source behind subject. Dark foreground. Aggressive shadow recovery.',                               settings: { brightness:150,contrast:110,saturation:95, shadowRecovery:90,highlightRecovery:60,clarity:20,dehaze:20} },
};

const filterGroups = {
  basic: {
    title: 'Basic',
    filters: {
      none:     { name: 'Original',  desc: 'No filter — unprocessed image.' },
      adaptive: { name: 'Adaptive',  desc: 'Per-pixel heuristic, no PCA. Cuts green cast, lifts dark areas.' },
    },
  },
  ycbcr: {
    title: 'Spectral (YCbCr)',
    filters: {
      yre:  { name: 'YRE',  desc: 'YCbCr PCA ×2.5 — strong red enhancement (emission, ochre, iron oxide).' },
      yrd:  { name: 'YRD',  desc: 'YCbCr PCA ×2.0 — moderate red boost, natural-looking result.' },
      ydt:  { name: 'YDT',  desc: 'YCbCr PCA ×1.5 — gentle dark tone stretch, preserves subtlety.' },
      ybk:  { name: 'YBK',  desc: 'YCbCr PCA ×1.8 — enhances dark features and shadows.' },
      yye:  { name: 'YYE',  desc: 'YCbCr PCA ×3.5 — amplifies pale yellows and warm emission.' },
      ywe:  { name: 'YWE',  desc: 'YCbCr PCA ×4.0 — maximises pale and white features.' },
      crgb: { name: 'CRGB', desc: 'RGB PCA ×3.0 — fast vivid stretch, good for initial survey.' },
      rgb0: { name: 'RGB0', desc: 'RGB PCA ×5.0 — maximum contrast, aggressive stretch.' },
    },
  },
  variants: {
    title: 'Spectral (variants)',
    filters: {
      lab:  { name: 'LAB',     desc: 'LAB PCA ×2.2 — perceptually balanced, noise-resistant.' },
      lab2: { name: 'LAB 2',   desc: 'LAB PCA ×3.5 — stronger LAB stretch for faint features.' },
      drgb: { name: 'RGB',     desc: 'RGB PCA ×2.5 — balanced RGB decorrelation.' },
      yuv:  { name: 'YUV',     desc: 'YUV PCA ×2.5 — separates luma from chroma differently to YCbCr.' },
    },
  },
  tools: {
    title: 'Tools',
    filters: {
      autolevel: { name: 'Auto Level',  desc: 'Per-channel min–max stretch to full 0–255 range.' },
      histeq:    { name: 'Hist EQ',     desc: 'Histogram equalisation — maximises overall contrast.' },
      satboost:  { name: 'Sat Boost',   desc: 'Doubles colour saturation while preserving luminance.' },
    },
  },
  more: {
    title: 'More (LAB / YCbCr)',
    filters: {
      yds: { name: 'YDS', desc: 'YCbCr PCA ×3.0 — versatile, highlights warm tones.' },
      ybr: { name: 'YBR', desc: 'YCbCr PCA ×2.2 — separates overlapping reds and blues.' },
      lre: { name: 'LRE', desc: 'LAB PCA ×2.5 — sharper red enhancement than YRE.' },
      lrd: { name: 'LRD', desc: 'LAB PCA ×2.0 — gentle LAB red enhancement.' },
      lbk: { name: 'LBK', desc: 'LAB PCA ×1.8 — dark features with cool blue tones.' },
      lye: { name: 'LYE', desc: 'LAB PCA ×3.5 — yellow/white enhancement, sharp edges.' },
    },
  },
};

// Populate flat meta lookup
Object.entries(filterGroups).forEach(([, g]) =>
  Object.entries(g.filters).forEach(([k, f]) => { filterMeta[k] = { ...f, group: g.title }; })
);

const Studio = ({ onBack, onMode }: { onBack: () => void; onMode: () => void }) => {
  const [filter,           setFilter          ] = useState<FilterName>('none');
  const [brightness,       setBrightness      ] = useState(100);
  const [contrast,         setContrast        ] = useState(100);
  const [saturation,       setSaturation      ] = useState(100);
  const [dehaze,           setDehaze          ] = useState(0);
  const [clarity,          setClarity         ] = useState(0);
  const [shadowRecovery,   setShadowRecovery  ] = useState(0);
  const [highlightRecovery,setHighlightRecovery] = useState(0);
  const [noiseReduction,   setNoiseReduction  ] = useState(0);
  const [noiseAlgorithm,   setNoiseAlgorithm  ] = useState<'median'|'gaussian'|'bilateral'>('median');
  const [sharpening,       setSharpening      ] = useState(0);
  const [sharpenAlgorithm, setSharpenAlgorithm] = useState<'unsharp'|'highpass'|'laplacian'>('unsharp');
  const [preNormalize,     setPreNormalize    ] = useState(100);
  const [postNormalize,    setPostNormalize   ] = useState(100);
  const [lightingPreset,   setLightingPreset  ] = useState('none');
  const [renderingMode,    setRenderingMode   ] = useState<'smooth'|'crisp'|'pixelated'>('smooth');

  const [image,            setImage           ] = useState<HTMLImageElement | null>(null);
  const [imageDimensions,  setImageDimensions ] = useState<{width:number;height:number}|null>(null);
  const [originalFormat,   setOriginalFormat  ] = useState<'jpeg'|'png'|'webp'>('png');
  const [showOriginal,     setShowOriginal    ] = useState(false);
  const [isProcessing,     setIsProcessing    ] = useState(false);
  const [processingMessage,setProcessingMessage] = useState('');
  const [isEditing,        setIsEditing       ] = useState(false);
  const [isDownloading,    setIsDownloading   ] = useState(false);
  const [sidebarOpen,      setSidebarOpen     ] = useState(true);
  const [zoom,             setZoom            ] = useState(1);
  const [panX,             setPanX            ] = useState(0);
  const [panY,             setPanY            ] = useState(0);
  const [isPanning,        setIsPanning       ] = useState(false);
  const [panStart,         setPanStart        ] = useState({x:0,y:0});
  const [histogram,        setHistogram       ] = useState<{r:number[];g:number[];b:number[]}|null>(null);
  const [hslAdjustments,   setHslAdjustments  ] = useState<HslAdjustments>(defaultHslAdjustments);
  const [selectedBand,     setSelectedBand    ] = useState<HslBandKey>('reds');
  const [colorSidebarOpen, setColorSidebarOpen] = useState(true);
  const [toneEnabled,        setToneEnabled       ] = useState(true);
  const [enhancementEnabled, setEnhancementEnabled] = useState(true);
  const [detailEnabled,      setDetailEnabled     ] = useState(true);

  const [colorWheels,      setColorWheels     ] = useState<ColorWheelAdjustments>({
    lift:  { x: 0, y: 0, luma: 0 },
    gamma: { x: 0, y: 0, luma: 0 },
    gain:  { x: 0, y: 0, luma: 0 },
  });

  const canvasRef         = useRef<HTMLCanvasElement>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const originalImageRef  = useRef<HTMLImageElement | null>(null);
  const currentOptsRef    = useRef<ProcessOptions | null>(null);

  // ── Worker ──────────────────────────────────────────────────────────────────

  const handleResult = useCallback((imageData: ImageData) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width  = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d')!.putImageData(imageData, 0, 0);
    calculateHistogram(canvas);
    setIsEditing(false);
  }, []);

  const { process } = useImageProcessor(handleResult, setIsEditing);

  // ── Trigger processing ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!image) return;
    const origCanvas = originalCanvasRef.current;
    if (!origCanvas) return;

    if (showOriginal) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width  = origCanvas.width;
      canvas.height = origCanvas.height;
      canvas.getContext('2d')!.drawImage(origCanvas, 0, 0);
      return;
    }

    const opts: ProcessOptions = {
      filter,
      brightness:        toneEnabled ? brightness        : 100,
      contrast:          toneEnabled ? contrast          : 100,
      saturation:        toneEnabled ? saturation        : 100,
      shadowRecovery:    enhancementEnabled ? shadowRecovery    : 0,
      highlightRecovery: enhancementEnabled ? highlightRecovery : 0,
      clarity:           enhancementEnabled ? clarity           : 0,
      dehaze:            enhancementEnabled ? dehaze            : 0,
      noiseReduction:    detailEnabled ? noiseReduction    : 0,
      noiseAlgorithm, sharpening: detailEnabled ? sharpening : 0, sharpenAlgorithm,
      hslAdjustments,
      colorWheels,
      preNormalize:  toneEnabled ? preNormalize  : 0,
      postNormalize: toneEnabled ? postNormalize : 0,
    };

    currentOptsRef.current = opts;
    setIsEditing(true);
    const timer = setTimeout(() => process(origCanvas, opts), 150);
    return () => clearTimeout(timer);
  }, [
    image, filter, brightness, contrast, saturation,
    shadowRecovery, highlightRecovery, clarity, dehaze,
    noiseReduction, noiseAlgorithm, sharpening, sharpenAlgorithm,
    hslAdjustments, colorWheels, showOriginal,
    preNormalize, postNormalize,
    toneEnabled, enhancementEnabled, detailEnabled,
  ]);

  // ── Histogram ───────────────────────────────────────────────────────────────

  const calculateHistogram = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const r = new Array(256).fill(0);
    const g = new Array(256).fill(0);
    const b = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 4) { r[data[i]]++; g[data[i+1]]++; b[data[i+2]]++; }
    setHistogram({ r, g, b });
  };

  // ── Image loading ────────────────────────────────────────────────────────────

  const MAX_EDIT_PX = 1_500_000; // 1.5MP cap for live editing
  const loadImageToOriginalCanvas = (img: HTMLImageElement) => {
    const canvas = originalCanvasRef.current;
    if (!canvas) return;
    const scale = Math.min(1, Math.sqrt(MAX_EDIT_PX / (img.width * img.height)));
    canvas.width  = Math.round(img.width  * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    originalImageRef.current = img;
    setImage(img);
    setImageDimensions({ width: img.width, height: img.height });
  };

  const processImageFile = async (file: File) => {
    setIsProcessing(true);
    setOriginalFormat(exportFormatOf(file));
    try {
      loadImageToOriginalCanvas(await decodeToImage(file, setProcessingMessage));
    } catch (err) {
      console.error(err);
      alert(`Could not open ${file.name}. The format may not be supported.`);
    } finally {
      setIsProcessing(false); setProcessingMessage('');
    }
  };

  // ── Download ─────────────────────────────────────────────────────────────────

  const downloadImage = async () => {
    const origImg = originalImageRef.current;
    const opts = currentOptsRef.current;
    if (!origImg || !opts || !image) return;
    setIsDownloading(true);
    try {
      const fullCanvas = document.createElement('canvas');
      fullCanvas.width  = origImg.naturalWidth;
      fullCanvas.height = origImg.naturalHeight;
      fullCanvas.getContext('2d')!.drawImage(origImg, 0, 0);
      const imageData = fullCanvas.getContext('2d')!.getImageData(0, 0, fullCanvas.width, fullCanvas.height);
      const result = await processOnce(imageData, opts);
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width  = result.width;
      exportCanvas.height = result.height;
      exportCanvas.getContext('2d')!.putImageData(result, 0, 0);
      const fmts = { jpeg:{mime:'image/jpeg',ext:'jpg',q:0.95}, png:{mime:'image/png',ext:'png',q:1}, webp:{mime:'image/webp',ext:'webp',q:0.95} };
      const fmt  = fmts[originalFormat];
      const ts   = new Date().toISOString().replace(/[:.]/g,'-').slice(0,-5);
      const a    = document.createElement('a');
      a.download  = `valgis-${filter}-${ts}.${fmt.ext}`;
      a.href      = exportCanvas.toDataURL(fmt.mime, fmt.q);
      a.click();
    } finally {
      setIsDownloading(false);
    }
  };

  // ── Lighting preset ──────────────────────────────────────────────────────────

  const applyLightingPreset = (key: string) => {
    setLightingPreset(key);
    const p = lightingPresets[key as keyof typeof lightingPresets];
    if (!p) return;
    setBrightness(p.settings.brightness);
    setContrast(p.settings.contrast);
    setSaturation(p.settings.saturation);
    setShadowRecovery(p.settings.shadowRecovery);
    setHighlightRecovery(p.settings.highlightRecovery);
    setClarity(p.settings.clarity);
    setDehaze(p.settings.dehaze);
  };

  // ── Zoom & pan ───────────────────────────────────────────────────────────────

  const viewportRef = useRef<HTMLDivElement>(null);
  // Native listener: React wheel handlers are passive, so preventDefault would not stop pinch-zoom.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(z => Math.min(Math.max(e.deltaY < 0 ? z * 1.25 : z / 1.25, 0.1), 10));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (zoom > 1) { setIsPanning(true); setPanStart({ x: e.clientX - panX, y: e.clientY - panY }); }
  };
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isPanning && zoom > 1) { setPanX(e.clientX - panStart.x); setPanY(e.clientY - panStart.y); }
  };
  const handleMouseUp   = () => setIsPanning(false);

  const handleZoom100 = () => {
    const c = canvasRef.current;
    if (!c) return;
    setZoom(Math.max(c.width / c.offsetWidth, c.height / c.offsetHeight));
    setPanX(0); setPanY(0);
  };

  // ── Reset ────────────────────────────────────────────────────────────────────

  const resetSettings = () => {
    setBrightness(100); setContrast(100); setSaturation(100);
    setDehaze(0); setClarity(0); setShadowRecovery(0); setHighlightRecovery(0);
    setNoiseReduction(0); setSharpening(0); setFilter('none'); setLightingPreset('none');
    setHslAdjustments(defaultHslAdjustments());
    setColorWheels({ lift: { x:0, y:0, luma:0 }, gamma: { x:0, y:0, luma:0 }, gain: { x:0, y:0, luma:0 } });
    setZoom(1); setPanX(0); setPanY(0);
  };

  // ── Before unload ────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (image) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [image]);

  const updateWheel = (key: keyof ColorWheelAdjustments, patch: Partial<WheelValue>) =>
    setColorWheels(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const isWheelActive = (w: WheelValue) => w.x !== 0 || w.y !== 0 || w.luma !== 0;

  const updateBand = (key: HslBandKey, field: keyof HslBandAdjustment, value: number) => {
    setHslAdjustments(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  const isBandActive = (key: HslBandKey) => {
    const b = hslAdjustments[key];
    return b.hue !== 0 || b.saturation !== 0 || b.lightness !== 0;
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  const header = (
    <StudioHeader
      mode="rockart" onMode={m => m === 'astro' && onMode()} onBack={onBack}
      sidebarOpen={sidebarOpen} onSidebarToggle={() => setSidebarOpen(o => !o)}
      center={image && (
        <HeaderOptionGroup label="Render" value={renderingMode} onChange={setRenderingMode}
          options={[{ key: 'smooth', label: 'Smooth' }, { key: 'crisp', label: 'Crisp' }, { key: 'pixelated', label: 'Pixel' }]}/>
      )}
      actions={<>
        {image && (
          <>
            <Button variant="outline" active={colorSidebarOpen} aria-pressed={colorSidebarOpen} className="hidden md:inline-flex"
              onClick={() => setColorSidebarOpen(o => !o)} title="Color Mixer">
              <Palette size={14}/>
              <span className="hidden lg:inline">Color</span>
            </Button>
            <div className="flex items-center rounded-md border border-border divide-x divide-border overflow-hidden" role="group" aria-label="Zoom">
              <Button variant="ghost" size="icon" className="rounded-none border-0" onClick={() => setZoom(z => Math.max(z/1.25,0.1))} aria-label="Zoom out"><ZoomOut size={14}/></Button>
              <Button variant="ghost" size="icon" className="rounded-none border-0" onClick={() => { setZoom(1); setPanX(0); setPanY(0); }} aria-label="Fit to screen"><Maximize2 size={14}/></Button>
              <Button variant="ghost" size="icon" className="rounded-none border-0" onClick={handleZoom100} aria-label="Zoom to 100 %"><Maximize size={14}/></Button>
              <Button variant="ghost" size="icon" className="rounded-none border-0" onClick={() => setZoom(z => Math.min(z*1.25,10))} aria-label="Zoom in"><ZoomIn size={14}/></Button>
              <span className="hidden md:inline text-xs text-muted-foreground px-2 min-w-[3rem] text-center tabular-nums" aria-live="polite">{Math.round(zoom*100)}%</span>
            </div>
            <Button variant="outline" active={showOriginal} aria-pressed={showOriginal} onClick={() => setShowOriginal(s => !s)}>
              <Eye size={14}/>
              <span className="hidden sm:inline">{showOriginal ? 'Edited' : 'Original'}</span>
            </Button>
            <Button variant="outline" onClick={resetSettings} aria-label="Reset all adjustments">
              <RotateCcw size={14}/><span className="hidden lg:inline">Reset</span>
            </Button>
          </>
        )}
        <Button variant="primary" onClick={downloadImage} disabled={!image||isDownloading}>
          <Download size={14} className={isDownloading?'animate-bounce':''}/>
          <span className="hidden sm:inline">{isDownloading?'Saving...':'Download'}</span>
        </Button>
      </>}
    />
  );

  const sidebar = (
    <>
      <UploadDrop accept={IMAGE_ACCEPT} isSupported={isSupportedImage} onFile={processImageFile}/>

      {/* ── Lighting preset ── */}
      <CollapsiblePanel
        id="lighting"
        title="Lighting Conditions"
        headerExtra={<span className="text-[11px] text-zinc-400">sets sliders below</span>}
      >
        <Select value={lightingPreset} onValueChange={v => v && applyLightingPreset(v)}>
          <SelectTrigger className="w-full bg-secondary border-border text-foreground text-xs h-8">
            <SelectValue>{lightingPresets[lightingPreset as keyof typeof lightingPresets].name}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(lightingPresets).map(([k, p]) => (
              <SelectItem key={k} value={k}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {lightingPreset !== 'none' && (
          <p className="text-xs text-zinc-400 mt-1.5 leading-tight">{lightingPresets[lightingPreset as keyof typeof lightingPresets].desc}</p>
        )}
      </CollapsiblePanel>

      {/* ── Spectral filters ── */}
      <CollapsiblePanel id="spectral" title="Spectral Filter">
        <div className="space-y-2.5">
          {Object.entries(filterGroups).map(([gk, group]) => (
            <div key={gk}>
              <span className="block text-[11px] text-zinc-400 mb-1">{group.title}</span>
              <ChipGroup
                chips={Object.entries(group.filters).map(([k, f]) => ({ key: k as FilterName, label: f.name, title: f.desc }))}
                value={filter} onChange={setFilter}
              />
            </div>
          ))}
        </div>
      </CollapsiblePanel>

      {/* ── Tone ── */}
      <CollapsiblePanel
        id="tone"
        title="Tone"
        enabled={toneEnabled}
        onEnabledChange={setToneEnabled}
      >
        <div className="space-y-2.5">
          <span className="block text-[10px] font-semibold text-zinc-400 uppercase tracking-widest pt-0.5">Exposure</span>
          <Slider label="Brightness" value={brightness}  min={0} max={200} defaultVal={100} onChange={setBrightness}
            gradient="linear-gradient(to right, #111 0%, #666 50%, #fff 100%)"/>
          <Slider label="Contrast"   value={contrast}    min={0} max={200} defaultVal={100} onChange={setContrast}
            gradient="linear-gradient(to right, hsl(0,0%,50%) 0%, hsla(0,0%,50%,0) 100%), repeating-linear-gradient(to right, #0a0a0a 0 3px, #f0f0f0 3px 6px)"/>
          <Slider label="Saturation" value={saturation}  min={0} max={200} defaultVal={100} onChange={setSaturation}
            gradient="linear-gradient(to right, hsl(0,0%,45%) 0%, hsl(0,0%,55%) 50%, hsl(14,70%,55%) 100%)"/>
          <div className="flex items-center gap-2 pt-1">
            <div className="flex-1 border-t border-zinc-700/60"/>
            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest shrink-0">Normalize</span>
            <div className="flex-1 border-t border-zinc-700/60"/>
          </div>
          <Slider label="Pre-filter"  value={preNormalize}  min={0} max={100} defaultVal={100} onChange={setPreNormalize}
            gradient="linear-gradient(to right, hsl(210,35%,40%) 0%, hsl(0,0%,50%) 40%, hsl(30,30%,55%) 100%)"/>
          <Slider label="Post-filter" value={postNormalize} min={0} max={100} defaultVal={100} onChange={setPostNormalize}
            gradient="linear-gradient(to right, hsl(0,0%,20%) 0%, hsl(0,0%,55%) 50%, hsl(0,0%,92%) 100%)"/>
        </div>
      </CollapsiblePanel>

      {/* ── Enhancement ── */}
      <CollapsiblePanel id="enhancement" title="Enhancement"
        enabled={enhancementEnabled} onEnabledChange={setEnhancementEnabled}>
        <div className="space-y-2.5">
          <Slider label="Shadow Recovery"    value={shadowRecovery}    min={0} max={100} defaultVal={0} onChange={setShadowRecovery}
            gradient="linear-gradient(to right, #0a0a0a 0%, hsl(30,15%,40%) 100%)"/>
          <Slider label="Highlight Recovery" value={highlightRecovery} min={0} max={100} defaultVal={0} onChange={setHighlightRecovery}
            gradient="linear-gradient(to right, #f8f8f8 0%, hsl(40,15%,60%) 100%)"/>
          <Slider label="Clarity"            value={clarity}           min={0} max={100} defaultVal={0} onChange={setClarity}
            gradient="linear-gradient(to right, hsl(0,0%,50%) 0%, hsla(0,0%,50%,0) 100%), repeating-linear-gradient(to right, #222 0 2px, #ddd 2px 4px)"/>
          <Slider label="Dehaze"             value={dehaze}            min={0} max={100} defaultVal={0} onChange={setDehaze}
            gradient="linear-gradient(to right, hsl(210,20%,55%) 0%, hsl(30,10%,35%) 100%)"/>
        </div>
      </CollapsiblePanel>

      {/* ── Detail ── */}
      <CollapsiblePanel id="detail" title="Detail"
        enabled={detailEnabled} onEnabledChange={setDetailEnabled}>
        <div className="space-y-3">
          {/* Noise Reduction */}
          <span className="block text-[10px] font-semibold text-zinc-400 uppercase tracking-widest pt-0.5">Noise</span>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-zinc-300">Noise Reduction</span>
              <span className="flex items-center gap-1 text-xs text-zinc-400">
                {noiseReduction}%
                {noiseReduction !== 0 && <button onClick={() => setNoiseReduction(0)} className="text-zinc-400 hover:text-zinc-300"><RefreshCw size={10}/></button>}
              </span>
            </div>
            <ShadSlider min={0} max={100} value={[noiseReduction]} onValueChange={(vals) => { const v = Array.isArray(vals) ? vals[0] : vals; setNoiseReduction(v as number); }} className="w-full mb-2"
              trackGradient="linear-gradient(to right, hsl(0,0%,55%) 0%, hsl(220,12%,50%) 100%)"/>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-400 shrink-0">Method:</span>
              <ChipGroup
                chips={(['median','gaussian','bilateral'] as const).map(m => ({ key: m, label: m[0].toUpperCase() + m.slice(1) }))}
                value={noiseAlgorithm} onChange={setNoiseAlgorithm} className="flex gap-1"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 border-t border-zinc-700/60"/>
            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest shrink-0">Sharpen</span>
            <div className="flex-1 border-t border-zinc-700/60"/>
          </div>
          {/* Sharpening */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-zinc-300">Sharpening</span>
              <span className="flex items-center gap-1 text-xs text-zinc-400">
                {sharpening}%
                {sharpening !== 0 && <button onClick={() => setSharpening(0)} className="text-zinc-400 hover:text-zinc-300"><RefreshCw size={10}/></button>}
              </span>
            </div>
            <ShadSlider min={0} max={100} value={[sharpening]} onValueChange={(vals) => { const v = Array.isArray(vals) ? vals[0] : vals; setSharpening(v as number); }} className="w-full mb-2"
              trackGradient="linear-gradient(to right, hsl(0,0%,35%) 0%, hsl(0,0%,88%) 100%)"/>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-400 shrink-0">Method:</span>
              <ChipGroup
                chips={(['unsharp','highpass','laplacian'] as const).map(m => ({ key: m, label: m[0].toUpperCase() + m.slice(1) }))}
                value={sharpenAlgorithm} onChange={setSharpenAlgorithm} className="flex gap-1"
              />
            </div>
          </div>
        </div>
      </CollapsiblePanel>

      {/* Histogram */}
      {histogram && (() => {
        const lum = histogram.r.map((_, i) =>
          Math.round(0.299 * histogram.r[i] + 0.587 * histogram.g[i] + 0.114 * histogram.b[i])
        );
        const gMax = Math.max(
          ...histogram.r, ...histogram.g, ...histogram.b, ...lum
        ) || 1;
        const pts = (vals: number[]) =>
          `0,64 ${vals.map((v, i) => `${i},${64 - (v / gMax) * 64}`).join(' ')} 255,64`;
        return (
          <CollapsiblePanel id="histogram" title="Histogram" defaultOpen={false}>
            <div className="relative h-20 bg-zinc-950 rounded overflow-hidden">
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 256 64" preserveAspectRatio="none">
                {/* luminance */}
                <polyline fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.25)" strokeWidth="0.5" points={pts(lum)}/>
                {/* R G B */}
                <polyline fill="rgba(239,68,68,0.25)"  stroke="rgba(239,68,68,0.7)"  strokeWidth="0.5" points={pts(histogram.r)}/>
                <polyline fill="rgba(34,197,94,0.25)"  stroke="rgba(34,197,94,0.7)"  strokeWidth="0.5" points={pts(histogram.g)}/>
                <polyline fill="rgba(96,165,250,0.25)" stroke="rgba(96,165,250,0.7)" strokeWidth="0.5" points={pts(histogram.b)}/>
              </svg>
            </div>
            <div className="flex gap-3 mt-1.5">
              {(['R','G','B'] as const).map((ch, i) => {
                const vals = [histogram.r, histogram.g, histogram.b][i];
                const total = vals.reduce((a, v) => a + v, 0) || 1;
                const mean = Math.round(vals.reduce((a, v, j) => a + v * j, 0) / total);
                const colors = ['text-red-400','text-green-400','text-primary'];
                return (
                  <span key={ch} className={`text-[11px] ${colors[i]}`}>{ch} {mean}</span>
                );
              })}
            </div>
          </CollapsiblePanel>
        );
      })()}

    </>
  );

  const rightSidebar = colorSidebarOpen && image && (
    <>
      {/* ── Color Wheels panel ── */}
      <CollapsiblePanel id="wheels" title="Color Wheels">
        <div className="space-y-4">
          {([
            { key: 'lift'  as const, label: 'Shadows'    },
            { key: 'gamma' as const, label: 'Midtones'   },
            { key: 'gain'  as const, label: 'Highlights' },
          ]).map(({ key, label }) => {
            const w = colorWheels[key];
            const active = isWheelActive(w);
            return (
              <div key={key} className={`rounded-lg p-3 border transition-colors ${active ? 'border-primary/50 bg-zinc-900/80' : 'border-zinc-700/60 bg-zinc-900'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-semibold uppercase tracking-wider ${active ? 'text-primary' : 'text-zinc-400'}`}>{label}</span>
                  {active && (
                    <button
                      onClick={() => updateWheel(key, { x: 0, y: 0, luma: 0 })}
                      className="text-[10px] text-zinc-400 hover:text-red-400 flex items-center gap-0.5 transition-colors"
                    >
                      <RefreshCw size={9}/> Reset
                    </button>
                  )}
                </div>

                <div className="flex gap-3 items-start">
                  {/* Wheel */}
                  <ColorWheel
                    label=""
                    size={72}
                    value={{ x: w.x, y: w.y }}
                    onChange={({ x, y }) => updateWheel(key, { x, y })}
                  />

                  {/* Luma slider + readouts */}
                  <div className="flex-1 pt-1 space-y-2">
                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-[10px] text-zinc-400">Luma</span>
                        <span className="text-[10px] text-zinc-400 tabular-nums">
                          {w.luma > 0 ? '+' : ''}{w.luma}
                        </span>
                      </div>
                      <ShadSlider
                        min={-100} max={100} value={[w.luma]}
                        onValueChange={([v]) => updateWheel(key, { luma: v })}
                        className="w-full"
                      />
                    </div>
                    {(w.x !== 0 || w.y !== 0) && (
                      <div className="text-[10px] text-zinc-400 tabular-nums">
                        x {w.x.toFixed(2)}  y {w.y.toFixed(2)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {(isWheelActive(colorWheels.lift) || isWheelActive(colorWheels.gamma) || isWheelActive(colorWheels.gain)) && (
            <button
              onClick={() => setColorWheels({ lift: {x:0,y:0,luma:0}, gamma: {x:0,y:0,luma:0}, gain: {x:0,y:0,luma:0} })}
              className="w-full text-[10px] text-zinc-400 hover:text-red-400 transition-colors py-1"
            >
              Reset all wheels
            </button>
          )}

          <p className="text-[10px] text-zinc-400 leading-snug">
            Drag wheels to push color into shadows, midtones, or highlights. Double-click a wheel to reset it.
          </p>
        </div>
      </CollapsiblePanel>

      {/* ── HSL panel ── */}
      <CollapsiblePanel id="hsl" title="HSL" defaultOpen={false}>
        <div className="space-y-3">
          {/* Band swatches */}
          <div className="grid grid-cols-4 gap-1.5">
            {HSL_BANDS.map(band => (
              <button
                key={band.key}
                onClick={() => setSelectedBand(band.key)}
                title={band.label}
                className="relative rounded-md h-8 flex items-center justify-center text-[10px] font-semibold transition-all"
                style={{
                  background: band.color,
                  color: band.textColor,
                  outline: selectedBand === band.key ? '2px solid white' : 'none',
                  outlineOffset: '1px',
                  opacity: isBandActive(band.key) ? 1 : 0.5,
                }}
              >
                {band.label.slice(0, 3)}
                {isBandActive(band.key) && (
                  <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-white opacity-90"/>
                )}
              </button>
            ))}
          </div>

          {(() => {
            const band  = HSL_BANDS.find(b => b.key === selectedBand)!;
            const adj   = hslAdjustments[selectedBand];
            const active = isBandActive(selectedBand);
            return (
              <div className={`rounded-lg p-3 border space-y-2.5 ${active ? 'border-primary/50 bg-zinc-900/80' : 'border-zinc-700/60 bg-zinc-900'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium" style={{ color: band.color }}>{band.label}</span>
                  {active && (
                    <button
                      onClick={() => setHslAdjustments(prev => ({ ...prev, [selectedBand]: defaultBand(selectedBand) }))}
                      className="text-[10px] text-zinc-400 hover:text-red-400 flex items-center gap-0.5 transition-colors"
                    >
                      <RefreshCw size={9}/> Reset
                    </button>
                  )}
                </div>
                {/* Hue range picker */}
                <HueRangePicker
                  center={adj.center}
                  halfWidth={adj.halfWidth}
                  onChange={(c, hw) => setHslAdjustments(prev => ({
                    ...prev,
                    [selectedBand]: { ...prev[selectedBand], center: c, halfWidth: hw },
                  }))}
                />

                <div className="border-t border-zinc-700/60"/>

                {([
                  { field: 'hue'        as const, label: 'Hue Shift',  min: -180, max: 180, unit: '°' },
                  { field: 'saturation' as const, label: 'Saturation', min: -100, max: 100, unit: ''  },
                  { field: 'lightness'  as const, label: 'Lightness',  min: -100, max: 100, unit: ''  },
                ]).map(({ field, label: fl, min, max, unit }) => (
                  <div key={field}>
                    <div className="flex justify-between mb-1">
                      <span className="text-xs text-zinc-300">{fl}</span>
                      <span className="text-xs text-zinc-400 tabular-nums">
                        {adj[field] > 0 ? '+' : ''}{adj[field]}{unit}
                      </span>
                    </div>
                    <ShadSlider
                      min={min} max={max} value={[adj[field]]}
                      onValueChange={([v]) => updateBand(selectedBand, field, v)}
                      className="w-full"
                    />
                  </div>
                ))}
              </div>
            );
          })()}

          {HSL_BANDS.some(b => isBandActive(b.key)) && (
            <div className="border-t border-zinc-700 pt-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-zinc-400 uppercase tracking-wide">Active</span>
                <button
                  onClick={() => setHslAdjustments(defaultHslAdjustments())}
                  className="text-[10px] text-zinc-400 hover:text-red-400 transition-colors"
                >
                  Reset all
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {HSL_BANDS.filter(b => isBandActive(b.key)).map(b => (
                  <span key={b.key} className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: b.color + '33', color: b.color, border: `1px solid ${b.color}44` }}>
                    {b.label.slice(0, 3)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </CollapsiblePanel>

    </>
  );

  return (
    <StudioShell header={header} sidebar={sidebar} sidebarOpen={sidebarOpen} onSidebarClose={() => setSidebarOpen(false)}
      rightSidebar={rightSidebar} overlay={isProcessing && <LoadingOverlay message={processingMessage}/>}>
      {imageDimensions && (
        <InfoBar left={`${imageDimensions.width} × ${imageDimensions.height} px`}
          right={<>
            <span className="text-foreground font-medium">{filterMeta[filter]?.name ?? 'Original'}</span>
            {filterMeta[filter] && <><span className="text-zinc-600">·</span><span>{filterMeta[filter].group}</span></>}
          </>}/>
      )}
      <div ref={viewportRef} className="flex-1 flex items-center justify-center p-4 overflow-hidden"
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
        style={{ cursor: isPanning ? 'grabbing' : zoom > 1 ? 'grab' : 'default' }}>
        {!image ? (
          <EmptyState icon={<Upload size={64}/>} title="Upload an image to begin" hint="Rock art · Archaeology · Natural science"/>
        ) : (
          <div className="relative max-w-full max-h-full flex items-center justify-center"
            style={{ transform:`scale(${zoom}) translate(${panX/zoom}px,${panY/zoom}px)`, transformOrigin:'center center', transition:isPanning?'none':'transform 0.1s ease-out' }}>
            <canvas ref={canvasRef} className="border border-border shadow-2xl"
              style={{ maxWidth:'100%', maxHeight:'calc(100vh - 120px)', objectFit:'contain', pointerEvents:'none',
                imageRendering: renderingMode==='smooth'?'auto':renderingMode==='crisp'?'crisp-edges':'pixelated' }}/>
            {isEditing && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded">
                <div className="flex flex-col items-center gap-2">
                  <svg className="animate-spin h-8 w-8 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                  </svg>
                  <span className="text-sm text-white font-medium">Processing…</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <canvas ref={originalCanvasRef} className="hidden"/>
    </StudioShell>
  );
};

export default Studio;
