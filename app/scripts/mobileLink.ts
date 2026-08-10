/**
 * Runs the phone-facing LinkServer outside Electron, against the app's real
 * stores, and prints a pairing code.
 *
 * A development harness. The shipping path is the same server started from the
 * main process with a pairing card in the UI; this exists so the client can be
 * built and exercised before that UI does.
 *
 * ⚠ NO TRANSPORT ENCRYPTION. Bearer auth over plain HTTP. Bound to loopback by
 * default for exactly that reason — a learner's productions would otherwise
 * cross the network in cleartext. Pass --lan only on a network you trust, and
 * understand that "trust" here means "nobody on it is reading packets".
 *
 *   npx tsx scripts/mobileLink.ts [--lan] [--port 8787]
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createCardPackStore } from '../src/main/link/cardPackStore'
import { createLinkServer } from '../src/main/link/LinkServer'
import { createOutboxStore } from '../src/main/link/outboxStore'
import { createPairingStore } from '../src/main/link/pairing'
import { mobileProviders } from '../src/main/session/mobileProviders'
import { networkInterfaces } from 'node:os'

const USER_DATA = join(homedir(), 'Library', 'Application Support', 'Engram Desktop')

function lanAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address
    }
  }
  return null
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const lan = args.includes('--lan')
  const portArg = args.indexOf('--port')
  const port = portArg >= 0 ? Number(args[portArg + 1]) : 8787

  const pairing = createPairingStore({ filePath: join(USER_DATA, 'paired-devices.json') })
  const outbox = createOutboxStore({ filePath: join(USER_DATA, 'outbox.jsonl') })
  const packs = createCardPackStore({ rootDir: join(USER_DATA, 'card-packs') })

  const server = createLinkServer({
    pairing,
    outbox,
    packs,
    // Same provider the app wires, so what this harness shows is what the
    // shipped menu shows — a dev server that served different data would be
    // testing itself rather than the product.
    ...mobileProviders((topic) => packs.listFor(topic)),
    host: lan ? '0.0.0.0' : '127.0.0.1',
    port,
  })
  await server.start()

  const host = lan ? (lanAddress() ?? '0.0.0.0') : '127.0.0.1'
  const offer = await pairing.beginPairing()

  console.log(`link server  http://${host}:${server.port}`)
  console.log(`pairing code ${offer.code}   (valid ${Math.round((offer.expiresAt - Date.now()) / 1000)}s)`)
  console.log(`paired so far ${(await pairing.list()).length} device(s)`)
  console.log(`queued        ${(await outbox.pending()).length} item(s) awaiting a session`)
  if (!lan) console.log('\nloopback only — pass --lan to expose it (unencrypted; trusted networks only)')

  // Keep minting a fresh code as each window closes, so a dev session does not
  // die because a code aged out while the client was being rebuilt.
  setInterval(
    async () => {
      const next = await pairing.beginPairing()
      console.log(`pairing code ${next.code}`)
    },
    2 * 60 * 1000,
  ).unref?.()

  process.stdin.resume()
}

void main()
