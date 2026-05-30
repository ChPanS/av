import { defineConfig } from 'vite';

export default defineConfig({
  // base: './' делает сборку переносимой на любой хостинг/подпапку
  base: './',
  server: {
    port: 5173,
  },
  build: {
    target: 'esnext', // strudel использует свежие фичи (top-level await и т.д.)
  },
});
