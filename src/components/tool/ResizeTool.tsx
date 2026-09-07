import { useCallback, useEffect, useRef, useState } from 'react';
import type { SizeSpec } from '../../data/presets';
import { createImageWorker, runImageJob } from '../../lib/worker/run-image-job';
import type { ImageJob } from '../../lib/worker/image-worker';
import type { OutputImageFormat, ProgressMessage, SizeTarget } from '../../lib/worker/types';
import ResultPreview from './ResultPreview';
import styles from './tool-ui.module.css';

// The image tool island. In "fixed" mode it is handed a target SizeSpec (exam
// pages); in "custom" mode (spec omitted) it shows controls so the user types
// their own size limit, dimensions and output format. All heavy work runs in the
// Web Worker (CLAUDE.md rule 2); nothing is uploaded (rule 1).
interface Props {
  spec?: SizeSpec;
  label: string;
}

type Status = 'idle' | 'ready' | 'working' | 'done' | 'error';

interface Result {
  beforeBytes: number;
  afterBytes: number;
  width?: number;
  height?: number;
  outputFormat: OutputImageFormat | 'pdf';
  url: string;
  filename: string;
  inRange: boolean;
}

// Human-readable byte size. KB below a megabyte, MB above.
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 100 ? kb.toFixed(1) : Math.round(kb)}KB`;
  return `${(kb / 1024).toFixed(2)}MB`;
}

const EXT: Record<OutputImageFormat | 'pdf', string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  pdf: 'pdf',
};
const MIME: Record<OutputImageFormat | 'pdf', string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

const PHASE_LABEL: Record<ProgressMessage['phase'], string> = {
  decoding: 'Reading your image…',
  resizing: 'Resizing…',
  encoding: 'Saving…',
  searching: 'Finding the smallest quality that fits…',
  finalizing: 'Finishing up…',
};

// The plain-language sentence describing the fixed target.
function specSentence(spec: SizeSpec): string {
  const size =
    spec.minBytes != null
      ? `${formatSize(spec.minBytes)}–${formatSize(spec.maxBytes)}`
      : `under ${formatSize(spec.maxBytes)}`;
  const dims = spec.widthPx && spec.heightPx ? ` at ${spec.widthPx}×${spec.heightPx}px` : '';
  return `${size}${dims}`;
}

// The byte bounds used to judge whether a result meets the target.
type Bounds = { maxBytes: number; minBytes?: number };

export default function ResizeTool({ spec, label }: Props) {
  const workerRef = useRef<Worker | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const resultUrlRef = useRef<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [phase, setPhase] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [result, setResult] = useState<Result | null>(null);
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);

  // Custom-mode controls.
  const [limitOn, setLimitOn] = useState(true);
  const [limitValue, setLimitValue] = useState('50');
  const [limitUnit, setLimitUnit] = useState<'KB' | 'MB'>('KB');
  const [dimsOn, setDimsOn] = useState(false);
  const [widthPx, setWidthPx] = useState('413');
  const [heightPx, setHeightPx] = useState('531');
  const [outFormat, setOutFormat] = useState<OutputImageFormat>('jpeg');

  useEffect(() => {
    workerRef.current = createImageWorker();
    setReady(true);
    return () => {
      workerRef.current?.terminate();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    };
  }, []);

  const acceptFile = useCallback((next: File | null) => {
    if (!next) return;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = null;
    const url = URL.createObjectURL(next);
    previewUrlRef.current = url;
    setFile(next);
    setPreviewUrl(url);
    setResult(null);
    setError('');
    setStatus('ready');
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const img = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (img) acceptFile(img);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [acceptFile]);

  // Resolves the current UI state (fixed spec or custom controls) into the job
  // fields the worker needs, plus the effective SizeSpec used to judge "in range".
  const resolveJob = useCallback(
    (input: ArrayBuffer): { job: ImageJob; effective: Bounds } => {
      let outputFormat: OutputImageFormat;
      let fit: ImageJob['fit'];
      let size: SizeTarget;
      let effective: Bounds;

      if (spec) {
        outputFormat = spec.format === 'png' ? 'png' : 'jpeg';
        fit =
          spec.widthPx && spec.heightPx
            ? { targetWidth: spec.widthPx, targetHeight: spec.heightPx, mode: 'cover' }
            : { mode: 'contain' };
        size =
          spec.minBytes != null
            ? { mode: 'range', minBytes: spec.minBytes, maxBytes: spec.maxBytes }
            : { mode: 'max', maxBytes: spec.maxBytes };
        effective = { maxBytes: spec.maxBytes, minBytes: spec.minBytes };
      } else {
        outputFormat = outFormat;
        const w = dimsOn ? Number(widthPx) : undefined;
        const h = dimsOn ? Number(heightPx) : undefined;
        fit = w && h ? { targetWidth: w, targetHeight: h, mode: 'cover' } : { mode: 'contain' };
        const maxBytes =
          Math.max(1, Number(limitValue) || 0) * (limitUnit === 'MB' ? 1024 * 1024 : 1024);
        size = limitOn ? { mode: 'max', maxBytes } : { mode: 'original' };
        effective = { maxBytes: limitOn ? maxBytes : Number.POSITIVE_INFINITY };
      }
      return { job: { jobId: crypto.randomUUID(), input, outputFormat, fit, size }, effective };
    },
    [spec, outFormat, dimsOn, widthPx, heightPx, limitOn, limitValue, limitUnit],
  );

  const convert = useCallback(async () => {
    const worker = workerRef.current;
    if (!worker || !file) return;
    setStatus('working');
    setError('');
    setPhase(PHASE_LABEL.decoding);
    try {
      const input = await file.arrayBuffer();
      const { job, effective } = resolveJob(input);
      const res = await runImageJob(worker, job, (p) => setPhase(PHASE_LABEL[p.phase]));

      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
      const blob = new Blob([res.output], { type: MIME[res.outputFormat] });
      const url = URL.createObjectURL(blob);
      resultUrlRef.current = url;
      const withinMax = res.afterBytes <= effective.maxBytes;
      const withinMin = effective.minBytes == null || res.afterBytes >= effective.minBytes;
      setResult({
        beforeBytes: res.beforeBytes,
        afterBytes: res.afterBytes,
        width: res.width,
        height: res.height,
        outputFormat: res.outputFormat,
        url,
        filename: `${label.toLowerCase().replace(/\s+/g, '-')}-resized.${EXT[res.outputFormat]}`,
        inRange: withinMax && withinMin,
      });
      setStatus('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try a different file.');
      setStatus('error');
    }
  }, [file, resolveJob, label]);

  const reset = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    previewUrlRef.current = null;
    resultUrlRef.current = null;
    setFile(null);
    setPreviewUrl(null);
    setResult(null);
    setError('');
    setStatus('idle');
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    acceptFile(e.dataTransfer.files?.[0] ?? null);
  };

  // Sentence describing the current target, for the result "in range" copy.
  const currentTarget = spec
    ? specSentence(spec)
    : limitOn
      ? `under ${limitValue}${limitUnit}${dimsOn ? ` at ${widthPx}×${heightPx}px` : ''}`
      : `original quality${dimsOn ? `, ${widthPx}×${heightPx}px` : ''}`;

  return (
    <section
      className={styles.tool}
      aria-label={`${label} resizer`}
      data-ready={ready || undefined}
    >
      {spec ? (
        <p className={styles.target}>
          Your {label.toLowerCase()} needs to be <strong>{specSentence(spec)}</strong>
        </p>
      ) : (
        <fieldset className={styles.controls}>
          <legend className={styles.legend}>Choose your target</legend>

          <div className={styles.radioGroup}>
            <label className={styles.radio}>
              <input
                type="radio"
                name={`${label}-size-mode`}
                checked={limitOn}
                onChange={() => setLimitOn(true)}
              />
              Set a size limit
            </label>
            <label className={styles.radio}>
              <input
                type="radio"
                name={`${label}-size-mode`}
                checked={!limitOn}
                onChange={() => setLimitOn(false)}
              />
              Keep original quality
            </label>
          </div>

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

          <label className={styles.radio}>
            <input type="checkbox" checked={dimsOn} onChange={(e) => setDimsOn(e.target.checked)} />
            Resize to exact dimensions
          </label>
          {dimsOn && (
            <div className={styles.fieldRow}>
              <label className={styles.field}>
                Width (px)
                <input
                  className={styles.input}
                  type="number"
                  min="1"
                  value={widthPx}
                  onChange={(e) => setWidthPx(e.target.value)}
                />
              </label>
              <label className={styles.field}>
                Height (px)
                <input
                  className={styles.input}
                  type="number"
                  min="1"
                  value={heightPx}
                  onChange={(e) => setHeightPx(e.target.value)}
                />
              </label>
            </div>
          )}

          <label className={styles.field}>
            Output format
            <select
              className={styles.select}
              value={outFormat}
              onChange={(e) => setOutFormat(e.target.value as OutputImageFormat)}
            >
              <option value="jpeg">JPG (smallest, best for photos)</option>
              <option value="png">PNG (lossless)</option>
              <option value="webp">WebP (modern, small)</option>
            </select>
          </label>
        </fieldset>
      )}

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
          className={styles.fileInput}
          onChange={(e) => acceptFile(e.target.files?.[0] ?? null)}
        />
        <span className={styles.dropzoneText}>
          {file ? (
            <>Choose a different image, or drop one here</>
          ) : (
            <>
              <strong>Drop an image here</strong>, click to choose, or paste
            </>
          )}
        </span>
      </label>

      <p className={styles.privacy}>
        <span aria-hidden="true">🔒</span> Processed on your device — your file never leaves this
        browser.
      </p>

      {previewUrl && status !== 'done' && (
        <div className={styles.preview}>
          <img src={previewUrl} alt={`Selected ${label.toLowerCase()}`} className={styles.thumb} />
          {file && (
            <p className={styles.previewMeta}>
              {file.name} — {formatSize(file.size)}
            </p>
          )}
        </div>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.convert}
          onClick={convert}
          disabled={!file || status === 'working'}
          data-primary-action
        >
          {status === 'working' ? 'Working…' : `Resize ${label.toLowerCase()}`}
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
            {result.width && result.height ? ` · ${result.width}×${result.height}px` : ''}
          </p>
          <p className={result.inRange ? styles.ok : styles.warn}>
            {result.inRange
              ? `✓ Within your target (${currentTarget})`
              : `This is the closest fit, but it falls outside ${currentTarget}.`}
          </p>

          <ResultPreview url={result.url} kind="image" label={`resized ${label.toLowerCase()}`} />

          <a
            className={styles.download}
            href={result.url}
            download={result.filename}
            data-primary-action
          >
            Download {label.toLowerCase()}
          </a>
        </div>
      )}
    </section>
  );
}
