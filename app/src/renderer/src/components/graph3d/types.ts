// src/renderer/src/components/graph3d/types.ts

export type EdgeKind = 'requires' | 'derives_from' | 'contrasts_with' | 'analogous_to'

export interface SimEdge {
  source: string
  target: string
  kind: EdgeKind
}

export interface EdgeStyleSpec {
  stroke: string
  dash?: string
  width: number
  label: string
}

export const EDGE_STYLE: Record<EdgeKind, EdgeStyleSpec> = {
  requires: { stroke: 'var(--color-ink-cool)', width: 1.3, label: 'requires' },
  derives_from: { stroke: 'var(--color-ink-cool-dim)', dash: '1 3', width: 1, label: 'derives from' },
  contrasts_with: { stroke: 'var(--color-ink-danger-dim)', dash: '5 3', width: 1, label: 'contrasts with' },
  analogous_to: { stroke: 'var(--color-ink-warm-dim)', dash: '1 4', width: 1, label: 'analogous to' },
}

export interface ForceParams {
  centerForce: number
  repelForce: number
  linkForce: number
  linkDistance: number
  nodeSize: number
  linkThickness: number
  labelSize: number
  showLabels: 'auto' | 'always' | 'never'
  showCapstoneLinks: boolean
}

export const DEFAULT_FORCE_PARAMS: ForceParams = {
  centerForce: 1,
  repelForce: 1,
  linkForce: 1,
  linkDistance: 1,
  nodeSize: 1,
  linkThickness: 1,
  labelSize: 11,
  showLabels: 'auto',
  showCapstoneLinks: false,
}
