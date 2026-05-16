import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    react(),
    dts({
      include: ['src'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test-setup.ts', 'src/integration/**'],
      rollupTypes: false,
      insertTypesEntry: true,
      tsconfigPath: './tsconfig.json',
    }),
  ],
  css: {
    modules: {
      generateScopedName: 'cv-[name]_[local]_[hash:base64:5]',
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    cssCodeSplit: false,
    sourcemap: true,
    minify: false,
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react'],
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) return 'styles.css';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
