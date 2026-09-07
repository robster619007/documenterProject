import styles from './tool-ui.module.css';

// A single, shared preview of a generated file, used by every tool's result panel
// so the preview markup and behaviour live in one place (no per-tool copy).
//  - kind 'image' → an inline image, shown at actual size when it fits and scaled
//    down to the card width for larger outputs (never scrolled).
//  - kind 'pdf'   → the browser's native, scrollable viewer via an <iframe>.
interface Props {
  url: string; // object URL of the file
  kind: 'image' | 'pdf';
  label?: string; // accessible description of what is shown
}

export default function ResultPreview({ url, kind, label = 'Generated result' }: Props) {
  const alt = `Preview of ${label.toLowerCase()}`;
  return (
    <div className={styles.previewOut}>
      {kind === 'image' ? (
        <img className={styles.previewImg} src={url} alt={alt} />
      ) : (
        <iframe className={styles.previewFrame} src={url} title={alt} />
      )}
    </div>
  );
}
