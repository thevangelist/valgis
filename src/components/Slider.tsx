import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Slider as ShadSlider } from '@/components/ui/slider';

export type SliderProps = {
  label: string; value: number; min: number; max: number; defaultVal: number;
  onChange: (v: number) => void; title?: string; gradient?: string;
};
export const Slider = ({ label, value, min, max, defaultVal, onChange, title, gradient }: SliderProps) => {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState('');
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5" title={title}>
        <span className="text-xs font-medium text-zinc-300">{label}</span>
        <span className="flex items-center gap-1">
          {editing ? (
            <input
              type="number" value={editVal} autoFocus
              className="w-12 text-xs text-right bg-zinc-700 text-zinc-200 rounded px-1 outline-none tabular-nums"
              onChange={e => setEditVal(e.target.value)}
              onBlur={() => {
                const n = parseInt(editVal, 10);
                if (!isNaN(n)) onChange(Math.max(min, Math.min(max, n)));
                setEditing(false);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditing(false);
              }}
            />
          ) : (
            <button
              onClick={() => { setEditVal(String(value)); setEditing(true); }}
              className="text-xs text-zinc-400 hover:text-zinc-200 tabular-nums transition-colors min-w-[2rem] text-right"
            >
              {value}
            </button>
          )}
          {value !== defaultVal && !editing && (
            <button onClick={() => onChange(defaultVal)} className="text-zinc-400 hover:text-zinc-300 transition-colors" title={`Reset to ${defaultVal}`}>
              <RefreshCw size={10} />
            </button>
          )}
        </span>
      </div>
      <ShadSlider
        min={min} max={max} aria-label={label}
        value={[value]}
        onValueChange={(vals) => { const v = Array.isArray(vals) ? vals[0] : vals; onChange(v as number); }}
        className="w-full"
        trackGradient={gradient}
      />
    </div>
  );
};
