import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, 'public/js'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        zombie: path.resolve(__dirname, 'src/client/zombie.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'iife',
      },
    },
  },
});
