import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * A small anchored menu: one trigger, a list of actions, optional one-level
 * submenus (Learn's "Move to folder ▸"). Rendered into document.body at a
 * fixed position computed from the trigger, because every place that uses it
 * sits inside a scrolling shelf whose `overflow` would otherwise clip it.
 *
 * Solid paper panel (`panel-raised`), no blur — the Nave/Folio surface rule.
 * Keyboard: the trigger opens on Enter/Space/ArrowDown; ArrowUp/ArrowDown
 * move between items, ArrowRight opens a submenu, ArrowLeft/Escape close
 * one level, Tab closes. Click outside closes.
 */

export type MenuItem =
  | {
      kind?: 'item'
      label: ReactNode
      onSelect?: () => void
      /** A one-level submenu; `onSelect` is ignored when present. */
      submenu?: MenuItem[]
      /** Leading mark (e.g. ✓ for the current folder). */
      mark?: ReactNode
      /** Quiet ink — for the catch-all choices ("Unfiled", "New folder…"). */
      quiet?: boolean
      disabled?: boolean
    }
  | { kind: 'separator' }
  | { kind: 'caption'; label: string }

function isActionable(it: MenuItem): boolean {
  return (it.kind === undefined || it.kind === 'item') && !it.disabled
}

function MenuList({
  items,
  pos,
  onClose,
  onCloseAll,
  label,
  autoFocus,
}: {
  items: MenuItem[]
  pos: { left: number; top: number; alignRight?: boolean }
  onClose: () => void
  onCloseAll: () => void
  label: string
  autoFocus: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)

  // Keep the list on screen: measure once mounted, then nudge left/up.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let left = pos.alignRight ? pos.left - r.width : pos.left
    let top = pos.top
    if (left + r.width > window.innerWidth - 8) left = window.innerWidth - 8 - r.width
    if (left < 8) left = 8
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - r.height)
    setPlace({ left, top })
  }, [pos.left, pos.top, pos.alignRight])

  useEffect(() => {
    if (autoFocus && place) ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus()
  }, [autoFocus, place])

  function openSub(i: number, target: HTMLElement) {
    const r = target.getBoundingClientRect()
    const menuR = ref.current?.getBoundingClientRect()
    // Open to the left when there is no room on the right — the ⋯ menus sit
    // at the right edge of the shelf.
    const roomRight = (menuR?.right ?? r.right) + 220 < window.innerWidth
    setSubPos({ left: roomRight ? (menuR?.right ?? r.right) + 4 : (menuR?.left ?? r.left) - 4, top: r.top - 6 })
    setOpen(i)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const nodes = [...(ref.current?.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]:not([aria-disabled="true"])') ?? [])]
    const at = nodes.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      nodes[(at + 1) % nodes.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      nodes[(at - 1 + nodes.length) % nodes.length]?.focus()
    } else if (e.key === 'Escape' || e.key === 'ArrowLeft') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Tab') {
      onCloseAll()
    }
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      data-popover-menu="true"
      className="panel-raised fixed z-[70] min-w-[13rem] py-1.5 flex flex-col shadow-[0_10px_30px_rgba(40,30,20,0.18)]"
      style={{
        left: place?.left ?? pos.left,
        top: place?.top ?? pos.top,
        visibility: place ? 'visible' : 'hidden',
        // pos.alignRight anchors the RIGHT edge; until measured, park it
        // where it cannot flash in the wrong spot.
      }}
    >
      {items.map((it, i) => {
        if (it.kind === 'separator') return <div key={i} className="my-1 h-px bg-[var(--color-hairline)]" />
        if (it.kind === 'caption')
          return (
            <div key={i} className="px-3.5 pt-1 pb-1.5 label-data text-[10px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
              {it.label}
            </div>
          )
        const hasSub = !!it.submenu
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            aria-haspopup={hasSub ? 'menu' : undefined}
            aria-expanded={hasSub ? open === i : undefined}
            aria-disabled={it.disabled ? 'true' : undefined}
            disabled={it.disabled}
            onMouseEnter={(e) => (hasSub ? openSub(i, e.currentTarget) : setOpen(null))}
            onClick={(e) => {
              if (hasSub) return openSub(i, e.currentTarget)
              onCloseAll()
              it.onSelect?.()
            }}
            onKeyDown={(e) => {
              if (hasSub && (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                e.stopPropagation()
                openSub(i, e.currentTarget)
              }
            }}
            className={`focus-ring flex items-center gap-2.5 px-3.5 py-1.5 text-left text-[13px] disabled:opacity-40 hover:bg-[color-mix(in_srgb,var(--color-surface-2)_85%,transparent)] focus:bg-[color-mix(in_srgb,var(--color-surface-2)_85%,transparent)] ${
              open === i ? 'bg-[color-mix(in_srgb,var(--color-surface-2)_85%,transparent)] ' : ''
            }${it.quiet ? 'text-[var(--color-text-faint)]' : 'text-[var(--color-text-primary)]'}`}
          >
            <span className="w-3 shrink-0 text-[var(--color-text-dim)]" aria-hidden="true">
              {it.mark ?? ''}
            </span>
            <span className="flex-1 min-w-0 truncate">{it.label}</span>
            {hasSub && (
              <span className="text-[var(--color-text-faint)] text-[10px]" aria-hidden="true">
                ▸
              </span>
            )}
          </button>
        )
      })}
      {open !== null && subPos && (() => {
        const it = items[open]
        if (!it || it.kind === 'separator' || it.kind === 'caption' || !it.submenu || !isActionable(it)) return null
        const roomRight = subPos.left > (ref.current?.getBoundingClientRect().left ?? 0)
        return (
          <MenuList
            items={it.submenu}
            pos={{ left: subPos.left, top: subPos.top, alignRight: !roomRight }}
            onClose={() => {
              setOpen(null)
              ref.current?.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]')[open]?.focus()
            }}
            onCloseAll={onCloseAll}
            label={typeof it.label === 'string' ? it.label : label}
            autoFocus
          />
        )
      })()}
    </div>
  )
}

export function PopoverMenu({
  label,
  items,
  trigger,
  triggerClassName = '',
  align = 'right',
  title,
}: {
  /** Accessible name for the menu and its trigger. */
  label: string
  items: MenuItem[]
  trigger: ReactNode
  triggerClassName?: string
  /** Which trigger edge the menu lines up with. */
  align?: 'left' | 'right'
  title?: string
}) {
  const btn = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; alignRight: boolean } | null>(null)
  const [viaKeyboard, setViaKeyboard] = useState(false)

  function openMenu(keyboard: boolean) {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    setViaKeyboard(keyboard)
    setPos(align === 'right' ? { left: r.right, top: r.bottom + 6, alignRight: true } : { left: r.left, top: r.bottom + 6, alignRight: false })
  }
  function close() {
    setPos(null)
    btn.current?.focus()
  }

  useEffect(() => {
    if (!pos) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (btn.current?.contains(t) || t.closest('[data-popover-menu]')) return
      setPos(null)
    }
    const onScroll = () => setPos(null)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onScroll)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onScroll)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [pos])

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={pos !== null}
        aria-label={label}
        title={title ?? label}
        onClick={(e) => {
          e.stopPropagation()
          if (pos) setPos(null)
          else openMenu(e.detail === 0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            openMenu(true)
          }
        }}
        className={`focus-ring ${triggerClassName}${pos ? ' is-open' : ''}`}
      >
        {trigger}
      </button>
      {pos &&
        createPortal(
          <MenuList items={items} pos={pos} onClose={close} onCloseAll={close} label={label} autoFocus={viaKeyboard} />,
          document.body,
        )}
    </>
  )
}
