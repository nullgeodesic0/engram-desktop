import { protocol, net } from 'electron'
import { isAbsolute, join, resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stat, realpath } from 'node:fs/promises'
import { engramLearningHome } from './engramCli/readOnly'

/**
 * Serves explorable-artifact HTML (and its same-directory assets — css/js/img
 * a self-contained explorable might reference) to the sandboxed iframe in
 * ExplorableViewer, over a dedicated `explorable://` scheme instead of `file://`.
 *
 * Why not just point an iframe at `file://`: the renderer's CSP is
 * `default-src 'self'` (see renderer/index.html), which has no `file:` in its
 * origin allowlist, so a `file://` iframe src is refused outright. Registering
 * `explorable:` as a privileged/standard scheme and adding it to `frame-src`
 * gives us a real origin to allow without loosening the CSP for anything else
 * (no `unsafe-inline` script, no wildcard host).
 *
 * Why not just prefix-check against `engramLearningHome()`: explorable paths
 * are NOT guaranteed to live under the learning home — engramArtifactList's
 * own doc comment (engramCli/readOnly.ts) confirms engram.py's `artifact list`
 * mixes learning-home-relative paths with fully-absolute ones from a custom
 * topic settings path, and a live check of `~/.claude/learning/graphs/*.json`
 * confirmed both shapes exist in the wild (e.g.
 * ".../Physics Qualifying Examination Preparation/.../noethers-theorem.html"
 * next to "artifacts/grad-classical-mechanics/....html" relative entries in
 * the SAME graph file). A single global-root prefix check would silently
 * break every explorable saved outside the learning home. Instead, each
 * explorable's own directory is allow-listed individually, at the moment a
 * viewer legitimately opens it (`registerExplorableRoot` below, called from
 * the `engram:openExplorable` IPC handler after that path has already been
 * resolved/validated) — so a request can only ever read *sibling files next
 * to an artifact the user was already shown*, never walk to an arbitrary
 * path, and never widen scope beyond what's been opened.
 *
 * IMPORTANT — what this allow-list actually defends, and what it doesn't:
 * `node.artifact` (and `artifact list`'s output) is itself model-authored —
 * the artifact-smith subagent picks the path an entry points at. So the
 * per-directory allow-list is NOT a boundary against the model choosing to
 * "open" some file it shouldn't; a threat model where the model can pick any
 * path already has read access to that path however it produced the graph
 * entry in the first place. What this genuinely defends is display-only
 * scoping (a served explorable's directory can't be leveraged, via crafted
 * relative asset references or the request URL, to read arbitrary sibling
 * paths beyond what the file's own directory contains) and, more
 * importantly, defense-in-depth if the resolved-path/allow-list logic above
 * ever has a bug — the REAL security boundary against the served HTML doing
 * anything dangerous is the iframe's `sandbox="allow-scripts"` (no
 * `allow-same-origin`, no Node, no IPC — see ExplorableViewer.tsx), not this
 * file. Path validation here is about not serving surprising bytes to a
 * user-visible frame, not about containing a malicious script — the sandbox
 * does that.
 *
 * Traversal defense: every request path is resolved with `path.resolve`
 * (collapses `..`) and then required to have `dirname(resolved) === root`
 * for some allow-listed root — an exact directory match, not a `startsWith`
 * prefix (which a sibling like `/root-evil` would satisfy against `/root`).
 * No recursion into subdirectories is allowed either; if an explorable ever
 * needs a nested assets/ folder, widen this deliberately, not by accident.
 *
 * Symlink containment: the dirname check above only constrains where the
 * *request path* points, not what it ultimately resolves to on disk —
 * `fs.stat` follows symlinks, so `isFile()` being true does NOT mean the
 * bytes served come from inside the allowed directory (a symlink physically
 * sitting in an allow-listed dir, itself named `x`, can point at
 * `/etc/passwd`, and `dirname('/allowed/dir/x')` still passes). The handler
 * therefore additionally `realpath()`s both the requested file and the
 * declared root and requires `dirname(realFile) === realRoot` — i.e. even
 * after following any symlink chain, the actual served file must still live
 * directly inside the real (not just nominal) allowed directory.
 */

const allowedRoots = new Set<string>()

/** Registers `dirname(absolutePath)` as servable. Called only from the main
 * process's own `engram:openExplorable` handler, never from renderer input
 * directly — the handler resolves relative-to-learning-home paths and
 * confirms the file exists before this is ever reached. */
export function registerExplorableRoot(absolutePath: string): void {
  allowedRoots.add(dirname(resolve(absolutePath)))
}

/** Resolves a raw artifact path (as stored in a topic graph or returned by
 * `artifact list`) to an absolute path, joining against the learning home
 * when it's relative — mirrors engramArtifactList's own normalization
 * (engramCli/readOnly.ts) since `readTopicGraph` reads graph JSON directly
 * and does NOT go through that normalization. Returns null if the file
 * doesn't exist (or isn't a regular file) so the caller can show a quiet
 * error card instead of a broken frame. */
export async function resolveExplorablePath(rawPath: string): Promise<string | null> {
  const home = await engramLearningHome()
  const absolute = isAbsolute(rawPath) ? rawPath : join(home, rawPath)
  try {
    const st = await stat(absolute)
    if (!st.isFile()) return null
  } catch {
    return null
  }
  return absolute
}

export function registerExplorableSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'explorable',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        stream: true,
      },
    },
  ])
}

/** Must run after `app.whenReady()`. Handles `explorable:///<absolute-path>` —
 * the triple slash mirrors `file://`'s convention (empty host, path starts at
 * the leading `/`), which lets an explorable's own relative asset references
 * (`<script src="chart.js">`) resolve normally against the document URL. */
export function installExplorableProtocolHandler(): void {
  protocol.handle('explorable', async (request) => {
    // Read-only scheme — nothing legitimate ever sends anything but GET, and
    // refusing everything else keeps the handler from having to reason about
    // request bodies at all.
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 })
    }

    let requestedPath: string
    try {
      requestedPath = decodeURIComponent(new URL(request.url).pathname)
    } catch {
      return new Response('Bad request', { status: 400 })
    }
    const resolved = resolve(requestedPath)
    const declaredRoot = dirname(resolved)
    if (!allowedRoots.has(declaredRoot)) {
      return new Response('Not found', { status: 404 })
    }

    // Containment against symlinks: dirname(resolved) being an allowed root
    // only says where the *request path* points, not what it resolves to on
    // disk. Resolve both the file and the root through any symlink chain and
    // require the real file to still live directly inside the real root —
    // see the header comment's "Symlink containment" section for why the
    // plain stat().isFile() check below isn't sufficient on its own.
    let realFile: string
    let realRoot: string
    try {
      ;[realFile, realRoot] = await Promise.all([realpath(resolved), realpath(declaredRoot)])
    } catch {
      return new Response('Not found', { status: 404 })
    }
    if (dirname(realFile) !== realRoot) {
      return new Response('Not found', { status: 404 })
    }

    try {
      const st = await stat(realFile)
      if (!st.isFile()) return new Response('Not found', { status: 404 })
    } catch {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(realFile).toString())
  })
}
