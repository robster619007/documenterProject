// Lazy HEIC/HEIF decoder. Backed by heic-to (libheif compiled to WASM). This
// module is dynamically imported the first time a HEIC file is processed, so its
// ~1–2MB of WASM is never part of the initial page download. Importing it
// registers the decoder as a side effect.
import { heicTo } from 'heic-to';
import { registerDecoder } from '../image-formats';

registerDecoder('heic', (bytes) => heicTo({ blob: new Blob([bytes]), type: 'bitmap' }));
