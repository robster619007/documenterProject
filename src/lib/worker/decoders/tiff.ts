// Lazy TIFF decoder, backed by utif2 (small, pure JS). Dynamically imported the
// first time a TIFF is processed. Importing it registers the decoder.
import UTIF from 'utif2';
import { registerDecoder } from '../image-formats';

registerDecoder('tiff', async (bytes) => {
  const ifds = UTIF.decode(bytes);
  if (ifds.length === 0) throw new Error('No image found in TIFF.');
  const ifd = ifds[0];
  UTIF.decodeImage(bytes, ifd);
  const rgba = UTIF.toRGBA8(ifd); // Uint8Array of RGBA pixels
  const width = ifd.width as number;
  const height = ifd.height as number;
  const image = new ImageData(new Uint8ClampedArray(rgba), width, height);
  return createImageBitmap(image);
});
