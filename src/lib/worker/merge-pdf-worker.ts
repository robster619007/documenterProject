/// <reference lib="webworker" />
// The PDF merge Web Worker. Combines several PDFs into one, in the given order,
// optionally inserting a labelled divider page before any file (ported from the
// desktop tool's reportlab label pages). All work runs off the main thread
// (CLAUDE.md rule 2) and nothing is uploaded (rule 1). It uses pdf-lib only, so
// source pages are copied as-is — text stays selectable, no re-rasterizing.
//
// This worker is self-contained: it is the whole engine for the merge feature and
// shares nothing tool-specific, so the feature can be gated (e.g. for subscribers)
// from its page without touching anything else.
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import type { WorkerResponse } from './types';

// Divider page size. 'match' adopts the size of the file it precedes so the
// divider blends in (works for A4, US Letter or anything else); 'a4'/'letter'
// force a fixed size.
export type DividerSize = 'match' | 'a4' | 'letter';

export interface MergePdfInput {
  bytes: ArrayBuffer;
  label?: string; // a non-empty label inserts a divider page before this file
  name?: string; // original filename, used only in error messages
}

export interface MergePdfJob {
  jobId: string;
  files: MergePdfInput[]; // in final order
  dividerSize: DividerSize;
}

// US Letter and A4 in PDF points (1pt = 1/72 inch).
const LETTER: [number, number] = [612, 792];
const A4: [number, number] = [595.28, 841.89];

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (event: MessageEvent<MergePdfJob>) => {
  const job = event.data;
  try {
    await runJob(job);
  } catch (err) {
    post({
      type: 'failure',
      jobId: job.jobId,
      reason: 'internal-error',
      message: `Could not merge the PDFs (${
        err instanceof Error ? err.message : 'unknown error'
      }). One of them may be encrypted or damaged.`,
    });
  }
};

async function runJob(job: MergePdfJob): Promise<void> {
  const { jobId, files, dividerSize } = job;
  if (files.length === 0) {
    return post({
      type: 'failure',
      jobId,
      reason: 'internal-error',
      message: 'Add at least one PDF to merge.',
    });
  }
  const beforeBytes = files.reduce((sum, f) => sum + f.bytes.byteLength, 0);

  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.HelveticaBold);

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    post({ type: 'progress', jobId, phase: 'finalizing', ratio: i / files.length });

    let src: PDFDocument;
    try {
      src = await PDFDocument.load(f.bytes);
    } catch {
      return post({
        type: 'failure',
        jobId,
        reason: 'decode-failed',
        message: `"${
          f.name ?? `File ${i + 1}`
        }" could not be read — it may not be a PDF, or it may be encrypted. Remove it and try again.`,
      });
    }

    const label = f.label?.trim();
    if (label) {
      addDivider(out, font, label, dividerSizeFor(dividerSize, src));
    }

    const pages = await out.copyPages(src, src.getPageIndices());
    for (const page of pages) out.addPage(page);
  }

  post({ type: 'progress', jobId, phase: 'finalizing', ratio: 1 });
  const saved = await out.save({ useObjectStreams: true });
  const output = saved.buffer.slice(
    saved.byteOffset,
    saved.byteOffset + saved.byteLength,
  ) as ArrayBuffer;

  post(
    { type: 'success', jobId, output, outputFormat: 'pdf', beforeBytes, afterBytes: output.byteLength },
    [output],
  );
}

// Resolves the divider size for a given preference, matching the following
// document's first page when asked (falling back to A4 if it has no pages).
function dividerSizeFor(pref: DividerSize, src: PDFDocument): [number, number] {
  if (pref === 'a4') return A4;
  if (pref === 'letter') return LETTER;
  if (src.getPageCount() > 0) {
    const { width, height } = src.getPage(0).getSize();
    return [width, height];
  }
  return A4;
}

// Draws a divider page with the label centred in Helvetica-Bold (like the original
// desktop tool). Long labels wrap to fit the page width and the block stays
// vertically centred.
function addDivider(doc: PDFDocument, font: PDFFont, label: string, size: [number, number]): void {
  const [w, h] = size;
  const page = doc.addPage([w, h]);
  const fontSize = 24;
  const maxWidth = w - 96; // 48pt side margins

  const lines: string[] = [];
  let line = '';
  for (const word of label.split(/\s+/)) {
    const trial = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(trial, fontSize) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);

  const lineHeight = fontSize * 1.3;
  let y = h / 2 + (lines.length * lineHeight) / 2 - lineHeight;
  for (const l of lines) {
    const textWidth = font.widthOfTextAtSize(l, fontSize);
    page.drawText(l, { x: (w - textWidth) / 2, y, size: fontSize, font, color: rgb(0, 0, 0) });
    y -= lineHeight;
  }
}
