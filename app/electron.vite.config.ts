import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
        output: {
          // `three` (NeuralField's ambient WebGL backdrop) and `katex` (MathRenderer)
          // are the two heaviest deps and aren't needed for first paint — split them
          // into their own chunks so the main bundle shrinks and they can be fetched
          // in parallel with (or after) it instead of inflating one monolithic chunk.
          manualChunks(id) {
            if (id.includes('node_modules/three')) return 'vendor-three'
            if (id.includes('node_modules/katex')) return 'vendor-katex'
          },
        },
      },
    },
  },
})
