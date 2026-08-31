/**
 * `explorable://` URL <-> absolute filesystem path, in both directions.
 *
 * Split out of `explorableProtocol.ts` — which imports `electron` at module
 * scope and so cannot be loaded by a plain Node test — because this is the
 * part with real platform behaviour worth pinning down.
 *
 * ## Why the conversion is not string concatenation
 *
 * A POSIX absolute path is already a valid URL path: `/Users/x/a.html` can be
 * pasted after a scheme and read back with `new URL(...).pathname`. That is
 * what the original code did, and on macOS it was correct.
 *
 * A Windows path is none of those things. `C:\Users\x\a.html` has no leading
 * slash, uses a separator the URL parser treats as an opaque character rather
 * than a delimiter, and carries a drive-letter colon that has to survive the
 * trip intact. Concatenated, it produces `explorable://localC:\Users\...`,
 * whose `pathname` is empty — so every explorable in the app would have
 * failed to load with a 404 from our own handler.
 *
 * `pathToFileURL`/`fileURLToPath` already implement exactly this mapping,
 * including the percent-encoding for spaces and non-ASCII that artifact
 * filenames genuinely contain (the artifact-smith names files after node
 * titles). The scheme swap borrows them rather than reimplementing the rules.
 *
 * ## Why `windows` is a parameter
 *
 * Those two functions default to the rules of whatever host they run on,
 * which is correct in production and untestable everywhere else: a Mac cannot
 * otherwise check that the Windows shape round-trips. Threading the platform
 * through makes the Windows behaviour assertable from any machine, and costs
 * one defaulted argument.
 */

import { pathToFileURL, fileURLToPath } from 'node:url'

/** The `local` host is retained from the original URL shape so the served
 * document has one stable origin for the renderer's CSP `frame-src` to
 * allow — `explorable://local/...` on every platform. */
const HOST = 'local'

export function explorablePathToUrl(absolutePath: string, windows = process.platform === 'win32'): string {
  return `explorable://${HOST}${pathToFileURL(absolutePath, { windows }).pathname}`
}

export function explorableUrlToPath(url: string, windows = process.platform === 'win32'): string {
  const { pathname } = new URL(url)
  // Re-badged as file: so Node does the platform-correct decoding — on
  // Windows that is what strips the leading slash off `/C:/Users/...` and
  // turns the separators back into backslashes.
  return fileURLToPath(`file://${pathname}`, { windows })
}
