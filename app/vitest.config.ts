import { defineConfig } from 'vitest/config'

// Minimal, deliberately narrow (Phase 3 of the shippable-pass roadmap):
// targets the riskiest NEW logic from the chart-interactivity/structured-
// MCP-card work and the probe-header merge fix, not a retrofit of coverage
// over the whole app.
//
// `.tsx` joined the glob for PlotCard.test.tsx. Still a plain node
// environment and still no jsdom: that one file renders through
// `react-dom/server`, which needs no DOM, and it asserts on the produced
// markup — enough to catch the two bugs that actually reached the screen (a
// LaTeX marker label printing as literal dollar signs because it was an SVG
// <text> node, and the card resizing under the cursor). Interaction-level
// coverage would need jsdom and is deliberately still out of scope.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
