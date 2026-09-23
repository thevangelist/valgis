import type { ReactNode } from 'react';
import { Menu, X, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StudioModeSwitch } from '@/components/StudioModeSwitch';
import type { StudioMode } from '@/components/StudioModeSwitch';

export function StudioHeader({ mode, onMode, onBack, sidebarOpen, onSidebarToggle, center, actions }: {
  mode: StudioMode;
  onMode: (m: StudioMode) => void;
  onBack: () => void;
  sidebarOpen: boolean;
  onSidebarToggle: () => void;
  center?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <header className="bg-background border-b border-border px-3 md:px-6 py-3">
      <div className="flex items-center justify-between gap-2 md:gap-4">
        <div className="flex items-center gap-2 md:gap-4">
          <Button variant="outline" size="icon" className="md:hidden" onClick={onSidebarToggle}
            aria-label={sidebarOpen ? 'Close panel' : 'Open panel'} aria-expanded={sidebarOpen}>
            {sidebarOpen ? <X size={18}/> : <Menu size={18}/>}
          </Button>
          <button onClick={onBack} className="flex items-center rounded-md" aria-label="Back to home">
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Valgis" className="h-7 md:h-8" />
          </button>
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ChevronLeft size={16} /> <span className="hidden md:inline">Home</span>
          </Button>
          <StudioModeSwitch mode={mode} onChange={onMode} />
        </div>
        {center && <div className="hidden md:flex items-center">{center}</div>}
        <div className="flex gap-1 md:gap-2">{actions}</div>
      </div>
    </header>
  );
}

// Small labelled option group for the header, e.g. Render: Smooth | Crisp.
export function HeaderOptionGroup<K extends string>({ label, options, value, onChange }: {
  label: string; options: { key: K; label: string }[]; value: K; onChange: (k: K) => void;
}) {
  return (
    <div className="flex items-center gap-1 bg-card rounded-md p-1 border border-border" role="group" aria-label={label}>
      <span className="text-xs text-muted-foreground px-1">{label}:</span>
      {options.map(o => (
        <Button key={o.key} variant="ghost" size="sm" active={value === o.key} aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}
