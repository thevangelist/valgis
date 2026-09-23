import { describe, it, expect, beforeEach, vi } from 'vitest';

// Fake Worker: replies to each job when `flush()` is called, in order.
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  queue: { id: number; width: number; height: number; reset?: boolean }[] = [];
  constructor() { FakeWorker.instances.push(this); }
  postMessage(m: { id: number; width: number; height: number; reset?: boolean }) { this.queue.push(m); }
  terminate() {}
  flushOne(extra: Record<string, unknown> = {}) {
    const m = this.queue.shift()!;
    this.onmessage?.({ data: { id: m.id, pixels: new ArrayBuffer(m.width * m.height * 4), width: m.width, height: m.height, skipped: [], ...extra } });
  }
  progress(stage: string) { this.onmessage?.({ data: { id: this.queue[0].id, progress: stage } }); }
}
vi.stubGlobal('Worker', FakeWorker);
vi.stubGlobal('ImageData', class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });

const { WorkerClient, isSuperseded } = await import('../lib/workerClient');
const job = (w = 2) => ({ pixels: new ArrayBuffer(w * w * 4), width: w, height: w, options: {} as never });

describe('WorkerClient', () => {
  let w: FakeWorker;
  beforeEach(() => { FakeWorker.instances.length = 0; new WorkerClient(); w = FakeWorker.instances[0]; });

  it('resolves the matching job by id', async () => {
    const c = new WorkerClient(); const fw = FakeWorker.instances[FakeWorker.instances.length - 1];
    const p1 = c.process(job(2)); const p2 = c.process(job(3));
    fw.flushOne(); fw.flushOne();
    expect((await p1).image.width).toBe(2);
    expect((await p2).image.width).toBe(3);
  });
  it('on a channel, a newer job supersedes the pending one', async () => {
    const c = new WorkerClient(); const fw = FakeWorker.instances[FakeWorker.instances.length - 1];
    const first = c.process(job(2), 'edit');
    const second = c.process(job(3), 'edit');
    const third = c.process(job(4), 'edit');
    await expect(second).rejects.toSatisfy(isSuperseded);
    fw.flushOne();                       // first completes, third is sent
    expect((await first).image.width).toBe(2);
    expect(fw.queue.length).toBe(1);
    fw.flushOne();
    expect((await third).image.width).toBe(4);
  });
  it('forwards progress to the job', async () => {
    const c = new WorkerClient(); const fw = FakeWorker.instances[FakeWorker.instances.length - 1];
    const stages: string[] = [];
    const p = c.process({ ...job(), onProgress: s => stages.push(s) });
    fw.progress('Tone'); fw.progress('Sharpening'); fw.flushOne();
    await p;
    expect(stages).toEqual(['Tone', 'Sharpening']);
  });
  it('reports skipped stages', async () => {
    const c = new WorkerClient(); const fw = FakeWorker.instances[FakeWorker.instances.length - 1];
    const p = c.process(job());
    fw.flushOne({ skipped: ['Noise reduction'] });
    expect((await p).skipped).toEqual(['Noise reduction']);
  });
  it('reset posts a reset message', () => {
    const c = new WorkerClient(); const fw = FakeWorker.instances[FakeWorker.instances.length - 1];
    c.reset();
    expect(fw.queue[0].reset).toBe(true);
  });
  it('worker error rejects in-flight jobs', async () => {
    const c = new WorkerClient(); const fw = FakeWorker.instances[FakeWorker.instances.length - 1];
    const p = c.process(job());
    fw.onerror?.(new Error('boom'));
    await expect(p).rejects.toBeTruthy();
    void w;
  });
});
