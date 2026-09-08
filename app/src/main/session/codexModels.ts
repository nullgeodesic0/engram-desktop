import { homedir } from 'node:os'
import type { CodexModelOption } from '../../shared/types'
import {
  assertCodexSubscriptionAccount,
  launchCodexAppServer,
  normalizeCodexModels,
  type CodexAccountResponse,
} from './codexAppServerClient'
import { resolveCodexBinary } from './codexResolver'
import { buildCodexSubscriptionEnv } from './codexEnv'

interface ModelPage {
  data: Array<{
    id: string
    model: string
    displayName: string
    description: string
    hidden: boolean
    isDefault: boolean
    inputModalities?: string[]
  }>
  nextCursor: string | null
}

async function withDeadline<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Verifies that the resolved Codex installation is backed by ChatGPT auth
 * without starting a model turn. Used by startup readiness checks. */
export async function verifyCodexSubscription(): Promise<string> {
  const binary = await resolveCodexBinary()
  const client = launchCodexAppServer(binary, {
    cwd: homedir(),
    env: buildCodexSubscriptionEnv(process.env),
  })
  try {
    return await withDeadline((async () => {
      await client.initialize()
      const account = await client.request<CodexAccountResponse>('account/read', { refreshToken: false })
      assertCodexSubscriptionAccount(account)
      return binary
    })(), 8_000, 'OpenAI Codex did not respond while checking the ChatGPT subscription login.')
  } finally {
    client.close()
  }
}

/** Reads the catalog from the authenticated Codex installation. Listing
 * models is account metadata and does not start a model turn. */
export async function listCodexModels(): Promise<CodexModelOption[]> {
  const client = launchCodexAppServer(await resolveCodexBinary(), {
    cwd: homedir(),
    env: buildCodexSubscriptionEnv(process.env),
  })
  try {
    await client.initialize()
    const account = await client.request<CodexAccountResponse>('account/read', { refreshToken: false })
    assertCodexSubscriptionAccount(account)

    const data: ModelPage['data'] = []
    let cursor: string | null = null
    do {
      const page: ModelPage = await client.request<ModelPage>('model/list', { cursor, limit: 100, includeHidden: false })
      data.push(...page.data)
      cursor = page.nextCursor
    } while (cursor)
    return normalizeCodexModels({ data, nextCursor: null })
  } finally {
    client.close()
  }
}
