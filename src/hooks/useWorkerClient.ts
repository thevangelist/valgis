import { useEffect, useRef } from 'react';
import { WorkerClient } from '../lib/workerClient';

export function useWorkerClient(): WorkerClient {
  const ref = useRef<WorkerClient | null>(null);
  if (!ref.current) ref.current = new WorkerClient();
  useEffect(() => () => { ref.current?.terminate(); ref.current = null; }, []);
  return ref.current;
}
