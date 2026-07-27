import { Modal } from './ui/Modal'
import { SHORTCUT_GROUPS, GLOSSARY } from '../shared/helpContent'

/** The app's one help surface — a keyboard reference and a glossary, reachable
 * from the app menu and from `?` (App.tsx's global listener, which is careful
 * never to fire while a text field has focus — see that listener's own
 * comment). This is the one place in the app allowed to explain itself
 * plainly; every other surface states facts about the learner's own memory,
 * never about how the product works. */
export function HelpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Help"
      wide
      // An explicit dismiss button, not just decoration: this sheet is
      // read-only reference material with no other focusable content, so
      // without a real button here the focus trap has nothing to land on
      // and Escape/scrim-click would be the only way out.
      headerExtra={
        <button
          onClick={onClose}
          aria-label="Close"
          className="focus-ring shrink-0 text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] text-lg leading-none"
        >
          ×
        </button>
      }
    >
      <div className="flex flex-col gap-7">
        <section className="flex flex-col gap-3">
          <h3 className="font-[var(--font-display)] text-sm text-[var(--color-text-primary)]">Keyboard reference</h3>
          <p className="fig-caption">Fig. — every shortcut that actually does something. Two keys on one row do the same thing.</p>
          <div className="flex flex-col gap-4">
            {SHORTCUT_GROUPS.map((group) => (
              <div key={group.heading} className="flex flex-col gap-1.5">
                <div className="label-data uppercase tracking-wide text-[10px] text-[var(--color-text-faint)]">
                  {group.heading}
                </div>
                <div className="flex flex-col gap-1">
                  {group.rows.map((row, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-4 text-sm">
                      <span className="flex items-center gap-1.5 shrink-0">
                        {row.keys.map((k, ki) => (
                          <span key={ki} className="flex items-center gap-1.5">
                            {ki > 0 && <span className="text-[var(--color-text-faint)]">or</span>}
                            <kbd className="label-data px-1.5 py-0.5 rounded border border-[var(--color-hairline)] bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-xs">
                              {k}
                            </kbd>
                          </span>
                        ))}
                      </span>
                      <span className="text-[var(--color-text-dim)] text-right">
                        {row.action}
                        {row.context && <span className="text-[var(--color-text-faint)]"> — {row.context}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="font-[var(--font-display)] text-sm text-[var(--color-text-primary)]">Glossary</h3>
          <p className="fig-caption">Fig. — the vocabulary this app uses constantly and never otherwise defines.</p>
          <dl className="flex flex-col gap-4">
            {GLOSSARY.map((g) => (
              <div key={g.term} className="flex flex-col gap-1">
                <dt className="font-[var(--font-serif)] text-[var(--color-ink-warm)]">{g.term}</dt>
                <dd className="text-sm text-[var(--color-text-primary)]">{g.definition}</dd>
                <dd className="fig-caption">Seen in: {g.seenIn}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </Modal>
  )
}
