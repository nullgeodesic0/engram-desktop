/**
 * Reapplies EngramDesktop's local customizations to the installed engram
 * plugin after `claude plugin update` — the plugin (github:nagisanzenin/engram,
 * a third-party dependency this repo doesn't own) installs each update as a
 * FRESH version directory (e.g. 1.0.7, 1.10.1), with none of this repo's own
 * edits carried forward. This script is that carry-forward: every overlay is
 * a self-contained content block, applied idempotently via HTML-comment
 * markers so re-running it (same version or a new one) always converges to
 * the same result, never accumulating duplicate insertions.
 *
 * Content lives in `plugin-overlays/<plugin>/*.md`, one file per inserted
 * block — edit those, not the installed copy directly (a fresh plugin update
 * would erase a direct edit with zero warning). Run `npm run apply:plugin-overlay`
 * after every `claude plugin update engram@engram`; run
 * `npm run check:plugin-overlay` on its own to detect drift without writing
 * anything (e.g. right after a plugin update, before deciding to reapply).
 *
 * The default charter: overlays don't touch the plugin's own pedagogy —
 * a genuinely additive section (a house-style appendix, a QA checklist
 * item), never a change to what a skill teaches or how it grades. One
 * narrow, deliberate exception exists (charter widened 2026-08-03, see
 * plugin-overlays/README.md): a PEDAGOGY overlay is permitted when it is
 * opt-in per sitting, opens with a constitutional-exception header naming
 * the upstream rule it contradicts, and is hash-pinned by checkDoctrine's
 * D5 section — which pins every overlay content file, asserts the
 * load-bearing sentences, and verifies the INSTALLED plugin still carries
 * the applied markers. The quick-checkpoint review protocol is the first
 * such exception. Everything else here remains presentation-only, and any
 * new overlay is reviewed by hand against the README's charter.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')
const OVERLAYS_DIR = join(REPO_ROOT, 'plugin-overlays')

interface Insertion {
  /** Unique id — becomes the marker comment's key; must never collide across
   * insertions in the same target file. */
  id: string
  /** Relative path from `plugin-overlays/<plugin>/` to the content file. */
  contentFile: string
  /** The exact line (trimmed) this insertion's block goes immediately BEFORE.
   * Must appear in the target file's CURRENT (post any earlier insertions in
   * this same pass) content — if it's gone, the anchor may have moved or
   * been renamed upstream; this script fails loudly rather than guessing a
   * new spot. */
  beforeLine: string
}

interface Overlay {
  /** Plugin name as it appears in installed_plugins.json's `<name>@<name>`
   * key and in the cache path `~/.claude/plugins/cache/<name>/<name>/<version>`. */
  plugin: string
  /** Path relative to the plugin's own installPath. */
  targetRelativePath: string
  insertions: Insertion[]
}

const OVERLAYS: Overlay[] = [
  {
    plugin: 'engram',
    targetRelativePath: 'skills/_shared/explorable-contract.md',
    insertions: [
      {
        id: 'visual-design-system',
        contentFile: 'engram/explorable-contract.visual-design-section.md',
        beforeLine: '## Widget vocabulary (grow it, but start here)',
      },
      {
        id: 'qa-checklist-house-style',
        contentFile: 'engram/explorable-contract.qa-checklist-item.md',
        beforeLine: '- [ ] Clause 1: what is gated, and by what commitment?',
      },
    ],
  },
  {
    plugin: 'engram',
    targetRelativePath: 'skills/review/SKILL.md',
    insertions: [
      {
        // The learner-elected checkpoint protocol — a PEDAGOGY overlay under
        // the widened charter (see file header + plugin-overlays/README.md).
        // Slots between the per-item protocol (§2) and the audit (§3), which
        // is exactly where its audit-exclusion rule needs to be read.
        id: 'quick-checkpoint-protocol',
        contentFile: 'engram/review-skill.quick-checkpoint-protocol.md',
        beforeLine: '## 3 · Assessor audit (keep self-grading honest)',
      },
    ],
  },
  {
    plugin: 'engram',
    targetRelativePath: 'skills/_shared/dialogue-grammar.md',
    insertions: [
      {
        // One sentence, placed right after the hard-rules section ends, so
        // the menus rule and the checkpoint protocol are never left as a
        // live contradiction for the model to adjudicate mid-sitting.
        id: 'checkpoint-exception',
        contentFile: 'engram/dialogue-grammar.checkpoint-exception.md',
        beforeLine: '## ⚠ The session does not end on a failed retrieval (v1.5 — retrieval to criterion)',
      },
    ],
  },
]

