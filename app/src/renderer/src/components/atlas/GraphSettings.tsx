/** Instrument panel for the topic map's live forces and display scale — the
 * Engram port of CairnDesktop's `GraphSettings.tsx` docked aside, adapted to
 * this app's own control-chrome idiom (`panel`, `label-data`, `CTRL_QUIET`)
 * instead of Cairn's `graph-range`/`graph-switch` CSS. Filters and the Key
 * legend are NOT ported — Engram already has a Key panel (`TopicMapView`'s
 * own legend) and no artifact-kind filter list to mirror; only Forces and
 * Display map onto anything this app has. */

import { CTRL_QUIET } from '../../shared/controlChrome'
import { DEFAULT_GRAPH_SETTINGS, type AtlasGraphSettings } from './settings'

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <div className="fig-caption">{title}</div>
      {children}
    </section>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format?: (v: number) => string
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2 text-[10px] label-data uppercase tracking-[0.12em] text-[var(--color-text-dim)]">
        <span>{label}</span>
        <span className="tabular-nums text-[var(--color-text-primary)]">{format ? format(value) : value}</span>
      </span>
      <input
        className="focus-ring w-full accent-[var(--color-ink-warm)]"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`${checked ? CTRL_QUIET.replace('text-[var(--color-text-dim)]', 'text-[var(--color-ink-warm)] border-[var(--color-ink-warm-dim)]') : CTRL_QUIET} w-full text-left`}
    >
      {label}: {checked ? 'on' : 'off'}
    </button>
  )
}

export function GraphSettings({
  value,
  onChange,
  onClose,
}: {
  value: AtlasGraphSettings
  onChange: (next: AtlasGraphSettings) => void
  onClose: () => void
}): React.JSX.Element {
  const patchForces = (part: Partial<AtlasGraphSettings['forces']>): void => onChange({ ...value, forces: { ...value.forces, ...part } })
  const patchDisplay = (part: Partial<AtlasGraphSettings['display']>): void => onChange({ ...value, display: { ...value.display, ...part } })

  return (
    <aside
      aria-label="Graph settings"
      className="absolute bottom-3 right-3 z-20 panel p-3 flex flex-col gap-4 w-56 max-h-[calc(100%-1.5rem)] overflow-y-auto"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <header className="flex items-center justify-between gap-2">
        <span className="label-data text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-primary)]">Graph settings</span>
        <span className="flex items-center gap-2.5">
          <button
            type="button"
            className="focus-ring label-data bg-transparent p-0 text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]"
            onClick={() => onChange(structuredClone(DEFAULT_GRAPH_SETTINGS))}
          >
            Reset
          </button>
          <button
            type="button"
            aria-label="Close graph settings"
            className="focus-ring label-data bg-transparent p-0 text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]"
            onClick={onClose}
          >
            Close
          </button>
        </span>
      </header>

      <Section title="Fig. — forces">
        <Toggle label="Physics" checked={value.forces.enabled} onChange={(v) => patchForces({ enabled: v })} />
        <Slider label="Center" value={value.forces.center} min={0} max={2} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => patchForces({ center: v })} />
        <Slider label="Repel" value={value.forces.repel} min={0} max={8} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => patchForces({ repel: v })} />
        <Slider label="Link" value={value.forces.link} min={0} max={2} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => patchForces({ link: v })} />
        <Slider
          label="Distance"
          value={value.forces.linkDistance}
          min={0.5}
          max={4}
          step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={(v) => patchForces({ linkDistance: v })}
        />
      </Section>

      <Section title="Fig. — display">
        <Slider
          label="Node size"
          value={value.display.nodeScale}
          min={0.25}
          max={4}
          step={0.05}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(v) => patchDisplay({ nodeScale: v })}
        />
        <Slider
          label="Link weight"
          value={value.display.linkThickness}
          min={0.25}
          max={6}
          step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={(v) => patchDisplay({ linkThickness: v })}
        />
      </Section>
    </aside>
  )
}
