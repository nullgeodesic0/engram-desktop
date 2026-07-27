import { isTaskNotificationContent } from './taskNotification'

export interface ChatMessage {
  id: string
  role: 'assistant' | 'user'
  text: string
  /** Absolute paths attached to this message (display only — the actual reference
   * that gets the model to read them lives in the message text itself, see
   * LearnSessionView's submitProduction). Never populated on transcript replay. */
  attachments?: string[]
}

interface TranscriptLine {
  type?: string
  message?: {
    role?: string
    content?: string | { type?: string; text?: string }[]
  }
}

/**
 * Reconstructs the chat-bubble history from a Claude Code session transcript
 * (`~/.claude/projects/<flattened-cwd>/<sessionId>.jsonl`), using the exact same
 * merge rule the live renderer uses (see LearnSessionView's 'text' handler) so a
 * resumed session's history looks identical to one that streamed in live.
 *
 * Genuine human turns (the app's own synthetic kickoff message, or a real typed
 * production) always have `message.content` as a plain string — that's how
 * SessionManager.sendUserMessage writes them. Tool-result plumbing turns have
 * `message.content` as an array of tool_result blocks and are skipped. The very
 * first user entry in every transcript is the app's own synthetic "continue this
 * topic" kickoff, never something the human typed — skipped unconditionally.
 */
export function parseTranscriptToMessages(rawLines: unknown[]): ChatMessage[] {
  const lines = rawLines as TranscriptLine[]
  const messages: ChatMessage[] = []
  let seenFirstUser = false
  let idCounter = 0

  for (const line of lines) {
    if (line.type === 'user' && typeof line.message?.content === 'string') {
      if (!seenFirstUser) {
        seenFirstUser = true
        continue // the app's own synthetic kickoff — not a real human message
      }
      // A background-agent completion (e.g. the assessor audit — see
      // shared/taskNotification.ts's doctrine comment) also lands as an
      // ordinary `type: "user"` string-content line, but it is NOT a genuine
      // learner turn — it's the assessor's raw envelope, quoting the very
      // rubric the sitting is being graded against. Never render it as a
      // chat bubble.
      if (isTaskNotificationContent(line.message.content)) continue
      messages.push({ id: `t${idCounter++}`, role: 'user', text: line.message.content })
      continue
    }

    if (line.type === 'assistant' && Array.isArray(line.message?.content)) {
      for (const block of line.message.content) {
        if (block.type !== 'text' || !block.text) continue
        const last = messages[messages.length - 1]
        if (last && last.role === 'assistant') {
          last.text += block.text
        } else {
          messages.push({ id: `t${idCounter++}`, role: 'assistant', text: block.text })
        }
      }
    }
  }

  return messages
}
