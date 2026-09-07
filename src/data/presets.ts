// The size-spec catalog. Each preset describes the file-size (and, where known,
// pixel-dimension) requirements for a photo, signature and optional document that
// some authority asks applicants to upload.
//
// IMPORTANT — read CLAUDE.md rule 5 before touching the numbers here:
//   Every entry is an UNVERIFIED PLACEHOLDER taken from secondary sources. None
//   has been confirmed against an official notification, so every preset ships
//   `verified: false` and every preset page must render <SpecDisclaimer />. Never
//   silently "correct" a figure, and never add a new preset with invented numbers.
//
// The catalog is deliberately generic: it is NOT limited to exams or any one
// school system. The same shape describes any file-size requirement — government
// forms, portals, applications — so new categories and entries drop in without a
// schema change. Add extensibility by appending to `presets`, not by reworking
// the types.

const KB = 1024;

// Centimetre specs are converted to pixels at this assumed print resolution. The
// assumption is recorded in each affected preset's `notes` so it can be revisited.
const ASSUMED_DPI = 200;

// Converts a length in centimetres to whole pixels at ASSUMED_DPI. 1 inch = 2.54cm.
function cmToPx(cm: number): number {
  return Math.round((cm / 2.54) * ASSUMED_DPI);
}

// One upload target's constraints. Bytes are hard limits; pixel dimensions are
// optional because many authorities specify only a size, not exact dimensions.
export type SizeSpec = {
  minBytes?: number;
  maxBytes: number;
  widthPx?: number;
  heightPx?: number;
  format: 'jpeg' | 'png' | 'pdf';
};

// Broad grouping so the catalog can grow beyond exams. Add values here as new
// kinds of requirement are catalogued.
export type PresetCategory = 'exam' | 'government-form' | 'other';

// A single requirement set. `examName`/`authority` are display labels for whatever
// publishes the requirement — despite the historical field name, the entry need
// not be an exam (see `category`).
export type Preset = {
  slug: string; // URL-safe id, e.g. 'upsc-cse'
  category: PresetCategory;
  examName: string; // human-readable name shown in the UI
  authority: string; // body that publishes the requirement
  officialUrl: string; // where the real, authoritative spec lives
  lastCheckedOn: string; // ISO date this entry was last reviewed
  verified: boolean; // false until a human confirms it against `officialUrl`
  photo: SizeSpec;
  signature: SizeSpec;
  document?: SizeSpec;
  notes: string[]; // assumptions, caveats, anything a reader should know
};

// The seeded catalog. Placeholder numbers only — see the file header.
export const presets: Preset[] = [
  {
    slug: 'upsc-cse',
    category: 'exam',
    examName: 'UPSC Civil Services',
    authority: 'Union Public Service Commission',
    officialUrl: 'https://upsc.gov.in/',
    lastCheckedOn: '2026-09-06',
    verified: false,
    photo: { minBytes: 20 * KB, maxBytes: 300 * KB, format: 'jpeg' },
    signature: { minBytes: 20 * KB, maxBytes: 100 * KB, format: 'jpeg' },
    notes: [
      'Placeholder figures from secondary sources — not confirmed against the official notification.',
      'Photo dimensions are given only as a rough range (about 300x300 to 1000x1000px), so no exact size is set here.',
    ],
  },
  {
    slug: 'ssc-cgl',
    category: 'exam',
    examName: 'SSC Combined Graduate Level',
    authority: 'Staff Selection Commission',
    officialUrl: 'https://ssc.gov.in/',
    lastCheckedOn: '2026-09-06',
    verified: false,
    photo: {
      minBytes: 20 * KB,
      maxBytes: 50 * KB,
      widthPx: cmToPx(3.5),
      heightPx: cmToPx(4.5),
      format: 'jpeg',
    },
    signature: { minBytes: 10 * KB, maxBytes: 20 * KB, format: 'jpeg' },
    notes: [
      'Placeholder figures from secondary sources — not confirmed against the official notification.',
      `Photo given as 3.5cm x 4.5cm; converted to ${cmToPx(3.5)}x${cmToPx(4.5)}px assuming ${ASSUMED_DPI} DPI.`,
    ],
  },
  {
    slug: 'ibps-po',
    category: 'exam',
    examName: 'IBPS Probationary Officer',
    authority: 'Institute of Banking Personnel Selection',
    officialUrl: 'https://www.ibps.in/',
    lastCheckedOn: '2026-09-06',
    verified: false,
    photo: { minBytes: 20 * KB, maxBytes: 50 * KB, format: 'jpeg' },
    signature: { minBytes: 10 * KB, maxBytes: 20 * KB, format: 'jpeg' },
    notes: [
      'Placeholder figures from secondary sources — not confirmed against the official notification.',
    ],
  },
];

// Looks up a preset by its slug; returns undefined if none matches.
export function getPreset(slug: string): Preset | undefined {
  return presets.find((p) => p.slug === slug);
}

// Returns every preset in a given category, in catalog order.
export function presetsInCategory(category: PresetCategory): Preset[] {
  return presets.filter((p) => p.category === category);
}
