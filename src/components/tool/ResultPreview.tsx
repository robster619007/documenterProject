import { useEffect, useRef, useState } from 'react';
import styles from './tool-ui.module.css';

// A single, shared preview of a generated file, used by every tool's result panel
// so the preview markup and behaviour live in one place (no per-tool copy).
//  - kind 'image' → an inline image, shown at actual size when it fits.
//  - kind 'pdf'   → an inline <iframe> teaser plus a "View all pages" button that
//    opens an in-page modal. The modal renders every page with pdf.js into a normal
//    scrollable panel — this scrolls on mobile, where an iframe'd PDF cannot. pdf.js
//    is lazy-loaded only when the modal opens, so it never adds to initial page load.
interface Props {
  url: string; // object URL of the file
  kind: 'image' | 'pdf';
  label?: string; // accessible description of what is shown
}

export default function ResultPreview({ url, kind, label = 'Generated result' }: Props) {
  const name = label.toLowerCase();
  if (kind === 'image') {
    return (
      <div className={styles.previewOut}>
        <img className={styles.previewImg} src={url} alt={`Preview of ${name}`} />
      </div>
    );
  }
  return <PdfPreview url={url} name={name} />;
}

function PdfPreview({ url, name }: { url: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.pdfPreviewWrap}>
      <div className={`${styles.previewOut} ${styles.previewFrameBox}`}>
        <iframe className={styles.previewFrame} src={url} title={`Preview of ${name}`} />
      </div>
      <button type="button" className={styles.previewOpen} onClick={() => setOpen(true)}>
        View all pages ⤢
      </button>
      <p className={styles.pdfNote}>Opens a scrollable viewer here on the page — works on mobile too.</p>
      {open && <PdfModal url={url} name={name} onClose={() => setOpen(false)} />}
    </div>
  );
}

// Cap rendered pages so a very large document can't exhaust a phone's memory.
const MAX_PAGES = 50;

function PdfModal({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [info, setInfo] = useState<{ shown: number; total: number } | null>(null);

  // Esc to close, lock background scroll, and manage focus.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  // Render the pages with pdf.js into the (React-empty) pages container.
  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => void } | undefined;
    (async () => {
      setState('loading');
      setInfo(null);
      try {
        const pdfjs = await import('pdfjs-dist');
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

        const loadingTask = pdfjs.getDocument({ url });
        task = loadingTask;
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        const holder = pagesRef.current;
        if (!holder) return;
        holder.replaceChildren();

        const cssWidth = Math.max(240, Math.min(900, holder.clientWidth - 8));
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const total = pdf.numPages;
        const shown = Math.min(total, MAX_PAGES);

        for (let i = 1; i <= shown; i++) {
          const page = await pdf.getPage(i);
          const scale = (cssWidth / page.getViewport({ scale: 1 }).width) * dpr;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.className = styles.modalPage;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          await page.render({ canvas: null, canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          holder.appendChild(canvas);
        }

        if (total > shown) setInfo({ shown, total });
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
      task?.destroy();
    };
  }, [url]);

  return (
    <div
      className={styles.modalOverlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modalPanel} role="dialog" aria-modal="true" aria-label={`Preview of ${name}`}>
        <div className={styles.modalHead}>
          <span className={styles.modalTitle}>Preview</span>
          <button
            type="button"
            ref={closeRef}
            className={styles.modalClose}
            onClick={onClose}
            aria-label="Close preview"
          >
            ✕
          </button>
        </div>
        <div className={styles.modalScroll}>
          <div ref={pagesRef} className={styles.modalPages} />
          {state === 'loading' && <p className={styles.pdfNote}>Rendering pages…</p>}
          {state === 'error' && (
            <p className={styles.pdfNote}>Couldn’t render the preview — use Download to view the file.</p>
          )}
          {info && (
            <p className={styles.pdfNote}>
              Showing the first {info.shown} of {info.total} pages — download to see all.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
