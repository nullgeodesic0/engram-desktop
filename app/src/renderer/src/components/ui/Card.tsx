import type { ReactNode } from 'react'

export function Card({
  raised = false,
  className = '',
  children,
}: {
  raised?: boolean
  className?: string
  children: ReactNode
}) {
  return <div className={`tilt-card ${raised ? 'panel-raised' : 'panel'} ${className}`}>{children}</div>
}
