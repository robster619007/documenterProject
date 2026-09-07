// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// Static output for Cloudflare Pages. No adapter is needed for a fully static
// build — @astrojs/cloudflare is only required once we add server routes (not
// in the prototype). `site` is a placeholder until the real domain is chosen;
// it drives canonical URLs and the generated sitemap.
export default defineConfig({
  site: 'https://documenter.pages.dev',
  output: 'static',
  integrations: [
    react(),
    // Keep the dev-only engine harness out of the public sitemap.
    sitemap({ filter: (page) => !page.includes('/dev/') }),
  ],
  vite: {
    plugins: [tailwindcss()],
    // Build Web Workers as ES modules so they can code-split (our workers use
    // dynamic import() to lazy-load heavy decoders like HEIC/TIFF).
    worker: { format: 'es' },
  },
});
