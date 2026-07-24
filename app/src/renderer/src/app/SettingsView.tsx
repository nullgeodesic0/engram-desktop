import { useEffect, useState } from 'react'
import type { BackupInfo, DescribeArchiveResult, LearnerModel, NotifierSettings } from '../../../shared/types'
import { AchievementsPanel } from '../components/AchievementsPanel'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { DendriteDivider } from '../components/ui/DendriteDivider'
import { soundOn, setSoundOn } from '../shared/soundscape'

/** One-line "when was this last done" — used for the last-backup line. */
function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

type RestoreStep =
  | { kind: 'pick' }
  | { kind: 'summary'; path: string; describe: DescribeArchiveResult }
  | { kind: 'restoring'; path: string }
  | { kind: 'done'; safetyPath: string }
  | { kind: 'failed'; reason: string }

/** The restore half of the Backup section — file picker → describeArchive
 * summary → typed 'restore' confirmation → result. A fresh archive pick or
 * modal close resets all of this; nothing here is remembered across opens.
 * MAIN re-checks the confirmation string and the live-session gate itself
 * (see main/session/backup.ts) — this UI's own gating is a convenience, not
 * the actual safety boundary. */
function RestoreModal({ sessionActive, onClose }: { sessionActive: boolean; onClose: () => void }) {
  const [step, setStep] = useState<RestoreStep>({ kind: 'pick' })
  const [confirmText, setConfirmText] = useState('')

  async function pick() {
    const path = await window.engram.pickBackupArchive()
    if (!path) return
    const describe = await window.engram.describeArchive(path)
    setConfirmText('')
    setStep({ kind: 'summary', path, describe })
  }

  async function doRestore() {
    if (step.kind !== 'summary' || confirmText !== 'restore') return
    setStep({ kind: 'restoring', path: step.path })
    const result = await window.engram.restoreFromArchive(step.path, confirmText)
    if (result.ok) setStep({ kind: 'done', safetyPath: result.safetyPath })
    else setStep({ kind: 'failed', reason: result.reason })
  }

  return (
    <Modal open onClose={onClose} title="Restore from backup">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-[var(--color-text-faint)]">
          Restoring replaces every topic, node, and receipt currently on this machine with what’s in the archive —
          today’s learning state goes away unless it’s in the file you pick. A safety snapshot of what’s here right
          now is always taken first, so this is recoverable even if you pick the wrong file.
        </p>

        {sessionActive && (
          <div className="panel border-[var(--color-ink-warm-dim)] px-3 py-2 text-xs text-[var(--color-ink-warm)]">
            A learning session is currently active — restore is refused until it’s finished or closed.
          </div>
        )}

        {step.kind === 'pick' && (
          <Button variant="ghost" onClick={pick} className="self-start">
            Choose an archive…
          </Button>
        )}

        {step.kind === 'summary' && !step.describe.ok && (
          <>
            <div className="panel border-[var(--color-ink-danger-dim)] px-3 py-2 text-xs text-[var(--color-ink-danger)]">
              {step.describe.reason}
            </div>
            <Button variant="ghost" onClick={pick} className="self-start">
              Choose a different file…
            </Button>
          </>
        )}

        {step.kind === 'summary' && step.describe.ok && (
          <>
            <div className="panel px-3 py-2 flex flex-col gap-1 text-xs">
              <div className="text-[var(--color-text-primary)] label-data truncate" title={step.path}>
                {step.path.split('/').pop()}
              </div>
              <div className="text-[var(--color-text-dim)]">
                {step.describe.topics} topic{step.describe.topics === 1 ? '' : 's'} ·{' '}
                {step.describe.receipts} receipt{step.describe.receipts === 1 ? '' : 's'} · archived{' '}
                {formatWhen(step.describe.archivedAt)}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-[var(--color-text-dim)]" htmlFor="restore-confirm">
                Type <span className="label-data text-[var(--color-ink-danger)]">restore</span> to confirm — this
                overwrites what’s here now.
              </label>
              <input
                id="restore-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="restore"
                className="focus-ring panel px-3 py-2 text-sm bg-[var(--color-surface-2)] text-[var(--color-text-primary)]"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={pick}>
                Choose a different file…
              </Button>
              <Button variant="danger" onClick={doRestore} disabled={confirmText !== 'restore' || sessionActive}>
                Restore
              </Button>
            </div>
          </>
        )}

        {step.kind === 'restoring' && <div className="text-sm text-[var(--color-text-dim)]">Restoring…</div>}

        {step.kind === 'done' && (
          <>
            <div className="panel border-[var(--color-ink-cool-dim)] px-3 py-2 text-xs text-[var(--color-ink-cool)]">
              Restore complete. A safety snapshot of what was here before is saved at:
              <div className="label-data mt-1 text-[var(--color-text-primary)] break-all">{step.safetyPath}</div>
            </div>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        )}

        {step.kind === 'failed' && (
          <>
            <div className="panel border-[var(--color-ink-danger-dim)] px-3 py-2 text-xs text-[var(--color-ink-danger)]">
              {step.reason}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep({ kind: 'pick' })}>
                Try again
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

function ToggleRow({
  label,
  hint,
  options,
  current,
  onPick,
}: {
  label: string
  hint?: string
  options: { value: string; label: string }[]
  current: string
  onPick: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="text-sm text-[var(--color-text-primary)]">{label}</div>
        {hint && <div className="text-xs text-[var(--color-text-faint)]">{hint}</div>}
      </div>
      <div className="flex gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onPick(opt.value)}
            className={`focus-ring px-3 py-1.5 rounded-lg text-xs ${
              current === opt.value
                ? 'bg-[var(--color-surface-3)] text-[var(--color-ink-warm)]'
                : 'bg-[var(--color-surface-2)] text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function PickerRow<T extends string>({
  label,
  hint,
  options,
  current,
  onPick,
}: {
  label: string
  hint?: string
  options: { value: T; label: string; description?: string }[]
  current: T
  onPick: (value: T) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="text-sm text-[var(--color-text-primary)]">{label}</div>
        {hint && <div className="text-xs text-[var(--color-text-faint)]">{hint}</div>}
      </div>
      <SegmentedControl options={options} value={current} onChange={onPick} />
    </div>
  )
}

export function SettingsView() {
  const [model, setModel] = useState<LearnerModel | null>(null)
  const [sessionActive, setSessionActive] = useState(false)
  const [cueInput, setCueInput] = useState('')
  const [actionInput, setActionInput] = useState('')
  const [editingCommitment, setEditingCommitment] = useState(false)
  const [interestInput, setInterestInput] = useState('')
  const [sounds, setSounds] = useState(soundOn())
  const [exporting, setExporting] = useState(false)
  const [exportResult, setExportResult] = useState<string | null>(null)
  const [notifier, setNotifier] = useState<NotifierSettings | null>(null)
  const [launchAtLogin, setLaunchAtLoginState] = useState(false)
  const [checkResult, setCheckResult] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [backupInfo, setBackupInfo] = useState<BackupInfo | null>(null)
  const [backingUp, setBackingUp] = useState(false)
  const [backupResult, setBackupResult] = useState<string | null>(null)
  const [restoreOpen, setRestoreOpen] = useState(false)

  function refresh() {
    window.engram.model().then(setModel)
    window.engram.anySessionActive().then(setSessionActive)
    window.engram.getNotifierSettings().then(setNotifier)
    window.engram.getLoginItemSettings().then((s) => setLaunchAtLoginState(s.openAtLogin))
    window.engram.getBackupInfo().then(setBackupInfo)
  }

  useEffect(refresh, [])

  async function toggleReminders(v: string) {
    const next = await window.engram.setNotifierSettings({ remindersEnabled: v === 'on' })
    setNotifier(next)
  }

  async function setCadence(v: string) {
    const next = await window.engram.setNotifierSettings({ cadenceMinutes: Number(v) })
    setNotifier(next)
  }

  async function toggleDockBadge(v: string) {
    const next = await window.engram.setNotifierSettings({ dockBadgeEnabled: v === 'on' })
    setNotifier(next)
  }

  async function toggleLaunchAtLogin(v: string) {
    const result = await window.engram.setLoginItemSettings(v === 'on')
    setLaunchAtLoginState(result.openAtLogin)
  }

  async function checkReviewsNow() {
    setChecking(true)
    setCheckResult(null)
    try {
      const { dueCount } = await window.engram.checkReviewsNow()
      setCheckResult(dueCount > 0 ? `Notified — ${dueCount} due` : 'Nothing due right now')
    } finally {
      setChecking(false)
    }
  }

  async function setDefaultMode(v: string) {
    await window.engram.modelSet('settings.default_mode', v)
    refresh()
  }

  async function setArtifacts(v: 'eager' | 'threshold' | 'off') {
    await window.engram.visuals(v)
    refresh()
  }

  async function setFocus(v: 'on' | 'off') {
    await window.engram.focus(v)
    refresh()
  }

  async function setMomentum(v: string) {
    await window.engram.modelSet('settings.momentum', v)
    refresh()
  }

  async function setDecayNotice(v: string) {
    await window.engram.modelSet('settings.decay_notice', v)
    refresh()
  }

  async function submitCommitment() {
    if (!cueInput.trim() || !actionInput.trim()) return
    await window.engram.commit(cueInput.trim(), actionInput.trim())
    setCueInput('')
    setActionInput('')
    setEditingCommitment(false)
    refresh()
  }

  async function clearCommitment() {
    // `--set settings.commitment=null` is the engine's own clear semantics.
    await window.engram.modelSet('settings.commitment', 'null')
    setEditingCommitment(false)
    refresh()
  }

  async function addInterest() {
    const v = interestInput.trim()
    if (!v) return
    await window.engram.modelAddInterest(v)
    setInterestInput('')
    refresh()
  }

  async function exportData() {
    setExporting(true)
    setExportResult(null)
    try {
      const result = await window.engram.exportLearningData()
      setExportResult(result.canceled ? null : `Saved to ${result.path}`)
    } finally {
      setExporting(false)
    }
  }

  async function doBackupNow() {
    setBackingUp(true)
    setBackupResult(null)
    try {
      const result = await window.engram.backupNow()
      if (result.ok) {
        setBackupResult(`Saved to ${result.path}`)
        window.engram.getBackupInfo().then(setBackupInfo)
      } else if (result.reason !== 'canceled') {
        setBackupResult(result.reason)
      }
    } finally {
      setBackingUp(false)
    }
  }

  if (!model) return <div className="p-8 text-sm text-[var(--color-text-dim)]">Reading learner model…</div>

  const artifactsValue = model.settings.artifacts === 'threshold-only' ? 'threshold' : model.settings.artifacts

  return (
    <div className="p-8 flex flex-col gap-6 w-full h-full overflow-y-auto">
      <header>
        <h1 className="font-[var(--font-display)] text-2xl text-[var(--color-text-primary)]">Settings</h1>
      </header>

      {sessionActive && (
        <div className="panel border-[var(--color-ink-warm-dim)] px-4 py-3 text-sm text-[var(--color-ink-warm)]">
          A learning session is currently active — changes here still apply immediately (engram.py’s own lockfile
          serializes them safely), this is just a heads-up in case you see the two update at slightly different times.
        </div>
      )}

      <div className="panel px-5 py-5 flex flex-col gap-5">
        <PickerRow
          label="Session mode"
          hint="Default mode when starting a /learn session"
          current={model.settings.default_mode}
          onPick={(v) => setDefaultMode(v)}
          options={[
            { value: 'sprint', label: 'Sprint · ~5 min' },
            { value: 'standard', label: 'Standard · ~25 min' },
            { value: 'deep', label: 'Deep · ~60 min' },
          ]}
        />
        <PickerRow
          label="Explorables"
          hint="When to build interactive artifacts for a node"
          current={artifactsValue}
          onPick={(v) => setArtifacts(v as 'eager' | 'threshold' | 'off')}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'threshold', label: 'Threshold nodes' },
            { value: 'eager', label: 'Eager' },
          ]}
        />
        <PickerRow
          label="Focus profile"
          hint="Dials pacing/feedback for ADHD — never changes pedagogy"
          current={model.settings.profile === 'adhd' ? 'on' : 'off'}
          onPick={(v) => setFocus(v as 'on' | 'off')}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'On' },
          ]}
        />
        <PickerRow
          label="Momentum lines"
          hint="One-line durability callouts on genuine gains"
          current={model.settings.momentum}
          onPick={(v) => setMomentum(v)}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'On' },
          ]}
        />
        <PickerRow
          label="Session sounds"
          hint="Whisper-quiet tones for recalls, ink drops, and the ticket — never for lapses"
          current={sounds ? 'on' : 'off'}
          onPick={(v) => {
            setSoundOn(v === 'on')
            setSounds(v === 'on')
          }}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'On' },
          ]}
        />
        <PickerRow
          label="Decay notices"
          hint="The honest-number line on return after an absence"
          current={model.settings.decay_notice}
          onPick={(v) => setDecayNotice(v)}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'On' },
          ]}
        />
      </div>

      <div className="panel px-5 py-5 flex flex-col gap-3">
        <div className="text-sm text-[var(--color-text-primary)]">Return commitment</div>
        <DendriteDivider />
        {model.settings.commitment && !editingCommitment ? (
          <>
            <div className="text-sm text-[var(--color-text-dim)]">
              “{model.settings.commitment.action}” — {model.settings.commitment.cue}
              <div className="text-xs text-[var(--color-text-faint)] mt-1">set {model.settings.commitment.set}</div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setCueInput(model.settings.commitment?.cue ?? '')
                  setActionInput(model.settings.commitment?.action ?? '')
                  setEditingCommitment(true)
                }}
              >
                Edit
              </Button>
              <Button variant="danger" onClick={clearCommitment}>
                Clear
              </Button>
            </div>
          </>
        ) : (
          <>
            {!model.settings.commitment && (
              <div className="text-xs text-[var(--color-text-faint)]">
                No commitment set yet — this is normally offered once at the close of a session, but you can set one here.
              </div>
            )}
            <div className="flex flex-col gap-2">
              <input
                value={cueInput}
                onChange={(e) => setCueInput(e.target.value)}
                placeholder="Cue — e.g. “when I open the terminal in the morning”"
                className="focus-ring panel px-3 py-2 text-sm bg-[var(--color-surface-2)] text-[var(--color-text-primary)]"
              />
              <input
                value={actionInput}
                onChange={(e) => setActionInput(e.target.value)}
                placeholder="Action — e.g. “I clear one review”"
                className="focus-ring panel px-3 py-2 text-sm bg-[var(--color-surface-2)] text-[var(--color-text-primary)]"
              />
              <div className="flex gap-2">
                <Button variant="ghost" onClick={submitCommitment} disabled={!cueInput.trim() || !actionInput.trim()}>
                  {model.settings.commitment ? 'Save commitment' : 'Set commitment'}
                </Button>
                {editingCommitment && (
                  <Button variant="ghost" onClick={() => setEditingCommitment(false)}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="panel px-5 py-5 flex flex-col gap-3">
        <div className="text-sm text-[var(--color-text-primary)]">Interests</div>
        <DendriteDivider />
        <div className="text-xs text-[var(--color-text-faint)]">
          The tutor leans on these for analogies and examples. Adding is instant; the intake conversation is where they
          get pruned (the engine has no remove operation).
        </div>
        {model.interests.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {model.interests.map((i) => (
              <span key={i} className="text-xs px-2 py-1 rounded-lg bg-[var(--color-surface-2)] text-[var(--color-text-dim)]">
                {i}
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={interestInput}
            onChange={(e) => setInterestInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addInterest()
            }}
            placeholder="Add an interest — e.g. “sailing”"
            className="focus-ring panel px-3 py-2 text-sm bg-[var(--color-surface-2)] text-[var(--color-text-primary)] flex-1 max-w-xs"
          />
          <Button variant="ghost" onClick={addInterest} disabled={!interestInput.trim()}>
            + Add
          </Button>
        </div>
      </div>

      <div className="panel px-5 py-5 flex flex-col gap-5">
        <div className="text-sm text-[var(--color-text-primary)]">Background &amp; notifications</div>
        <DendriteDivider />
        <ToggleRow
          label="Launch at login"
          hint="Keeps Engram Desktop running in the menu bar so reminders work without opening it first"
          current={launchAtLogin ? 'on' : 'off'}
          onPick={toggleLaunchAtLogin}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'On' },
          ]}
        />
        {notifier && (
          <>
            <ToggleRow
              label="Review reminders"
              hint="A native notification when reviews are due"
              current={notifier.remindersEnabled ? 'on' : 'off'}
              onPick={toggleReminders}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'on', label: 'On' },
              ]}
            />
            {notifier.remindersEnabled && (
              <ToggleRow
                label="Reminder cadence"
                hint="Minimum time between repeat reminders for the same due items"
                current={String(notifier.cadenceMinutes)}
                onPick={setCadence}
                options={[
                  { value: '15', label: '15 min' },
                  { value: '30', label: '30 min' },
                  { value: '60', label: '1 hr' },
                  { value: '240', label: '4 hr' },
                ]}
              />
            )}
            <ToggleRow
              label="Dock badge"
              hint="Shows the number of reviews due on the app icon"
              current={notifier.dockBadgeEnabled ? 'on' : 'off'}
              onPick={toggleDockBadge}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'on', label: 'On' },
              ]}
            />
          </>
        )}
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={checkReviewsNow} disabled={checking} className="self-start">
            {checking ? 'Checking…' : 'Check for reviews now'}
          </Button>
          {checkResult && <span className="text-xs text-[var(--color-ink-cool)]">{checkResult}</span>}
        </div>
      </div>

      <div className="panel px-5 py-5 flex flex-col gap-3">
        <div>
          <div className="text-sm text-[var(--color-text-primary)]">Data</div>
          <div className="text-xs text-[var(--color-text-faint)] mt-0.5">
            Every topic, receipt, and artifact lives under your Engram plugin’s own storage — this copies the whole
            thing to a folder you choose, as a plain snapshot in time.
          </div>
        </div>
        <DendriteDivider />
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={exportData} disabled={exporting} className="self-start">
            {exporting ? 'Exporting…' : 'Export learning data'}
          </Button>
          {exportResult && <span className="text-xs text-[var(--color-ink-cool)]">{exportResult}</span>}
        </div>
      </div>

      <div className="panel px-5 py-5 flex flex-col gap-3">
        <div>
          <div className="text-sm text-[var(--color-text-primary)]">Backup</div>
          <div className="text-xs text-[var(--color-text-faint)] mt-0.5">
            A single archive of everything — your learning data plus this app’s own settings — for moving to a new
            machine or recovering from a mistake. Restore replaces what’s currently here; a safety snapshot is
            always taken first.
          </div>
        </div>
        <DendriteDivider />
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={doBackupNow} disabled={backingUp} className="self-start">
            {backingUp ? 'Backing up…' : 'Back up now'}
          </Button>
          <Button variant="ghost" onClick={() => setRestoreOpen(true)} className="self-start">
            Restore…
          </Button>
        </div>
        {backupResult && <span className="text-xs text-[var(--color-ink-cool)]">{backupResult}</span>}
        <div className="text-xs text-[var(--color-text-faint)]">
          {backupInfo?.lastBackupAt
            ? `Last backup: ${formatWhen(backupInfo.lastBackupAt)}`
            : 'No backups yet.'}
        </div>
      </div>

      <div className="panel px-5 py-5 flex flex-col gap-3">
        <div className="text-sm text-[var(--color-text-primary)]">Achievements</div>
        <DendriteDivider />
        <AchievementsPanel />
      </div>

      {restoreOpen && (
        <RestoreModal
          sessionActive={sessionActive}
          onClose={() => {
            setRestoreOpen(false)
            refresh()
          }}
        />
      )}
    </div>
  )
}
