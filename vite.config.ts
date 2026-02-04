import { defineConfig } from 'vite';
import path from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  root: './src/client',
  build: {
    outDir: '../../public',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        zombie: path.resolve(__dirname, 'src/client/zombie.ts')
      },
      output: {
        entryFileNames: 'js/[name].js',
        chunkFileNames: 'js/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      },
      external: ['three']
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/client')
    }
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: '../css/*',
          dest: 'css'
        },
        {
          src: '../content/**/*',
          dest: 'content'
        },
        {
          src: '../fonts/*',
          dest: 'fonts'
        }
      ]
    })
  ],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true
      }
    }
  }
});
