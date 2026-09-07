// Browser-side helper that wraps the PDF worker in a promise. Mirrors
// run-image-job. Type-only import keeps the worker off the main thread.
import type { PdfJob } from './pdf-worker';
import type { SuccessMessage, ProgressMessage, WorkerResponse } from './types';

// Creates a module worker instance for PDF jobs.
export function createPdfWorker(): Worker {
  return new Worker(new URL('./pdf-worker.ts', import.meta.url), { type: 'module' });
}

// Sends a PDF job and resolves with its success message (or rejects with the
// user-facing failure). The input ArrayBuffer is transferred.
export function runPdfJob(
  worker: Worker,
  job: PdfJob,
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
