import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'static',
  outDir: '../dist',

  devToolbar: {
    enabled: false
  },

  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        '/ws': {
          target: 'ws://localhost:3000',
          ws: true
        }
      }
    }
  }
});