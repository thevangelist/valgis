import { useRef, useCallback, useEffect } from 'react';
import type { ProcessOptions } from '../worker/imageProcessor';

export type { ProcessOptions };

export function processOnce(imageData: ImageData, opts: ProcessOptions): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('../worker/imageProcessor', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (e: MessageEvent) => {
      const { pixels, width, height } = e.data as { pixels: ArrayBuffer; width: number; height: number };
      resolve(new ImageData(new Uint8ClampedArray(pixels), width, height));
      worker.terminate();
    };
    worker.onerror = (e) => { reject(e); worker.terminate(); };
    const buf = imageData.data.buffer.slice(0);
    worker.postMessage({ pixels: buf, width: imageData.width, height: imageData.height, options: opts }, [buf]);
  });
}

export function useImageProcessor(
  onResult: (imageData: ImageData) => void,
  onProcessingChange: (processing: boolean) => void,
) {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<{ buf: ArrayBuffer; w: number; h: number; opts: ProcessOptions } | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    const worker = new Worker(
      new URL('../worker/imageProcessor', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (e: MessageEvent) => {
      const { pixels, width, height } = e.data as { pixels: ArrayBuffer; width: number; height: number };
      const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
      busyRef.current = false;

      if (pendingRef.current) {
        const { buf, w, h, opts } = pendingRef.current;
        pendingRef.current = null;
        dispatch(buf, w, h, opts);
      } else {
        onProcessingChange(false);
        onResult(imageData);
      }
    };

    workerRef.current = worker;
    return () => worker.terminate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function dispatch(buf: ArrayBuffer, w: number, h: number, opts: ProcessOptions) {
    const worker = workerRef.current;
    if (!worker) return;
    busyRef.current = true;
    worker.postMessage({ pixels: buf, width: w, height: h, options: opts }, [buf]);
  }

  const process = useCallback((
    originalCanvas: HTMLCanvasElement,
    opts: ProcessOptions,
  ) => {
    const ctx = originalCanvas.getContext('2d');
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, originalCanvas.width, originalCanvas.height);
    const buf = imageData.data.buffer.slice(0);
    const w = originalCanvas.width, h = originalCanvas.height;

    onProcessingChange(true);

    if (busyRef.current) {
      pendingRef.current = { buf, w, h, opts };
    } else {
      dispatch(buf, w, h, opts);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { process };
}
