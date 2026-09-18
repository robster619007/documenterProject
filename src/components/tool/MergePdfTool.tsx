import { useCallback, useEffect, useRef, useState } from 'react';
import { createMergePdfWorker, runMergePdfJob } from '../../lib/worker/run-merge-pdf-job';
import type { DividerSize, MergePdfInput, MergePdfJob } from '../../lib/worker/merge-pdf-worker';
import type { ProgressMessage } from '../../lib/worker/types';
import ResultPreview from './ResultPreview';
import styles from './tool-ui.module.css';

// The PDF merge island: add PDFs, reorder them, give any an optional section label
// (which inserts a divider page), name the output, and merge — all in the browser.
// Self-contained so the feature can be gated later; reuses only generic shared UI.
type Status = 'idle' | 'ready' | 'working' | 'done' | 'error';

interface Row {
  id: number;
  file: File;
  label: string;
}

interface Result {
  beforeBytes: number;
  afterBytes: number;
  url: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 100 ? kb.toFixed(1) : Math.round(kb)}KB`;
  return `${(kb / 1024).toFixed(2)}MB`;
}

const PHASE_LABEL: Record<ProgressMessage['phase'], string> = {
  decoding: 'Reading the PDFs…',
  resizing: 'Preparing pages…',
  encoding: 'Saving…',
  searching: 'Working…',
  finalizing: 'Merging your PDFs…',
};

// Turns the output filename into a safe "<name>.pdf".
function outputName(raw: string): string {
  const trimmed = raw.trim().replace(/\.pdf$/i, '');
  const safe = trimmed.replace(/[\\/:*?"<>|]+/g, '-') || 'merged';
  return `${safe}.pdf`;
}

export default function MergePdfTool() {
  const workerRef = useRef<Worker | null>(null);
  const resultUrlRef = useRef<string | null>(null);
  const nextId = useRef(0);

  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);

  const [dividerSize, setDividerSize] = useState<DividerSize>('match');
  const [filename, setFilename] = useState('merged.pdf');

  useEffect(() => {
    workerRef.current = createMergePdfWorker();
    setReady(true);
    return () => {
      workerRef.current?.terminate();
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    };
  }, []);

  const addFiles = useCallback((incoming: FileList | File[] | null) => {
    const pdfs = Array.from(incoming ?? []).filter(
      (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name),
    );
    if (pdfs.length === 0) return;
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = null;
    setRows((prev) => [...prev, ...pdfs.map((file) => ({ id: nextId.current++, file, label: '' }))]);
    setResult(null);
    setError('');
    setStatus('ready');
  }, []);

  const setLabel = useCallback((id: number, label: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, label } : r)));
  }, []);

  const removeRow = useCallback((id: number) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const move = useCallback((index: number, dir: -1 | 1) => {
    setRows((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const merge = useCallback(async () => {
    const worker = workerRef.current;
    if (!worker || rows.length === 0) return;
    setStatus('working');
    setError('');
    setPhase(PHASE_LABEL.finalizing);
    try {
      const files: MergePdfInput[] = await Promise.all(
        rows.map(async (r) => ({
          bytes: await r.file.arrayBuffer(),
          label: r.label.trim() || undefined,
          name: r.file.name,
        })),
      );
      const job: MergePdfJob = { jobId: crypto.randomUUID(), files, dividerSize };
      const res = await runMergePdfJob(worker, job, (p) => setPhase(PHASE_LABEL[p.phase]));

      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
      const url = URL.createObjectURL(new Blob([res.output], { type: 'application/pdf' }));
      resultUrlRef.current = url;
      setResult({ beforeBytes: res.beforeBytes, afterBytes: res.afterBytes, url });
      setStatus('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try different files.');
      setStatus('error');
    }
  }, [rows, dividerSize]);

  const reset = useCallback(() => {
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = null;
    setRows([]);
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
    <section className={styles.tool} aria-label="PDF merger" data-ready={ready || undefined}>
      <fieldset className={styles.controls}>
        <legend className={styles.legend}>Options</legend>
        <div className={styles.fieldRow}>
          <label className={styles.field}>
            Divider page size
            <select
              className={styles.select}
              value={dividerSize}
              onChange={(e) => setDividerSize(e.target.value as DividerSize)}
            >
              <option value="match">Match each document</option>
              <option value="a4">A4</option>
              <option value="letter">US Letter</option>
            </select>
          </label>
          <label className={styles.field}>
            Output file name
            <input
              className={styles.select}
              style={{ width: '12rem' }}
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
            />
          </label>
        </div>
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
          multiple
          className={styles.fileInput}
          onChange={(e) => addFiles(e.target.files)}
        />
        <span className={styles.dropzoneText}>
          <strong>Drop PDFs here</strong>, or click to choose. Add as many as you like — they merge
          top to bottom.
        </span>
      </label>

      <p className={styles.privacy}>
        <span aria-hidden="true">🔒</span> Processed on your device — your files never leave this
        browser.
      </p>

      {rows.length > 0 && (
        <ol className={styles.mergeList}>
          {rows.map((r, i) => (
            <li className={styles.mergeRow} key={r.id}>
              <div className={styles.mergeRowHead}>
                <span className={styles.mergeIndex}>{i + 1}.</span>
                <span className={styles.mergeName}>
                  {r.file.name} — {formatSize(r.file.size)}
                </span>
                {status !== 'working' && (
                  <div className={styles.mergeActions}>
                    <button
                      type="button"
                      className={styles.moveBtn}
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${r.file.name} up`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={styles.moveBtn}
                      onClick={() => move(i, 1)}
                      disabled={i === rows.length - 1}
                      aria-label={`Move ${r.file.name} down`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={styles.remove}
                      onClick={() => removeRow(r.id)}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
              <input
                className={styles.labelInput}
                type="text"
                value={r.label}
                placeholder="Optional section label (adds a divider page before this file)"
                aria-label={`Section label for ${r.file.name}`}
                onChange={(e) => setLabel(r.id, e.target.value)}
              />
            </li>
          ))}
        </ol>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.convert}
          onClick={merge}
          disabled={rows.length < 1 || status === 'working'}
          data-primary-action
        >
          {status === 'working' ? 'Working…' : `Merge ${rows.length > 1 ? `${rows.length} PDFs` : 'PDF'}`}
        </button>
        {rows.length > 0 && status !== 'working' && (
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
            <strong className={styles.ok}>{formatSize(result.afterBytes)}</strong> merged PDF ready
          </p>
          <ResultPreview url={result.url} kind="pdf" label="merged PDF" downloadName={outputName(filename)} />
        </div>
      )}
    </section>
  );
}
