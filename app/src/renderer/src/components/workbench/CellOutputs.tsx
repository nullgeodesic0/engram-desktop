import { useState } from 'react'
import type { CellOutput } from '../../../../shared/runtime'

/**
 * A cell's outputs, in the order the kernel produced them. Figures render as
 * images (never inline SVG markup), so nothing a cell prints can script the
 * page. Errors lead with the exception and keep the traceback one click away.
 */

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function ErrorOutput({ out }: { out: Extract<CellOutput, { type: 'error' }> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-l-2 border-[var(--color-ink-danger-dim)] pl-3 py-1">
      <div className="text-sm text-[var(--color-text-primary)]">
        <span className="label-data text-[var(--color-ink-danger)]">{out.ename}</span>
        {out.evalue && <span className="text-[var(--color-text-dim)]">: {out.evalue}</span>}
        {out.line != null && <span className="text-xs text-[var(--color-text-faint)]"> · line {out.line}</span>}
      </div>
      {out.traceback.length > 0 && (
        <>
          <button
            className="focus-ring text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)] mt-1"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            {open ? 'Hide traceback' : 'Show traceback'}
          </button>
          {open && (
            <pre className="cell-output-pre text-[var(--color-text-dim)] mt-1">{out.traceback.join('')}</pre>
          )}
        </>
      )}
    </div>
  )
}

export function CellOutputs({ outputs }: { outputs: CellOutput[] }) {
  if (outputs.length === 0) return null
  return (
    <div className="flex flex-col gap-2 px-3 pb-3 pt-1 min-w-0">
      {outputs.map((o, i) => {
        if (o.type === 'stream')
          return (
            <pre
              key={i}
              className={`cell-output-pre ${o.name === 'stderr' ? 'text-[var(--color-text-dim)]' : 'text-[var(--color-text-primary)]'}`}
            >
              {o.text}
            </pre>
          )
        if (o.type === 'value')
          return (
            <pre key={i} className="cell-output-pre text-[var(--color-ink-cool)]">
              {o.text}
            </pre>
          )
        if (o.type === 'figure')
          return (
            <img
              key={i}
              alt="Figure produced by this cell"
              className="cell-figure max-w-full self-start"
              src={o.svg ? svgDataUrl(o.svg) : `data:image/png;base64,${o.png}`}
            />
          )
        return <ErrorOutput key={i} out={o} />
      })}
    </div>
  )
}
