import type { DrainSummary, LinkStatus, LocalModelProbe, OpencodeProbe, OpencodeSetupStatus, PairingOffer } from '../../../shared/types'
import { useEffect, useState } from 'react'
import type {
  ApiKeyStatus,
  AuthSettings,
  BackupInfo,
  DescribeArchiveResult,
  DoctorResult,
  LearnerModel,
  NotifierSettings,
  UpdateCheckResult,
  CrashLogEntry,
} from '../../../shared/types'
import { AchievementsPanel } from '../components/AchievementsPanel'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { describeProbe as describeProbeVerdict } from '../../../shared/localModelVerdict'
import { describeOpencodeProbe as describeOpencodeProbeVerdict } from '../../../shared/opencodeVerdict'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { DendriteDivider } from '../components/ui/DendriteDivider'
import { CopyButton } from '../components/ui/CopyButton'
import { PageHeader } from '../components/ui/PageHeader'
import { SectionBanner } from '../components/ui/SectionBanner'
import { soundOn, setSoundOn } from '../shared/soundscape'
import { friendlyErrorText } from '../shared/friendlyError'
import { getStoredThemeChoice, setThemeChoice, type ThemeChoice } from '../shared/theme'

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

/** Local crash visibility (Phase 3) — same quiet-status-row idiom as
 * `DoctorFindings` above. Empty state reads as reassurance, not an absence;
 * a non-empty log shows most-recent-first (already sorted that way by
 * `getCrashLog` in the main process) with the raw message and, behind a
 * disclosure (same pattern as DoctorFindings' notes), the stack trace —
 * useful for reporting a bug, noisy for everyday reading. */
