// Ambient declarations for the build-time constants defined in electron.vite.config.ts's
// `main.define` block (git commit short-sha + commit date, or 'unknown' if git wasn't
// available at build time). Only valid in the main process bundle — see
// src/main/session/updateCheck.ts for the one place that reads them.
declare const __BUILD_COMMIT__: string
declare const __BUILD_DATE__: string
