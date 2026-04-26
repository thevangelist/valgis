import { useRef, useEffect, useCallback } from 'react';

// ── Draw a full hue spectrum into a canvas ────────────────────────────────────

function drawSpectrum(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height;
  for (let x = 0; x < w; x++) {
    ctx.fillStyle = `hsl(${(x / w) * 360}, 80%, 55%)`;
    ctx.fillRect(x, 0, 1, h);
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  center: number;    // 0–359
  halfWidth: number; // 5–90
  onChange: (center: number, halfWidth: number) => void;
}

export function HueRangePicker({ center: centerRaw, halfWidth: halfWidthRaw, onChange }: Props) {
  const center    = (isNaN(centerRaw)    || centerRaw    == null) ? 0  : centerRaw;
  const halfWidth = (isNaN(halfWidthRaw) || halfWidthRaw == null) ? 45 : halfWidthRaw;

  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const drag       = useRef<'left' | 'right' | 'center' | null>(null);
  const startX     = useRef(0);
  const startC     = useRef(0);
  const startH     = useRef(0);

  // Draw spectrum once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawSpectrum(canvas);
  }, []);

  // Convert hue (0–360) → percentage across the strip
  const hueToPct = (h: number) => ((h % 360 + 360) % 360) / 360 * 100;

  const lo = hueToPct(center - halfWidth);
  const hi = hueToPct(center + halfWidth);
  const wraps = lo > hi; // band crosses the 0°/360° seam

  const onPointerDown = useCallback((
    e: React.PointerEvent,
    part: 'left' | 'right' | 'center',
  ) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current   = part;
    startX.current = e.clientX;
    startC.current = center;
    startH.current = halfWidth;
  }, [center, halfWidth]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current || !overlayRef.current) return;
    const strip = overlayRef.current.getBoundingClientRect();
    const dx = (e.clientX - startX.current) / strip.width * 360;

    if (drag.current === 'center') {
      onChange(((startC.current + dx) % 360 + 360) % 360, startH.current);
    } else if (drag.current === 'left') {
      const newHW = Math.min(90, Math.max(5, startH.current - dx));
      onChange(startC.current, newHW);
    } else {
      const newHW = Math.min(90, Math.max(5, startH.current + dx));
      onChange(startC.current, newHW);
    }
  }, [onChange]);

  const onPointerUp = useCallback(() => { drag.current = null; }, []);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500 uppercase tracking-wide">Hue Range</span>
        <span className="text-[10px] text-gray-500 tabular-nums">
          {Math.round((center - halfWidth + 360) % 360)}° – {Math.round((center + halfWidth) % 360)}°
          <span className="text-gray-600 ml-1">({Math.round(halfWidth * 2)}° wide)</span>
        </span>
      </div>

      {/* Spectrum strip + handles */}
      <div
        ref={overlayRef}
        className="relative h-5 rounded overflow-hidden select-none"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <canvas ref={canvasRef} width={256} height={20} className="absolute inset-0 w-full h-full"/>

        {/* Dark overlay outside the range */}
        {!wraps ? (
          <>
            <div className="absolute inset-y-0 bg-black/60" style={{ left: 0, right: `${100 - lo}%` }}/>
            <div className="absolute inset-y-0 bg-black/60" style={{ left: `${hi}%`, right: 0 }}/>
          </>
        ) : (
          /* Wrapping band: only darken the gap between hi and lo */
          <div className="absolute inset-y-0 bg-black/60" style={{ left: `${hi}%`, right: `${100 - lo}%` }}/>
        )}

        {/* Center drag zone */}
        <div
          className="absolute inset-y-0 cursor-ew-resize"
          style={!wraps
            ? { left: `${lo}%`, right: `${100 - hi}%` }
            : { left: `${hi}%`, right: `${100 - lo}%`, display: 'none' } // simplified: just use handles for wrapping case
          }
          onPointerDown={e => onPointerDown(e, 'center')}
        />

        {/* Left handle (low edge) */}
        <div
          className="absolute inset-y-0 w-2 cursor-col-resize flex items-center justify-center"
          style={{ left: `calc(${lo}% - 4px)` }}
          onPointerDown={e => onPointerDown(e, 'left')}
        >
          <div className="w-0.5 h-3/4 bg-white/90 rounded-full"/>
        </div>

        {/* Right handle (high edge) */}
        <div
          className="absolute inset-y-0 w-2 cursor-col-resize flex items-center justify-center"
          style={{ left: `calc(${hi}% - 4px)` }}
          onPointerDown={e => onPointerDown(e, 'right')}
        >
          <div className="w-0.5 h-3/4 bg-white/90 rounded-full"/>
        </div>

        {/* Center dot */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-white border border-black/30 cursor-ew-resize"
          style={{ left: `calc(${hueToPct(center)}% - 4px)` }}
          onPointerDown={e => onPointerDown(e, 'center')}
        />
      </div>
    </div>
  );
}
