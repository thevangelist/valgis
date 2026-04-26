import { useRef, useState, useCallback, useEffect } from 'react';
import type { RefObject } from 'react';
import type { ProcessOptions } from '../worker/imageProcessor';

export type CameraState = 'idle' | 'running' | 'error';

// These filters have no expensive PCA step and can switch instantly.
const INSTANT_FILTERS = new Set(['none', 'autolevel', 'histeq', 'satboost', 'adaptive']);

export function useLiveCamera(outputCanvasRef: RefObject<HTMLCanvasElement>) {
  const [state, setState] = useState<CameraState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fps, setFps]     = useState(0);

  const workerRef        = useRef<Worker | null>(null);
  const videoRef         = useRef<HTMLVideoElement | null>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const rafRef           = useRef<number | null>(null);
  const busyRef          = useRef(false);
  const pendingRef       = useRef<{ buf: ArrayBuffer; w: number; h: number; opts: ProcessOptions } | null>(null);
  const pausedRef        = useRef(false);
  const runningRef       = useRef(false);
  const filterDebounce   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameTimesRef    = useRef<number[]>([]);
  // Keep the last rendered ImageData so we can redraw instantly after a canvas resize.
  const lastImageDataRef = useRef<ImageData | null>(null);

  const optsRef = useRef<ProcessOptions>({
    filter: 'none', brightness: 100, contrast: 100, saturation: 100,
    shadowRecovery: 0, highlightRecovery: 0, clarity: 0, dehaze: 0,
    noiseReduction: 0, noiseAlgorithm: 'median', sharpening: 0, sharpenAlgorithm: 'unsharp',
  });

  useEffect(() => {
    const worker = new Worker(
      new URL('../worker/imageProcessor', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (e: MessageEvent) => {
      const { pixels, width, height } = e.data as { pixels: ArrayBuffer; width: number; height: number };
      const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
      lastImageDataRef.current = imageData;

      const canvas = outputCanvasRef.current;
      if (canvas) {
        // Only resize when dimensions change by more than 1px to avoid clearing the
        // canvas between frames when floating-point rounding produces tiny differences.
        if (Math.abs(canvas.width - width) > 1 || Math.abs(canvas.height - height) > 1) {
          canvas.width = width;
          canvas.height = height;
        }
        canvas.getContext('2d')?.putImageData(imageData, 0, 0);
      }

      const now = performance.now();
      frameTimesRef.current = [...frameTimesRef.current.filter(t => now - t < 1000), now];
      setFps(frameTimesRef.current.length);

      busyRef.current = false;
      if (pendingRef.current && !pausedRef.current) {
        const { buf, w, h, opts } = pendingRef.current;
        pendingRef.current = null;
        dispatch(worker, buf, w, h, opts);
      }
    };

    workerRef.current = worker;
    return () => { worker.terminate(); cleanup(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function dispatch(worker: Worker, buf: ArrayBuffer, w: number, h: number, opts: ProcessOptions) {
    busyRef.current = true;
    worker.postMessage({ pixels: buf, width: w, height: h, options: opts, live: true }, [buf]);
  }

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
      const worker = workerRef.current;
      if (!vid || !worker || vid.readyState < 2) return;

      const screenAR = window.innerWidth / Math.max(window.innerHeight, 1);
      const frame    = grabFrame(vid, screenAR);
      if (!frame) return;

      const opts = optsRef.current;
      if (busyRef.current) {
        pendingRef.current = { ...frame, opts };
      } else {
        dispatch(worker, frame.buf, frame.w, frame.h, opts);
      }
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
    if (INSTANT_FILTERS.has(opts.filter)) {
      optsRef.current = opts;
    } else {
      filterDebounce.current = setTimeout(() => { optsRef.current = opts; }, 150);
    }
  }, []);

  // Grab the current video frame at full camera resolution, run the active
  // filter on it (fresh PCA — no live EMA smoothing), and return a blob.
  const captureHighRes = useCallback((): Promise<Blob | null> => {
    const vid    = videoRef.current;
    const worker = workerRef.current;
    if (!vid || !worker) return Promise.resolve(null);

    const W = vid.videoWidth;
    const H = vid.videoHeight;
    if (!W || !H) return Promise.resolve(null);

    let buf: ArrayBuffer;
    try {
      const oc  = new OffscreenCanvas(W, H);
      const ctx = oc.getContext('2d')!;
      ctx.drawImage(vid, 0, 0, W, H);
      buf = ctx.getImageData(0, 0, W, H).data.buffer.slice(0);
    } catch { return Promise.resolve(null); }

    return new Promise(resolve => {
      const prevHandler = worker.onmessage;

      worker.onmessage = (e: MessageEvent) => {
        worker.onmessage = prevHandler;
        busyRef.current = false;

        const { pixels, width, height } = e.data as { pixels: ArrayBuffer; width: number; height: number };
        const oc  = new OffscreenCanvas(width, height);
        const ctx = oc.getContext('2d')!;
        ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
        // PNG for lossless; falls back to JPEG on browsers that don't support PNG in convertToBlob
        oc.convertToBlob({ type: 'image/png' }).then(resolve).catch(() =>
          oc.convertToBlob({ type: 'image/jpeg', quality: 0.97 }).then(resolve)
        );
      };

      busyRef.current = true;
      // live:false → fresh PCA, not temporally smoothed
      worker.postMessage({ pixels: buf, width: W, height: H, options: optsRef.current }, [buf]);
    });
  }, []);

  return { state, error, fps, start, stop, pause, resume, setOptions, captureHighRes };
}
