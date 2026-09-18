import styles from './tool-ui.module.css';

// A single, shared preview of a generated file, used by every tool's result panel
// so the preview markup and behaviour live in one place (no per-tool copy).
//  - kind 'image' → an inline image, shown at actual size when it fits and scaled
//    down to the card width for larger outputs (never scrolled).
//  - kind 'pdf'   → an inline preview via <iframe>, plus an "Open full PDF" link.
//    Desktop browsers scroll the whole PDF inside the iframe; mobile browsers can
//    only show its first page and can't scroll it, so the link opens the file in
//    the device's own PDF viewer where every page scrolls.
interface Props {
  url: string; // object URL of the file
  kind: 'image' | 'pdf';
  label?: string; // accessible description of what is shown
}

export default function ResultPreview({ url, kind, label = 'Generated result' }: Props) {
  const alt = `Preview of ${label.toLowerCase()}`;

  if (kind === 'image') {
    return (
      <div className={styles.previewOut}>
        <img className={styles.previewImg} src={url} alt={alt} />
      </div>
    );
  }

  return (
    <div className={styles.pdfPreviewWrap}>
      <div className={styles.previewOut}>
        <iframe className={styles.previewFrame} src={url} title={alt} />
      </div>
      <a className={styles.previewOpen} href={url} target="_blank" rel="noopener noreferrer">
        Open full PDF ↗
      </a>
      <p className={styles.pdfNote}>On a phone, tap “Open full PDF” to scroll through every page.</p>
    </div>
  );
}
