// The contract between the MCP bridge worker (spawned by `claude` as an MCP
// server, replacing the native AskUserQuestion tool — see spike/FINDINGS.md
// Finding 3) and the Electron main process's bridgeServer HTTP relay.

export interface BridgeAskRequest {
  requestId: string
  sessionId: string
  question: string
  header: string
  options: { label: string; description?: string }[]
  multiSelect: boolean
}

export interface BridgeAskResponse {
  // Either a picked option's label (or labels, if multiSelect), or null if
  // the picker was dismissed — mirrors AskUserQuestion's own "Other -> skip"
  // -> null convention from the dialogue grammar.
  chosen: string[] | null
}

export interface BridgeBeatRequest {
  sessionId: string
  beat: string
  content: string
  // extended beat telemetry — the worker may attach the node id and a 'n/of' session position
  node?: string
  position?: string
}

// generic fire-and-forget tutor-driven UI signal; `tool` names which MCP tool fired, `payload` is that tool's zod-validated input — renderer must still shape-guard before use
//
// `tool: 'annotate_node'` is the one kind the main process also persists (see
// bridgeServer.ts + main/session/mapAnnotations.ts) before forwarding — its
// payload shape is `{ topic: string; node: string; latex_label?: string; latex_claim?: string }`
// (at least one of latex_label/latex_claim present), matching mapAnnotations.ts's
// sanitizeAnnotatePayload.
export interface BridgeUiRequest {
  sessionId: string
  tool: string
  payload: Record<string, unknown>
}
