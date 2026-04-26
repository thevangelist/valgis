import { useRef, useEffect, useCallback } from 'react';

// ── Inline HSL → RGB (avoids worker import in component) ─────────────────────

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1/6) return p + (q - p) * 6 * t;
  if (t < 1/2) return q;
  if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
  return p;
}

function hslToRgb255(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) { const v = l * 255; return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hn = h / 360;
  return [hue2rgb(p, q, hn + 1/3) * 255, hue2rgb(p, q, hn) * 255, hue2rgb(p, q, hn - 1/3) * 255];
}

// ─────────────────────────────────────────────────────────────────────────────

export interface WheelValue { x: number; y: number; }

interface Props {
  value: WheelValue;
  onChange: (v: WheelValue) => void;
  label: string;
  size?: number;
}

export function ColorWheel({ value, onChange, label, size = 64 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging  = useRef(false);

  // Draw wheel gradient + indicator dot
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const r = size / 2;
    const imgData = ctx.createImageData(size, size);

    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const dx = (px - r) / (r - 1);
        const dy = (py - r) / (r - 1);
        const dist = Math.sqrt(dx * dx + dy * dy);
        const idx = (py * size + px) * 4;
        if (dist > 1) { imgData.data[idx + 3] = 0; continue; }

        const hue = ((Math.atan2(-dy, dx) * 180 / Math.PI) + 360) % 360;
        // Slightly lighter center for legibility
        const l = 0.45 + (1 - dist) * 0.15;
        const [rv, gv, bv] = hslToRgb255(hue, dist, l);
        // Vignette edge
        const edge = 1 - Math.pow(Math.max(0, dist - 0.85) / 0.15, 2) * 0.4;
        imgData.data[idx]     = rv * edge;
        imgData.data[idx + 1] = gv * edge;
        imgData.data[idx + 2] = bv * edge;
        imgData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Indicator dot
    const dotX = r + value.x * (r - 5);
    const dotY = r + value.y * (r - 5);
    ctx.beginPath(); ctx.arc(dotX, dotY, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill();
    ctx.beginPath(); ctx.arc(dotX, dotY, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = 'white'; ctx.fill();
  }, [size, value]);

  const clampToCircle = (rawX: number, rawY: number): WheelValue => {
    const dist = Math.sqrt(rawX * rawX + rawY * rawY);
    if (dist <= 1) return { x: rawX, y: rawY };
    return { x: rawX / dist, y: rawY / dist };
  };

  const eventToValue = useCallback((clientX: number, clientY: number): WheelValue => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((clientY - rect.top) / rect.height) * 2 - 1;
    return clampToCircle(x, y);
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    onChange(eventToValue(e.clientX, e.clientY));
  }, [eventToValue, onChange]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    dragging.current = true;
    onChange(eventToValue(e.touches[0].clientX, e.touches[0].clientY));
  }, [eventToValue, onChange]);

  const onDblClick = useCallback(() => { onChange({ x: 0, y: 0 }); }, [onChange]);

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current) return;
      const { clientX, clientY } = 'touches' in e ? e.touches[0] : e;
      onChange(eventToValue(clientX, clientY));
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [eventToValue, onChange]);

  const isDeflected = value.x !== 0 || value.y !== 0;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={size}
          height={size}
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
          onDoubleClick={onDblClick}
          title="Drag to push color. Double-click to reset."
          className="rounded-full cursor-crosshair block"
          style={{ width: size, height: size }}
        />
        {/* Outer ring */}
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{ boxShadow: isDeflected ? 'inset 0 0 0 1.5px rgba(255,255,255,0.4)' : 'inset 0 0 0 1px rgba(255,255,255,0.12)' }}
        />
      </div>
      <span className={`text-[10px] uppercase tracking-widest ${isDeflected ? 'text-white' : 'text-gray-500'}`}>{label}</span>
    </div>
  );
}
