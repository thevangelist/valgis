import { CollapsiblePanel } from '@/components/CollapsiblePanel';
import { Slider } from '@/components/Slider';
import { ChipGroup } from '@/components/ChipGroup';
import type { Adjustments } from '@/hooks/useAdjustments';

type Props = { adj: Adjustments; set: <K extends keyof Adjustments>(k: K, v: Adjustments[K]) => void };

const GRADIENT = {
  brightness: 'linear-gradient(to right, #111 0%, #666 50%, #fff 100%)',
  contrast:   'linear-gradient(to right, hsl(0,0%,50%) 0%, hsla(0,0%,50%,0) 100%), repeating-linear-gradient(to right, #0a0a0a 0 3px, #f0f0f0 3px 6px)',
  saturation: 'linear-gradient(to right, hsl(0,0%,45%) 0%, hsl(0,0%,55%) 50%, hsl(14,70%,55%) 100%)',
  pre:        'linear-gradient(to right, hsl(210,35%,40%) 0%, hsl(0,0%,50%) 40%, hsl(30,30%,55%) 100%)',
  post:       'linear-gradient(to right, hsl(0,0%,20%) 0%, hsl(0,0%,55%) 50%, hsl(0,0%,92%) 100%)',
  shadow:     'linear-gradient(to right, #0a0a0a 0%, hsl(30,15%,40%) 100%)',
  highlight:  'linear-gradient(to right, #f8f8f8 0%, hsl(40,15%,60%) 100%)',
  clarity:    'linear-gradient(to right, hsl(0,0%,50%) 0%, hsla(0,0%,50%,0) 100%), repeating-linear-gradient(to right, #222 0 2px, #ddd 2px 4px)',
  dehaze:     'linear-gradient(to right, hsl(210,20%,55%) 0%, hsl(30,10%,35%) 100%)',
  noise:      'linear-gradient(to right, hsl(0,0%,55%) 0%, hsl(220,12%,50%) 100%)',
  sharpen:    'linear-gradient(to right, hsl(0,0%,35%) 0%, hsl(0,0%,88%) 100%)',
};

export function SectionLabel({ children }: { children: string }) {
  return <span className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-widest pt-0.5">{children}</span>;
}

export function SectionRule({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <div className="flex-1 border-t border-border"/>
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest shrink-0">{children}</span>
      <div className="flex-1 border-t border-border"/>
    </div>
  );
}

// `normalize` shows the pre/post-filter sliders, which only make sense in front of a spectral filter.
export function TonePanel({ adj, set, normalize = true }: Props & { normalize?: boolean }) {
  return (
    <CollapsiblePanel id="tone" title="Tone" enabled={adj.toneEnabled} onEnabledChange={v => set('toneEnabled', v)}>
      <div className="space-y-2.5">
        <SectionLabel>Exposure</SectionLabel>
        <Slider label="Brightness" value={adj.brightness} min={0} max={200} defaultVal={100} onChange={v => set('brightness', v)} gradient={GRADIENT.brightness}/>
        <Slider label="Contrast"   value={adj.contrast}   min={0} max={200} defaultVal={100} onChange={v => set('contrast', v)}   gradient={GRADIENT.contrast}/>
        <Slider label="Saturation" value={adj.saturation} min={0} max={200} defaultVal={100} onChange={v => set('saturation', v)} gradient={GRADIENT.saturation}/>
        {normalize && <>
          <SectionRule>Normalize</SectionRule>
          <Slider label="Pre-filter"  value={adj.preNormalize}  min={0} max={100} defaultVal={100} onChange={v => set('preNormalize', v)}  gradient={GRADIENT.pre}/>
          <Slider label="Post-filter" value={adj.postNormalize} min={0} max={100} defaultVal={100} onChange={v => set('postNormalize', v)} gradient={GRADIENT.post}/>
        </>}
      </div>
    </CollapsiblePanel>
  );
}

export function EnhancementPanel({ adj, set }: Props) {
  return (
    <CollapsiblePanel id="enhancement" title="Enhancement" enabled={adj.enhancementEnabled} onEnabledChange={v => set('enhancementEnabled', v)}>
      <div className="space-y-2.5">
        <Slider label="Shadow Recovery"    value={adj.shadowRecovery}    min={0} max={100} defaultVal={0} onChange={v => set('shadowRecovery', v)}    gradient={GRADIENT.shadow}/>
        <Slider label="Highlight Recovery" value={adj.highlightRecovery} min={0} max={100} defaultVal={0} onChange={v => set('highlightRecovery', v)} gradient={GRADIENT.highlight}/>
        <Slider label="Clarity"            value={adj.clarity}           min={0} max={100} defaultVal={0} onChange={v => set('clarity', v)}           gradient={GRADIENT.clarity}/>
        <Slider label="Dehaze"             value={adj.dehaze}            min={0} max={100} defaultVal={0} onChange={v => set('dehaze', v)}            gradient={GRADIENT.dehaze}/>
      </div>
    </CollapsiblePanel>
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function DetailPanel({ adj, set }: Props) {
  return (
    <CollapsiblePanel id="detail" title="Detail" enabled={adj.detailEnabled} onEnabledChange={v => set('detailEnabled', v)}>
      <div className="space-y-3">
        <SectionLabel>Noise</SectionLabel>
        <Slider label="Noise Reduction" value={adj.noiseReduction} min={0} max={100} defaultVal={0} onChange={v => set('noiseReduction', v)} gradient={GRADIENT.noise}/>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground shrink-0">Method:</span>
          <ChipGroup chips={(['median','gaussian','bilateral'] as const).map(m => ({ key: m, label: cap(m) }))} value={adj.noiseAlgorithm} onChange={v => set('noiseAlgorithm', v)} className="flex gap-1"/>
        </div>
        <SectionRule>Sharpen</SectionRule>
        <Slider label="Sharpening" value={adj.sharpening} min={0} max={100} defaultVal={0} onChange={v => set('sharpening', v)} gradient={GRADIENT.sharpen}/>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground shrink-0">Method:</span>
          <ChipGroup chips={(['unsharp','highpass','laplacian'] as const).map(m => ({ key: m, label: cap(m) }))} value={adj.sharpenAlgorithm} onChange={v => set('sharpenAlgorithm', v)} className="flex gap-1"/>
        </div>
      </div>
    </CollapsiblePanel>
  );
}
