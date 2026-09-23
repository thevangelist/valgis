import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Eye, EyeOff, ChevronDown, RefreshCw } from 'lucide-react';

// ─── Collapsible panel ────────────────────────────────────────────────────────

export function CollapsiblePanel({
  id, title, headerExtra, children, defaultOpen = true, enabled, onEnabledChange, onReset, dirty = false,
}: {
  id: string; title: string; headerExtra?: ReactNode;
  children: ReactNode; defaultOpen?: boolean;
  enabled?: boolean; onEnabledChange?: (v: boolean) => void;
  onReset?: () => void; dirty?: boolean;
}) {
  const storageKey = `valgis.panel.${id}`;
  const [open, setOpen] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    return stored === null ? defaultOpen : stored === '1';
  });
  useEffect(() => { localStorage.setItem(storageKey, open ? '1' : '0'); }, [storageKey, open]);

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-secondary/50 transition-colors"
      >
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</span>
        <div className="flex items-center gap-2">
          {onEnabledChange !== undefined && (
            <span
              role="switch"
              tabIndex={0}
              aria-checked={enabled !== false}
              aria-label={`${title} enabled`}
              onClick={e => { e.stopPropagation(); onEnabledChange(!enabled); }}
              onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onEnabledChange(!enabled); } }}
              className="cursor-pointer rounded"
            >
              {enabled !== false
                ? <Eye size={13} className="text-zinc-300"/>
                : <EyeOff size={13} className="text-zinc-500"/>}
            </span>
          )}
          {headerExtra}
          {onReset && dirty && (
            <span
              role="button"
              tabIndex={0}
              aria-label={`Reset ${title}`}
              title={`Reset ${title}`}
              onClick={e => { e.stopPropagation(); onReset(); }}
              onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onReset(); } }}
              className="cursor-pointer rounded text-zinc-400 hover:text-foreground"
            >
              <RefreshCw size={12}/>
            </span>
          )}
          <ChevronDown size={14} className={`text-zinc-500 transition-transform ${open ? '' : '-rotate-90'}`} />
        </div>
      </button>
      {open && <div className={`px-3 pb-3 ${enabled === false ? 'opacity-40 pointer-events-none select-none' : ''}`}>{children}</div>}
    </div>
  );
}
