import { useRef, useState, useEffect, useCallback } from 'react';
import { X, RotateCcw, Share2, Download, SlidersHorizontal, RefreshCw } from 'lucide-react';
import { useLiveCamera } from './hooks/useLiveCamera';
import type { ProcessOptions } from './worker/imageProcessor';

// ─── Filter strip ─────────────────────────────────────────────────────────────

const FILTERS = [
  { key: 'none',      label: 'Original'  },
  { key: 'adaptive',  label: 'Adaptive'  },
  { key: 'yre',       label: 'YRE'       },
  { key: 'yrd',       label: 'YRD'       },
  { key: 'crgb',      label: 'CRGB'      },
  { key: 'lab',       label: 'LAB'       },
  { key: 'autolevel', label: 'Auto'      },
  { key: 'satboost',  label: 'Sat+'      },
] as const;

type LiveFilter = (typeof FILTERS)[number]['key'];

const BASE_OPTS: ProcessOptions = {
  filter: 'none', brightness: 100, contrast: 100, saturation: 100,
  shadowRecovery: 0, highlightRecovery: 0, clarity: 0, dehaze: 0,
  noiseReduction: 0, noiseAlgorithm: 'median', sharpening: 0, sharpenAlgorithm: 'unsharp',
};

// ─── Save helper ──────────────────────────────────────────────────────────────

async function saveImage(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch { /* cancelled or unsupported */ }
  }
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ─── Compact slider ───────────────────────────────────────────────────────────

