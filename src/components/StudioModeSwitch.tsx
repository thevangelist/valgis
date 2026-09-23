import { Button } from '@/components/ui/button';

export type StudioMode = 'rockart' | 'astro';

const MODES: { key: StudioMode; label: string }[] = [
  { key: 'rockart', label: 'Rock art' },
  { key: 'astro',   label: 'Astro' },
];

export function StudioModeSwitch({ mode, onChange }: { mode: StudioMode; onChange: (m: StudioMode) => void }) {
  return (
    <div className="flex items-center gap-1 bg-zinc-900 rounded-md p-1 border border-zinc-700" role="group" aria-label="Studio mode">
      {MODES.map(m => (
        <Button key={m.key} variant="ghost" size="sm" active={mode === m.key} aria-pressed={mode === m.key} onClick={() => onChange(m.key)}>
          {m.label}
        </Button>
      ))}
    </div>
  );
}
