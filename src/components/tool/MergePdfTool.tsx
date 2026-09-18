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
  labelOpen: boolean; // whether the optional label field is revealed
}

const IconUp = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
);
const IconDown = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
);
const IconTag = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L3 13V4a1 1 0 0 1 1-1h9l7.59 7.59a2 2 0 0 1 0 2.82Z" /><circle cx="7.5" cy="7.5" r="1.3" /></svg>
);
const IconTrash = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
);

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
    setRows((prev) => [
      ...prev,
      ...pdfs.map((file) => ({ id: nextId.current++, file, label: '', labelOpen: false })),
    ]);
    setResult(null);
    setError('');
    setStatus('ready');
  }, []);

  const setLabel = useCallback((id: number, label: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, label } : r)));
  }, []);

  // Reveal/hide the optional label field for a row; focus it when revealing.
  const toggleLabel = useCallback((id: number) => {
    setRows((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, labelOpen: !r.labelOpen } : r));
      if (next.find((r) => r.id === id)?.labelOpen) {
        requestAnimationFrame(() => document.getElementById(`merge-label-${id}`)?.focus());
      }
      return next;
    });
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
          label: r.labelOpen && r.label.trim() ? r.label.trim() : undefined,
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
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.rowBtn}
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${r.file.name} up`}
                    >
                      <IconUp />
                      <span className={styles.rowTip} aria-hidden="true">Move up</span>
                    </button>
                    <button
                      type="button"
                      className={styles.rowBtn}
                      onClick={() => move(i, 1)}
                      disabled={i === rows.length - 1}
                      aria-label={`Move ${r.file.name} down`}
                    >
                      <IconDown />
                      <span className={styles.rowTip} aria-hidden="true">Move down</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.rowBtn} ${styles.rowBtnTag} ${r.labelOpen ? styles.rowBtnActive : ''}`}
                      onClick={() => toggleLabel(r.id)}
                      aria-label={`Add section label for ${r.file.name}`}
                      aria-expanded={r.labelOpen}
                    >
                      <IconTag />
                      <span className={styles.rowTip} aria-hidden="true">
                        {r.labelOpen ? 'Hide label' : 'Add label'}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.rowBtn} ${styles.rowBtnDanger}`}
                      onClick={() => removeRow(r.id)}
                      aria-label={`Remove ${r.file.name}`}
                    >
                      <IconTrash />
                      <span className={styles.rowTip} aria-hidden="true">Remove</span>
                    </button>
                  </div>
                )}
              </div>
              <div className={`${styles.labelSlot} ${r.labelOpen ? styles.labelSlotOpen : ''}`}>
                <div className={styles.labelSlotInner}>
                  <div className={styles.labelFieldWrap}>
                    <span className={styles.labelTag} aria-hidden="true"><IconTag /></span>
                    <input
                      id={`merge-label-${r.id}`}
                      className={styles.labelInput}
                      type="text"
                      value={r.label}
                      placeholder="Section label — adds a divider page before this file"
                      aria-label={`Section label for ${r.file.name}`}
                      onChange={(e) => setLabel(r.id, e.target.value)}
                    />
                  </div>
                </div>
              </div>
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
