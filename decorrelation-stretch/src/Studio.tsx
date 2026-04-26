import { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Download, RotateCcw, Eye, Menu, X, ZoomIn, ZoomOut, Maximize2, RefreshCw, Maximize, ChevronLeft, Palette } from 'lucide-react';
import heic2any from 'heic2any';
import UTIF from 'utif';
import { useImageProcessor } from './hooks/useImageProcessor';
import type { ProcessOptions } from './hooks/useImageProcessor';
import type { HslBandKey, HslBandAdjustment, HslAdjustments, WheelValue, ColorWheelAdjustments } from './worker/imageProcessor';
import { ColorWheel } from './components/ColorWheel';
import { HueRangePicker } from './components/HueRangePicker';
import { Slider as ShadSlider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
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
      adaptive: { name: 'Adaptive',  desc: 'Context-aware stretch. Reduces green cast, enhances dark areas.' },
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

const Studio = ({ onBack }: { onBack?: () => void } = {}) => {
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
  const [lightingPreset,   setLightingPreset  ] = useState('none');
  const [renderingMode,    setRenderingMode   ] = useState<'smooth'|'crisp'|'pixelated'>('smooth');

  const [image,            setImage           ] = useState<HTMLImageElement | null>(null);
  const [imageDimensions,  setImageDimensions ] = useState<{width:number;height:number}|null>(null);
  const [originalFormat,   setOriginalFormat  ] = useState<'jpeg'|'png'|'webp'>('png');
  const [isDragging,       setIsDragging      ] = useState(false);
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
  const [colorTab,         setColorTab        ] = useState<'wheels' | 'hsl'>('wheels');
  const [colorWheels,      setColorWheels     ] = useState<ColorWheelAdjustments>({
    lift:  { x: 0, y: 0, luma: 0 },
    gamma: { x: 0, y: 0, luma: 0 },
    gain:  { x: 0, y: 0, luma: 0 },
  });

  const canvasRef         = useRef<HTMLCanvasElement>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const originalImageRef  = useRef<HTMLImageElement | null>(null);

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
      filter, brightness, contrast, saturation,
      shadowRecovery, highlightRecovery, clarity, dehaze,
      noiseReduction, noiseAlgorithm, sharpening, sharpenAlgorithm,
      hslAdjustments,
      colorWheels,
    };

    setIsEditing(true);
    process(origCanvas, opts);
  }, [
    image, filter, brightness, contrast, saturation,
    shadowRecovery, highlightRecovery, clarity, dehaze,
    noiseReduction, noiseAlgorithm, sharpening, sharpenAlgorithm,
    hslAdjustments, colorWheels, showOriginal,
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

  const loadImageToOriginalCanvas = (img: HTMLImageElement) => {
    const canvas = originalCanvasRef.current;
    if (!canvas) return;
    canvas.width  = img.width;
    canvas.height = img.height;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    originalImageRef.current = img;
    setImage(img);
    setImageDimensions({ width: img.width, height: img.height });
  };

  const processImageFile = async (file: File) => {
    setIsProcessing(true);
    setProcessingMessage('Loading image...');

    setOriginalFormat(
      file.type === 'image/jpeg' || /\.(jpg|jpeg)$/i.test(file.name) ? 'jpeg' :
      file.type === 'image/webp' || /\.webp$/i.test(file.name)       ? 'webp' : 'png',
    );

    let fileToProcess = file;

    if (/\.(heic|heif)$/i.test(file.name) || /heic|heif/.test(file.type)) {
      try {
        setProcessingMessage('Converting HEIC image...');
        const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 1 });
        fileToProcess = new File(
          [Array.isArray(blob) ? blob[0] : blob],
          file.name.replace(/\.heic$/i, '.jpg'),
          { type: 'image/jpeg' },
        );
      } catch {
        alert('Failed to convert HEIC image.');
        setIsProcessing(false); setProcessingMessage(''); return;
      }
    }

    if (/\.(tiff?|tif)$/i.test(file.name) || /tiff?/.test(file.type)) {
      try {
        setProcessingMessage('Converting TIFF image...');
        const buf = await file.arrayBuffer();
        const ifds = UTIF.decode(buf);
        UTIF.decodeImage(buf, ifds[0]);
        const rgba = UTIF.toRGBA8(ifds[0]);
        const cvs  = document.createElement('canvas');
        cvs.width  = ifds[0].width;
        cvs.height = ifds[0].height;
        const id   = cvs.getContext('2d')!.createImageData(cvs.width, cvs.height);
        id.data.set(rgba);
        cvs.getContext('2d')!.putImageData(id, 0, 0);
        const tblob = await new Promise<Blob>((res, rej) => cvs.toBlob(b => b ? res(b) : rej(), 'image/png'));
        fileToProcess = new File([tblob], file.name.replace(/\.tiff?$/i, '.png'), { type: 'image/png' });
      } catch {
        alert('Failed to convert TIFF image.');
        setIsProcessing(false); setProcessingMessage(''); return;
      }
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload  = () => { loadImageToOriginalCanvas(img); setIsProcessing(false); setProcessingMessage(''); };
      img.onerror = () => { alert('Failed to load image.'); setIsProcessing(false); setProcessingMessage(''); };
      img.src = ev.target!.result as string;
    };
    reader.onerror = () => { alert('Failed to read file.'); setIsProcessing(false); setProcessingMessage(''); };
    reader.readAsDataURL(fileToProcess);
  };

  // ── Drag & Drop ──────────────────────────────────────────────────────────────

  const handleDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop      = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.type.startsWith('image/') || /\.(heic|heif|tiff?)$/i.test(file.name)))
      processImageFile(file);
  };

  // ── Download ─────────────────────────────────────────────────────────────────

  const downloadImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsDownloading(true);
    const fmts = { jpeg:{mime:'image/jpeg',ext:'jpg',q:0.95}, png:{mime:'image/png',ext:'png',q:1}, webp:{mime:'image/webp',ext:'webp',q:0.95} };
    const fmt  = fmts[originalFormat];
    const ts   = new Date().toISOString().replace(/[:.]/g,'-').slice(0,-5);
    const a    = document.createElement('a');
    a.download  = `valgis-${filter}-${ts}.${fmt.ext}`;
    a.href      = canvas.toDataURL(fmt.mime, fmt.q);
    a.click();
    setTimeout(() => setIsDownloading(false), 500);
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

  const handleWheel     = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(z => Math.min(Math.max(e.deltaY < 0 ? z * 1.25 : z / 1.25, 0.1), 10)); }
  };
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
    setHslAdjustments(prev => {
      const existing = prev[key];
      return {
        ...prev,
        [key]: {
          center:    existing.center    ?? BAND_DEFAULTS[key].center,
          halfWidth: existing.halfWidth ?? BAND_DEFAULTS[key].halfWidth,
          ...existing,
          [field]: value,
        },
      };
    });
  };

  const isBandActive = (key: HslBandKey) => {
    const b = hslAdjustments[key];
    return b.hue !== 0 || b.saturation !== 0 || b.lightness !== 0;
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Slider helper
  // ─────────────────────────────────────────────────────────────────────────────

  type SliderProps = {
    label: string; value: number; min: number; max: number; defaultVal: number;
    onChange: (v: number) => void; title?: string;
  };
  const Slider = ({ label, value, min, max, defaultVal, onChange, title }: SliderProps) => (
    <div>
      <div className="flex justify-between items-center mb-1.5" title={title}>
        <span className="text-xs font-medium text-gray-300">{label}</span>
        <span className="flex items-center gap-1">
          <span className="text-xs text-gray-400">{value}%</span>
          {value !== defaultVal && (
            <button onClick={() => onChange(defaultVal)} className="text-gray-600 hover:text-gray-300 transition-colors" title={`Reset to ${defaultVal}`}>
              <RefreshCw size={10} />
            </button>
          )}
        </span>
      </div>
      <ShadSlider
        min={min} max={max}
        value={[value]}
        onValueChange={(vals) => { const v = Array.isArray(vals) ? vals[0] : vals; onChange(v as number); }}
        className="w-full"
      />
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen bg-gray-900 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-gray-950 border-b border-gray-800 px-3 md:px-6 py-3">
        <div className="flex items-center justify-between gap-2 md:gap-4">
          <div className="flex items-center gap-2 md:gap-4">
            <button onClick={() => setSidebarOpen(o => !o)} className="md:hidden bg-gray-800 hover:bg-gray-700 border border-gray-700 p-2 rounded-md">
              {sidebarOpen ? <X size={20}/> : <Menu size={20}/>}
            </button>
            <div>
              <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Valgis" className="h-7 md:h-8" />
            </div>
            {onBack && (
              <button onClick={onBack} className="hidden md:flex items-center gap-1 text-gray-400 hover:text-white text-sm transition-colors">
                <ChevronLeft size={16} /> Home
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 md:gap-2">
            {image && (
              <>
                <button
                  onClick={() => setShowOriginal(s => !s)}
                  className={`border px-2 md:px-3 py-1.5 md:py-2 rounded-md text-xs md:text-sm flex items-center gap-1 md:gap-2 transition-colors ${showOriginal ? 'bg-zinc-600 border-zinc-500 text-white' : 'bg-gray-800 border-gray-700 hover:bg-gray-700 text-gray-300'}`}
                >
                  <Eye size={14}/>
                  <span className="hidden sm:inline">{showOriginal ? 'Edited' : 'Original'}</span>
                </button>
                <div className="hidden md:flex items-center gap-1 bg-gray-900 rounded-md p-1 border border-gray-700">
                  <span className="text-xs text-gray-500 px-1">Render:</span>
                  {(['smooth','crisp','pixelated'] as const).map(m => (
                    <button key={m} onClick={() => setRenderingMode(m)}
                      className={`px-2 py-1 rounded-md text-xs transition-colors ${renderingMode===m ? 'bg-zinc-600 text-white' : 'bg-transparent text-gray-400 hover:text-white'}`}>
                      {m.charAt(0).toUpperCase()+m.slice(1,m==='pixelated'?5:undefined)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="flex gap-1 md:gap-2">
            {image && (
              <>
                <button
                  onClick={() => setColorSidebarOpen(o => !o)}
                  title="Color Mixer"
                  className={`hidden md:flex items-center gap-1.5 px-2 md:px-3 py-1.5 md:py-2 rounded-md border text-xs md:text-sm transition-colors ${colorSidebarOpen ? 'bg-zinc-600 border-zinc-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}
                >
                  <Palette size={14}/>
                  <span className="hidden lg:inline">Color</span>
                </button>
                <div className="flex items-center bg-gray-800 border border-gray-700 rounded-md overflow-hidden">
                  <button onClick={() => setZoom(z => Math.max(z/1.25,0.1))} className="hover:bg-gray-700 px-2 py-1.5 md:py-2 text-gray-300 hover:text-white transition-colors"><ZoomOut size={14}/></button>
                  <button onClick={() => { setZoom(1); setPanX(0); setPanY(0); }} className="hover:bg-gray-700 px-2 py-1.5 md:py-2 text-gray-300 hover:text-white border-x border-gray-700 transition-colors"><Maximize2 size={14}/></button>
                  <button onClick={handleZoom100} className="hover:bg-gray-700 px-2 py-1.5 md:py-2 text-gray-300 hover:text-white border-r border-gray-700 transition-colors"><Maximize size={14}/></button>
                  <button onClick={() => setZoom(z => Math.min(z*1.25,10))} className="hover:bg-gray-700 px-2 py-1.5 md:py-2 text-gray-300 hover:text-white border-r border-gray-700 transition-colors"><ZoomIn size={14}/></button>
                  <span className="hidden md:inline text-xs text-gray-500 px-2 min-w-[3rem] text-center tabular-nums">{Math.round(zoom*100)}%</span>
                </div>
                <button onClick={resetSettings} className="bg-gray-800 hover:bg-gray-700 border border-gray-700 px-2 md:px-3 py-1.5 md:py-2 rounded-md text-xs md:text-sm flex items-center gap-1 text-gray-300 hover:text-white transition-colors">
                  <RotateCcw size={14}/><span className="hidden lg:inline">Reset</span>
                </button>
              </>
            )}
            <button onClick={downloadImage} disabled={!image||isDownloading}
              className="bg-white hover:bg-zinc-100 text-black disabled:bg-gray-800 disabled:text-gray-500 disabled:border-gray-700 disabled:cursor-not-allowed border border-transparent px-2 md:px-4 py-1.5 md:py-2 rounded-md text-xs md:text-sm flex items-center gap-1 md:gap-2 font-medium transition-colors">
              <Download size={14} className={isDownloading?'animate-bounce':''}/>
              <span className="hidden sm:inline">{isDownloading?'Saving...':'Download'}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <div className={`${sidebarOpen?'translate-x-0':'-translate-x-full'} md:translate-x-0 fixed md:relative z-20 w-80 bg-gray-800 border-r border-gray-700 flex flex-col overflow-hidden h-full transition-transform duration-300`}>
          <div className="flex-1 overflow-y-auto">
            <div className="p-2.5 md:p-3 space-y-2">

              {/* Upload */}
              <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                className={`flex items-center justify-center w-full px-3 py-4 bg-gray-700 rounded-lg border-2 border-dashed cursor-pointer transition ${isDragging?'border-blue-400 bg-blue-500/10':'border-gray-600 hover:border-blue-500'}`}>
                <label className="cursor-pointer text-center w-full">
                  <Upload className="mx-auto mb-1.5" size={20}/>
                  <span className="text-[11px] block">{isDragging?'Drop image here':'Upload or Drop Image'}</span>
                  <input type="file" accept="image/png,image/jpeg,image/jpg,image/tiff,image/tif,image/heic,image/heif,image/webp,.png,.jpg,.jpeg,.tiff,.tif,.heic,.heif"
                    onChange={e => e.target.files?.[0] && processImageFile(e.target.files[0])} className="hidden"/>
                </label>
              </div>

              {/* ── Lighting preset ── */}
              <div className="bg-gray-900 rounded-lg p-3 border border-gray-700/60">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Lighting Conditions</span>
                  <span className="text-[11px] text-gray-500">sets sliders below</span>
                </div>
                <Select value={lightingPreset} onValueChange={v => v && applyLightingPreset(v)}>
                  <SelectTrigger className="w-full bg-gray-700 border-gray-600 text-gray-200 text-xs h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(lightingPresets).map(([k, p]) => (
                      <SelectItem key={k} value={k}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {lightingPreset !== 'none' && (
                  <p className="text-xs text-gray-500 mt-1.5 leading-tight">{lightingPresets[lightingPreset as keyof typeof lightingPresets].desc}</p>
                )}
              </div>

              {/* ── Spectral filters ── */}
              <div className="bg-gray-900 rounded-lg p-3 border border-gray-700/60">
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Spectral Filter</span>
                <div className="space-y-2.5">
                  {Object.entries(filterGroups).map(([gk, group]) => (
                    <div key={gk}>
                      <span className="block text-[11px] text-gray-500 mb-1">{group.title}</span>
                      <ToggleGroup
                        value={[filter]}
                        onValueChange={(vals) => { if (vals.length) setFilter(vals[vals.length - 1] as FilterName); }}
                        className="flex flex-wrap gap-1 justify-start w-full"
                      >
                        {Object.entries(group.filters).map(([k, f]) => (
                          <ToggleGroupItem
                            key={k} value={k} title={f.desc}
                            className="h-6 px-2 text-xs font-medium rounded-md border border-gray-700 bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white aria-pressed:bg-zinc-600 aria-pressed:border-zinc-500 aria-pressed:text-white transition-colors"
                          >
                            {f.name}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Basic adjustments ── */}
              <div className="bg-gray-900 rounded-lg p-3 border border-gray-700/60">
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2.5">Basic</span>
                <div className="space-y-2.5">
                  <Slider label="Brightness" value={brightness}  min={0} max={200} defaultVal={100} onChange={setBrightness}/>
                  <Slider label="Contrast"   value={contrast}    min={0} max={200} defaultVal={100} onChange={setContrast}/>
                  <Slider label="Saturation" value={saturation}  min={0} max={200} defaultVal={100} onChange={setSaturation}/>
                </div>
              </div>

              {/* ── Enhancement ── */}
              <div className="bg-gray-900 rounded-lg p-3 border border-gray-700/60">
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2.5">Enhancement</span>
                <div className="space-y-2.5">
                  <Slider label="Shadow Recovery"    value={shadowRecovery}    min={0} max={100} defaultVal={0} onChange={setShadowRecovery}/>
                  <Slider label="Highlight Recovery" value={highlightRecovery} min={0} max={100} defaultVal={0} onChange={setHighlightRecovery}/>
                  <Slider label="Clarity"            value={clarity}           min={0} max={100} defaultVal={0} onChange={setClarity}/>
                  <Slider label="Dehaze"             value={dehaze}            min={0} max={100} defaultVal={0} onChange={setDehaze}/>
                </div>
              </div>

              {/* ── Detail ── */}
              <div className="bg-gray-900 rounded-lg p-3 border border-gray-700/60">
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2.5">Detail</span>
                <div className="space-y-3">
                  {/* Noise Reduction */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-gray-300">Noise Reduction</span>
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        {noiseReduction}%
                        {noiseReduction !== 0 && <button onClick={() => setNoiseReduction(0)} className="text-gray-600 hover:text-gray-300"><RefreshCw size={10}/></button>}
                      </span>
                    </div>
                    <ShadSlider min={0} max={100} value={[noiseReduction]} onValueChange={(vals) => { const v = Array.isArray(vals) ? vals[0] : vals; setNoiseReduction(v as number); }} className="w-full mb-2"/>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-gray-500 shrink-0">Method:</span>
                      <ToggleGroup
                        value={[noiseAlgorithm]}
                        onValueChange={(vals) => { if (vals.length) setNoiseAlgorithm(vals[vals.length-1] as typeof noiseAlgorithm); }}
                        className="flex gap-1"
                      >
                        {(['median','gaussian','bilateral'] as const).map(m => (
                          <ToggleGroupItem key={m} value={m}
                            className="h-5 px-2 text-[11px] font-medium rounded-md border border-gray-700 bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white aria-pressed:bg-zinc-600 aria-pressed:border-zinc-500 aria-pressed:text-white transition-colors capitalize">
                            {m}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </div>
                  </div>
                  <div className="border-t border-gray-700/60"/>
                  {/* Sharpening */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-gray-300">Sharpening</span>
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        {sharpening}%
                        {sharpening !== 0 && <button onClick={() => setSharpening(0)} className="text-gray-600 hover:text-gray-300"><RefreshCw size={10}/></button>}
                      </span>
                    </div>
                    <ShadSlider min={0} max={100} value={[sharpening]} onValueChange={(vals) => { const v = Array.isArray(vals) ? vals[0] : vals; setSharpening(v as number); }} className="w-full mb-2"/>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-gray-500 shrink-0">Method:</span>
                      <ToggleGroup
                        value={[sharpenAlgorithm]}
                        onValueChange={(vals) => { if (vals.length) setSharpenAlgorithm(vals[vals.length-1] as typeof sharpenAlgorithm); }}
                        className="flex gap-1"
                      >
                        {(['unsharp','highpass','laplacian'] as const).map(m => (
                          <ToggleGroupItem key={m} value={m}
                            className="h-5 px-2 text-[11px] font-medium rounded-md border border-gray-700 bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white aria-pressed:bg-zinc-600 aria-pressed:border-zinc-500 aria-pressed:text-white transition-colors capitalize">
                            {m}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </div>
                  </div>
                </div>
              </div>

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
                  <div className="bg-gray-900 rounded-lg p-3 border border-gray-700/60">
                    <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Histogram</span>
                    <div className="relative h-20 bg-gray-950 rounded overflow-hidden">
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
                        const colors = ['text-red-400','text-green-400','text-blue-400'];
                        return (
                          <span key={ch} className={`text-[11px] ${colors[i]}`}>{ch} {mean}</span>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

            </div>
          </div>
        </div>

        {/* Mobile overlay */}
        {sidebarOpen && <div className="fixed inset-0 bg-black bg-opacity-50 z-10 md:hidden" onClick={() => setSidebarOpen(false)}/>}

        {/* Loading overlay */}
        {isProcessing && (
          <div className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center">
            <div className="bg-gray-800 rounded-lg p-8 flex flex-col items-center gap-4 border border-gray-700">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"/>
              <p className="text-white text-lg">{processingMessage}</p>
            </div>
          </div>
        )}

        {/* Main canvas */}
        <div className="flex-1 bg-gray-900 flex flex-col overflow-hidden">
          {imageDimensions && (
            <div className="bg-gray-800 border-b border-gray-700 px-4 py-2 text-xs text-gray-400 flex items-center justify-between">
              <span>{imageDimensions.width} × {imageDimensions.height} px</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-200 font-medium">{filterMeta[filter]?.name ?? 'Original'}</span>
                {filterMeta[filter] && <>
                  <span className="text-gray-600">·</span>
                  <span className="text-gray-500">{filterMeta[filter].group}</span>
                </>}
              </div>
            </div>
          )}

          <div className="flex-1 flex items-center justify-center p-4 overflow-hidden"
            onWheel={handleWheel} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
            style={{ cursor: isPanning ? 'grabbing' : zoom > 1 ? 'grab' : 'default' }}>
            {!image ? (
              <div className="text-center text-gray-500">
                <Upload size={64} className="mx-auto mb-4 opacity-30"/>
                <p className="text-lg mb-2">Upload an image to begin</p>
                <p className="text-sm text-gray-600">Astronomy · Rock art · Archaeology · Natural science</p>
              </div>
            ) : (
              <div className="relative max-w-full max-h-full flex items-center justify-center"
                style={{ transform:`scale(${zoom}) translate(${panX/zoom}px,${panY/zoom}px)`, transformOrigin:'center center', transition:isPanning?'none':'transform 0.1s ease-out' }}>
                <canvas ref={canvasRef} className="border border-gray-700 shadow-2xl"
                  style={{ maxWidth:'100%', maxHeight:'calc(100vh - 120px)', objectFit:'contain', pointerEvents:'none',
                    imageRendering: renderingMode==='smooth'?'auto':renderingMode==='crisp'?'crisp-edges':'pixelated' }}/>
                {isEditing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded">
                    <div className="flex flex-col items-center gap-2">
                      <svg className="animate-spin h-8 w-8 text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
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
        </div>

        {/* ── Color sidebar (right) ───────────────────────────────────── */}
        {colorSidebarOpen && image && (
          <div className="hidden md:flex flex-col w-64 bg-gray-800 border-l border-gray-700 shrink-0">

            {/* Tab bar */}
            <div className="flex border-b border-gray-700 shrink-0">
              {(['wheels', 'hsl'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setColorTab(tab)}
                  className={`flex-1 py-2 text-xs font-medium uppercase tracking-wider transition-colors ${
                    colorTab === tab
                      ? 'text-white border-b-2 border-purple-500 bg-gray-800'
                      : 'text-gray-500 hover:text-gray-300 border-b-2 border-transparent'
                  }`}
                >
                  {tab === 'wheels' ? 'Wheels' : 'HSL'}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto">

              {/* ── WHEELS tab ── */}
              {colorTab === 'wheels' && (
                <div className="p-3 space-y-4">
                  {([
                    { key: 'lift'  as const, label: 'Shadows'    },
                    { key: 'gamma' as const, label: 'Midtones'   },
                    { key: 'gain'  as const, label: 'Highlights' },
                  ]).map(({ key, label }) => {
                    const w = colorWheels[key];
                    const active = isWheelActive(w);
                    return (
                      <div key={key} className={`rounded-lg p-3 border transition-colors ${active ? 'border-purple-600/50 bg-gray-900/80' : 'border-gray-700/60 bg-gray-900'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-xs font-semibold uppercase tracking-wider ${active ? 'text-purple-300' : 'text-gray-400'}`}>{label}</span>
                          {active && (
                            <button
                              onClick={() => updateWheel(key, { x: 0, y: 0, luma: 0 })}
                              className="text-[10px] text-gray-500 hover:text-red-400 flex items-center gap-0.5 transition-colors"
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
                                <span className="text-[10px] text-gray-400">Luma</span>
                                <span className="text-[10px] text-gray-400 tabular-nums">
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
                              <div className="text-[10px] text-gray-600 tabular-nums">
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
                      className="w-full text-[10px] text-gray-500 hover:text-red-400 transition-colors py-1"
                    >
                      Reset all wheels
                    </button>
                  )}

                  <p className="text-[10px] text-gray-600 leading-snug">
                    Drag wheels to push color into shadows, midtones, or highlights. Double-click a wheel to reset it.
                  </p>
                </div>
              )}

              {/* ── HSL tab ── */}
              {colorTab === 'hsl' && (
                <div className="p-3 space-y-3">
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
                      <div className={`rounded-lg p-3 border space-y-2.5 ${active ? 'border-purple-600/50 bg-gray-900/80' : 'border-gray-700/60 bg-gray-900'}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium" style={{ color: band.color }}>{band.label}</span>
                          {active && (
                            <button
                              onClick={() => setHslAdjustments(prev => ({ ...prev, [selectedBand]: defaultBand(selectedBand) }))}
                              className="text-[10px] text-gray-500 hover:text-red-400 flex items-center gap-0.5 transition-colors"
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

                        <div className="border-t border-gray-700/60"/>

                        {([
                          { field: 'hue'        as const, label: 'Hue Shift',  min: -180, max: 180, unit: '°' },
                          { field: 'saturation' as const, label: 'Saturation', min: -100, max: 100, unit: ''  },
                          { field: 'lightness'  as const, label: 'Lightness',  min: -100, max: 100, unit: ''  },
                        ]).map(({ field, label: fl, min, max, unit }) => (
                          <div key={field}>
                            <div className="flex justify-between mb-1">
                              <span className="text-xs text-gray-300">{fl}</span>
                              <span className="text-xs text-gray-400 tabular-nums">
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
                    <div className="border-t border-gray-700 pt-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] text-gray-500 uppercase tracking-wide">Active</span>
                        <button
                          onClick={() => setHslAdjustments(defaultHslAdjustments())}
                          className="text-[10px] text-gray-500 hover:text-red-400 transition-colors"
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
              )}

            </div>
          </div>
        )}
      </div>

      <canvas ref={originalCanvasRef} className="hidden"/>
    </div>
  );
};

export default Studio;
