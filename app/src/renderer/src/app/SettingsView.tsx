import { useEffect, useState } from 'react'
import type { LearnerModel, NotifierSettings } from '../../../shared/types'
import { AchievementsPanel } from '../components/AchievementsPanel'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { Button } from '../components/ui/Button'
import { DendriteDivider } from '../components/ui/DendriteDivider'
import { soundOn, setSoundOn } from '../shared/soundscape'

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

  function refresh() {
    window.engram.model().then(setModel)
    window.engram.anySessionActive().then(setSessionActive)
    window.engram.getNotifierSettings().then(setNotifier)
    window.engram.getLoginItemSettings().then((s) => setLaunchAtLoginState(s.openAtLogin))
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
        <div className="text-sm text-[var(--color-text-primary)]">Achievements</div>
        <DendriteDivider />
        <AchievementsPanel />
      </div>
    </div>
  )
}
