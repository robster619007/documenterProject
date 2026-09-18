import { useCallback, useEffect, useRef, useState } from 'react';
import { createPdfWorker, runPdfJob } from '../../lib/worker/run-pdf-job';
import type { PdfJob } from '../../lib/worker/pdf-worker';
import type { PdfCompressMode, ProgressMessage, SizeTarget } from '../../lib/worker/types';
import ResultPreview from './ResultPreview';
import styles from './tool-ui.module.css';

// The PDF-compress island. Wraps the existing PDF worker: choose a mode (keep
// selectable text, or flatten to smallest size) and optionally a size limit. All
// work is off the main thread; nothing is uploaded.
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
  decoding: 'Reading the PDF…',
  resizing: 'Rendering pages…',
  encoding: 'Saving…',
  searching: 'Finding the smallest quality that fits…',
  finalizing: 'Building the compressed PDF…',
};

export default function PdfCompressTool() {
  const workerRef = useRef<Worker | null>(null);
  const resultUrlRef = useRef<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);

  const [mode, setMode] = useState<'auto' | PdfCompressMode>('auto');
  const [limitOn, setLimitOn] = useState(false);
  const [limitValue, setLimitValue] = useState('500');
  const [limitUnit, setLimitUnit] = useState<'KB' | 'MB'>('KB');

  useEffect(() => {
    workerRef.current = createPdfWorker();
    setReady(true);
    return () => {
      workerRef.current?.terminate();
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    };
  }, []);

  const acceptFile = useCallback((next: File | null) => {
    if (!next) return;
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = null;
    setFile(next);
    setResult(null);
    setError('');
    setStatus('ready');
  }, []);

  const convert = useCallback(async () => {
    const worker = workerRef.current;
    if (!worker || !file) return;
    setStatus('working');
    setError('');
    setPhase(PHASE_LABEL.decoding);
    try {
      const input = await file.arrayBuffer();
      const maxBytes =
        Math.max(1, Number(limitValue) || 0) * (limitUnit === 'MB' ? 1024 * 1024 : 1024);
      const size: SizeTarget = limitOn ? { mode: 'max', maxBytes } : { mode: 'original' };
      const job: PdfJob = { jobId: crypto.randomUUID(), input, mode, size };
      const res = await runPdfJob(worker, job, (p) => setPhase(PHASE_LABEL[p.phase]));

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
      setError(e instanceof Error ? e.message : 'Something went wrong. Try a different PDF.');
      setStatus('error');
    }
  }, [file, mode, limitOn, limitValue, limitUnit]);

  const reset = useCallback(() => {
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = null;
    setFile(null);
    setResult(null);
    setError('');
    setStatus('idle');
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    acceptFile(e.dataTransfer.files?.[0] ?? null);
  };

  return (
    <section className={styles.tool} aria-label="PDF compressor" data-ready={ready || undefined}>
      <fieldset className={styles.controls}>
        <legend className={styles.legend}>How should it be compressed?</legend>
        <div className={styles.radioGroup}>
          <label className={styles.radio}>
            <input type="radio" name="pdf-mode" checked={mode === 'auto'} onChange={() => setMode('auto')} />
            Automatic
          </label>
          <label className={styles.radio}>
            <input
              type="radio"
              name="pdf-mode"
              checked={mode === 'keep-text'}
              onChange={() => setMode('keep-text')}
            />
            Keep text selectable
          </label>
          <label className={styles.radio}>
            <input
              type="radio"
              name="pdf-mode"
              checked={mode === 'rasterize'}
              onChange={() => setMode('rasterize')}
            />
            Smallest size (flatten)
          </label>
        </div>

        <label className={styles.radio}>
          <input type="checkbox" checked={limitOn} onChange={(e) => setLimitOn(e.target.checked)} />
          Compress to a size limit
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
          accept="application/pdf,.pdf"
          className={styles.fileInput}
          onChange={(e) => acceptFile(e.target.files?.[0] ?? null)}
        />
        <span className={styles.dropzoneText}>
          {file ? (
            <>Choose a different PDF, or drop one here</>
          ) : (
            <>
              <strong>Drop a PDF here</strong>, or click to choose
            </>
          )}
        </span>
      </label>

      <p className={styles.privacy}>
        <span aria-hidden="true">🔒</span> Processed on your device — your file never leaves this
        browser.
      </p>

      {file && <p className={styles.previewMeta}>{file.name} — {formatSize(file.size)}</p>}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.convert}
          onClick={convert}
          disabled={!file || status === 'working'}
          data-primary-action
        >
          {status === 'working' ? 'Working…' : 'Compress PDF'}
        </button>
        {file && status !== 'working' && (
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
            <span>{formatSize(result.beforeBytes)}</span>
            <span aria-hidden="true"> → </span>
            <strong className={result.inRange ? styles.ok : styles.warn}>
              {formatSize(result.afterBytes)}
            </strong>
          </p>
          <ResultPreview url={result.url} kind="pdf" label="compressed PDF" downloadName="compressed.pdf" />
        </div>
      )}
    </section>
  );
}
