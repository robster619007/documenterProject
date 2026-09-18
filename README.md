# Documenter

A privacy-first, browser-only document and image toolkit. All conversion,
compression and resizing happens **in the browser** — files never leave the
user's device. There is no upload step and no server that sees your documents,
which you can confirm yourself in the browser's Network tab.

Built with Astro 6 (static output), React 19 (tool islands only), TypeScript and
Tailwind. See `docs/PROJECT_BRIEF.md` for product context, `docs/PROTOTYPE_SPEC.md`
for the build plan, and `CLAUDE.md` for the working rules.

> Status: **Prototype complete (Milestones 1–6).** All pages, the conversion
> engine, the tool UI, the exam preset pages, and the full verification suite are
> in place.

---

## What it does

- **Resize a photo or signature** to an exact size limit (KB) and pixel
  dimensions — from an exam preset or a custom target you type.
- **Compress a PDF** under a size limit — keeping the text selectable, or
  flattening scans for the smallest possible file.
- **Combine images into a single PDF**, one image per page, optionally under a
  size cap.
- **Merge several PDFs into one**, in any order, with optional labelled divider
  pages between sections (divider size: match each document, A4, or US Letter).

Input images: JPG, PNG, WebP, HEIC/HEIF, AVIF, GIF, BMP, TIFF. The decoder
registry is pluggable, so new formats can be added without touching the rest of
the engine.

Exam preset pages (`/exam/<slug>`) come pre-filled with a particular exam's stated
photo and signature requirements. **These numbers are unverified — see below.**

## How the privacy guarantee holds

- All heavy work (decode, resize, compress, PDF build) runs in a **Web Worker**,
  off the main thread.
- No `fetch`/XHR ever sends file bytes anywhere. A dedicated end-to-end test
  (`tests/e2e/no-upload.spec.ts`) performs a real conversion while recording every
  network request and **fails if any request is cross-origin or carries the file's
  bytes.** This test guards the core product claim.

## Prerequisites

- **Node.js ≥ 22.12.0** (Astro 6's minimum; developed on Node 24). An `.nvmrc` is
  included — with [nvm](https://github.com/nvm-sh/nvm) run `nvm install` then
  `nvm use` to match it.
- **npm ≥ 9.6.5** (ships with the above Node).

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Install the browser used by the test/perf tooling.
#    Playwright downloads Chromium to a user cache — it is NOT part of
#    `npm install`, so this step is required on every fresh machine.
npm run setup

# 3. Start the dev server
npm run dev
```

### Linux servers / CI

Headless Chromium also needs system libraries. Install them once (needs sudo):

```bash
npx playwright install-deps chromium
```

On macOS and Windows this step is not required.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start the Astro dev server |
| `npm run build` | Build the static site into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run check` | Astro + TypeScript type check |
| `npm run lint` | ESLint (TypeScript, Astro, jsx-a11y) |
| `npm run format` | Prettier |
| `npm run test` | Vitest unit tests (pure logic) |
| `npm run e2e` | Playwright end-to-end tests (real browser, built site) |
| `npm run a11y` | axe-core accessibility scan across every route |
| `npm run lh` | Lighthouse CI against the performance budgets |

`dev`, `build`, `preview`, `check`, `lint`, `test`, and `format` work after
`npm install` alone. `e2e`, `a11y`, and `lh` additionally require `npm run setup`
(and, on Linux, the `install-deps` step above).

## Latest verification numbers

From the most recent full run of the suite:

- **Lighthouse: Performance 100 on all 11 public routes** (LCP ≤ ~1.1s, CLS 0.000,
  TBT 0ms — comfortably inside the budgets).
- **Accessibility: 0 violations** across all routes (axe-core).
- **e2e: all green**, including the no-upload network test, a 360px mobile
  no-overflow check on every page, and a geometric check that no ad slot sits
  within 150px of a primary action.
- **JS shipped:** content pages 0 KB; tool/exam pages ~60 KB gzipped (React island;
  pdf-lib/pdf.js load lazily inside the worker, not on page load).

## Deploying

The site is fully static — no server runtime is required in production:

```bash
npm install
npm run build      # outputs dist/
```

Deploy the `dist/` directory to any static host (Cloudflare Pages, Netlify,
nginx, S3, …). The deploy target is Cloudflare Pages; no adapter is needed for a
static build.

**Before a production deploy:** set the real domain in `astro.config.mjs` (`site:`)
— it drives canonical URLs and the generated sitemap. It is currently a placeholder
(`https://documenter.pages.dev`). Update the contact address in
`src/pages/contact.astro` at the same time (also a placeholder).

## Current limitations

- **Exam specs are placeholders** (see the unverified list below).
- **HEIC decoding is wired but not runtime-verified** against a real iPhone HEIC
  file. The decoder loads lazily and builds; it has not been exercised with genuine
  HEIC input in the test suite.
- **Office formats (DOCX/PPT/XLSX) are out of scope** for the prototype — faithful
  conversion needs a server-side Office engine, which would break the "nothing
  uploads" promise. Deferred to a possible Pro version.
- **Ads are placeholders only.** Ad slots render as sized `<div>`s with reserved
  height; no live ad script is integrated.
- **Only three exam presets** exist (UPSC CSE, SSC CGL, IBPS PO). Adding a fourth
  requires a verified source (see `CLAUDE.md`).
- **`image→PDF` scales large images down** to a longest edge of ~2000px to keep PDF
  size reasonable; it does not preserve original full resolution.
- **PDF "keep text" compression is gentle** (structural re-save only); very tight
  size targets require the "smallest size" (rasterize) mode, which drops selectable
  text.

## What is unverified

Everything in this list is a placeholder or unconfirmed and must not be treated as
authoritative:

- **All exam file-size and dimension specs** in `src/data/presets.ts`
  (`verified: false` on every preset). They come from secondary sources and have
  **not** been confirmed against the official notifications. The centimetre→pixel
  conversions assume **200 DPI**, recorded in each preset's `notes`.
- **The `officialUrl` links** point to each authority's website as a best-effort
  starting point, not to a verified specification page.
- **The `lastCheckedOn` date** records when the placeholder was entered, not a
  confirmation against the official source.
- **The `site:` domain** in `astro.config.mjs` and the **contact email** in
  `src/pages/contact.astro` are placeholders.

## Notes

- **`lighthouse-logs/`** (gitignored) holds Lighthouse reports (`reports/`), the
  relocated LHCI working dir (`lighthouseci-work/`), the public-only build audited
  by Lighthouse (`public-dist/`), and any throwaway Chrome profile folders swept up
  after a run (`chrome-temp/`). `scripts/run-lh.mjs` builds, prunes the dev-only
  pages, serves the result via `scripts/serve-dist.mjs`, runs Lighthouse against
  every route explicitly, then relocates the stray folders WSL scatters into the
  project root. It is a harmless no-op on other systems.
- **`src/pages/dev/`** contains a test-only engine harness. It is `noindex`,
  excluded from the sitemap, and never audited against the performance budgets.
