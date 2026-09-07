import { getViteConfig } from 'astro/config';

// getViteConfig ensures Vitest resolves modules the same way Astro does.
export default getViteConfig({
  test: {
    include: ['tests/unit/**/*.{test,spec}.ts'],
    environment: 'node',
  },
});
