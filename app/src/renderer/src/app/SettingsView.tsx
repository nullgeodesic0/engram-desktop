import { useEffect, useState } from 'react'
import type {
  BackupInfo,
  DescribeArchiveResult,
  DoctorResult,
  LearnerModel,
  NotifierSettings,
  UpdateCheckResult,
} from '../../../shared/types'
import { AchievementsPanel } from '../components/AchievementsPanel'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { DendriteDivider } from '../components/ui/DendriteDivider'
import { CopyButton } from '../components/ui/CopyButton'
import { PageHeader } from '../components/ui/PageHeader'
import { soundOn, setSoundOn } from '../shared/soundscape'
import { friendlyErrorText } from '../shared/friendlyError'

// Mirrors docs/development.md's "Packaged install flow" exactly — keep the two
// in sync if the packaging steps ever change.
const UPDATE_COMMANDS = [
  'git pull',
  'npm run dist:mac',
  'cp -R "app/dist/mac-arm64/Engram Desktop.app" /Applications/',
]

function formatBuildDate(iso: string): string {
  if (!iso || iso === 'unknown') return 'unknown'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

/** The three quiet states from updateCheck.ts — current/behind/unknown — each
 * rendered in Atlas voice, never as an error. `behind` is the only one with
 * anything actionable, so it's the only one with a disclosure. */
function UpdateStatusLine({ update }: { update: UpdateCheckResult }) {
  if (update.state === 'current') {
    return (
      <div className="text-sm text-[var(--color-text-dim)]">
        Up to date — build {update.buildCommit} ({formatBuildDate(update.buildDate)})
      </div>
    )
  }

  if (update.state === 'behind') {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-sm text-[var(--color-ink-warm)]">
          Newer build available — repo at {update.remoteCommit ?? '?'} ({formatBuildDate(update.remoteDate ?? '')})
        </div>
        <details className="fig-caption">
          <summary className="cursor-pointer">how to update</summary>
          <div className="mt-2 flex flex-col gap-1.5 not-italic">
            {UPDATE_COMMANDS.map((cmd) => (
              <div key={cmd} className="group flex items-center gap-2 label-data text-[10px]">
                <code className="flex-1 truncate">{cmd}</code>
                <CopyButton text={cmd} alwaysVisible />
              </div>
            ))}
          </div>
        </details>
      </div>
    )
  }

  return (
    <div className="fig-caption">
      couldn’t check — {update.reason ?? 'unknown reason'}, last checked {formatWhen(update.checkedAt)}
    </div>
  )
}

/** One-line "when was this last done" — used for the last-backup line. */
function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** engram.py's `doctor` health check, rendered the same way EnvironmentSteps
 * shows the claude-CLI / plugin checks — a status row, then any issues called
 * out plainly (danger ink), with hand-editable-state notes tucked behind a
 * disclosure the same way UpdateStatusLine tucks its update commands. */
