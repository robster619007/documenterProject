// Browser-side helper wrapping the image→PDF worker in a promise. Mirrors
// run-image-job / run-pdf-job. All image buffers are transferred to the worker.
import type { ImageToPdfJob } from './image-to-pdf-worker';
import type { SuccessMessage, ProgressMessage, WorkerResponse } from './types';

// Creates a module worker instance for image→PDF jobs.
export function createImageToPdfWorker(): Worker {
  return new Worker(new URL('./image-to-pdf-worker.ts', import.meta.url), { type: 'module' });
}

// Sends a job and resolves with its success message (or rejects with the
// user-facing failure). Every input image ArrayBuffer is transferred.
export function runImageToPdfJob(
  worker: Worker,
  job: ImageToPdfJob,
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
    worker.postMessage(job, job.images);
  });
}
