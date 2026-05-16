import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
// @ts-expect-error -- plain ESM, no .d.ts
import { apiPlugin } from './api.mjs';

export default defineConfig({
  root: resolve(__dirname),
  plugins: [react(), apiPlugin()],
  server: {
    port: 5181,
    open: false,
    host: '127.0.0.1',
  },
});