function DoctorFindings({ doctor }: { doctor: DoctorResult }) {
  return (
    <div className="flex flex-col gap-3">
      <div className={`panel px-4 py-3 flex items-start gap-3 ${doctor.ok ? '' : 'border-[var(--color-ink-danger-dim)]'}`}>
        <span className={doctor.ok ? 'text-[var(--color-ink-warm)]' : 'text-[var(--color-ink-danger)]'}>
          {doctor.ok ? '✓' : '✕'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-[var(--color-text-primary)]">
            {doctor.ok ? 'Everything checks out' : `${doctor.issues.length} issue${doctor.issues.length === 1 ? '' : 's'} found`}
          </div>
          <div className="label-data text-xs text-[var(--color-text-faint)] mt-1">
            {doctor.topics} topic{doctor.topics === 1 ? '' : 's'} · {doctor.nodes} node{doctor.nodes === 1 ? '' : 's'} ·{' '}
            {doctor.receipts} receipt{doctor.receipts === 1 ? '' : 's'} · {doctor.artifacts} artifact
            {doctor.artifacts === 1 ? '' : 's'} · python {doctor.python}
          </div>
        </div>
      </div>
      {doctor.issues.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {doctor.issues.map((issue, i) => (
            <div key={i} className="panel border-[var(--color-ink-danger-dim)] px-3 py-2 text-xs text-[var(--color-ink-danger)]">
              {issue}
            </div>
          ))}
        </div>
      )}
      {doctor.notes.length > 0 && (
        <details className="fig-caption">
          <summary className="cursor-pointer">
            {doctor.notes.length} note{doctor.notes.length === 1 ? '' : 's'}
          </summary>
          <div className="mt-2 flex flex-col gap-1.5 not-italic">
            {doctor.notes.map((note, i) => (
              <div key={i} className="text-xs text-[var(--color-text-dim)]">
                {note}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

type RestoreStep =
  | { kind: 'pick' }
  | { kind: 'summary'; path: string; describe: DescribeArchiveResult }
  | { kind: 'restoring'; path: string }
  | { kind: 'done'; safetyPath: string | null }
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
              {step.safetyPath ? (
                <>
                  Restore complete. A safety snapshot of what was here before is saved at:
                  <div className="label-data mt-1 text-[var(--color-text-primary)] break-all">{step.safetyPath}</div>
                </>
              ) : (
                <>Restore complete — no safety snapshot was needed, there was nothing here to replace.</>
              )}
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
  const [rhythmKeyInput, setRhythmKeyInput] = useState('')
  const [rhythmValueInput, setRhythmValueInput] = useState('')
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
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [version, setVersion] = useState<string | null>(null)
  const [doctor, setDoctor] = useState<DoctorResult | null>(null)
  const [doctorRunning, setDoctorRunning] = useState(false)
  const [doctorError, setDoctorError] = useState<string | null>(null)

  function refresh() {
    window.engram.model().then(setModel)
    window.engram.anySessionActive().then(setSessionActive)
    window.engram.getNotifierSettings().then(setNotifier)
    window.engram.getLoginItemSettings().then((s) => setLaunchAtLoginState(s.openAtLogin))
    window.engram.getBackupInfo().then(setBackupInfo)
    window.engram.getCachedUpdateCheck().then(setUpdate)
    window.engram.getVersion().then(setVersion)
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

  // rhythms is a plain object (`Record<string, unknown>` in the model), not a
  // list — but engram.py's `model --set` walks/creates nested keys inside any
  // existing dict field (see cmd_model's parent-walk), so `rhythms.<key>`
  // reaches it through the exact same modelSet path settings.* already uses.
  // No new IPC, no new allowlist entry — just a dotted key one level deeper.
  async function addRhythm() {
    const key = rhythmKeyInput.trim()
    const value = rhythmValueInput.trim()
    if (!key || !value) return
    await window.engram.modelSet(`rhythms.${key}`, value)
    setRhythmKeyInput('')
    setRhythmValueInput('')
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

  async function recheckUpdate() {
    setUpdateChecking(true)
    try {
      setUpdate(await window.engram.checkForUpdate())
    } finally {
      setUpdateChecking(false)
    }
  }

  // On demand only — never on mount. doctor() shells out to engram.py and
  // re-reads every topic graph on disk; Settings shouldn't pay that cost on
  // every open, only when asked.
  async function runDoctor() {
    setDoctorRunning(true)
    setDoctorError(null)
    try {
      setDoctor(await window.engram.doctor())
    } catch (e) {
      setDoctorError(friendlyErrorText(e instanceof Error ? e.message : String(e)).headline)
    } finally {
      setDoctorRunning(false)
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
      <PageHeader title="Settings" />

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

      <div className="panel px-5 py-5 flex flex-col gap-3">
        <div className="text-sm text-[var(--color-text-primary)]">Goals</div>
        <DendriteDivider />
        <div className="fig-caption">
          Fig. — standing aims the tutor mines for examples and relevance, same as interests above.
        </div>
        {model.goals.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {model.goals.map((g) => (
              <span key={g} className="text-xs px-2 py-1 rounded-lg bg-[var(--color-surface-2)] text-[var(--color-text-dim)]">
                {g}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-xs text-[var(--color-text-faint)]">
            None declared yet — the tutor records these when you tell it what you're working toward.
          </div>
        )}
      </div>

      <div className="panel px-5 py-5 flex flex-col gap-3">
        <div className="text-sm text-[var(--color-text-primary)]">Accessibility</div>
        <DendriteDivider />
        <div className="fig-caption">
          Fig. — declared needs (dyslexia, ADHD, color vision, and the like) the tutor always honors as dials — a
          need, never a “learning style” guess.
        </div>
        {model.accessibility.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {model.accessibility.map((a) => (
              <span key={a} className="text-xs px-2 py-1 rounded-lg bg-[var(--color-surface-2)] text-[var(--color-text-dim)]">
                {a}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-xs text-[var(--color-text-faint)]">
            None declared yet — tell the tutor what you need and it records it here.
          </div>
        )}
      </div>

      <div className="panel px-5 py-5 flex flex-col gap-3">
        <div className="text-sm text-[var(--color-text-primary)]">Rhythms</div>
        <DendriteDivider />
        <div className="fig-caption">
          Fig. — session telemetry (length, cadence, time-of-day yield) the coach reads alongside your session log
          to suggest, never impose, a better schedule.
        </div>
        {Object.keys(model.rhythms).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(model.rhythms).map(([k, v]) => (
              <span key={k} className="text-xs px-2 py-1 rounded-lg bg-[var(--color-surface-2)] text-[var(--color-text-dim)]">
                {k}: {String(v)}
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={rhythmKeyInput}
            onChange={(e) => setRhythmKeyInput(e.target.value)}
            placeholder="Key — e.g. “best_slot”"
            className="focus-ring panel px-3 py-2 text-sm bg-[var(--color-surface-2)] text-[var(--color-text-primary)] flex-1 max-w-[9rem]"
          />
          <input
            value={rhythmValueInput}
            onChange={(e) => setRhythmValueInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addRhythm()
            }}
            placeholder="Value — e.g. “evening”"
            className="focus-ring panel px-3 py-2 text-sm bg-[var(--color-surface-2)] text-[var(--color-text-primary)] flex-1 max-w-xs"
          />
          <Button variant="ghost" onClick={addRhythm} disabled={!rhythmKeyInput.trim() || !rhythmValueInput.trim()}>
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
        <div>
          <div className="text-sm text-[var(--color-text-primary)]">Software</div>
          <div className="text-xs text-[var(--color-text-faint)] mt-0.5">
            Compares this build against the repo’s <span className="label-data">main</span> branch via your own
            authenticated <span className="label-data">gh</span> CLI — nothing is sent anywhere, no embedded token.
          </div>
        </div>
        <DendriteDivider />
        {version && (
          <div className="text-sm text-[var(--color-text-dim)]">
            Version <span className="label-data text-[var(--color-text-primary)]">{version}</span>
          </div>
        )}
        {update ? <UpdateStatusLine update={update} /> : <div className="fig-caption">not checked yet this launch</div>}
        <Button variant="ghost" onClick={recheckUpdate} disabled={updateChecking} className="self-start">
          {updateChecking ? 'Checking…' : 'Check for updates'}
        </Button>
      </div>

      <div className="panel px-5 py-5 flex flex-col gap-3">
        <div>
          <div className="text-sm text-[var(--color-text-primary)]">Diagnostics</div>
          <div className="text-xs text-[var(--color-text-faint)] mt-0.5">
            Runs the engine's own health check — state-dir writability, the learner model, and every topic graph on
            disk. Nothing runs until you ask for it below.
          </div>
        </div>
        <DendriteDivider />
        {doctor && <DoctorFindings doctor={doctor} />}
        {doctorError && (
          <div className="panel border-[var(--color-ink-danger-dim)] px-3 py-2 text-xs text-[var(--color-ink-danger)]">
            {doctorError}
          </div>
        )}
        <Button variant="ghost" onClick={runDoctor} disabled={doctorRunning} className="self-start">
          {doctorRunning ? 'Checking…' : doctor ? 'Run again' : 'Run diagnostics'}
        </Button>
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
