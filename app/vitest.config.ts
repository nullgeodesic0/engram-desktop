import { defineConfig } from 'vitest/config'

// Minimal, deliberately narrow (Phase 3 of the shippable-pass roadmap):
// targets the riskiest NEW logic from the chart-interactivity/structured-
// MCP-card work and the probe-header merge fix, not a retrofit of coverage
// over the whole app. Plain node environment — these are pure functions
// over strings/data, not React components, so no jsdom is needed yet.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
