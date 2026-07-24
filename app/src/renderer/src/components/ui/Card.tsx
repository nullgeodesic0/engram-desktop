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
  return <div className={`${raised ? 'panel-raised' : 'panel'} ${className}`}>{children}</div>
}
