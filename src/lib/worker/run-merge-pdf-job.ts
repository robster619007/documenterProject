// Browser-side helper wrapping the PDF merge worker in a promise. Mirrors the
// other run-*-job helpers. Every input PDF's ArrayBuffer is transferred.
import type { MergePdfJob } from './merge-pdf-worker';
import type { SuccessMessage, ProgressMessage, WorkerResponse } from './types';

// Creates a module worker instance for merge jobs.
export function createMergePdfWorker(): Worker {
  return new Worker(new URL('./merge-pdf-worker.ts', import.meta.url), { type: 'module' });
}

// Sends a merge job and resolves with its success message (or rejects with the
// user-facing failure). All input buffers are transferred to the worker.
export function runMergePdfJob(
  worker: Worker,
  job: MergePdfJob,
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
    worker.postMessage(
      job,
      job.files.map((f) => f.bytes),
    );
  });
}
