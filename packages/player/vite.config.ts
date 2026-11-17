import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // index.html is the player; bench.html is the page tools/browser-checks.mjs drives.
    rollupOptions: { input: { index: page('index.html'), bench: page('bench.html') } },
  },
});
