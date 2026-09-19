// Copies pdf.js's standard font data into public/ so the site serves it at
// /standard-fonts/. The PDF compression worker renders pages off the main thread,
// where there is no DOM and no access to system fonts; without this data pdf.js
// draws non-embedded fonts as blank ".notdef" boxes (tofu). Pointing the worker's
// standardFontDataUrl here lets it substitute those fonts correctly.
//
// The files are copied from the pinned pdfjs-dist install at dev/build time rather
// than committed, so they can never drift from the installed pdf.js version.
// Fetching them at runtime is fetching our own bundled assets — no user data leaves
// the device, so the "nothing uploads" guarantee is unaffected.
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pdfjs-dist', 'standard_fonts');
const dest = join(root, 'public', 'standard-fonts');

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`Copied pdf.js standard fonts → ${dest}`);
