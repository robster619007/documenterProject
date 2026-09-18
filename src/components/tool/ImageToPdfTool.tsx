import { useCallback, useEffect, useRef, useState } from 'react';
import { createImageToPdfWorker, runImageToPdfJob } from '../../lib/worker/run-image-to-pdf-job';
import type { ImageToPdfJob } from '../../lib/worker/image-to-pdf-worker';
import type { ProgressMessage, SizeTarget } from '../../lib/worker/types';
import ResultPreview from './ResultPreview';
import styles from './tool-ui.module.css';

// The image→PDF island. Collects one or more images (in order) and builds a PDF,
// one image per page, optionally under a size limit. Off the main thread; no upload.
type Status = 'idle' | 'ready' | 'working' | 'done' | 'error';

interface Result {
  beforeBytes: number;
  afterBytes: number;
  url: string;
  inRange: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 100 ? kb.toFixed(1) : Math.round(kb)}KB`;
  return `${(kb / 1024).toFixed(2)}MB`;
}

const PHASE_LABEL: Record<ProgressMessage['phase'], string> = {
  decoding: 'Reading your images…',
  resizing: 'Preparing pages…',
  encoding: 'Saving…',
  searching: 'Finding the smallest quality that fits…',
  finalizing: 'Building the PDF…',
};

export default function ImageToPdfTool() {
  const workerRef = useRef<Worker | null>(null);
  const resultUrlRef = useRef<string | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);

  const [limitOn, setLimitOn] = useState(false);
  const [limitValue, setLimitValue] = useState('1');
  const [limitUnit, setLimitUnit] = useState<'KB' | 'MB'>('MB');

  useEffect(() => {
    workerRef.current = createImageToPdfWorker();
    setReady(true);
    return () => {
      workerRef.current?.terminate();
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    };
  }, []);

  const addFiles = useCallback((incoming: FileList | File[] | null) => {
    const imgs = Array.from(incoming ?? []).filter((f) => f.type.startsWith('image/'));
    if (imgs.length === 0) return;
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = null;
    setFiles((prev) => [...prev, ...imgs]);
    setResult(null);
    setError('');
    setStatus('ready');
  }, []);

  const removeAt = useCallback((i: number) => {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }, []);

  const convert = useCallback(async () => {
    const worker = workerRef.current;
    if (!worker || files.length === 0) return;
    setStatus('working');
    setError('');
    setPhase(PHASE_LABEL.decoding);
    try {
      const images = await Promise.all(files.map((f) => f.arrayBuffer()));
      const maxBytes =
        Math.max(1, Number(limitValue) || 0) * (limitUnit === 'MB' ? 1024 * 1024 : 1024);
      const size: SizeTarget = limitOn ? { mode: 'max', maxBytes } : { mode: 'original' };
      const job: ImageToPdfJob = { jobId: crypto.randomUUID(), images, size };
      const res = await runImageToPdfJob(worker, job, (p) => setPhase(PHASE_LABEL[p.phase]));

      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
      const url = URL.createObjectURL(new Blob([res.output], { type: 'application/pdf' }));
      resultUrlRef.current = url;
      setResult({
        beforeBytes: res.beforeBytes,
        afterBytes: res.afterBytes,
        url,
        inRange: !limitOn || res.afterBytes <= maxBytes,
      });
      setStatus('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try different images.');
      setStatus('error');
    }
  }, [files, limitOn, limitValue, limitUnit]);

  const reset = useCallback(() => {
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = null;
    setFiles([]);
    setResult(null);
    setError('');
    setStatus('idle');
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  return (
    <section className={styles.tool} aria-label="Image to PDF converter" data-ready={ready || undefined}>
      <fieldset className={styles.controls}>
        <legend className={styles.legend}>Options</legend>
        <label className={styles.radio}>
          <input type="checkbox" checked={limitOn} onChange={(e) => setLimitOn(e.target.checked)} />
          Keep the PDF under a size limit
        </label>
        {limitOn && (
          <div className={styles.fieldRow}>
            <label className={styles.field}>
              Maximum size
              <input
                className={styles.input}
                type="number"
                min="1"
                inputMode="numeric"
                value={limitValue}
                onChange={(e) => setLimitValue(e.target.value)}
              />
            </label>
            <label className={styles.field}>
              Unit
              <select
                className={styles.select}
                value={limitUnit}
                onChange={(e) => setLimitUnit(e.target.value as 'KB' | 'MB')}
              >
                <option value="KB">KB</option>
                <option value="MB">MB</option>
              </select>
            </label>
          </div>
        )}
      </fieldset>

      <label
        className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-primary-action
      >
        <input
          type="file"
          accept="image/*"
          multiple
          className={styles.fileInput}
          onChange={(e) => addFiles(e.target.files)}
        />
        <span className={styles.dropzoneText}>
          <strong>Drop images here</strong>, or click to choose. Add as many as you like — one per
          page, in order.
        </span>
      </label>

      <p className={styles.privacy}>
        <span aria-hidden="true">🔒</span> Processed on your device — your files never leave this
        browser.
      </p>

      {files.length > 0 && (
        <ol className={styles.fileList}>
          {files.map((f, i) => (
            <li className={styles.fileItem} key={`${f.name}-${i}`}>
              <span>
                {i + 1}. {f.name} — {formatSize(f.size)}
              </span>
              {status !== 'working' && (
                <button type="button" className={styles.remove} onClick={() => removeAt(i)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ol>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.convert}
          onClick={convert}
          disabled={files.length === 0 || status === 'working'}
          data-primary-action
        >
          {status === 'working' ? 'Working…' : `Make PDF${files.length > 1 ? ` (${files.length} pages)` : ''}`}
        </button>
        {files.length > 0 && status !== 'working' && (
          <button type="button" className={styles.secondary} onClick={reset}>
            Start over
          </button>
        )}
      </div>

      <p className={styles.progress} role="status" aria-live="polite">
        {status === 'working' ? phase : ''}
      </p>

      {status === 'error' && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {status === 'done' && result && (
        <div className={styles.result} aria-live="polite">
          <p className={styles.resultLine}>
            <strong className={result.inRange ? styles.ok : styles.warn}>
              {formatSize(result.afterBytes)}
            </strong>{' '}
            PDF ready
          </p>
          <ResultPreview url={result.url} kind="pdf" label="generated PDF" downloadName="images.pdf" />
          <a className={styles.download} href={result.url} download="images.pdf" data-primary-action>
            Download PDF
          </a>
        </div>
      )}
    </section>
  );
}
