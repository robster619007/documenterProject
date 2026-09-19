import { useEffect, useRef, useState, type RefObject } from 'react';
import styles from './tool-ui.module.css';

// A single, shared preview of a generated file, used by every tool's result panel
// so the preview markup and behaviour live in one place (no per-tool copy).
//  - kind 'image' → an inline image, shown at actual size when it fits.
//  - kind 'pdf'   → we render the pages ourselves with pdf.js (no browser iframe),
//    so the chrome and scrollbar are fully ours on every browser. Desktop shows a
//    scrollable inline preview with a corner toolbar (fullscreen/download/print,
//    labels expand on hover); mobile shows a first-page thumbnail with a bottom
//    action bar. Fullscreen opens an in-page scrollable viewer. pdf.js is lazy-loaded.
interface Props {
  url: string; // object URL of the file
  kind: 'image' | 'pdf';
  label?: string; // accessible description of what is shown
  downloadName?: string; // filename used by the Download action (pdf only)
}

// Lazy, memoised pdf.js loader (worker configured once). Only fetched when a preview
// actually needs it, so it never adds to initial page load.
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

// Cap rendered pages so a very large document can't exhaust memory.
const MAX_PAGES = 50;

// Renders a PDF's pages (or just the first) as canvases into a ref'd container.
// Skips work when `mediaQuery` is given and doesn't match (the container is hidden).
function usePdfRender(
  url: string,
  ref: RefObject<HTMLDivElement | null>,
  maxPages: number,
  firstPageOnly: boolean,
  mediaQuery?: string,
) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [info, setInfo] = useState<{ shown: number; total: number } | null>(null);

  useEffect(() => {
    if (mediaQuery && !window.matchMedia(mediaQuery).matches) {
      setState('ready');
      return;
    }
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
        const el = ref.current;
        if (!el) return;
        el.replaceChildren();
        const cssWidth = Math.max(180, Math.min(900, el.clientWidth - 8));
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const total = pdf.numPages;
        const shown = firstPageOnly ? 1 : Math.min(total, maxPages);
        for (let i = 1; i <= shown; i++) {
          const page = await pdf.getPage(i);
          const scale = (cssWidth / page.getViewport({ scale: 1 }).width) * dpr;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.className = styles.renderedPage;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          await page.render({ canvas: null, canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          el.appendChild(canvas);
        }
        if (!firstPageOnly && total > shown) setInfo({ shown, total });
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
      task?.destroy();
    };
  }, [url, maxPages, firstPageOnly, mediaQuery, ref]);

  return { state, info };
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
      <InlinePreview url={url} name={name} onFullscreen={() => setOpen(true)} onDownload={download} onPrint={print} />
      <MobileThumb url={url} onFullscreen={() => setOpen(true)} onDownload={download} onPrint={print} />
      {open && <PdfModal url={url} name={name} onClose={() => setOpen(false)} />}
    </div>
  );
}

// Desktop: scrollable inline preview (our own render) with the corner expand toolbar.
function InlinePreview({
  url,
  name,
  onFullscreen,
  onDownload,
  onPrint,
}: {
  url: string;
  name: string;
  onFullscreen: () => void;
  onDownload: () => void;
  onPrint: () => void;
}) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const { state, info } = usePdfRender(url, pagesRef, MAX_PAGES, false, '(min-width: 641px)');

  return (
    <div className={`${styles.previewOut} ${styles.previewFrameBox}`}>
      <div
        ref={pagesRef}
        className={`${styles.inlineScroll} ${styles.hoverScroll}`}
        role="group"
        aria-label={`Preview of ${name}`}
      />
      {state === 'loading' && <p className={styles.inlineOverlay}>Rendering preview…</p>}
      {state === 'error' && <p className={styles.inlineOverlay}>Preview unavailable — use Download.</p>}
      {info && (
        <p className={styles.inlineFoot}>
          First {info.shown} of {info.total} pages — open fullscreen or download for all
        </p>
      )}
      <div className={styles.pdfToolbar}>
        <button type="button" className={styles.pdfToolBtn} onClick={onFullscreen} aria-label="Fullscreen">
          <IconFullscreen />
          <span className={styles.pdfToolLbl} aria-hidden="true">Fullscreen</span>
        </button>
        <button type="button" className={styles.pdfToolBtn} onClick={onDownload} aria-label="Download" data-primary-action>
          <IconDownload />
          <span className={styles.pdfToolLbl} aria-hidden="true">Download</span>
        </button>
        <button type="button" className={styles.pdfToolBtn} onClick={onPrint} aria-label="Print">
          <IconPrint />
          <span className={styles.pdfToolLbl} aria-hidden="true">Print</span>
        </button>
      </div>
    </div>
  );
}

// Mobile: first-page thumbnail with a bottom action bar.
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
  const pagesRef = useRef<HTMLDivElement>(null);
  usePdfRender(url, pagesRef, 1, true, '(max-width: 640px)');

  return (
    <div className={styles.pdfThumb}>
      <div ref={pagesRef} className={styles.thumbPages} />
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

function PdfModal({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { state, info } = usePdfRender(url, pagesRef, MAX_PAGES, false);

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
        <div className={`${styles.modalScroll} ${styles.hoverScroll}`}>
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
