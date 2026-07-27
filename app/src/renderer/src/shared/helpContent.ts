/** Static copy for the Help sheet (App.tsx's `?` / the menu's Help item) — kept
 * as data rather than inline JSX so the two tables can be reviewed and diffed
 * on their own, the way a spec review would check them.
 *
 * KEYBOARD REFERENCE — every row was checked against a live key handler, not
 * against what "should" exist:
 *   - The 11 accelerators come straight from `main/appMenu.ts`'s Electron menu
 *     template (Cmd+, Cmd+N Cmd+L Shift+Cmd+R Shift+Cmd+H Cmd+0..Cmd+5).
 *   - Cmd+K and Cmd+0..Cmd+6 are a SEPARATE renderer-level `keydown` listener
 *     in App.tsx (the `NAV`-driven one) — Cmd+6 is real and works (it opens
 *     Settings) but has no Electron accelerator counterpart, since the menu
 *     reaches Settings via Cmd+, instead. Both are listed as aliases.
 *   - Cmd+Enter (send) and Escape (blur the field) are MessageComposer.tsx's
 *     own `onKeyDown`.
 *   - Arrow Up/Down and Enter-to-run are CommandPalette.tsx's own `onKeyDown`,
 *     scoped to the palette's result list.
 *   - Escape-closes-the-open-dialog is Modal.tsx's shell behavior, shared by
 *     every modal in the app including this one.
 *   - `?` itself is new: App.tsx's global listener, gated on
 *     `!isTypingTarget(document.activeElement)` so it never fires while the
 *     composer, a settings field, or the palette's search box has focus.
 *
 * Deliberately NOT listed: SettingsView's per-field "Enter adds this tag"
 * behavior (addInterest/addRhythm) and CoachSessionPanel's "Enter sends this
 * message" — both are the same ordinary "Enter confirms the field you're in"
 * pattern already covered by the single contextual Enter row below; listing
 * every text field that does this would pad the sheet with the same fact
 * restated per component.
 */

export interface ShortcutRow {
  /** One or more accelerators that do the exact same thing — rendered as
   * aliases on one row, never as separate capabilities. */
  keys: string[]
  action: string
  /** Only set for a binding that only applies in a particular place (a text
   * field, the palette) — omitted for anything that works anywhere. */
  context?: string
}

export const SHORTCUT_GROUPS: { heading: string; rows: ShortcutRow[] }[] = [
  {
    heading: 'Go anywhere',
    rows: [
      { keys: ['⌘0'], action: 'Home' },
      { keys: ['⌘1', '⌘L'], action: 'Learn' },
      { keys: ['⌘2', '⇧⌘R'], action: 'Review' },
      { keys: ['⌘3'], action: 'Topic Map' },
      { keys: ['⌘4'], action: 'Coach' },
      { keys: ['⌘5'], action: 'Artifacts' },
      { keys: ['⌘6', '⌘,'], action: 'Settings' },
      { keys: ['⇧⌘H'], action: 'Session history' },
      { keys: ['⌘K'], action: 'Command palette — jump to a topic, node, or receipt by typing' },
    ],
  },
  {
    heading: 'Start something',
    rows: [{ keys: ['⌘N'], action: 'New topic' }],
  },
  {
    heading: 'While writing',
    rows: [
      { keys: ['⌘⏎'], action: 'Send', context: 'composer' },
      { keys: ['Esc'], action: 'Step back out of the field', context: 'composer' },
    ],
  },
  {
    heading: 'Elsewhere',
    rows: [
      { keys: ['Esc'], action: 'Close the open dialog' },
      { keys: ['↑', '↓'], action: 'Move through the list', context: 'command palette' },
      { keys: ['⏎'], action: 'Confirm the field, or run the highlighted result', context: 'contextual' },
      { keys: ['?'], action: 'Open this sheet', context: 'not while a field has focus' },
    ],
  },
]

export interface GlossaryTerm {
  term: string
  definition: string
  /** Where the learner actually sees this word in the app today — grounds the
   * definition in a real surface rather than a dictionary abstraction. */
  seenIn: string
}

/** Every entry here was checked against the engine's own source (the FSRS
 * core and the curriculum architect's own node-authoring rules) or against
 * this app's own established vocabulary (nodeDisplay.ts's stateLabel, already
 * user-visible on the Topic Map and Home) — never written as a plausible
 * gloss. See the P4/P5 task report for the term-by-term grounding table. */
export const GLOSSARY: GlossaryTerm[] = [
  {
    term: 'Threshold',
    definition:
      "One of a topic's 1–3 portal concepts — the ideas that reorganize everything after them once you actually have them. These get an interactive explorable and extra relearning if they lapse.",
    seenIn: 'The † mark on a node in the Topic Map.',
  },
  {
    term: 'Stability',
    definition:
      'How many days a memory can go untouched and still come back reliably. It grows when you recall something well, and — unlike almost every other number in this app — a lapse can only shrink it, never grow it.',
    seenIn: "A node's drawer in the Topic Map (\"stability 40d\"), and the stability bar on a graded result.",
  },
  {
    term: 'Retrievability',
    definition:
      "The engine's live estimate of how likely you are to recall a node right now, given its stability and how long it's been. It decays continuously between reviews, not just on the day something comes due.",
    seenIn: "A node's ink fading on the Topic Map the longer it goes untouched.",
  },
  {
    term: 'Lapse',
    definition:
      'An honest "I couldn\'t produce that" — not a failure. Stability drops (see above) and the node returns to encoding. The app never frames a lapse as bad news, because a lapse caught here is cheaper than one on the day it actually mattered.',
    seenIn: 'The "Lapsed" badge on a graded result.',
  },
  {
    term: 'Frontier',
    definition:
      "The concept or concepts actually ready to learn next — every prerequisite already encoded. There's usually more than one path open at a time; the frontier is whichever nodes have nothing left blocking them.",
    seenIn: 'The ringed nodes on the Topic Map, and a session ticket\'s "frontier 8/13".',
  },
  {
    term: 'Encode',
    definition:
      "A concept's first honest production from memory — the moment it stops being untouched and starts being held, even loosely.",
    seenIn: 'The "encoding" count on a topic card, once a node has left "not started".',
  },
  {
    term: 'Consolidate',
    definition:
      "A concept that has survived long enough, across enough successful recalls, to be held by review alone rather than active study. This app's own word for a node that has cleared encoding — a lapse can still return it there.",
    seenIn: 'The "consolidated" group on Home, and a node reading "consolidated" in the Topic Map.',
  },
  {
    term: 'Probe',
    definition:
      'The question itself, shown alone — no options, no hints, no "remember when we…". That bareness is deliberate: anything more turns free recall into recognition, which measures something else.',
    seenIn: 'The prompt at the top of every Learn and Review turn.',
  },
  {
    term: 'Receipt',
    definition:
      "The permanent record written every time a node is rated — what was asked, what came back, and exactly how it moved the schedule. Nothing in this app claims a memory changed without one.",
    seenIn: 'A graded result card, and every row in Session History.',
  },
  {
    term: 'Capstone',
    definition:
      "The one node every other node in a topic must be encoded before it unlocks. It isn't a recap — it's a synthesis that asks you to use the whole topic at once, which is why it waits for everything else.",
    seenIn: 'The ★ mark on a node in the Topic Map.',
  },
]