function marker(id: string, edge: 'start' | 'end'): string {
  return `<!-- engram-desktop-overlay:${id}:${edge} -->`
}

function readInstalledPluginPath(pluginName: string): string {
  const manifestPath = join(homedir(), '.claude', 'plugins', 'installed_plugins.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
    plugins: Record<string, { installPath: string }[]>
  }
  const entries = manifest.plugins[`${pluginName}@${pluginName}`]
  if (!entries || entries.length === 0) {
    throw new Error(`plugin "${pluginName}" not found in ${manifestPath} — is it installed?`)
  }
  return entries[0].installPath
}

/** Builds the marked block for one insertion from its content file. */
function loadBlock(overlayDir: string, insertion: Insertion): { block: string } {
  const contentPath = join(overlayDir, insertion.contentFile)
  const content = readFileSync(contentPath, 'utf-8').replace(/\n+$/, '')
  const block = `${marker(insertion.id, 'start')}\n${content}\n${marker(insertion.id, 'end')}`
  return { block }
}

/** Applies (or, in check mode, evaluates) one insertion against `text`.
 * Returns the resulting text and whether a change was made/would be made. */
function applyInsertion(text: string, insertion: Insertion, block: string): { text: string; changed: boolean } {
  const startMark = marker(insertion.id, 'start')
  const endMark = marker(insertion.id, 'end')
  const startIdx = text.indexOf(startMark)
  if (startIdx !== -1) {
    const endIdx = text.indexOf(endMark, startIdx)
    if (endIdx === -1) {
      throw new Error(`"${insertion.id}": found start marker without a matching end marker — file may have been hand-edited; resolve manually.`)
    }
    const existing = text.slice(startIdx, endIdx + endMark.length)
    if (existing === block) return { text, changed: false }
    return { text: text.slice(0, startIdx) + block + text.slice(endIdx + endMark.length), changed: true }
  }
  const beforeIdx = text.indexOf(insertion.beforeLine)
  if (beforeIdx === -1) {
    throw new Error(
      `"${insertion.id}": anchor line not found: ${JSON.stringify(insertion.beforeLine)}. ` +
        `The plugin's own file may have restructured this section upstream — re-read it and update this insertion's anchor by hand, don't guess a new spot.`,
    )
  }
  return { text: text.slice(0, beforeIdx) + block + '\n\n' + text.slice(beforeIdx), changed: true }
}

function main(): void {
  const checkOnly = process.argv.includes('--check')
  let anyChanged = false
  let anyErrored = false

  for (const overlay of OVERLAYS) {
    let installPath: string
    try {
      installPath = readInstalledPluginPath(overlay.plugin)
    } catch (err) {
      console.error(`FAIL — ${(err as Error).message}`)
      anyErrored = true
      continue
    }
    const targetPath = join(installPath, overlay.targetRelativePath)
    if (!existsSync(targetPath)) {
      console.error(`FAIL — target file does not exist: ${targetPath}`)
      anyErrored = true
      continue
    }
    let text = readFileSync(targetPath, 'utf-8')
    let fileChanged = false
    for (const insertion of overlay.insertions) {
      try {
        const { block } = loadBlock(OVERLAYS_DIR, insertion)
        const result = applyInsertion(text, insertion, block)
        text = result.text
        if (result.changed) {
          fileChanged = true
          anyChanged = true
          console.log(`${checkOnly ? '[would apply]' : '[applied]'} ${overlay.plugin}/${overlay.targetRelativePath} :: ${insertion.id}`)
        } else {
          console.log(`[up to date] ${overlay.plugin}/${overlay.targetRelativePath} :: ${insertion.id}`)
        }
      } catch (err) {
        console.error(`FAIL — ${overlay.plugin}/${overlay.targetRelativePath} :: ${insertion.id} — ${(err as Error).message}`)
        anyErrored = true
      }
    }
    if (fileChanged && !checkOnly) {
      writeFileSync(targetPath, text, 'utf-8')
    }
  }

  if (anyErrored) {
    console.error('\nFAIL — one or more overlays could not be verified/applied (see above).')
    process.exit(1)
  }
  if (checkOnly && anyChanged) {
    console.error('\nDRIFT — installed plugin is missing local customizations. Run `npm run apply:plugin-overlay` to reapply.')
    process.exit(1)
  }
  console.log(`\nOK — all plugin overlays ${checkOnly ? 'verified' : 'applied'}.`)
}

main()