function QuickSlider({
  label, value, min, max, onChange,
}: {
  label: string; value: number; min: number; max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-white/50 text-[10px] w-6 shrink-0 text-right">{label}</span>
      <input
        type="range" min={min} max={max} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 h-1 appearance-none rounded-full bg-white/20 accent-white cursor-pointer"
      />
      <span className="text-white/40 text-[10px] w-6 tabular-nums">{value}</span>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

type Mode = 'live' | 'preview';

export default function LiveCamera({ onBack }: { onBack: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [filter, setFilter]             = useState<LiveFilter>('none');
  const [mode, setMode]                 = useState<Mode>('live');
  const [previewBlob, setPreviewBlob]   = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl]     = useState<string | null>(null);
  const [saving, setSaving]             = useState(false);
  const [showSliders, setShowSliders]   = useState(false);
  const [brightness, setBrightness]     = useState(() => Number(localStorage.getItem('valgis.brightness')) || 100);
  const [contrast, setContrast]         = useState(() => Number(localStorage.getItem('valgis.contrast'))   || 100);
  const [saturation, setSaturation]     = useState(() => Number(localStorage.getItem('valgis.saturation')) || 100);

  useEffect(() => { localStorage.setItem('valgis.brightness', String(brightness)); }, [brightness]);
  useEffect(() => { localStorage.setItem('valgis.contrast',   String(contrast));   }, [contrast]);
  useEffect(() => { localStorage.setItem('valgis.saturation', String(saturation)); }, [saturation]);

  const resetAdjustments = useCallback(() => {
    setBrightness(100); setContrast(100); setSaturation(100);
  }, []);

  const { state, error, fps, start, stop, pause, resume, setOptions, captureHighRes } =
    useLiveCamera(canvasRef);

  useEffect(() => { start(); return () => stop(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setOptions({ ...BASE_OPTS, filter, brightness, contrast, saturation });
  }, [filter, brightness, contrast, saturation, setOptions]);

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const handleShutter = useCallback(async () => {
    if (state !== 'running') return;
    pause();
    const blob = await captureHighRes();
    if (!blob) { resume(); return; }
    const url = URL.createObjectURL(blob);
    setPreviewBlob(blob);
    setPreviewUrl(url);
    setMode('preview');
  }, [state, pause, resume, captureHighRes]);

  const handleDismiss = useCallback(() => {
    setMode('live');
    setPreviewBlob(null);
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
    resume();
  }, [previewUrl, resume]);

  const handleSave = useCallback(async () => {
    if (!previewBlob) return;
    setSaving(true);
    await saveImage(previewBlob, `valgis-${filter}-${Date.now()}.png`);
    setSaving(false);
    handleDismiss();
  }, [previewBlob, filter, handleDismiss]);

  const safeTop    = { paddingTop:    'max(16px, env(safe-area-inset-top))' };
  const safeBottom = { paddingBottom: 'max(16px, env(safe-area-inset-bottom))' };

  const hasAdjustments = brightness !== 100 || contrast !== 100 || saturation !== 100;

  return (
    <div
      className="fixed inset-0 bg-black overflow-hidden select-none touch-none"
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ imageRendering: 'auto' }}
      />

      {state === 'idle' && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-white/30 text-sm pointer-events-none">
          Starting camera…
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
          <p className="text-red-400 text-sm leading-relaxed">{error}</p>
          <button onClick={start} className="bg-white/10 text-white text-sm px-5 py-2 rounded-full">
            Try again
          </button>
        </div>
      )}

      {mode === 'live' && (
        <>
          {/* Top row */}
          <div
            className="absolute top-0 inset-x-0 flex items-center justify-between px-4 pointer-events-none"
            style={safeTop}
          >
            <button
              onClick={onBack}
              className="pointer-events-auto bg-black/50 text-white p-2 rounded-full backdrop-blur-sm"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2">
              {state === 'running' && (
                <span className="bg-black/40 text-white/40 text-xs px-2 py-1 rounded-full backdrop-blur-sm tabular-nums">
                  {fps} fps
                </span>
              )}
              <button
                onClick={() => { stop(); setTimeout(start, 80); }}
                className="pointer-events-auto bg-black/50 text-white p-2 rounded-full backdrop-blur-sm"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Bottom controls */}
          <div className="absolute bottom-0 inset-x-0" style={safeBottom}>
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent pointer-events-none" />

            {/* Quick adjust sliders */}
            {showSliders && (
              <div className="relative px-5 pb-2 pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-white/40 text-[10px] uppercase tracking-wider">Adjustments</span>
                  <button
                    onClick={resetAdjustments}
                    disabled={!hasAdjustments}
                    className="flex items-center gap-1 text-white/50 text-[10px] disabled:opacity-30 active:text-white"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Reset
                  </button>
                </div>
                <QuickSlider label="B" value={brightness} min={50} max={150} onChange={setBrightness} />
                <QuickSlider label="C" value={contrast}   min={50} max={150} onChange={setContrast} />
                <QuickSlider label="S" value={saturation} min={0}  max={200} onChange={setSaturation} />
              </div>
            )}

            {/* Filter chips */}
            <div
              className="relative flex gap-1.5 px-4 pb-3 pt-6 overflow-x-auto"
              style={{ scrollbarWidth: 'none' }}
            >
              {FILTERS.map(f => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key as LiveFilter)}
                  className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    filter === f.key
                      ? 'bg-white text-black scale-105'
                      : 'bg-white/15 text-white/80 backdrop-blur-sm active:bg-white/25'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Shutter row */}
            <div className="relative flex items-center justify-center py-3">
              {/* Sliders toggle — left of shutter */}
              <button
                onClick={() => setShowSliders(v => !v)}
                className={`absolute left-8 p-2 rounded-full backdrop-blur-sm transition-colors ${
                  showSliders || hasAdjustments
                    ? 'bg-white/20 text-white'
                    : 'bg-black/40 text-white/50'
                }`}
              >
                <SlidersHorizontal className="w-5 h-5" />
              </button>

              <button
                onClick={handleShutter}
                disabled={state !== 'running'}
                className="w-16 h-16 rounded-full border-[3px] border-white/90 flex items-center justify-center disabled:opacity-30 active:scale-95 transition-transform"
              >
                <div className="w-[52px] h-[52px] rounded-full bg-white/90" />
              </button>
            </div>
          </div>
        </>
      )}

      {mode === 'preview' && previewUrl && (
        <>
          <img
            src={previewUrl}
            className="absolute inset-0 w-full h-full"
            style={{ objectFit: 'contain', background: '#000' }}
            alt="Captured frame"
          />

          <div
            className="absolute top-0 inset-x-0 flex items-center justify-between px-4"
            style={safeTop}
          >
            <button
              onClick={handleDismiss}
              className="bg-black/50 text-white p-2 rounded-full backdrop-blur-sm"
            >
              <X className="w-5 h-5" />
            </button>
            <span className="text-white/50 text-xs bg-black/40 px-2 py-1 rounded-full backdrop-blur-sm">
              {filter !== 'none' ? FILTERS.find(f => f.key === filter)?.label : 'Original'}
            </span>
          </div>

          <div
            className="absolute bottom-0 inset-x-0 flex items-center justify-between px-6 py-4"
            style={safeBottom}
          >
            <button
              onClick={handleDismiss}
              className="flex flex-col items-center gap-1 text-white/80 active:text-white"
            >
              <div className="bg-white/10 rounded-full p-3 backdrop-blur-sm">
                <X className="w-6 h-6" />
              </div>
              <span className="text-xs">Dismiss</span>
            </button>

            <button
              onClick={handleSave}
              disabled={saving}
              className="flex flex-col items-center gap-1 text-white active:opacity-70 disabled:opacity-40"
            >
              <div className="bg-white rounded-full p-3">
                {navigator.canShare != null ? (
                  <Share2 className="w-6 h-6 text-black" />
                ) : (
                  <Download className="w-6 h-6 text-black" />
                )}
              </div>
              <span className="text-xs">{saving ? 'Saving…' : 'Save'}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
