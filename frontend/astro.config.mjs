import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'static',
  outDir: '../dist',
  vite: {
    plugins: [tailwindcss()],
    server: {
      // Dev-only: astro dev runs on :4321, the Hono backend on :3000.
      // Forward /ws so signaling works without needing PUBLIC_BACKEND_URL
      // during local dev. Has no effect on the production build.
      proxy: {
        '/ws': {
          target: 'ws://localhost:3000',
          ws: true
        }
      }
    }
  }
});