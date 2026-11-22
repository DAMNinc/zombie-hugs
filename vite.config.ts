import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, 'public/js'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        zombie: path.resolve(__dirname, 'src/client/zombie.ts'),
        solo: path.resolve(__dirname, 'src/client/solo.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'es',
      },
    },
  },
});