function CrashLogSection({ entries }: { entries: CrashLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="panel px-4 py-3 flex items-center gap-3">
        <span className="text-[var(--color-ink-warm)]">✓</span>
        <div className="text-sm text-[var(--color-text-primary)]">No crashes recorded</div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      {entries.slice(0, 20).map((entry, i) => (
        <details key={i} className="panel border-[var(--color-ink-danger-dim)] px-3 py-2 text-xs">
          <summary className="cursor-pointer text-[var(--color-ink-danger)]">
            <span className="label-data">{new Date(entry.timestamp).toLocaleString()}</span> · {entry.source} ·{' '}
            {entry.message}
          </summary>
          {entry.stack && (
            <pre className="mt-2 text-[10px] text-[var(--color-text-faint)] whitespace-pre-wrap font-mono">
              {entry.stack}
            </pre>
          )}
        </details>
      ))}
      {entries.length > 20 && (
        <div className="fig-caption">+{entries.length - 20} older, not shown</div>
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
                className="focus-ring panel px-3 py-2 text-sm bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-primary)]"
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
                ? 'bg-[color-mix(in_srgb,var(--color-surface-3)_68%,transparent)] text-[var(--color-ink-warm)]'
                : 'bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]'
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

/** Light/dark toggle — 'system' (the default) tracks the OS setting until the
 * learner picks an explicit theme, which then wins regardless of the OS.
 * Local component state only (not the learner-model settings object): the
 * theme is a renderer-local preference persisted to localStorage via
 * shared/theme.ts, not part of engram.py's learner-model settings — there's
 * no backend round-trip here, just an immediate localStorage write + DOM
 * attribute flip. */
function ThemePickerRow() {
  const [choice, setChoice] = useState<ThemeChoice>(getStoredThemeChoice())
  return (
    <PickerRow
      label="Theme"
      hint="System follows your Mac's appearance setting"
      current={choice}
      onPick={(v) => {
        setThemeChoice(v)
        setChoice(v)
      }}
      options={[
        { value: 'system', label: 'System' },
        { value: 'dark', label: 'Dark' },
        { value: 'light', label: 'Light' },
      ]}
    />
  )
}


/** The phone link.
 *
 * Lives in Settings because that is where people look for it — the menu-bar
 * item stays, but a capability nobody can find is a capability nobody has.
 *
 * States what is true and nothing more: whether the server is up, what a phone
 * should be pointed at, which devices are trusted, and how much work is
 * waiting to be settled. The encryption gap is named here rather than buried,
 * because widening the bind is the one action on this panel that can put a
 * learner's productions on a network.
 */
function CompanionSection() {
  const [status, setStatus] = useState<LinkStatus | null>(null)
  const [offer, setOffer] = useState<PairingOffer | null>(null)
  const [now, setNow] = useState(Date.now())
  const [settling, setSettling] = useState(false)
  const [settled, setSettled] = useState<DrainSummary | null>(null)

  useEffect(() => {
    void window.engram.linkStatus().then(setStatus)
  }, [])

  // A code that has quietly expired is worse than no code: it reads as broken
  // rather than as elapsed. Tick so the countdown is honest.
  useEffect(() => {
    if (!offer) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [offer])

  const secondsLeft = offer ? Math.max(0, Math.round((offer.expiresAt - now) / 1000)) : 0

  async function beginPairing() {
    setOffer(await window.engram.linkBeginPairing())
    setNow(Date.now())
    setStatus(await window.engram.linkStatus())
  }

  if (!status) return null

  return (
    <div className="panel px-5 py-5 flex flex-col gap-4">
      <SectionBanner label="Companion" className="border-t-0" />

      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-[var(--color-text-primary)]">
            {status.running ? 'Listening for your phone' : 'Not running'}
          </div>
          <div className="label-data text-xs text-[var(--color-text-dim)] mt-1">
            {status.running ? (status.lanUrl ?? `http://127.0.0.1:${status.port} · this Mac only`) : (status.error ?? '—')}
          </div>
          {!status.running && status.error?.includes('EADDRINUSE') && (
            <div className="text-xs text-[var(--color-text-dim)] mt-1">
              Something else is already using the port — most often a second copy of this app, or the
              development link script.
            </div>
          )}
        </div>
        <button className="btn-ghost text-xs" onClick={() => void beginPairing()}>
          Link a phone…
        </button>
      </div>

      {offer && (
        <div className="panel-plate px-4 py-3 flex flex-col gap-1">
          <div className="label-data text-[10px] text-[var(--color-text-faint)]">PAIRING CODE</div>
          <div className="text-2xl text-[var(--color-ink-warm)] tracking-widest label-data">{offer.code}</div>
          <div className="text-xs text-[var(--color-text-dim)]">
            Enter it with host <span className="label-data">{offer.url}</span>.{' '}
            {secondsLeft > 0 ? `Single-use, ${secondsLeft}s left.` : 'Expired — ask for another.'}
          </div>
          {offer.loopbackOnly && (
            <div className="text-xs text-[var(--color-text-dim)] mt-1">
              Reachable from this Mac only, so a simulator will connect and a real phone will not.
            </div>
          )}
        </div>
      )}

      <PickerRow
        label="Reachable from"
        hint="There is no transport encryption yet — only widen this on a network you trust"
        current={status.exposed ? 'lan' : 'loopback'}
        onPick={(v) => {
          void window.engram.linkExpose(v === 'lan').then(setStatus)
          setOffer(null)
        }}
        options={[
          { value: 'loopback', label: 'This Mac only' },
          { value: 'lan', label: 'This network' },
        ]}
      />

      {status.devices.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {status.devices.map((device) => (
            <div key={device.deviceId} className="flex items-center gap-3 text-xs">
              <span className="text-[var(--color-text-primary)] flex-1 min-w-0 truncate">{device.deviceName}</span>
              <span className="label-data text-[var(--color-text-faint)]">
                {new Date(device.pairedAt).toLocaleDateString()}
              </span>
              <button
                className="btn-ghost text-xs"
                onClick={() => void window.engram.linkRevoke(device.deviceId).then(setStatus)}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      {status.queued > 0 && (
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-[var(--color-text-primary)]">
              {status.queued} item(s) waiting from your phone
            </div>
            <div className="fig-caption mt-1">
              Settling opens one sitting per topic. Nothing is graded until it does — the phone reports what
              you did; the session decides what it was worth.
            </div>
          </div>
          <button
            className="btn-ghost text-xs"
            disabled={settling}
            onClick={() => {
              setSettling(true)
              void window.engram
                .linkSettle()
                .then(async (result) => {
                  setSettled(result)
                  setStatus(await window.engram.linkStatus())
                })
                .finally(() => setSettling(false))
            }}
          >
            {settling ? 'Settling…' : 'Settle now'}
          </button>
        </div>
      )}

      {settled && (
        <div className="fig-caption">
          {settled.sessionsStarted} sitting(s) opened for {settled.itemsDrained} item(s).
          {/* Settled and handed-over are reported separately on purpose: a
              sitting that starts has not graded anything yet, and saying
              otherwise is what let failed sittings look like finished ones. */}
          {settled.itemsSettled > 0 && ` ${settled.itemsSettled} earlier item(s) confirmed by a receipt.`}
          {settled.itemsRetried > 0 && ` ${settled.itemsRetried} returned to the queue after a sitting produced nothing.`}
          {/* Said plainly rather than hidden: this is work the learner did
              that will never reach the record, and quietly dropping it is
              exactly what the in-flight state was introduced to stop. */}
          {settled.itemsAbandoned > 0 &&
            ` ${settled.itemsAbandoned} given up on after repeated sittings wrote nothing — that evidence may not be gradeable on its own.`}
          {settled.failures.length > 0 &&
            ` ${settled.failures.length} topic(s) could not start and stay queued: ${settled.failures
              .map((f) => f.topic)
              .join(', ')}.`}
        </div>
      )}
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
  const [auth, setAuth] = useState<AuthSettings | null>(null)
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus | null>(null)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
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
  // Crash log (Phase 3) — unlike `doctor`, this is a plain local file read
  // (no engram.py shell-out), so it's cheap enough to load on mount rather
  // than gating behind a button: a learner who just had the app disappear
  // on them shouldn't have to know to ask for the reason.
  const [crashLog, setCrashLog] = useState<CrashLogEntry[]>([])

  // Local models. `probe` is null until asked: a capability check costs a
  // real generation on the learner's own hardware, so it runs on demand.
  const [localModels, setLocalModels] = useState<string[]>([])
  const [probe, setProbe] = useState<LocalModelProbe | null>(null)
  const [probing, setProbing] = useState(false)

  // OpenCode + Cursor. `opencodeSetup` (free) is fetched on entering the
  // mode; `opencodeProbe` (NOT free — a real turn on the user's Cursor plan)
  // stays null until the learner presses the button.
  const [opencodeSetup, setOpencodeSetup] = useState<OpencodeSetupStatus | null>(null)
  const [opencodeProbe, setOpencodeProbe] = useState<OpencodeProbe | null>(null)
  const [opencodeProbing, setOpencodeProbing] = useState(false)

  function refresh() {
    window.engram.model().then(setModel)
    window.engram.anySessionActive().then(setSessionActive)
    window.engram.getNotifierSettings().then(setNotifier)
    window.engram.getAuthSettings().then(setAuth)
    window.engram.authKeyStatus().then(setKeyStatus)
    window.engram.getLoginItemSettings().then((s) => setLaunchAtLoginState(s.openAtLogin))
    window.engram.getBackupInfo().then(setBackupInfo)
    window.engram.getCrashLog().then(setCrashLog)
    window.engram.getCachedUpdateCheck().then(setUpdate)
    window.engram.getVersion().then(setVersion)
  }

  useEffect(refresh, [])

  async function pickAuthMode(v: string) {
    const mode = v === 'apiKey' ? 'apiKey' : v === 'local' ? 'local' : v === 'opencodeCursor' ? 'opencodeCursor' : 'subscription'
    const next = await window.engram.setAuthMode(mode)
    setAuth(next)
    // A mode switch invalidates any previous verdict — it was about a
    // different runtime.
    setProbe(null)
    setOpencodeProbe(null)
    if (mode === 'local') setLocalModels(await window.engram.listLocalModels(next.localBaseUrl))
    if (mode === 'opencodeCursor') setOpencodeSetup(await window.engram.opencodeSetup())
  }

  async function pickLocalModel(model: string) {
    if (!auth) return
    setProbe(null)
    setAuth(await window.engram.setLocalModel(auth.localBaseUrl, model))
  }

  async function runProbe() {
    if (!auth) return
    setProbing(true)
    setProbe(null)
    try {
      setProbe(await window.engram.probeLocalModel(auth.localBaseUrl, auth.localModel))
    } catch (err) {
      setProbe({
        reachable: false,
        text: false,
        toolUse: false,
        toolUseImitation: false,
        models: [],
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setProbing(false)
    }
  }

  async function pickOpencodeModel(model: string) {
    setOpencodeProbe(null)
    setAuth(await window.engram.setOpencodeModel(model))
  }

  async function runOpencodeProbe() {
    if (!auth) return
    setOpencodeProbing(true)
    setOpencodeProbe(null)
    try {
      setOpencodeProbe(await window.engram.probeOpencodeModel(auth.opencodeModel))
    } catch (err) {
      setOpencodeProbe({ ok: false, toolUse: false, costUsd: null, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setOpencodeProbing(false)
    }
  }

  async function saveApiKey() {
    const key = apiKeyDraft.trim()
    if (key === '') return
    setAuthError(null)
    try {
      setKeyStatus(await window.engram.authSetApiKey(key))
      setApiKeyDraft('')
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err))
    }
  }

  async function removeApiKey() {
    setAuthError(null)
    try {
      setKeyStatus(await window.engram.authClearApiKey())
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err))
    }
  }

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

  async function setCheckpointAllNodes(v: string) {
    await window.engram.modelSetCheckpointAllNodes(v === 'on' ? 'on' : 'off')
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

      <CompanionSection />

      <div className="panel px-5 py-5 flex flex-col gap-5">
        <SectionBanner label="Appearance" className="border-t-0" />
        <ThemePickerRow />
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
        <PickerRow
          label="Checkpoints on every node"
          hint="Off by default. When on, an elected Checkpoint sitting may walk ANY node as a chain of picks — including threshold, lapsed, transfer-ready, and procedure nodes normally held to free recall. The recall floor still applies: two checkpoint reviews in a row still force the next one back to real production."
          current={model.settings.checkpoint_all_nodes ?? 'off'}
          onPick={(v) => setCheckpointAllNodes(v)}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'On' },
          ]}
        />
      </div>

      <div className="panel px-5 py-5 flex flex-col gap-3">
        <SectionBanner label="Return commitment" className="border-t-0" />
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
                className="focus-ring panel px-3 py-2 text-sm bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-primary)]"
              />
              <input
                value={actionInput}
                onChange={(e) => setActionInput(e.target.value)}
                placeholder="Action — e.g. “I clear one review”"
                className="focus-ring panel px-3 py-2 text-sm bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-primary)]"
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
        <SectionBanner label="Interests" className="border-t-0" />
        <DendriteDivider />
        <div className="text-xs text-[var(--color-text-faint)]">
          The tutor leans on these for analogies and examples. Adding is instant; the intake conversation is where they
          get pruned (the engine has no remove operation).
        </div>
        {model.interests.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {model.interests.map((i) => (
              <span key={i} className="text-xs px-2 py-1 rounded-lg bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-dim)]">
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
            className="focus-ring panel px-3 py-2 text-sm bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-primary)] flex-1 max-w-xs"
          />
          <Button variant="ghost" onClick={addInterest} disabled={!interestInput.trim()}>
            + Add
          </Button>
        </div>
      </div>

      <div className="panel px-5 py-5 flex flex-col gap-3">
        <SectionBanner label="Goals" className="border-t-0" />
        <DendriteDivider />
        <div className="fig-caption">
          Fig. — standing aims the tutor mines for examples and relevance, same as interests above.
        </div>
        {model.goals.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {model.goals.map((g) => (
              <span key={g} className="text-xs px-2 py-1 rounded-lg bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-dim)]">
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
        <SectionBanner label="Accessibility" className="border-t-0" />
        <DendriteDivider />
        <div className="fig-caption">
          Fig. — declared needs (dyslexia, ADHD, color vision, and the like) the tutor always honors as dials — a
          need, never a “learning style” guess.
        </div>
        {model.accessibility.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {model.accessibility.map((a) => (
              <span key={a} className="text-xs px-2 py-1 rounded-lg bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-dim)]">
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
        <SectionBanner label="Rhythms" className="border-t-0" />
        <DendriteDivider />
        <div className="fig-caption">
          Fig. — session telemetry (length, cadence, time-of-day yield) the coach reads alongside your session log
          to suggest, never impose, a better schedule.
        </div>
        {Object.keys(model.rhythms).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(model.rhythms).map(([k, v]) => (
              <span key={k} className="text-xs px-2 py-1 rounded-lg bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-dim)]">
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
            className="focus-ring panel px-3 py-2 text-sm bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-primary)] flex-1 max-w-[9rem]"
          />
          <input
            value={rhythmValueInput}
            onChange={(e) => setRhythmValueInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addRhythm()
            }}
            placeholder="Value — e.g. “evening”"
            className="focus-ring panel px-3 py-2 text-sm bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-primary)] flex-1 max-w-xs"
          />
          <Button variant="ghost" onClick={addRhythm} disabled={!rhythmKeyInput.trim() || !rhythmValueInput.trim()}>
            + Add
          </Button>
        </div>
      </div>

      <div className="panel px-5 py-5 flex flex-col gap-5">
        <SectionBanner label="Background & notifications" className="border-t-0" />
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
        <SectionBanner label="Authentication" className="border-t-0" />
        <DendriteDivider />
        <ToggleRow
          label="Claude auth"
          hint={
            (auth?.authMode ?? 'subscription') === 'apiKey'
              ? 'Sessions run with your Anthropic API key under the Commercial Terms, pay per token. The key is encrypted with the system keychain, stored outside any settings file, and never leaves this machine.'
              : (auth?.authMode ?? 'subscription') === 'local'
                ? 'Sessions run against a model on this machine — nothing billed, nothing sent anywhere. Ollama 0.32+ serves the Anthropic API directly, so no proxy is involved. Check the model before you rely on it: a tutor drives the sitting with tool calls, and a model that cannot make them will appear to work while recording nothing.'
                : 'Engram drives the Claude Code binary you already installed and pay for. The CLI authenticates from its own login; a stray ANTHROPIC_API_KEY in your shell is ignored so it can never flip sessions onto per-token billing.'
          }
          current={auth?.authMode ?? 'subscription'}
          onPick={pickAuthMode}
          options={[
            { value: 'subscription', label: 'Claude Code subscription' },
            { value: 'apiKey', label: 'API key' },
            { value: 'local', label: 'Local model' },
            // 'OpenCode + Cursor' TEMPORARILY REMOVED (2026-08-14) — confirmed
            // live that bridge tools never reach cursor-acp's models, so a
            // sitting in this mode cannot actually be taught (see
            // OpencodeSessionManager.start()'s doctrine comment). The backend
            // is otherwise intact; this is only the picker entry point.
          ]}
        />
        {(auth?.authMode ?? 'subscription') === 'apiKey' && (
          <div className="flex flex-col gap-2">
            {keyStatus?.present ? (
              <div className="flex items-center justify-between gap-3">
                <span className="label-data text-[11px] text-[var(--color-text-dim)]">Key stored · ····{keyStatus.last4}</span>
                <Button variant="ghost" onClick={removeApiKey}>
                  Remove key
                </Button>
              </div>
            ) : (
              <div className="text-xs text-[var(--color-ink-danger)]">
                No key stored — sessions will fail to start until one is added or the mode is switched back.
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveApiKey()
                }}
                placeholder={keyStatus?.present ? 'Replace key…' : 'sk-ant-…'}
                maxLength={256}
                autoComplete="off"
                className="focus-ring panel px-3 py-2 text-sm bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-primary)] flex-1 max-w-xs"
              />
              <Button variant="ghost" onClick={saveApiKey} disabled={!apiKeyDraft.trim()}>
                Save key
              </Button>
            </div>
            {authError && <div className="text-xs text-[var(--color-ink-danger)]">{authError}</div>}
          </div>
        )}
        {auth?.authMode === 'local' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="label-data text-[11px] text-[var(--color-text-dim)]">
                Server · {auth.localBaseUrl}
              </span>
              <Button variant="ghost" onClick={async () => setLocalModels(await window.engram.listLocalModels(auth.localBaseUrl))}>
                Refresh models
              </Button>
            </div>

            {localModels.length === 0 ? (
              <div className="text-xs text-[var(--color-ink-danger)]">
                No models found at {auth.localBaseUrl} — is the runtime running? Start it, then Refresh.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {localModels.map((m) => (
                  <button
                    key={m}
                    onClick={() => pickLocalModel(m)}
                    className={`focus-ring label-data text-[11px] px-2.5 py-1.5 border transition-colors duration-[var(--dur-fast)] ${
                      auth.localModel === m
                        ? 'border-[var(--color-ink-warm)] text-[var(--color-text-primary)]'
                        : 'border-[var(--color-hairline)] text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={runProbe} disabled={probing || !auth.localModel}>
                {probing ? 'Checking…' : 'Check this model'}
              </Button>
              {!auth.localModel && (
                <span className="text-xs text-[var(--color-text-faint)]">Pick a model first.</span>
              )}
            </div>

            {probe && (
              <div className="flex flex-col gap-1">
                <span
                  className="label-data text-[11px]"
                  style={{ color: describeProbeVerdict(probe).ok ? 'var(--color-ink-warm)' : 'var(--color-ink-danger)' }}
                >
                  {describeProbeVerdict(probe).headline}
                </span>
                <span className="text-xs text-[var(--color-text-dim)]">{describeProbeVerdict(probe).detail}</span>
              </div>
            )}
          </div>
        )}
        {auth?.authMode === 'opencodeCursor' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="label-data text-[11px] text-[var(--color-text-dim)]">
                {opencodeSetup?.binaryFound
                  ? `opencode found · ${opencodeSetup.models.length} cursor-acp model${opencodeSetup.models.length === 1 ? '' : 's'}`
                  : 'opencode CLI'}
              </span>
              <Button variant="ghost" onClick={async () => setOpencodeSetup(await window.engram.opencodeSetup())}>
                Refresh
              </Button>
            </div>

            {opencodeSetup?.error && (
              <div className="text-xs text-[var(--color-ink-danger)]">{opencodeSetup.error}</div>
            )}

            {opencodeSetup && opencodeSetup.models.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {opencodeSetup.models.map((m) => (
                  <button
                    key={m}
                    onClick={() => pickOpencodeModel(m)}
                    className={`focus-ring label-data text-[11px] px-2.5 py-1.5 border transition-colors duration-[var(--dur-fast)] ${
                      auth.opencodeModel === m
                        ? 'border-[var(--color-ink-warm)] text-[var(--color-text-primary)]'
                        : 'border-[var(--color-hairline)] text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={runOpencodeProbe} disabled={opencodeProbing || !auth.opencodeModel}>
                {opencodeProbing ? 'Checking…' : 'Check this model'}
              </Button>
              <span className="text-xs text-[var(--color-text-faint)]">
                {opencodeProbing ? 'Running a real turn on your Cursor plan…' : 'Costs a small real charge on your Cursor plan.'}
              </span>
            </div>

            {opencodeProbe && (
              <div className="flex flex-col gap-1">
                <span
                  className="label-data text-[11px]"
                  style={{ color: describeOpencodeProbeVerdict(opencodeProbe).ok ? 'var(--color-ink-warm)' : 'var(--color-ink-danger)' }}
                >
                  {describeOpencodeProbeVerdict(opencodeProbe).headline}
                </span>
                <span className="text-xs text-[var(--color-text-dim)]">{describeOpencodeProbeVerdict(opencodeProbe).detail}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="panel px-5 py-5 flex flex-col gap-3">
        <div>
          <SectionBanner label="Data" className="border-t-0" />
          <div className="text-xs text-[var(--color-text-faint)] mt-1.5">
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
          <SectionBanner label="Backup" className="border-t-0" />
          <div className="text-xs text-[var(--color-text-faint)] mt-1.5">
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
          <SectionBanner label="Software" className="border-t-0" />
          <div className="text-xs text-[var(--color-text-faint)] mt-1.5">
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
          <SectionBanner label="Diagnostics" className="border-t-0" />
          <div className="text-xs text-[var(--color-text-faint)] mt-1.5">
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
        <div>
          <SectionBanner label="Crash log" className="border-t-0" />
          <div className="text-xs text-[var(--color-text-faint)] mt-1.5">
            Local only — never sent anywhere. Recorded whenever the app hits an error it can't recover from, so "it
            just closed" has an actual reason attached the next time you look.
          </div>
        </div>
        <DendriteDivider />
        <CrashLogSection entries={crashLog} />
      </div>

      <div className="panel px-5 py-5 flex flex-col gap-3">
        <SectionBanner label="Achievements" className="border-t-0" />
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
