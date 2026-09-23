import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export type StudioMode = 'rockart' | 'astro';

const MODES: { key: StudioMode; label: string; beta?: boolean }[] = [
  { key: 'rockart', label: 'Rock art' },
  { key: 'astro',   label: 'Astro', beta: true },
];

export function StudioModeSwitch({ mode, onChange }: { mode: StudioMode; onChange: (m: StudioMode) => void }) {
  return (
    <div className="flex items-center gap-1 bg-card rounded-md p-1 border border-border" role="group" aria-label="Studio mode">
      {MODES.map(m => (
        <Button key={m.key} variant="ghost" size="sm" active={mode === m.key} aria-pressed={mode === m.key} onClick={() => onChange(m.key)}>
          {m.label}
          {m.beta && <Badge variant="primary">Beta</Badge>}
        </Button>
      ))}
    </div>
  );
}
