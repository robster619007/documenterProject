// Browser-side helper that wraps the image worker in a promise. Used by the test
// harness now and by the real tool UI later. Type-only import of ImageJob keeps
// the worker module from being evaluated on the main thread.
import type { ImageJob } from './image-worker';
import type { SuccessMessage, ProgressMessage, WorkerResponse } from './types';

// Creates a module worker instance. Vite/Astro bundle the referenced file.
export function createImageWorker(): Worker {
  return new Worker(new URL('./image-worker.ts', import.meta.url), { type: 'module' });
}

// Sends a job to the worker and resolves with its success message (or rejects
// with the user-facing failure message). The input ArrayBuffer is transferred.
export function runImageJob(
  worker: Worker,
  job: ImageJob,
  onProgress?: (p: ProgressMessage) => void,
): Promise<SuccessMessage> {
  return new Promise((resolve, reject) => {
    const handle = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.jobId !== job.jobId) return;
      if (msg.type === 'progress') {
        onProgress?.(msg);
        return;
      }
      worker.removeEventListener('message', handle);
      if (msg.type === 'success') resolve(msg);
      else reject(new Error(msg.message));
    };
    worker.addEventListener('message', handle);
    worker.postMessage(job, [job.input]);
  });
}
