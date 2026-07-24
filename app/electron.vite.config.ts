import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Build-time identity for the update checker (see src/main/session/updateCheck.ts):
// a short commit + its commit date, baked in as string constants so the running
// app can compare itself against `main` without shelling out to git at runtime
// (a packaged .app isn't run from inside the git checkout). Falls back to
// 'unknown' — checked out from a tarball, git missing, shallow clone weirdness —
// which the update checker treats as its own "can't tell" state, never a crash.
function gitBuildIdentity(): { commit: string; date: string } {
  try {
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: __dirname }).toString().trim()
    const date = execFileSync('git', ['log', '-1', '--format=%cI'], { cwd: __dirname }).toString().trim()
    if (!commit || !date) throw new Error('empty git output')
    return { commit, date }
  } catch {
    return { commit: 'unknown', date: 'unknown' }
  }
}

const { commit: BUILD_COMMIT, date: BUILD_DATE } = gitBuildIdentity()

export default defineConfig({
  main: {
    define: {
      __BUILD_COMMIT__: JSON.stringify(BUILD_COMMIT),
      __BUILD_DATE__: JSON.stringify(BUILD_DATE),
    },
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
