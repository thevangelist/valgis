import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

export interface Chip<K extends string> { key: K; label: string; title?: string; }

const CHIP = "h-6 px-2 text-xs font-medium rounded-md border border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white aria-pressed:bg-zinc-600 aria-pressed:border-zinc-500 aria-pressed:text-white transition-colors";

type Props<K extends string> =
  | { chips: Chip<K>[]; value: K; onChange: (k: K) => void; multiple?: false; className?: string }
  | { chips: Chip<K>[]; value: K[]; onChange: (k: K[]) => void; multiple: true; className?: string };

// Single-select picks the last clicked chip; multi-select passes the whole set.
export function ChipGroup<K extends string>(p: Props<K>) {
  const value = p.multiple ? p.value : [p.value];
  return (
    <ToggleGroup
      multiple={p.multiple}
      value={value}
      onValueChange={(vals: unknown[]) => {
        const ks = vals as K[];
        if (p.multiple) p.onChange(ks);
        else if (ks.length) p.onChange(ks[ks.length - 1]);
      }}
      className={p.className ?? 'flex flex-wrap gap-1 justify-start w-full'}
    >
      {p.chips.map(c => (
        <ToggleGroupItem key={c.key} value={c.key} title={c.title} className={CHIP}>{c.label}</ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
