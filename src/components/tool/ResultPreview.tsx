import { useEffect, useRef, useState } from 'react';
import styles from './tool-ui.module.css';

// A single, shared preview of a generated file, used by every tool's result panel
// so the preview markup and behaviour live in one place (no per-tool copy).
//  - kind 'image' → an inline image, shown at actual size when it fits.
//  - kind 'pdf'   → a clean inline preview with side actions (fullscreen, download,
//    print). Desktop shows an <iframe> with a corner toolbar whose buttons expand
//    to reveal labels on hover; mobile shows a first-page thumbnail (rendered with
//    pdf.js) with a bottom action bar. Fullscreen opens an in-page scrollable viewer
//    (mobile can't scroll an iframe'd PDF). pdf.js is lazy-loaded only when needed.
interface Props {
  url: string; // object URL of the file
  kind: 'image' | 'pdf';
  label?: string; // accessible description of what is shown
  downloadName?: string; // filename used by the toolbar's Download action (pdf only)
}

// Lazy, memoised pdf.js loader (worker configured once). Only fetched when a viewer
// or thumbnail actually needs it, so it never adds to initial page load.
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
function getPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

const IconFullscreen = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3" />
  </svg>
);
const IconDownload = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v11m0 0l-4-4m4 4l4-4M4 20h16" />
  </svg>
);
const IconPrint = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9V3h12v6" />
    <path d="M6 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1" />
    <path d="M7 14h10v7H7z" />
  </svg>
);

export default function ResultPreview({ url, kind, label = 'Generated result', downloadName }: Props) {
  const name = label.toLowerCase();
  if (kind === 'image') {
    return (
      <div className={styles.previewOut}>
        <img className={styles.previewImg} src={url} alt={`Preview of ${name}`} />
      </div>
    );
  }
  return <PdfPreview url={url} name={name} downloadName={downloadName} />;
}

function PdfPreview({ url, name, downloadName }: { url: string; name: string; downloadName?: string }) {
  const [open, setOpen] = useState(false);

  const download = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName || 'document.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // Print via a hidden iframe pointed at the blob (the standard technique for PDFs).
  const print = () => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    frame.src = url;
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        /* some browsers block programmatic print of a PDF; user can use Download */
      }
    };
    document.body.appendChild(frame);
    window.setTimeout(() => frame.remove(), 60_000);
  };

  return (
    <div className={styles.pdfPreviewWrap}>
      {/* Desktop: inline frame with a corner expand-on-hover toolbar. */}
      <div className={`${styles.previewOut} ${styles.previewFrameBox}`}>
        {/* #toolbar=0 hides the browser's own PDF toolbar; our toolbar replaces it. */}
        <iframe className={styles.previewFrame} src={`${url}#toolbar=0`} title={`Preview of ${name}`} />
        <div className={styles.pdfToolbar}>
          <button type="button" className={styles.pdfToolBtn} onClick={() => setOpen(true)} aria-label="Fullscreen">
            <IconFullscreen />
            <span className={styles.pdfToolLbl} aria-hidden="true">Fullscreen</span>
          </button>
          <button
            type="button"
            className={styles.pdfToolBtn}
            onClick={download}
            aria-label="Download"
            data-primary-action
          >
            <IconDownload />
            <span className={styles.pdfToolLbl} aria-hidden="true">Download</span>
          </button>
          <button type="button" className={styles.pdfToolBtn} onClick={print} aria-label="Print">
            <IconPrint />
            <span className={styles.pdfToolLbl} aria-hidden="true">Print</span>
          </button>
        </div>
      </div>

      {/* Mobile: first-page thumbnail with a bottom action bar. */}
      <MobileThumb url={url} onFullscreen={() => setOpen(true)} onDownload={download} onPrint={print} />

      {open && <PdfModal url={url} name={name} onClose={() => setOpen(false)} />}
    </div>
  );
}

// Renders the PDF's first page (pdf.js) as a thumbnail for the mobile layout, with a
// bottom action bar. Only renders on small screens (the element is hidden on desktop).
function MobileThumb({
  url,
  onFullscreen,
  onDownload,
  onPrint,
}: {
  url: string;
  onFullscreen: () => void;
  onDownload: () => void;
  onPrint: () => void;
}) {
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window.matchMedia('(max-width: 640px)').matches) return; // desktop: skip render
    let cancelled = false;
    let task: { destroy: () => void } | undefined;
    (async () => {
      try {
        const pdfjs = await getPdfjs();
        const loadingTask = pdfjs.getDocument({ url });
        task = loadingTask;
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        const el = holder.current;
        if (!el) return;
        el.replaceChildren();
        const page = await pdf.getPage(1);
        const cssWidth = Math.max(180, el.clientWidth);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const scale = (cssWidth / page.getViewport({ scale: 1 }).width) * dpr;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.className = styles.thumbCanvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        await page.render({ canvas: null, canvasContext: ctx, viewport }).promise;
        if (cancelled) return;
        el.appendChild(canvas);
      } catch {
        /* leave the thumbnail empty; the action bar still works */
      }
    })();
    return () => {
      cancelled = true;
      task?.destroy();
    };
  }, [url]);

  return (
    <div className={styles.pdfThumb}>
      <div ref={holder} className={styles.thumbPages} />
      <div className={styles.pdfBottomBar}>
        <button type="button" className={styles.pdfBarItem} onClick={onFullscreen}>
          <IconFullscreen />
          Fullscreen
        </button>
        <button type="button" className={styles.pdfBarItem} onClick={onDownload} data-primary-action>
          <IconDownload />
          Download
        </button>
        <button type="button" className={styles.pdfBarItem} onClick={onPrint}>
          <IconPrint />
          Print
        </button>
      </div>
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

  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => void } | undefined;
    (async () => {
      setState('loading');
      setInfo(null);
      try {
        const pdfjs = await getPdfjs();
        const loadingTask = pdfjs.getDocument({ url });
        task = loadingTask;
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        const holderEl = pagesRef.current;
        if (!holderEl) return;
        holderEl.replaceChildren();
        const cssWidth = Math.max(240, Math.min(900, holderEl.clientWidth - 8));
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
          holderEl.appendChild(canvas);
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
        <button type="button" ref={closeRef} className={styles.modalClose} onClick={onClose} aria-label="Close preview">
          ✕
        </button>
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
