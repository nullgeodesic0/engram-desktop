import { useCallback, useRef } from 'react'
import { NODE_CHIP_ATTR, NODE_CHIP_NODE_ATTR, NODE_CHIP_TOPIC_ATTR } from '../shared/nodeChip'

function attach(node: HTMLElement, onOpenNode: (topicId: string, nodeId: string) => void): () => void {
  function onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement | null
    const chip = target?.closest<HTMLElement>(`[${NODE_CHIP_ATTR}]`) ?? null
    if (!chip || !node.contains(chip)) return
    const topicId = chip.getAttribute(NODE_CHIP_TOPIC_ATTR)
    const nodeId = chip.getAttribute(NODE_CHIP_NODE_ATTR)
    if (!topicId || !nodeId) return
    e.stopPropagation()
    onOpenNode(topicId, nodeId)
  }
  node.addEventListener('click', onClick)
  return () => node.removeEventListener('click', onClick)
}

/**
 * Chat Instruments Wave B — ONE delegated click handler per wired container,
 * covering every node-name chip anywhere in its subtree (ProseMarkdown's
 * `dangerouslySetInnerHTML` output — see markdownWithMath.ts's
 * `chipifyNodeCodespans`). Same callback-ref architecture as
 * `useEquationCopy.ts` (see that hook's own doctrine comment for the full
 * remount rationale) and for the identical reason: LearnSessionView's own
 * session pane sits behind a `started` conditional that unmounts on "back to
 * topics" and remounts on re-open, which a `RefObject` + `useEffect(() =>
 * ..., [ref])` would not reliably re-wire across.
 *
 * Takes `onOpenNode` as an argument (unlike `useEquationCopy`, which takes
 * none) because — unlike a clipboard write, which needs no caller context —
 * opening a node is a real navigation the caller alone knows how to perform
 * (see LearnSessionView's own `onOpenNode` prop, wired straight to App.tsx's
 * `goToNode`). The callback is read through a ref on every click rather than
 * closed over at attach time, so a caller whose `onOpenNode` identity changes
 * across renders (it doesn't here, but nothing enforces that) never attaches
 * a stale listener.
 */
export function useNodeChipClick(onOpenNode: (topicId: string, nodeId: string) => void): (node: HTMLElement | null) => void {
  const cleanupRef = useRef<(() => void) | null>(null)
  const onOpenNodeRef = useRef(onOpenNode)
  onOpenNodeRef.current = onOpenNode

  return useCallback((node: HTMLElement | null) => {
    cleanupRef.current?.()
    cleanupRef.current = null
    if (!node) return
    cleanupRef.current = attach(node, (topicId, nodeId) => onOpenNodeRef.current(topicId, nodeId))
  }, [])
}
