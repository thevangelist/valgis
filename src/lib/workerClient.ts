// One client for the image worker. Requests are matched by id, so a capture and a
// live frame can never be confused. `latest` keeps only the newest pending job per
// channel: live preview and slider editing drop superseded frames instead of queueing.
import type { ProcessOptions } from '../worker/imageProcessor';

export interface WorkerResult { image: ImageData; skipped: string[]; }
export interface Job {
  pixels: ArrayBuffer; width: number; height: number; options: ProcessOptions;
  live?: boolean; onProgress?: (stage: string) => void;
}

interface Pending { job: Job; resolve: (r: WorkerResult) => void; reject: (e: unknown) => void; }

export class WorkerClient {
  private worker: Worker;
  private inflight = new Map<number, Pending>();
  private latest = new Map<string, Pending>();
  private busy = false;
  private seq = 0;

  constructor() {
    this.worker = new Worker(new URL('../worker/imageProcessor', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent) => this.onMessage(e.data);
    this.worker.onerror = (e) => { for (const p of this.inflight.values()) p.reject(e); this.inflight.clear(); this.busy = false; };
  }

  process(job: Job, channel?: string): Promise<WorkerResult> {
    return new Promise((resolve, reject) => {
      const p = { job, resolve, reject };
      if (channel && this.busy) {
        this.latest.get(channel)?.reject(new DOMException('superseded', 'AbortError'));
        this.latest.set(channel, p);
      } else this.send(p);
    });
  }

  reset(): void { this.worker.postMessage({ reset: true }); }
  terminate(): void { this.worker.terminate(); }

  private send(p: Pending) {
    const id = ++this.seq;
    this.inflight.set(id, p);
    this.busy = true;
    const { pixels, width, height, options, live } = p.job;
    this.worker.postMessage({ id, pixels, width, height, options, live }, [pixels]);
  }

  private onMessage(m: { id: number; progress?: string; pixels?: ArrayBuffer; width: number; height: number; skipped?: string[] }) {
    const p = this.inflight.get(m.id);
    if (!p) return;
    if (m.progress) { p.job.onProgress?.(m.progress); return; }
    this.inflight.delete(m.id);
    this.busy = false;
    p.resolve({ image: new ImageData(new Uint8ClampedArray(m.pixels!), m.width, m.height), skipped: m.skipped ?? [] });
    const next = this.latest.entries().next();
    if (!next.done) { this.latest.delete(next.value[0]); this.send(next.value[1]); }
  }
}

export const isSuperseded = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
