import { describe, it, expect } from 'vitest';
import { advise, autoSettings } from '../lib/advice';
import type { AstroSettings } from '../lib/advice';

const base: AstroSettings = { kind: 'mtf', target: 25, shadowClip: 28, amount: 30, tools: [] };
const neptune = { median: 775, mad: 20, min: 0, max: 44300 };     // real single L frame, Moon 16° away

describe('advise', () => {
  it('picks asinh + background + hot pixels for a bright-sky single frame with a planet', () => {
    const a = advise({ EXPTIME: '20', AIRMASS: '2.9', 'CCD-TEMP': '-25' }, [neptune]);
    expect(a.map(x => x.id)).toEqual(['stars', 'sky', 'single', 'airmass']);
    const s = autoSettings(base, a);
    expect(s.kind).toBe('asinh'); expect(s.tools.sort()).toEqual(['background', 'hot']);
  });
  it('recognises a Siril stack and does not add hot-pixel removal', () => {
    const a = advise({ STACKCNT: '15', EXPTIME: '20' }, [{ median: 0.0115, mad: 0.0003, min: 0, max: 0.68 }]);
    expect(a.find(x => x.id === 'stack')?.text).toContain('15 frames, 5 min total');
    expect(autoSettings(base, a).tools).not.toContain('hot');
  });
  it('goes hard STF on a faint, read-noise limited frame', () => {
    const a = advise({}, [{ median: 100, mad: 10, min: 0, max: 900 }]);
    expect(autoSettings(base, a)).toMatchObject({ kind: 'mtf', target: 40, shadowClip: 15 });
  });
  it('works without a header', () => {
    expect(advise(undefined, [neptune]).length).toBeGreaterThan(0);
  });
});
