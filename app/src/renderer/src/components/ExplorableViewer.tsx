import { useEffect, useState } from 'react'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { humanizeNodeId } from '../../../shared/humanizeId'

/**
 * In-app viewer for artifact-smith explorables — self-contained interactive
 * HTML files under `~/.claude/learning` (or a custom topic settings path)
 * that are, by contract, MODEL-AUTHORED and therefore untrusted content.
 *
 * Sandbox mechanism (why this frame can't reach Node, IPC, or the host
 * window):
 *
 * 1. It's a plain `<iframe>`, never a `<webview>` — Electron's `<webview>`
 *    tag carries its own Node/IPC surface (`nodeIntegration`,
 *    `preload`, `ipcRenderer` bridging) that the brief explicitly forbids;
 *    an `<iframe>` has none of that by construction, and this app's
 *    BrowserWindow doesn't set `nodeIntegrationInSubFrames` (defaults to
 *    false), so subframes never get Node even if someone tried.
 * 2. `sandbox="allow-scripts"` — ONLY `allow-scripts`, deliberately never
 *    combined with `allow-same-origin`. Per the HTML sandbox spec, an
 *    `allow-scripts`-only frame is forced into a unique, opaque origin on
 *    every load: its script can run (interactive explorables need JS for
 *    charts/simulations), but it cannot read/write the parent's DOM
 *    (different origin, blocked by the same-origin policy), cannot use
 *    `window.top`/`window.parent` to script the host, and — because
 *    `allow-top-navigation` / `allow-popups` are also NOT set — cannot
 *    navigate the host window or spawn new windows. Adding
 *    `allow-same-origin` back would give the frame's origin a stable
 *    identity matching the `explorable:` scheme's origin and let it read
 *    other allow-listed explorables' files via `fetch()`; that combination
 *    is never used here.
 * 3. `src` points at a dedicated `explorable://` scheme (see
 *    main/explorableProtocol.ts), not `file://` — the renderer's CSP is
 *    `default-src 'self'` (renderer/index.html) with `frame-src
 *    explorable:` as the one carve-out, so a `file://` src would be
 *    refused by CSP before the sandbox attribute even mattered. The
 *    `explorable://` handler in main only ever serves a file whose
 *    directory was explicitly allow-listed by the trusted
 *    `engram:openExplorable` IPC handler (never renderer-supplied paths
 *    directly), resolves `..` away, and rejects anything outside that
 *    single directory — see that file's header comment for why a global
 *    prefix check against the learning home alone isn't sufficient (some
 *    explorables legitimately live at arbitrary absolute paths outside
 *    it).
 *
 * Failure mode when the file is missing/unreadable: `engram:openExplorable`
 * resolves to `{ error }` instead of throwing, and this component renders a
 * quiet inline error card inside the Modal — no crash, no blank frame, no
 * error dialog stealing focus (compare the old `engram:openArtifact`
 * external-window path, which pops a native `dialog.showErrorBox`).
 */
export function ExplorableViewer({
  path,
  title,
  nodeId,
  onClose,
  onJumpToNode,
}: {
  /** Raw artifact path as stored on the node/entry — may be relative to the
   * learning home (topic graphs often store it that way) or fully absolute;
   * resolved and validated in main before anything is rendered. */
  path: string
  title?: string
  nodeId?: string
  onClose: () => void
  /** Lets the caller (TopicMapView / ArtifactGalleryView) own navigation —
   * this component never touches routing itself. */
  onJumpToNode?: (nodeId: string) => void
}) {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'ready'; url: string; absolutePath: string } | { kind: 'error'; message: string }
  >({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    window.engram
      .openExplorable(path)
      .then((res) => {
        if (cancelled) return
        if ('error' in res) setState({ kind: 'error', message: res.error })
        else setState({ kind: 'ready', url: res.url, absolutePath: res.absolutePath })
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ kind: 'error', message: e.message })
      })
    return () => {
      cancelled = true
    }
  }, [path])

  const displayTitle = title ?? (nodeId ? humanizeNodeId(nodeId) : 'Explorable')

  return (
    <Modal open onClose={onClose} wide panelClassName="!max-w-4xl !h-[85vh] !max-h-[85vh]">
      <div className="flex flex-col gap-3 h-full">
        <div className="flex items-start justify-between gap-3 shrink-0">
          <div>
            <h2 className="font-[var(--font-display)] text-xl text-[var(--color-text-primary)]">{displayTitle}</h2>
            {nodeId && (
              <div className="flex items-center gap-2 mt-0.5">
                <span className="label-data text-[10px] text-[var(--color-text-faint)]">{nodeId}</span>
                {onJumpToNode && (
                  <button
                    onClick={() => onJumpToNode(nodeId)}
                    className="focus-ring text-[10px] label-data text-[var(--color-ink-cool)] hover:text-[var(--color-text-primary)]"
                  >
                    Jump to node →
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {state.kind === 'ready' && (
              <Button variant="ghost" onClick={() => window.engram.openArtifact(state.absolutePath)}>
                Open in browser ↗
              </Button>
            )}
            <button
              onClick={onClose}
              className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] text-2xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 rounded-lg border border-[var(--color-hairline)] bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] overflow-hidden">
          {state.kind === 'loading' && (
            <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-dim)]">
              Loading explorable…
            </div>
          )}
          {state.kind === 'error' && (
            <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center">
              <div className="text-sm text-[var(--color-ink-danger)]">Couldn’t load this explorable</div>
              <div className="text-xs text-[var(--color-text-faint)] max-w-md">{state.message}</div>
            </div>
          )}
          {state.kind === 'ready' && (
            <iframe
              src={state.url}
              sandbox="allow-scripts"
              title={displayTitle}
              className="w-full h-full border-0 bg-white"
            />
          )}
        </div>
      </div>
    </Modal>
  )
}
