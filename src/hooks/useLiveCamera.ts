import { useRef, useState, useCallback, useEffect } from 'react';
import type { RefObject } from 'react';
import type { ProcessOptions } from '../worker/imageProcessor';
import { WorkerClient, isSuperseded } from '../lib/workerClient';

export type CameraState = 'idle' | 'running' | 'error';

// These filters have no expensive PCA step and can switch instantly.
const INSTANT_FILTERS = new Set(['none', 'autolevel', 'histeq', 'satboost', 'adaptive']);

export function useLiveCamera(outputCanvasRef: RefObject<HTMLCanvasElement>) {
  const [state, setState] = useState<CameraState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fps, setFps]     = useState(0);

  const clientRef        = useRef<WorkerClient | null>(null);
  const videoRef         = useRef<HTMLVideoElement | null>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const rafRef           = useRef<number | null>(null);
  const inFlightRef      = useRef(false);
  const pausedRef        = useRef(false);
  const runningRef       = useRef(false);
  const filterDebounce   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameTimesRef    = useRef<number[]>([]);

  const optsRef = useRef<ProcessOptions>({
    filter: 'none', brightness: 100, contrast: 100, saturation: 100,
    shadowRecovery: 0, highlightRecovery: 0, clarity: 0, dehaze: 0,
    noiseReduction: 0, noiseAlgorithm: 'median', sharpening: 0, sharpenAlgorithm: 'unsharp',
  });

  useEffect(() => {
    clientRef.current = new WorkerClient();
    return () => { clientRef.current?.terminate(); clientRef.current = null; cleanup(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showFrame = (imageData: ImageData) => {
    const canvas = outputCanvasRef.current;
    if (canvas) {
      // Only resize when dimensions change by more than 1px to avoid clearing the
      // canvas between frames when floating-point rounding produces tiny differences.
      if (Math.abs(canvas.width - imageData.width) > 1 || Math.abs(canvas.height - imageData.height) > 1) {
        canvas.width = imageData.width;
        canvas.height = imageData.height;
      }
      canvas.getContext('2d')?.putImageData(imageData, 0, 0);
    }
    const now = performance.now();
    frameTimesRef.current = [...frameTimesRef.current.filter(t => now - t < 1000), now];
    setFps(frameTimesRef.current.length);
  };

  function cleanup() {
    runningRef.current = false;
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) { videoRef.current.srcObject = null; videoRef.current = null; }
  }

  // Draw the video cover-cropped to `targetAR`, capping the longer side at `maxPx`.
  function grabFrame(
    vid: HTMLVideoElement,
    targetAR: number,
    maxPx = 720,
  ): { buf: ArrayBuffer; w: number; h: number } | null {
    const vw = vid.videoWidth, vh = vid.videoHeight;
    if (!vw || !vh) return null;

    const videoAR = vw / vh;
    let sx = 0, sy = 0, sw = vw, sh = vh;
    if (videoAR > targetAR) {
      // Video wider than target → crop left / right
      sw = Math.round(vh * targetAR);
      sx = Math.round((vw - sw) / 2);
    } else {
      // Video taller than target → crop top / bottom
      sh = Math.round(vw / targetAR);
      sy = Math.round((vh - sh) / 2);
    }

    const longer = Math.max(sw, sh);
    const scale  = Math.min(1, maxPx / longer);
    const W = Math.round(sw * scale);
    const H = Math.round(sh * scale);

    try {
      const oc  = new OffscreenCanvas(W, H);
      const ctx = oc.getContext('2d')!;
      ctx.drawImage(vid, sx, sy, sw, sh, 0, 0, W, H);
      return { buf: ctx.getImageData(0, 0, W, H).data.buffer.slice(0), w: W, h: H };
    } catch { return null; }
  }

  const start = useCallback(async () => {
    cleanup();
    setError(null);
    pausedRef.current = false;
    clientRef.current?.reset();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch {
      setError('Camera access denied. Allow camera permission and tap Try again.');
      setState('error');
      return;
    }

    streamRef.current = stream;
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;

    try { await video.play(); } catch {
      setError('Failed to start video stream.');
      setState('error');
      stream.getTracks().forEach(t => t.stop());
      return;
    }

    videoRef.current = video;
    runningRef.current = true;
    setState('running');

    const loop = () => {
      if (!runningRef.current) return;
      rafRef.current = requestAnimationFrame(loop);
      if (pausedRef.current) return;

      const vid    = videoRef.current;
      const client = clientRef.current;
      if (!vid || !client || vid.readyState < 2) return;
      // One frame in flight, one waiting: never grab more than the worker can use.
      if (inFlightRef.current) return;

      const screenAR = window.innerWidth / Math.max(window.innerHeight, 1);
      const frame    = grabFrame(vid, screenAR);
      if (!frame) return;

      inFlightRef.current = true;
      client.process({ pixels: frame.buf, width: frame.w, height: frame.h, options: optsRef.current, live: true }, 'live')
        .then(r => { if (!pausedRef.current) showFrame(r.image); })
        .catch(e => { if (!isSuperseded(e)) console.error(e); })
        .finally(() => { inFlightRef.current = false; });
    };

    rafRef.current = requestAnimationFrame(loop);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(() => {
    cleanup();
    setState('idle');
    setFps(0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pause  = useCallback(() => { pausedRef.current = true;  }, []);
  const resume = useCallback(() => { pausedRef.current = false; }, []);

  // Instant switches (no PCA) take effect immediately.
  // PCA filters debounce ~150 ms so rapid chip-tapping doesn't produce
  // a sequence of frames from filters the user has already moved past.
  const setOptions = useCallback((opts: ProcessOptions) => {
    if (filterDebounce.current) clearTimeout(filterDebounce.current);
    const apply = () => {
      if (opts.filter !== optsRef.current.filter) clientRef.current?.reset();
      optsRef.current = opts;
    };
    if (INSTANT_FILTERS.has(opts.filter)) apply();
    else filterDebounce.current = setTimeout(apply, 150);
  }, []);

  // Grab the current video frame at full camera resolution, run the active
  // filter on it (fresh PCA — no live EMA smoothing), and return a blob.
  const captureHighRes = useCallback(async (): Promise<Blob | null> => {
    const vid    = videoRef.current;
    const client = clientRef.current;
    if (!vid || !client) return null;
    const W = vid.videoWidth, H = vid.videoHeight;
    if (!W || !H) return null;

    let buf: ArrayBuffer;
    try {
      const oc  = new OffscreenCanvas(W, H);
      const ctx = oc.getContext('2d')!;
      ctx.drawImage(vid, 0, 0, W, H);
      buf = ctx.getImageData(0, 0, W, H).data.buffer;
    } catch { return null; }

    // live:false → fresh PCA, not temporally smoothed. Matched by id, so a live frame cannot be mistaken for it.
    const { image } = await client.process({ pixels: buf, width: W, height: H, options: optsRef.current });
    const oc  = new OffscreenCanvas(image.width, image.height);
    oc.getContext('2d')!.putImageData(image, 0, 0);
    // JPEG for iOS Photos compatibility; falls back to PNG
    return oc.convertToBlob({ type: 'image/jpeg', quality: 0.97 }).catch(() => oc.convertToBlob({ type: 'image/png' }));
  }, []);

  return { state, error, fps, start, stop, pause, resume, setOptions, captureHighRes };
}
