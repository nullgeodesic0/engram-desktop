import { useCallback, useState } from 'react'

export interface HoverAnchor {
  x: number
  y: number
}

/** One hover-popover manager per chart, generalized from the identical
 * getBoundingClientRect-on-mouseenter pattern duplicated in RetentionTrend
 * and StreakCalendar. `showHover` anchors the popover to the CENTER-TOP of
 * whatever element fired the event — pair with `ChartTooltip`, which expects
 * exactly that anchor shape. */
export function useChartHover<T>() {
  const [hover, setHover] = useState<(T & HoverAnchor) | null>(null)

  const showHover = useCallback((e: React.SyntheticEvent<Element>, data: T) => {
    const r = e.currentTarget.getBoundingClientRect()
    setHover({ ...data, x: r.left + r.width / 2, y: r.top })
  }, [])

  const hideHover = useCallback(() => setHover(null), [])

  return { hover, showHover, hideHover }
}
