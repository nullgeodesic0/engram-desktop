import { app, safeStorage, dialog, BrowserWindow, ipcMain, protocol, net, Notification, screen, Menu, shell, nativeImage, Tray } from "electron";
import { join, dirname, isAbsolute, basename, relative, resolve, normalize, extname } from "node:path";
import { readdir, readFile, mkdir, writeFile, appendFile, mkdtemp, stat, unlink, cp, rename, rm, copyFile, realpath } from "node:fs/promises";
import { homedir, tmpdir, networkInterfaces } from "node:os";
import { exec, spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { createServer } from "node:http";
import { randomInt, createHash, timingSafeEqual, randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, readdirSync, unlinkSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, lstatSync } from "node:fs";
import { pathToFileURL } from "node:url";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const BEAT_ORDER = [
  "open_gap",
  "predict",
  "struggle",
  "resolve",
  "self_explain",
  "connect",
  "verify",
  "close"
];
const optionSchema = z.object({ id: z.string().min(1), label: z.string().min(1).max(600) });
const proseCard = z.object({
  beat: z.enum(BEAT_ORDER),
  kind: z.literal("prose"),
  content: z.string().min(1).max(4e3)
});
const hintsCard = z.object({
  beat: z.enum(BEAT_ORDER),
  kind: z.literal("hints"),
  /** One rung per card on the phone — the struggle budget is unchanged. */
  rungs: z.array(z.string().min(1).max(1e3)).min(1).max(4)
});
const mcCard = z.object({
  beat: z.enum(BEAT_ORDER),
  kind: z.literal("mc"),
  stem: z.string().min(1).max(1200),
  options: z.array(optionSchema).min(2).max(4),
  sealed: z.object({
    correctOptionIds: z.array(z.string()).min(1),
    revealMarkdown: z.string().min(1).max(4e3)
  })
}).refine((c) => c.sealed.correctOptionIds.every((id) => c.options.some((o) => o.id === id)), {
  message: "the correct option must be one of the options offered"
});
const ladderCard = z.object({
  beat: z.enum(BEAT_ORDER),
  kind: z.literal("ladder"),
  stem: z.string().min(1).max(1200),
  pool: z.array(optionSchema).min(2).max(24),
  sealed: z.object({
    orderedStepIds: z.array(z.string()).min(2),
    revealMarkdown: z.string().min(1).max(4e3)
  })
}).refine((c) => c.sealed.orderedStepIds.every((id) => c.pool.some((o) => o.id === id)), {
  message: "every true step must be drawn from the pool the learner is shown"
});
const clozeCard = z.object({
  beat: z.enum(BEAT_ORDER),
  kind: z.literal("cloze"),
  /** `{{1}}` markers name the blanks, in order. */
  template: z.string().min(1).max(2e3),
  palette: z.array(optionSchema).min(2).max(24),
  sealed: z.object({
    blankOptionIds: z.array(z.string()).min(1),
    revealMarkdown: z.string().min(1).max(4e3)
  })
}).refine((c) => c.sealed.blankOptionIds.every((id) => c.palette.some((o) => o.id === id)), {
  message: "every filled blank must be drawn from the palette the learner is shown"
});
const recallCard = z.object({
  beat: z.enum(BEAT_ORDER),
  kind: z.literal("recall"),
  stem: z.string().min(1).max(1200),
  sealed: z.object({ revealMarkdown: z.string().min(1).max(4e3) })
});
const cardSchema = z.union([proseCard, hintsCard, mcCard, ladderCard, clozeCard, recallCard]);
const cardPackSchema = z.object({
  packId: z.string().uuid(),
  topic: z.string().min(1).max(120),
  node: z.string().min(1).max(200),
  nodeTitle: z.string().min(1).max(300),
  generatedAt: z.string().datetime(),
  /** Read from the CLI's `node_kind`, never the graph's raw `kind` — see the
   * spec's Evidence 2; 117 nodes carry no explicit kind and default via
   * `node_kind_of`. */
  eligibility: z.object({
    nodeKind: z.enum(["concept", "fact", "procedure"]),
    threshold: z.boolean(),
    transferReady: z.boolean(),
    lapsed: z.boolean(),
    experimentArm: z.string().nullable()
  }),
  beats: z.array(cardSchema).min(1)
});
function parseCardPack(raw) {
  const result = cardPackSchema.safeParse(raw);
  return result.success ? result.data : null;
}
function isCarvedOut(e) {
  return e.threshold || e.transferReady || e.lapsed || e.nodeKind === "procedure" || e.experimentArm !== null;
}
function validateAgainstOverlay(pack) {
  const reasons = [];
  const byBeat = new Map(pack.beats.map((c) => [c.beat, c]));
  for (const beat of BEAT_ORDER) {
    if (!byBeat.has(beat)) reasons.push(`missing beat: ${beat}`);
  }
  const present = pack.beats.map((c) => c.beat);
  const expected = BEAT_ORDER.filter((b) => present.includes(b));
  if (present.join(",") !== expected.join(",")) reasons.push("beats are not in grammar order");
  const selfExplain = byBeat.get("self_explain");
  if (selfExplain && !["ladder", "cloze", "recall"].includes(selfExplain.kind)) {
    reasons.push("self_explain may not be served as a menu");
  }
  const verify = byBeat.get("verify");
  if (verify && isCarvedOut(pack.eligibility) && !["ladder", "recall"].includes(verify.kind)) {
    reasons.push("verify on a carved-out node requires a ladder or a real production");
  }
  for (const card of pack.beats) {
    if (card.kind === "ladder" && card.pool.length < card.sealed.orderedStepIds.length * 2) {
      reasons.push("ladder pool must be at least 2N for N true steps");
    }
  }
  return reasons;
}
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
function assertSafe(kind, value) {
  if (!SAFE_SEGMENT.test(value) || value.includes("..")) {
    throw new Error(`unsafe ${kind} for a card-pack path: ${JSON.stringify(value)}`);
  }
}
function isSafe(value) {
  return SAFE_SEGMENT.test(value) && !value.includes("..");
}
function createCardPackStore(deps) {
  const { rootDir } = deps;
  return {
    async put(pack) {
      assertSafe("topic", pack.topic);
      assertSafe("node", pack.node);
      const reasons = validateAgainstOverlay(pack);
      if (reasons.length > 0) {
        throw new Error(`card pack breaks the mobile-walk overlay: ${reasons.join("; ")}`);
      }
      const dir = join(rootDir, pack.topic);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${pack.node}.json`), JSON.stringify(pack, null, 2), "utf-8");
    },
    async get(topic, node) {
      if (!isSafe(topic) || !isSafe(node)) return null;
      try {
        const raw = JSON.parse(await readFile(join(rootDir, topic, `${node}.json`), "utf-8"));
        const parsed = parseCardPack(raw);
        if (!parsed || validateAgainstOverlay(parsed).length > 0) return null;
        return parsed;
      } catch {
        return null;
      }
    },
    async listFor(topic) {
      if (!isSafe(topic)) return [];
      try {
        const files = await readdir(join(rootDir, topic));
        return files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length));
      } catch {
        return [];
      }
    }
  };
}
const MOBILE_INPUT_KINDS = ["checkpoint", "connect", "cloze", "ladder", "recall"];
const PRODUCTION_MAX = 800;
const SOURCE_STAMPS = {
  checkpoint: "quick-mc",
  connect: "mobile-mc",
  cloze: "mobile-cloze",
  ladder: "mobile-ladder",
  recall: "self"
};
function isTapDerived(kind) {
  return kind !== "recall";
}
const PHONE_SOURCE_STAMPS = Object.freeze(
  Object.entries(SOURCE_STAMPS).filter(([kind]) => isTapDerived(kind)).map(([, stamp]) => stamp).sort()
);
const outboxItemSchema = z.object({
  /** Client-generated UUID. The dedupe key: a replayed batch is a no-op. */
  id: z.string().uuid(),
  topic: z.string().min(1).max(120),
  node: z.string().min(1).max(200),
  mode: z.enum(["learn", "review"]),
  kind: z.enum(MOBILE_INPUT_KINDS),
  /** The four-band pick, or null when the learner skipped it. Never a typed
   * number and never estimated — same rule as the desktop picker. */
  confidence: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.null()]),
  /** Human-readable input trail, destined for `--rubric-notes`. */
  trail: z.string().max(400),
  /** Present only on `recall`. */
  production: z.string().min(1).max(PRODUCTION_MAX).optional(),
  committedAt: z.string().datetime()
}).strict().refine((v) => v.kind === "recall" ? typeof v.production === "string" : v.production === void 0, {
  message: "a recall item must carry its production, and a tap-derived item must not: the blind assessor grades free text against criteria, and a trail of picks has no production to grade"
});
function parseOutboxItem(raw) {
  const result = outboxItemSchema.safeParse(raw);
  return result.success ? result.data : null;
}
const MAX_BODY_BYTES = 1e6;
function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}
function readBody(req, res) {
  return new Promise((resolve2) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        send(res, 413, { error: "body too large" });
        req.destroy();
        resolve2(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      resolve2(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", () => {
      if (done) return;
      done = true;
      resolve2(null);
    });
  });
}
function bearerToken(req) {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
}
function createLinkServer(deps) {
  const { pairing: pairing2, outbox: outbox2, packs: packs2 } = deps;
  let server2 = null;
  let port = 0;
  async function handlePackRead(req, res, url) {
    if (!await pairing2.verifyToken(bearerToken(req))) {
      send(res, 401, { error: "unauthorized" });
      return;
    }
    const topic = url.searchParams.get("topic") ?? "";
    if (url.pathname === "/link/packs") {
      send(res, 200, { nodes: await packs2.listFor(topic) });
      return;
    }
    if (url.pathname === "/link/overview") {
      send(res, 200, deps.overview ? await deps.overview() : { topics: [], dueTotal: 0, minutesPerItem: null });
      return;
    }
    if (url.pathname === "/link/graph") {
      if (!deps.graph) {
        send(res, 404, { error: "no graph provider" });
        return;
      }
      send(res, 200, await deps.graph(topic));
      return;
    }
    if (url.pathname === "/link/receipts") {
      if (!deps.receipts) {
        send(res, 404, { error: "no receipts provider" });
        return;
      }
      send(res, 200, await deps.receipts(topic));
      return;
    }
    const node = url.searchParams.get("node") ?? "";
    const pack = await packs2.get(topic, node);
    if (!pack) {
      send(res, 404, { error: "no pack for that node" });
      return;
    }
    send(res, 200, pack);
  }
  async function handlePair(req, res) {
    const body = await readBody(req, res);
    if (body === null) return;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      send(res, 400, { error: "malformed json" });
      return;
    }
    if (typeof parsed.code !== "string" || typeof parsed.deviceName !== "string") {
      send(res, 400, { error: "code and deviceName are required" });
      return;
    }
    const paired = await pairing2.completePairing(parsed.code, parsed.deviceName);
    if (!paired) {
      send(res, 401, { error: "pairing refused" });
      return;
    }
    send(res, 200, paired);
  }
  async function handleOutbox(req, res) {
    const device = await pairing2.verifyToken(bearerToken(req));
    if (!device) {
      send(res, 401, { error: "unauthorized" });
      return;
    }
    const body = await readBody(req, res);
    if (body === null) return;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      send(res, 400, { error: "malformed json" });
      return;
    }
    if (!Array.isArray(parsed.items)) {
      send(res, 400, { error: "items must be an array" });
      return;
    }
    const valid = [];
    let rejected = 0;
    for (const raw of parsed.items) {
      const item = parseOutboxItem(raw);
      if (item) valid.push(item);
      else rejected += 1;
    }
    const { accepted, duplicates } = await outbox2.append(valid);
    send(res, 200, { accepted, duplicates, rejected });
  }
  async function handleSetFolder(req, res) {
    if (!await pairing2.verifyToken(bearerToken(req))) {
      send(res, 401, { error: "unauthorized" });
      return;
    }
    if (!deps.setFolder) {
      send(res, 404, { error: "filing not available" });
      return;
    }
    const body = await readBody(req, res);
    if (body === null) return;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      send(res, 400, { error: "malformed json" });
      return;
    }
    if (typeof parsed.topic !== "string" || !parsed.topic) {
      send(res, 400, { error: "topic is required" });
      return;
    }
    const folder = parsed.folder === null || parsed.folder === void 0 ? null : typeof parsed.folder === "string" ? parsed.folder.trim().slice(0, 60) || null : void 0;
    if (folder === void 0) {
      send(res, 400, { error: "folder must be a string or null" });
      return;
    }
    await deps.setFolder(parsed.topic, folder);
    send(res, 200, { ok: true });
  }
  return {
    async start() {
      if (server2) return { port };
      server2 = createServer((req, res) => {
        const parsedUrl = new URL(req.url ?? "/", "http://localhost");
        const url = parsedUrl.pathname;
        if (req.method === "GET" && (url === "/link/pack" || url === "/link/packs" || url === "/link/overview" || url === "/link/graph" || url === "/link/receipts")) {
          void handlePackRead(req, res, parsedUrl);
          return;
        }
        if (req.method === "GET" && url === "/link/health") {
          send(res, 200, { app: "engram-desktop", protocol: 1 });
          return;
        }
        if (req.method === "POST" && url === "/link/pair") {
          void handlePair(req, res);
          return;
        }
        if (req.method === "POST" && url === "/link/outbox") {
          void handleOutbox(req, res);
          return;
        }
        if (req.method === "POST" && url === "/link/topic-folder") {
          void handleSetFolder(req, res);
          return;
        }
        send(res, 404, { error: "no such route" });
      });
      const listening = new Promise((resolve2, reject) => {
        const onError = (err) => {
          server2?.removeListener("listening", onListening);
          reject(err);
        };
        const onListening = () => {
          server2?.removeListener("error", onError);
          resolve2();
        };
        server2.once("error", onError);
        server2.once("listening", onListening);
        server2.listen(deps.port ?? 0, deps.host ?? "0.0.0.0");
      });
      try {
        await listening;
      } catch (err) {
        server2?.close();
        server2 = null;
        throw err;
      }
      const address = server2.address();
      port = typeof address === "object" && address ? address.port : 0;
      return { port };
    },
    async stop() {
      const current = server2;
      server2 = null;
      if (!current) return;
      await new Promise((resolve2) => current.close(() => resolve2()));
    },
    get port() {
      return port;
    }
  };
}
async function readLog(filePath) {
  const state = { order: [], items: /* @__PURE__ */ new Map(), drained: /* @__PURE__ */ new Set() };
  let raw;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return state;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.kind === "drained" && typeof record.id === "string") {
      state.drained.add(record.id);
      continue;
    }
    if (record.kind !== "item") continue;
    const item = parseOutboxItem(record.item);
    if (!item || state.items.has(item.id)) continue;
    state.items.set(item.id, item);
    state.order.push(item.id);
  }
  return state;
}
async function endsMidLine(filePath) {
  try {
    const raw = await readFile(filePath, "utf-8");
    return raw.length > 0 && !raw.endsWith("\n");
  } catch {
    return false;
  }
}
async function appendRecords(filePath, records) {
  if (records.length === 0) return;
  await mkdir(dirname(filePath), { recursive: true });
  const heal = await endsMidLine(filePath) ? "\n" : "";
  await appendFile(filePath, heal + records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");
}
function createOutboxStore(deps) {
  const { filePath } = deps;
  return {
    async append(items) {
      const state = await readLog(filePath);
      const fresh = [];
      const seen = /* @__PURE__ */ new Set();
      let duplicates = 0;
      for (const item of items) {
        if (state.items.has(item.id) || seen.has(item.id)) {
          duplicates += 1;
          continue;
        }
        seen.add(item.id);
        fresh.push(item);
      }
      await appendRecords(
        filePath,
        fresh.map((item) => ({ kind: "item", item }))
      );
      return { accepted: fresh.length, duplicates };
    },
    async pending() {
      const state = await readLog(filePath);
      return state.order.filter((id) => !state.drained.has(id)).map((id) => state.items.get(id));
    },
    async markDrained(ids) {
      await appendRecords(
        filePath,
        ids.map((id) => ({ kind: "drained", id }))
      );
    }
  };
}
const PAIRING_WINDOW_MS = 2 * 60 * 1e3;
function hashToken(token) {
  return createHash("sha256").update(token, "utf-8").digest("hex");
}
function digestsMatch(a, b) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
function createPairingStore(deps) {
  const { filePath } = deps;
  const now = deps.now ?? (() => Date.now());
  let offer = null;
  async function read2() {
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf-8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  async function write2(devices) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(devices, null, 2), "utf-8");
  }
  return {
    async beginPairing() {
      const code = String(randomInt(0, 1e6)).padStart(6, "0");
      const expiresAt = now() + PAIRING_WINDOW_MS;
      offer = { code, expiresAt };
      return { code, expiresAt };
    },
    async completePairing(code, deviceName) {
      if (!offer) return null;
      if (now() > offer.expiresAt) {
        offer = null;
        return null;
      }
      if (!digestsMatch(hashToken(offer.code), hashToken(code))) return null;
      offer = null;
      const token = randomBytes(32).toString("base64url");
      const device = {
        deviceId: randomBytes(8).toString("hex"),
        deviceName: deviceName.slice(0, 64),
        pairedAt: new Date(now()).toISOString(),
        tokenHash: hashToken(token)
      };
      await write2([...await read2(), device]);
      const { tokenHash: _omit, ...pub } = device;
      return { ...pub, token };
    },
    async verifyToken(token) {
      if (!token) return null;
      const candidate = hashToken(token);
      for (const device of await read2()) {
        if (digestsMatch(device.tokenHash, candidate)) {
          const { tokenHash: _omit, ...pub } = device;
          return pub;
        }
      }
      return null;
    },
    async revoke(deviceId) {
      await write2((await read2()).filter((d) => d.deviceId !== deviceId));
    },
    async list() {
      return (await read2()).map(({ tokenHash: _omit, ...pub }) => pub);
    }
  };
}
function composeMobileDrainKickoff(options) {
  const { topic, evidencePath, itemCount } = options;
  return `/engram:learn ${topic} — I worked ${itemCount} card(s) on the Engram companion app, away from my desk, so this sitting is a mobile-surface one. What I picked and produced there is in ${evidencePath}. Please settle it and tell me where those nodes now stand.`;
}
function groupByTopic(items) {
  const groups = /* @__PURE__ */ new Map();
  for (const item of items) {
    const existing = groups.get(item.topic);
    if (existing) existing.push(item);
    else groups.set(item.topic, [item]);
  }
  return groups;
}
async function drainOutbox(deps) {
  const { outbox: outbox2, batchDir, startSession: startSession2 } = deps;
  const pending = await outbox2.pending();
  const result = { sessionsStarted: 0, itemsDrained: 0, failures: [] };
  if (pending.length === 0) return result;
  await mkdir(batchDir, { recursive: true });
  for (const [topic, items] of groupByTopic(pending)) {
    const path = join(batchDir, `mobile-batch-${randomUUID()}.json`);
    try {
      await writeFile(path, JSON.stringify({ topic, items }, null, 2), "utf-8");
      const message = composeMobileDrainKickoff({
        topic,
        evidencePath: path,
        itemCount: items.length
      });
      await startSession2(message, "learn", topic);
      await outbox2.markDrained(items.map((i) => i.id));
      result.sessionsStarted += 1;
      result.itemsDrained += items.length;
    } catch (error) {
      result.failures.push({ topic, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
const PLUGIN_CACHE_ROOT = join(homedir(), ".claude", "plugins", "cache", "engram", "engram");
function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
let cached$2 = null;
function resolveEngramPlugin() {
  if (cached$2) return cached$2;
  if (!existsSync(PLUGIN_CACHE_ROOT)) {
    throw new Error(`Engram plugin not found at ${PLUGIN_CACHE_ROOT} — is the plugin installed?`);
  }
  const versions = readdirSync(PLUGIN_CACHE_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).filter((name) => existsSync(join(PLUGIN_CACHE_ROOT, name, "scripts", "engram.py")));
  if (versions.length === 0) {
    throw new Error(`No usable Engram plugin version found under ${PLUGIN_CACHE_ROOT}`);
  }
  versions.sort(compareVersions);
  const version = versions[versions.length - 1];
  const root = join(PLUGIN_CACHE_ROOT, version);
  cached$2 = { version, root, scriptPath: join(root, "scripts", "engram.py") };
  return cached$2;
}
const execAsync = promisify(exec);
const COMMON_LOCATIONS = [
  join(homedir(), ".claude", "local", "claude"),
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude"
];
let cached$1 = null;
async function resolveClaudeBinary() {
  if (cached$1) return cached$1;
  for (const loc of COMMON_LOCATIONS) {
    if (existsSync(loc)) {
      cached$1 = loc;
      return cached$1;
    }
  }
  const shell2 = process.env.SHELL || "/bin/zsh";
  try {
    const { stdout } = await execAsync(`${shell2} -lic 'command -v claude'`, { timeout: 1e4 });
    const resolved = stdout.trim().split("\n").pop()?.trim();
    if (resolved && existsSync(resolved)) {
      cached$1 = resolved;
      return cached$1;
    }
  } catch {
  }
  cached$1 = "claude";
  return cached$1;
}
const AUTH_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
function buildSessionEnv(base, engramRoot, mode = "subscription", apiKey = null) {
  const env = { ...base, ENGRAM_ROOT: engramRoot };
  for (const v of AUTH_VARS) delete env[v];
  if (mode === "apiKey") {
    if (apiKey === null || apiKey.trim() === "") {
      throw new Error("API-key mode is selected but no key is stored — add one in Settings → Authentication, or switch back to subscription mode.");
    }
    env.ANTHROPIC_API_KEY = apiKey;
  }
  return env;
}
const DEFAULTS$2 = { authMode: "subscription" };
function statePath$2() {
  return join(app.getPath("userData"), "auth-settings.json");
}
async function getAuthSettings() {
  try {
    const parsed = JSON.parse(await readFile(statePath$2(), "utf-8"));
    return parsed.authMode === "apiKey" ? { authMode: "apiKey" } : { ...DEFAULTS$2 };
  } catch {
    return { ...DEFAULTS$2 };
  }
}
async function setAuthMode(mode) {
  const next = { authMode: mode };
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(statePath$2(), JSON.stringify(next, null, 2), "utf-8");
  return next;
}
function createApiKeyStore(deps) {
  function readCiphertext() {
    try {
      return readFileSync(deps.filePath);
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }
  function get() {
    const ciphertext = readCiphertext();
    if (ciphertext === null) return null;
    try {
      const key = deps.decrypt(ciphertext);
      return key.trim() === "" ? null : key;
    } catch {
      return null;
    }
  }
  return {
    set(key) {
      if (key === null) {
        try {
          unlinkSync(deps.filePath);
        } catch (err) {
          if (err.code !== "ENOENT") throw err;
        }
        return;
      }
      if (!deps.encryptionAvailable()) {
        throw new Error("Secure key storage is unavailable on this system — the API key was not saved.");
      }
      mkdirSync(dirname(deps.filePath), { recursive: true });
      writeFileSync(deps.filePath, deps.encrypt(key));
    },
    get,
    status() {
      const key = get();
      if (key === null) return { present: false, last4: null };
      return { present: true, last4: key.slice(-4) };
    }
  };
}
let instance = null;
function apiKeyStore() {
  if (instance === null) {
    instance = createApiKeyStore({
      filePath: join(app.getPath("userData"), "auth-api-key.enc"),
      encrypt: (s) => safeStorage.encryptString(s),
      decrypt: (b) => safeStorage.decryptString(b),
      encryptionAvailable: () => safeStorage.isEncryptionAvailable()
    });
  }
  return instance;
}
function isPlausibleApiKey(x) {
  return typeof x === "string" && x.length >= 8 && x.length <= 256 && /^[\x21-\x7e]+$/.test(x);
}
const BRIDGE_SERVER_NAME = "engram-ui-bridge";
const MINIMAL_TOOLS = "Bash,Write,Read,Task";
const DISALLOWED_BASH_PATTERNS = [
  "Bash(rm -rf *)",
  "Bash(sudo *)",
  "Bash(curl *)",
  "Bash(wget *)",
  "Bash(> /dev/sd*)"
];
const APPEND_SYSTEM_PROMPT = `You are running headless, driven by a custom desktop app (Engram Desktop) rather than an interactive terminal. Three things differ from a normal interactive Claude Code session:

1. The native AskUserQuestion tool does not exist in this session. Whenever your instructions (the /engram:learn, /engram:review, or /engram:coach skill, or the shared dialogue-grammar.md) say to call AskUserQuestion, call the MCP tool mcp__${BRIDGE_SERVER_NAME}__ask_user_question instead, with the exact same arguments (question, header, options as an array of {label, description}, multiSelect). It behaves identically — it blocks until the learner picks an answer in the app UI.

2. Optionally, when you begin one of the dialogue-grammar's prose beats (open a gap, predict/attempt, struggle, resolve, self-explain, connect), you may call mcp__${BRIDGE_SERVER_NAME}__render_beat with the beat name and the content you're about to say, before saying it. This lets the app render a purpose-built card instead of a plain text block. It is entirely optional and never blocks — skip it if it would slow you down, the app degrades gracefully to a generic dialogue block. Include node and position ('n/of') when you know them.

3. A set of additional optional MCP tools lets you drive the app's UI as you teach. All are advisory and never block — skip any of them freely; the app degrades gracefully. Available: mcp__${BRIDGE_SERVER_NAME}__session_phase (call at each coarse phase transition: intake, pretest, walk, grading, closing); mcp__${BRIDGE_SERVER_NAME}__beat_outcome (when a beat resolves, report confirmed/partial/missed so the learner's beat trail inks honestly); mcp__${BRIDGE_SERVER_NAME}__spotlight_node (point at a node on the learner's Topic Map — especially during CONNECT beats); mcp__${BRIDGE_SERVER_NAME}__show_figure (a small markdown figure card set apart from prose — use sparingly); mcp__${BRIDGE_SERVER_NAME}__suggest_action (up to 3 one-click chips: open_explorable, show_on_map, go_review, prefill — prefill never auto-sends); mcp__${BRIDGE_SERVER_NAME}__progress_note (one-line session-plan status); mcp__${BRIDGE_SERVER_NAME}__annotate_node (attach LaTeX to a Topic Map node — latex_label for its plate caption, latex_claim for its claim in the drawer/full-node view; provide at least one, call again to update); mcp__${BRIDGE_SERVER_NAME}__render_ticket (when you print the session's opening ticket block — the "engram · <kind>" fenced summary the display formats describe — you may also call this with the same kind/mode/fields so the app renders it from real structured data instead of re-parsing your text; still print the fenced block as documented, this is purely an additional, optional path to the same card); in /review specifically, mcp__${BRIDGE_SERVER_NAME}__report_verdict (immediately before writing a grading-feedback paragraph that reveals the canonical answer or echoes the learner's confidence pick, call this with kind ('canonical' or 'confidence') and the exact text of that paragraph, then write the paragraph as you normally would — this lets the app style it correctly even when your wording doesn't open with a literal "Canonical:"/"Confidence:" label). Four more shape the teaching moments you already have, and carry only content you were going to write in prose anyway — they never license you to say something earlier than your instructions allow: mcp__${BRIDGE_SERVER_NAME}__render_comparison (a contrast case as two labelled columns — the boundary-drawing move); mcp__${BRIDGE_SERVER_NAME}__render_steps (a derivation or procedure as a numbered ladder, each rung with an optional 'why' note); mcp__${BRIDGE_SERVER_NAME}__render_formula (one display equation with a caption and a where-clause naming its symbols); mcp__${BRIDGE_SERVER_NAME}__cite_source (a provenance chip naming the source and place you're drawing on — never a citation you aren't actually working from); and mcp__${BRIDGE_SERVER_NAME}__render_plot (sketch the shape of a function from sampled [x, y] points — for a field inside vs outside a boundary, a payoff diagram, a decay; the app draws axes and traces the curve, and plots only the points you send); mcp__${BRIDGE_SERVER_NAME}__render_checks (the sanity checks an answer must survive — limiting cases, boundary agreement, dimensions — each paired with what it must give); mcp__${BRIDGE_SERVER_NAME}__render_timeline (a chronology as a dated spine; the \`when\` label is rendered verbatim, never parsed as a calendar date); and mcp__${BRIDGE_SERVER_NAME}__define_term (a term, its definition, and optionally the thing it is most often confused with). One more is not a display tool at all: mcp__${BRIDGE_SERVER_NAME}__propose_transcription, which you call when the learner attaches handwritten work — it returns the transcription to them for confirmation instead of into the dialogue, and they approve it before it becomes their answer. Transcribe it and stop: reproduce errors exactly, wrap expressions in $...$ or $$...$$ so they render, and say nothing — there or in the surrounding message — about whether the work is right, whether a step looks wrong, or what is missing from it. The learner has the page in front of them; that judgement is theirs to make and yours only once they submit. These serve the learner's orientation — never let them replace the dialogue itself.

4. The app renders LaTeX math ($...$ for inline, $$...$$ for display) via KaTeX — in ordinary chat prose, in text passed to mcp__${BRIDGE_SERVER_NAME}__render_beat, mcp__${BRIDGE_SERVER_NAME}__show_figure, mcp__${BRIDGE_SERVER_NAME}__ask_user_question, mcp__${BRIDGE_SERVER_NAME}__progress_note, mcp__${BRIDGE_SERVER_NAME}__render_comparison, mcp__${BRIDGE_SERVER_NAME}__render_steps and mcp__${BRIDGE_SERVER_NAME}__render_formula (whose \`latex\` field takes the bare expression, no delimiters), and in misconception descriptions logged via engram.py's \`misconception add\`. Prefer LaTeX delimiters over unicode approximation (ħ, ∂, ≥, etc.) anywhere you'd otherwise reach for one, so the app can actually set it as math.

Everything else about how you teach, grade, and schedule is unchanged — follow the installed skill and dialogue-grammar files exactly as written.`;
function resolveBridgeWorkerPath() {
  return app.isPackaged ? join(process.resourcesPath, "mcpBridgeWorker.mjs") : join(app.getAppPath(), "src", "main", "bridge", "mcpBridgeWorker.mjs");
}
async function prepareSessionPermissions(bridgePort, sessionId, extraInstructions) {
  const dir = await mkdtemp(join(tmpdir(), "engram-desktop-mcp-"));
  const mcpConfigPath = join(dir, "mcp-config.json");
  const workerPath = resolveBridgeWorkerPath();
  const config = {
    mcpServers: {
      [BRIDGE_SERVER_NAME]: {
        command: process.execPath,
        args: [workerPath],
        env: {
          ENGRAM_BRIDGE_PORT: String(bridgePort),
          ENGRAM_BRIDGE_SESSION_ID: sessionId,
          // Without this, process.execPath in a PACKAGED app is the branded "Engram
          // Desktop" binary itself, not a plain Node runtime — spawning it with a
          // script path as argv doesn't run that script, it boots a second full app
          // instance, which immediately hits our own requestSingleInstanceLock() and
          // quits (root-caused live: system/init showed mcp_servers status "failed",
          // and the model's tool_use for ask_user_question got "No such tool available"
          // back instantly). This forces Electron's binary to act as plain Node against
          // the given script instead, in both dev and packaged builds.
          ELECTRON_RUN_AS_NODE: "1"
        }
      }
    }
  };
  await writeFile(mcpConfigPath, JSON.stringify(config, null, 2), "utf-8");
  const appendSystemPrompt = extraInstructions?.trim() ? `${APPEND_SYSTEM_PROMPT}

Additional instructions for this specific topic, set by the learner in the app's topic settings — follow these too:
${extraInstructions.trim()}` : APPEND_SYSTEM_PROMPT;
  return {
    mcpConfigPath,
    tools: MINIMAL_TOOLS,
    disallowedTools: DISALLOWED_BASH_PATTERNS.join(" "),
    allowedTools: `mcp__${BRIDGE_SERVER_NAME}__ask_user_question mcp__${BRIDGE_SERVER_NAME}__render_beat mcp__${BRIDGE_SERVER_NAME}__session_phase mcp__${BRIDGE_SERVER_NAME}__beat_outcome mcp__${BRIDGE_SERVER_NAME}__spotlight_node mcp__${BRIDGE_SERVER_NAME}__show_figure mcp__${BRIDGE_SERVER_NAME}__suggest_action mcp__${BRIDGE_SERVER_NAME}__progress_note mcp__${BRIDGE_SERVER_NAME}__annotate_node mcp__${BRIDGE_SERVER_NAME}__render_ticket mcp__${BRIDGE_SERVER_NAME}__report_verdict mcp__${BRIDGE_SERVER_NAME}__render_comparison mcp__${BRIDGE_SERVER_NAME}__render_steps mcp__${BRIDGE_SERVER_NAME}__render_formula mcp__${BRIDGE_SERVER_NAME}__cite_source mcp__${BRIDGE_SERVER_NAME}__render_plot mcp__${BRIDGE_SERVER_NAME}__render_checks mcp__${BRIDGE_SERVER_NAME}__render_timeline mcp__${BRIDGE_SERVER_NAME}__define_term mcp__${BRIDGE_SERVER_NAME}__propose_transcription`,
    appendSystemPrompt,
    cleanup: async () => {
      const { rm: rm2 } = await import("node:fs/promises");
      await rm2(dir, { recursive: true, force: true }).catch(() => {
      });
    }
  };
}
class NdjsonLineSplitter {
  buffer = "";
  push(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    const parsed = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        parsed.push(JSON.parse(trimmed));
      } catch {
      }
    }
    return parsed;
  }
}
const TOPIC_ID_RE = /^[a-z0-9-]+$/;
const MAX_ID_LEN = 128;
const MAX_LATEX_LEN = 2e3;
function annotationsPath() {
  return join(app.getPath("userData"), "map-annotations.json");
}
async function readAll$1() {
  try {
    return JSON.parse(await readFile(annotationsPath(), "utf-8"));
  } catch {
    return {};
  }
}
async function writeAll$1(all) {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(annotationsPath(), JSON.stringify(all, null, 2), "utf-8");
}
async function getMapAnnotations(topicId) {
  const all = await readAll$1();
  return all[topicId] ?? {};
}
async function setNodeAnnotation(topicId, nodeId, patch) {
  const all = await readAll$1();
  const forTopic = { ...all[topicId] ?? {} };
  forTopic[nodeId] = { ...forTopic[nodeId], ...patch };
  all[topicId] = forTopic;
  await writeAll$1(all);
}
function sanitizeAnnotatePayload(payload) {
  const topic = payload.topic;
  const node = payload.node;
  const latexLabel = payload.latex_label;
  const latexClaim = payload.latex_claim;
  if (typeof topic !== "string" || topic.length > MAX_ID_LEN || !TOPIC_ID_RE.test(topic)) return null;
  if (typeof node !== "string" || node.length > MAX_ID_LEN || !TOPIC_ID_RE.test(node)) return null;
  const patch = {};
  if (latexLabel !== void 0) {
    if (typeof latexLabel !== "string" || latexLabel.length > MAX_LATEX_LEN) return null;
    patch.latexLabel = latexLabel;
  }
  if (latexClaim !== void 0) {
    if (typeof latexClaim !== "string" || latexClaim.length > MAX_LATEX_LEN) return null;
    patch.latexClaim = latexClaim;
  }
  if (patch.latexLabel === void 0 && patch.latexClaim === void 0) return null;
  return { topic, node, patch };
}
class BridgeServer {
  server = null;
  port = 0;
  // Keyed by requestId; carries the owning sessionId alongside the HTTP
  // resolver so a dead session's entries can be found and dropped without
  // scanning by anything other than a Map lookup — see `dropSession` below.
  pendingAsks = /* @__PURE__ */ new Map();
  window = null;
  setWindow(win) {
    this.window = win;
  }
  async start() {
    if (this.server) return this.port;
    this.server = createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        void this.handleRequest(req.url ?? "", Buffer.concat(chunks).toString("utf-8"), res);
      });
    });
    await new Promise((resolve2) => this.server.listen(0, "127.0.0.1", resolve2));
    const address = this.server.address();
    this.port = typeof address === "object" && address ? address.port : 0;
    return this.port;
  }
  stop() {
    this.server?.close();
    this.server = null;
  }
  async handleRequest(url, body, res) {
    const askMatch = url.match(/^\/bridge\/([^/]+)\/ask$/);
    const beatMatch = url.match(/^\/bridge\/([^/]+)\/beat$/);
    const uiMatch = url.match(/^\/bridge\/([^/]+)\/ui$/);
    if (askMatch) {
      const sessionId = decodeURIComponent(askMatch[1]);
      const payload = JSON.parse(body);
      const requestId = randomUUID();
      const request = { ...payload, sessionId, requestId };
      let settled = false;
      res.on("close", () => {
        if (settled) return;
        this.pendingAsks.delete(requestId);
        this.window?.webContents.send("bridge:ask-dropped", { sessionId, requestId });
      });
      const answer = await new Promise((resolve2) => {
        this.pendingAsks.set(requestId, { sessionId, resolve: resolve2 });
        this.window?.webContents.send("bridge:ask", request);
      });
      settled = true;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(answer));
      return;
    }
    if (beatMatch) {
      const sessionId = decodeURIComponent(beatMatch[1]);
      const payload = JSON.parse(body);
      this.window?.webContents.send("bridge:beat", { ...payload, sessionId });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (uiMatch) {
      const sessionId = decodeURIComponent(uiMatch[1]);
      const payload = JSON.parse(body);
      if (payload.tool === "annotate_node" && payload.payload && typeof payload.payload === "object") {
        const sanitized = sanitizeAnnotatePayload(payload.payload);
        if (sanitized) {
          void setNodeAnnotation(sanitized.topic, sanitized.node, sanitized.patch).catch(() => {
          });
        }
      }
      this.window?.webContents.send("bridge:ui", { ...payload, sessionId });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404);
    res.end();
  }
  /** Called by the renderer (via IPC) when the user answers a bridge:ask prompt. */
  answer(requestId, response) {
    const pending = this.pendingAsks.get(requestId);
    if (!pending) return;
    this.pendingAsks.delete(requestId);
    pending.resolve(response);
  }
  /**
   * Called by SessionManager when a session's process dies (abort, crash, or
   * natural exit — the one `handleClose` path). Any ask still pending for
   * that session has a dead `res` behind it (the mcpBridgeWorker process that
   * opened the HTTP connection died with the session), and the renderer-side
   * ask mark is now orphaned too (see ReviewSessionView.tsx/LearnSessionView.tsx's
   * `closed` handling) — nothing will ever call `answer()` for it again.
   * Deliberately does NOT call `resolve()`: the underlying HTTP socket is
   * already gone, and writing to it from here would risk an unhandled
   * rejection out of `handleRequest`'s still-suspended `await`. Dropping the
   * map entry just releases the reference so it can't accumulate across
   * repeated session aborts; the suspended request handler is left to be
   * garbage-collected with its dead socket, exactly as it would be if this
   * method didn't exist.
   */
  dropSession(sessionId) {
    for (const [requestId, pending] of this.pendingAsks) {
      if (pending.sessionId === sessionId) this.pendingAsks.delete(requestId);
    }
  }
  get portNumber() {
    return this.port;
  }
}
const bridgeServer = new BridgeServer();
function isTaskNotificationContent(content) {
  if (content.startsWith("<task-notification>")) return true;
  return content.startsWith("[SYSTEM NOTIFICATION") && content.includes("<task-notification>");
}
const STALL_THRESHOLD_MS = 9e4;
class SessionManager extends EventEmitter {
  sessionId;
  isResume;
  child = null;
  splitter = new NdjsonLineSplitter();
  permissions = null;
  ended = false;
  turnOutstanding = false;
  stallTimer = null;
  /**
   * `resumeSessionId`, when given, continues a previous Claude Code conversation
   * (`--resume`) instead of starting a fresh one (`--session-id`) — the UI-convenience
   * pointer lives in sessionIndex.ts, not here; this class just does what it's told.
   * `this.sessionId` is always the id actually in effect either way, since it's what
   * bridgeServer routes bridge:ask/bridge:beat requests by.
   */
  /** Resolves on the CLI's first stdout line — see sendUserMessageWhenReady. */
  ready;
  readyResolve;
  constructor(resumeSessionId) {
    super();
    this.sessionId = resumeSessionId ?? randomUUID();
    this.isResume = Boolean(resumeSessionId);
    this.ready = new Promise((resolve2) => {
      this.readyResolve = resolve2;
    });
  }
  /** `extraInstructions` — per-topic system-prompt addition, see topicSettings.ts. Ignored on resume (the prior turn's system prompt already governs the conversation; --resume doesn't accept a new one). */
  async start(initialMessage, extraInstructions) {
    const { root: engramRoot } = resolveEngramPlugin();
    const port = await bridgeServer.start();
    this.permissions = await prepareSessionPermissions(port, this.sessionId, extraInstructions);
    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--tools",
      this.permissions.tools,
      "--disallowedTools",
      this.permissions.disallowedTools,
      "--allowedTools",
      this.permissions.allowedTools,
      // Required for --input-format stream-json to run ANY tool at all — without it every
      // Bash call is denied with a generic "requires approval" gate (confirmed by direct
      // repro; --output-format-only `-p "text"` mode does not have this requirement).
      // --disallowedTools patterns are still enforced under bypass (also confirmed by
      // direct repro: `rm -rf` was denied even with bypassPermissions active), which is
      // what keeps the "scoped allowlist" intent alive despite the blunter flag name.
      "--permission-mode",
      "bypassPermissions",
      "--mcp-config",
      this.permissions.mcpConfigPath,
      "--strict-mcp-config",
      "--append-system-prompt",
      this.permissions.appendSystemPrompt,
      ...this.isResume ? ["--resume", this.sessionId] : ["--session-id", this.sessionId]
    ];
    const claudeBin = await resolveClaudeBinary();
    const { authMode } = await getAuthSettings();
    const sessionEnv = buildSessionEnv(process.env, engramRoot, authMode, authMode === "apiKey" ? apiKeyStore().get() : null);
    this.child = spawn(claudeBin, args, {
      cwd: homedir(),
      stdio: ["pipe", "pipe", "pipe"],
      // ENGRAM_ROOT: the skills' own engine-locator bootstrap probes
      // $OPENCODE_PLUGIN_ROOT → $CLAUDE_PLUGIN_ROOT → $CODEX_PLUGIN_ROOT →
      // $ENGRAM_ROOT → … for a dir containing scripts/engram.py. None of the
      // plugin-root vars exist in this headless spawn, so without this the
      // locator exits 2 on the FIRST engram call of nearly every sitting
      // (real-transcript evidence: "engram: engine not found — set
      // ENGRAM_ROOT to your engram checkout"), the tool-failure card fires,
      // and the tutor burns a turn re-finding the engine by hand. The
      // resolver's root is guaranteed to contain scripts/engram.py (that
      // filter is how it picks a version), which is exactly the locator's
      // own test — the sanctioned dev-clone hook, not a plugin modification.
      env: sessionEnv
    });
    this.child.stdout.on("data", (chunk) => this.handleStdout(chunk.toString("utf-8")));
    this.child.stderr.on("data", (chunk) => {
      console.error(`[session ${this.sessionId}] stderr:`, chunk.toString("utf-8"));
    });
    this.child.on("close", (code) => this.handleClose(code));
    this.child.on("error", (err) => this.emitEvent({ type: "error", message: err.message }));
    if (!this.isResume) {
      this.sendUserMessage(initialMessage);
    }
  }
  sendUserMessage(text) {
    if (!this.child || this.ended) return;
    const message = { type: "user", message: { role: "user", content: text } };
    this.child.stdin.write(JSON.stringify(message) + "\n");
    this.turnOutstanding = true;
    this.armStallTimer();
  }
  /** `sendUserMessage`, but held until the CLI has produced its first stdout
   * line (the init event) — a `--resume` spends its startup loading and
   * repairing the prior transcript, and a message written into that window
   * was observed to vanish (2026-08-03: the resume re-pose nudge never
   * reached the model; the child then idled forever). Fresh sessions resolve
   * readiness almost immediately, so routing ALL renderer-originated sends
   * through this costs nothing. 10s cap so a wedged child can't hold a send
   * hostage — after that we write anyway and let the stall watchdog judge. */
  async sendUserMessageWhenReady(text) {
    await Promise.race([this.ready, new Promise((r) => setTimeout(r, 1e4))]);
    this.sendUserMessage(text);
  }
  abort() {
    this.clearStallTimer();
    this.child?.kill();
  }
  /** (Re)starts the stall watchdog — called on every genuine stdout activity
   * while a turn is outstanding, so it only ever fires after a real gap of
   * total silence, never merely because a turn is taking a while. */
  armStallTimer() {
    this.clearStallTimer();
    if (!this.turnOutstanding) return;
    this.stallTimer = setTimeout(() => {
      this.emitEvent({ type: "stall", seconds: STALL_THRESHOLD_MS / 1e3 });
    }, STALL_THRESHOLD_MS);
  }
  clearStallTimer() {
    if (this.stallTimer) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }
  handleStdout(chunk) {
    this.readyResolve();
    this.armStallTimer();
    for (const raw of this.splitter.push(chunk)) {
      this.handleRawEvent(raw);
    }
  }
  handleRawEvent(d) {
    const type = d.type;
    if (d.parent_tool_use_id != null) return;
    if (type === "assistant") {
      const message = d.message;
      for (const block of message?.content ?? []) {
        if (block.type === "text") {
          this.emitEvent({ type: "text", text: block.text });
        } else if (block.type === "tool_use") {
          const b = block;
          this.emitEvent({ type: "tool_use", id: b.id, name: b.name, input: b.input });
        }
      }
      return;
    }
    if (type === "user") {
      const message = d.message;
      const content = message?.content;
      if (typeof content === "string") {
        if (isTaskNotificationContent(content)) {
          this.emitEvent({ type: "task_notification", content });
        }
        return;
      }
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = block;
          if (b?.type === "tool_result") {
            this.emitEvent({
              type: "tool_result",
              toolUseId: b.tool_use_id ?? "",
              isError: Boolean(b.is_error),
              content: b.content
            });
          }
        }
      }
      return;
    }
    if (type === "rate_limit_event") {
      const info = d.rate_limit_info;
      this.emitEvent({ type: "rate_limit", status: info?.status ?? "unknown", resetsAt: info?.resetsAt ?? null });
      return;
    }
    if (type === "result") {
      const usage = d.usage;
      const modelUsage = d.modelUsage;
      const contextWindow = modelUsage ? Object.values(modelUsage)[0]?.contextWindow : void 0;
      if (usage && contextWindow) {
        const usedTokens = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
        this.emitEvent({ type: "usage", usedTokens, contextWindow });
      }
      this.turnOutstanding = false;
      this.clearStallTimer();
      this.emitEvent({
        type: "turn_ended",
        isError: Boolean(d.is_error),
        resultText: typeof d.result === "string" ? d.result : null
      });
    }
  }
  handleClose(code) {
    this.ended = true;
    this.turnOutstanding = false;
    this.clearStallTimer();
    bridgeServer.dropSession(this.sessionId);
    this.emitEvent({ type: "closed", exitCode: code });
    void this.permissions?.cleanup();
  }
  emitEvent(event) {
    this.emit("event", event);
  }
}
function indexPath() {
  return join(app.getPath("userData"), "session-index.json");
}
async function readIndex() {
  let raw;
  try {
    raw = JSON.parse(await readFile(indexPath(), "utf-8"));
  } catch {
    return {};
  }
  const index = raw;
  const migrated = {};
  for (const [key, value] of Object.entries(index)) {
    migrated[key] = Array.isArray(value) ? value : [value];
  }
  return migrated;
}
async function writeIndex(index) {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(indexPath(), JSON.stringify(index, null, 2), "utf-8");
}
async function recordSession(key, sessionId) {
  const index = await readIndex();
  const list = index[key] ?? [];
  list.push({ sessionId, key, startedAt: (/* @__PURE__ */ new Date()).toISOString() });
  index[key] = list;
  await writeIndex(index);
}
async function lastSessionFor(key) {
  const index = await readIndex();
  const list = index[key] ?? [];
  return list.length > 0 ? list[list.length - 1].sessionId : null;
}
async function sessionHistoryFor(key) {
  const index = await readIndex();
  return [...index[key] ?? []].reverse();
}
const EMPTY = {
  systemPromptExtra: "",
  contextFiles: [],
  targetDate: null,
  displayTitle: null,
  folder: null
};
function settingsPath() {
  return join(app.getPath("userData"), "topic-settings.json");
}
async function readAll() {
  try {
    return JSON.parse(await readFile(settingsPath(), "utf-8"));
  } catch {
    return {};
  }
}
async function writeAll(all) {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(all, null, 2), "utf-8");
}
async function getTopicSettings(topicId) {
  const all = await readAll();
  return { ...EMPTY, ...all[topicId] };
}
async function getDisplayTitles() {
  const all = await readAll();
  const out = {};
  for (const [id, s] of Object.entries(all)) {
    const title = s.displayTitle?.trim();
    if (title) out[id] = title;
  }
  return out;
}
async function getTopicFolders() {
  const all = await readAll();
  const out = {};
  for (const [id, s] of Object.entries(all)) {
    const folder = s.folder?.trim();
    if (folder) out[id] = folder;
  }
  return out;
}
async function setTopicSettings(topicId, settings) {
  const all = await readAll();
  all[topicId] = settings;
  await writeAll(all);
}
function projectsRoot() {
  return join(homedir(), ".claude", "projects");
}
function transcriptsDir() {
  const flattenedCwd = homedir().replace(/\//g, "-");
  return join(projectsRoot(), flattenedCwd);
}
function transcriptPath(sessionId) {
  return join(transcriptsDir(), `${sessionId}.jsonl`);
}
async function findTranscriptPath(sessionId) {
  const primary = transcriptPath(sessionId);
  try {
    await stat(primary);
    return primary;
  } catch {
  }
  try {
    const entries = await readdir(projectsRoot(), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = join(projectsRoot(), entry.name, `${sessionId}.jsonl`);
      try {
        await stat(candidate);
        return candidate;
      } catch {
      }
    }
  } catch {
  }
  return null;
}
function parseNdjson(raw) {
  const lines = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      lines.push(JSON.parse(trimmed));
    } catch {
    }
  }
  return lines;
}
async function readTranscriptFile(path) {
  let raw;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return [];
  }
  return parseNdjson(raw);
}
async function readTranscript(sessionId) {
  const path = await findTranscriptPath(sessionId);
  if (!path) return [];
  return readTranscriptFile(path);
}
function sanitizeFilename(title) {
  const cleaned = title.replace(/[/\\:*?"<>|]/g, " ").trim();
  return cleaned.length > 0 ? cleaned : "sitting";
}
function todayStamp() {
  const d = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
async function renderPrintHtmlToPdf(printHtml, options) {
  const tempHtmlPath = join(app.getPath("temp"), `engram-print-export-${randomUUID()}.html`);
  let printWindow = null;
  try {
    await writeFile(tempHtmlPath, printHtml, "utf-8");
    printWindow = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    await printWindow.loadFile(tempHtmlPath);
    return await printWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: "Letter",
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      ...options
    });
  } finally {
    if (printWindow && !printWindow.isDestroyed()) printWindow.destroy();
    await unlink(tempHtmlPath).catch(() => {
    });
  }
}
async function exportSitting(win, req) {
  if (!win) return { ok: false, reason: "No window available to show the save dialog from." };
  const ext = req.format === "md" ? "md" : "pdf";
  const dialogResult = await dialog.showSaveDialog(win, {
    title: "Export sitting",
    defaultPath: `${sanitizeFilename(req.title)} — ${todayStamp()}.${ext}`,
    filters: [{ name: req.format === "md" ? "Markdown" : "PDF", extensions: [ext] }]
  });
  if (dialogResult.canceled || !dialogResult.filePath) return { ok: false, reason: "canceled" };
  const filePath = dialogResult.filePath;
  if (req.format === "md") {
    if (req.markdown == null) return { ok: false, reason: "No markdown content was provided." };
    await writeFile(filePath, req.markdown, "utf-8");
    return { ok: true, path: filePath };
  }
  if (req.printHtml == null) return { ok: false, reason: "No print document was provided." };
  try {
    const pdfBuffer = await renderPrintHtmlToPdf(req.printHtml);
    await writeFile(filePath, pdfBuffer);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
async function exportMap(win, req) {
  if (!win) return { ok: false, reason: "No window available to show the save dialog from." };
  const dialogResult = await dialog.showSaveDialog(win, {
    title: "Export map",
    defaultPath: `${sanitizeFilename(req.title)} — map — ${todayStamp()}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });
  if (dialogResult.canceled || !dialogResult.filePath) return { ok: false, reason: "canceled" };
  const filePath = dialogResult.filePath;
  if (req.printHtml == null) return { ok: false, reason: "No print document was provided." };
  try {
    const pdfBuffer = await renderPrintHtmlToPdf(req.printHtml, { landscape: true });
    await writeFile(filePath, pdfBuffer);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
const execFileAsync$3 = promisify(execFile);
const READ_ONLY_COMMANDS = /* @__PURE__ */ new Set([
  "topics",
  "stats",
  "due",
  "decay",
  "next",
  "adherence",
  "retention",
  "transfer",
  "grader-health",
  "topic-status",
  "doctor",
  "path",
  "model"
]);
const READ_ONLY_SUBCOMMANDS = /* @__PURE__ */ new Map([
  ["misconception", /* @__PURE__ */ new Set(["list"])],
  ["experiment", /* @__PURE__ */ new Set(["status", "list"])],
  // The count action only. Verified against engram.py 1.10.1: that branch
  // reads the stash file and emits its length — no write, no removal, no lock
  // of its own. Its siblings in the SAME command do write (add appends, clear
  // unlinks), which is exactly the case this per-action map exists for: the
  // command as a whole could never be allowlisted, and one action of it
  // safely can.
  //
  // Why the app needs it: a sitting can end with productions stashed and not
  // yet graded, and that state was invisible in the app, so the work sat in
  // limbo until another session happened to run. Reading the count is what
  // lets Home say so and offer to finish it. The stash holds productions the
  // learner wrote, so this reads no claim and no rubric.
  ["stash", /* @__PURE__ */ new Set(["count"])]
]);
class EngramCliError extends Error {
  constructor(message, stderr, exitCode) {
    super(message);
    this.stderr = stderr;
    this.exitCode = exitCode;
    this.name = "EngramCliError";
  }
}
async function engramRead(command, args = []) {
  if (!READ_ONLY_COMMANDS.has(command)) {
    const allowedActions = READ_ONLY_SUBCOMMANDS.get(command);
    const action = args[0];
    if (!allowedActions || action === void 0 || !allowedActions.has(action)) {
      throw new Error(`engramRead: "${command}" is not on the read-only allowlist`);
    }
  }
  const { scriptPath } = resolveEngramPlugin();
  try {
    const { stdout } = await execFileAsync$3("python3", [scriptPath, command, ...args], {
      maxBuffer: 32 * 1024 * 1024
    });
    return JSON.parse(stdout);
  } catch (err) {
    const e = err;
    throw new EngramCliError(
      `engram.py ${command} failed: ${e.message}`,
      e.stderr ?? "",
      e.code ?? null
    );
  }
}
async function engramTopicStatusText(topic) {
  const { scriptPath } = resolveEngramPlugin();
  try {
    const { stdout } = await execFileAsync$3("python3", [scriptPath, "topic-status", "--topic", topic]);
    return stdout;
  } catch (err) {
    const e = err;
    throw new EngramCliError(`engram.py topic-status failed: ${e.message}`, e.stderr ?? "", e.code ?? null);
  }
}
async function engramLearningHome() {
  const { scriptPath } = resolveEngramPlugin();
  const { stdout } = await execFileAsync$3("python3", [scriptPath, "path"]);
  return stdout.trim();
}
async function engramArtifactList() {
  const { scriptPath } = resolveEngramPlugin();
  const { stdout } = await execFileAsync$3("python3", [scriptPath, "artifact", "list"]);
  const entries = JSON.parse(stdout);
  if (entries.length === 0) return entries;
  const home = await engramLearningHome();
  return entries.map((e) => ({ ...e, artifact: isAbsolute(e.artifact) ? e.artifact : join(home, e.artifact) }));
}
const DIRECT_MUTATION_COMMANDS = /* @__PURE__ */ new Set(["visuals", "focus", "commit", "misconception", "retire"]);
async function engramDirectMutate(command, args) {
  if (!DIRECT_MUTATION_COMMANDS.has(command) && command !== "model") {
    throw new Error(`engramDirectMutate: "${command}" is not on the direct-mutation allowlist`);
  }
  if (command === "misconception" && args[0] !== "resolve") {
    throw new Error('engramDirectMutate: only the resolve action of "misconception" is permitted');
  }
  if (command === "retire") {
    const shapeOk = args[0] === "--topic" && typeof args[1] === "string" && /^[a-z0-9-]+$/.test(args[1]) && (args.length === 2 || args.length === 3 && args[2] === "--restore");
    if (!shapeOk) {
      throw new Error("engramDirectMutate: retire is permitted only as `--topic <slug> [--restore]`");
    }
  }
  const { scriptPath } = resolveEngramPlugin();
  const { stdout } = await execFileAsync$3("python3", [scriptPath, command, ...args]);
  try {
    return JSON.parse(stdout);
  } catch {
    return { raw: stdout };
  }
}
async function readTopicGraph(topic) {
  const { homedir: homedir2 } = await import("node:os");
  const { join: join2 } = await import("node:path");
  const { readFile: readFile2 } = await import("node:fs/promises");
  const path = join2(homedir2(), ".claude", "learning", "graphs", `${topic}.json`);
  const raw = await readFile2(path, "utf-8");
  return JSON.parse(raw);
}
const execFileAsync$2 = promisify(execFile);
const USERDATA_BACKUP_FILES = [
  "topic-settings.json",
  "session-index.json",
  "map-annotations.json",
  "achievements.json",
  "notifier-state.json"
];
const LEARNING_ENTRY_PREFIX = ".claude/learning/";
function localStamp(now) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}
function randomSuffix() {
  return randomBytes(4).toString("hex");
}
function hasAnythingToBackUp(learningHome2, userDataDir) {
  if (existsSync(learningHome2)) return true;
  return USERDATA_BACKUP_FILES.some((name) => existsSync(join(userDataDir, name)));
}
async function createBackupArchive(opts) {
  const { home, learningHome: learningHome2, userDataDir, destDir } = opts;
  const now = opts.now ?? /* @__PURE__ */ new Date();
  const args = [];
  const relLearning = relative(home, learningHome2);
  const learningIsUnderHome = relLearning !== "" && !relLearning.startsWith("..") && !isAbsolute(relLearning);
  if (existsSync(learningHome2)) {
    if (learningIsUnderHome) {
      args.push("-C", home, relLearning);
    } else {
      args.push("-C", dirname(learningHome2), basename(learningHome2));
    }
  }
  const presentUserDataFiles = USERDATA_BACKUP_FILES.filter((name) => existsSync(join(userDataDir, name)));
  if (presentUserDataFiles.length > 0) {
    args.push("-C", userDataDir, ...presentUserDataFiles);
  }
  if (args.length === 0) {
    throw new Error("Nothing to back up — no learning data or app settings found.");
  }
  await mkdir(destDir, { recursive: true });
  const destPath = join(destDir, opts.fileName ?? `engram-backup-${localStamp(now)}.tar.gz`);
  await execFileAsync$2("tar", ["-czf", destPath, ...args]);
  const { size } = await stat(destPath);
  return { path: destPath, bytes: size };
}
async function createSafetySnapshotArchive(opts) {
  const { home, learningHome: learningHome2, userDataDir, archivePath } = opts;
  if (!hasAnythingToBackUp(learningHome2, userDataDir)) {
    return { ok: true, path: null, bytes: 0 };
  }
  const now = opts.now ?? /* @__PURE__ */ new Date();
  const destDir = dirname(archivePath);
  const fileName = opts.fileName ?? `engram-safety-${localStamp(now)}-${randomSuffix()}.tar.gz`;
  const destPath = join(destDir, fileName);
  if (resolve(destPath) === resolve(archivePath)) {
    return {
      ok: false,
      reason: `Refusing to write the safety snapshot to the same path as the archive being restored (${destPath}). Nothing was changed.`
    };
  }
  try {
    const { path, bytes } = await createBackupArchive({ home, learningHome: learningHome2, userDataDir, destDir, now, fileName });
    return { ok: true, path, bytes };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
async function listArchiveEntries(archivePath) {
  const { stdout } = await execFileAsync$2("tar", ["-tzf", archivePath], { maxBuffer: 32 * 1024 * 1024 });
  return stdout.split("\n").filter(Boolean);
}
function validateEntryNames(entries) {
  for (const entry of entries) {
    if (entry.startsWith("/") || entry.split("/").includes("..")) {
      throw new Error(`Archive contains an unsafe path entry ("${entry}") — refusing to restore.`);
    }
  }
}
async function describeArchive(archivePath) {
  if (!existsSync(archivePath)) return { ok: false, reason: "Archive not found." };
  let entries;
  try {
    entries = await listArchiveEntries(archivePath);
  } catch (err) {
    return { ok: false, reason: `Could not read archive: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    validateEntryNames(entries);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  if (!entries.some((e) => e.includes(LEARNING_ENTRY_PREFIX))) {
    return { ok: false, reason: "This does not look like an Engram backup — no learning data found inside." };
  }
  const topics = entries.filter((e) => /\.claude\/learning\/graphs\/[^/]+\.json$/.test(e)).length;
  const receipts = entries.filter((e) => /\.claude\/learning\/receipts\/[^/]+\.jsonl$/.test(e)).length;
  const stampMatch = basename(archivePath).match(/^engram-backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.tar\.gz$/);
  let archivedAt;
  if (stampMatch) {
    const [, y, mo, d, hh, mm] = stampMatch;
    archivedAt = `${y}-${mo}-${d}T${hh}:${mm}:00`;
  } else {
    archivedAt = (await stat(archivePath)).mtime.toISOString();
  }
  return { ok: true, topics, receipts, archivedAt };
}
async function restoreArchiveInto(opts) {
  const { archivePath, learningHome: learningHome2, userDataDir } = opts;
  const entries = await listArchiveEntries(archivePath);
  validateEntryNames(entries);
  const tmpStagingDir = await mkdtemp(join(tmpdir(), "engram-restore-"));
  const unique = `${Date.now()}-${randomSuffix()}`;
  const onVolumeStaging = `${learningHome2}.incoming-${unique}`;
  const asideDir = `${learningHome2}.restore-aside-${unique}`;
  let renamedAside = false;
  try {
    await execFileAsync$2("tar", ["-xzf", archivePath, "-C", tmpStagingDir]);
    const stagedLearning = join(tmpStagingDir, ".claude", "learning");
    if (!existsSync(stagedLearning)) {
      throw new Error("Archive did not contain a .claude/learning directory — refusing to restore.");
    }
    await mkdir(dirname(learningHome2), { recursive: true });
    await cp(stagedLearning, onVolumeStaging, { recursive: true });
    const hadExisting = existsSync(learningHome2);
    if (hadExisting) {
      await rename(learningHome2, asideDir);
      renamedAside = true;
    }
    if (opts.__beforeFinalMove) await opts.__beforeFinalMove();
    await rename(onVolumeStaging, learningHome2);
    if (renamedAside) {
      await rm(asideDir, { recursive: true, force: true });
      renamedAside = false;
    }
    await mkdir(userDataDir, { recursive: true });
    for (const name of USERDATA_BACKUP_FILES) {
      const stagedFile = join(tmpStagingDir, name);
      if (existsSync(stagedFile)) {
        await copyFile(stagedFile, join(userDataDir, name));
      }
    }
  } catch (err) {
    if (renamedAside) {
      await rm(learningHome2, { recursive: true, force: true }).catch(() => {
      });
      try {
        await rename(asideDir, learningHome2);
      } catch (rollbackErr) {
        throw new Error(
          `Restore failed AND automatic rollback failed — your original learning dir was NOT restored to its usual location; it is preserved at ${asideDir}. Original error: ${err instanceof Error ? err.message : String(err)}. Rollback error: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}.`
        );
      }
    }
    throw err;
  } finally {
    await rm(tmpStagingDir, { recursive: true, force: true }).catch(() => {
    });
    if (existsSync(onVolumeStaging)) {
      await rm(onVolumeStaging, { recursive: true, force: true }).catch(() => {
      });
    }
  }
}
function backupStatePath() {
  return join(app.getPath("userData"), "backup-state.json");
}
const EMPTY_BACKUP_INFO = { lastDestDir: null, lastBackupAt: null, lastBackupPath: null };
async function readBackupState() {
  try {
    return { ...EMPTY_BACKUP_INFO, ...JSON.parse(await readFile(backupStatePath(), "utf-8")) };
  } catch {
    return { ...EMPTY_BACKUP_INFO };
  }
}
async function writeBackupState(state) {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(backupStatePath(), JSON.stringify(state, null, 2), "utf-8");
}
async function getBackupInfo() {
  return readBackupState();
}
async function backupNow(destDir) {
  const state = await readBackupState();
  let dir = destDir ?? state.lastDestDir ?? void 0;
  if (!dir) {
    const result = await dialog.showOpenDialog({
      title: "Choose a folder for Engram backups",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, reason: "canceled" };
    dir = result.filePaths[0];
  }
  try {
    const home = homedir();
    const learningHome2 = await engramLearningHome();
    const userDataDir = app.getPath("userData");
    const { path, bytes } = await createBackupArchive({ home, learningHome: learningHome2, userDataDir, destDir: dir });
    await writeBackupState({ lastDestDir: dir, lastBackupAt: (/* @__PURE__ */ new Date()).toISOString(), lastBackupPath: path });
    return { ok: true, path, bytes };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
async function pickBackupArchivePath() {
  const result = await dialog.showOpenDialog({
    title: "Choose an Engram backup to restore",
    properties: ["openFile"],
    filters: [
      { name: "Engram backup (.tar.gz)", extensions: ["gz"] },
      { name: "All files", extensions: ["*"] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
}
async function restoreFromArchive(archivePath, confirmation, isSessionActive = () => false) {
  if (confirmation !== "restore") {
    return { ok: false, reason: 'Type "restore" to confirm — nothing was changed.' };
  }
  if (isSessionActive()) {
    return { ok: false, reason: "A learning session is active — finish or close it before restoring." };
  }
  const described = await describeArchive(archivePath);
  if (!described.ok) return described;
  let home;
  let learningHome2;
  let userDataDir;
  try {
    home = homedir();
    learningHome2 = await engramLearningHome();
    userDataDir = app.getPath("userData");
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  const safety = await createSafetySnapshotArchive({ home, learningHome: learningHome2, userDataDir, archivePath });
  if (!safety.ok) {
    return {
      ok: false,
      reason: `Could not create a safety snapshot before restoring — nothing was changed. (${safety.reason})`
    };
  }
  try {
    await restoreArchiveInto({ archivePath, learningHome: learningHome2, userDataDir });
    return { ok: true, safetyPath: safety.path };
  } catch (err) {
    const snapshotNote = safety.path ? `the safety snapshot was saved to ${safety.path}` : "no safety snapshot was needed — nothing existed to protect before this restore";
    return {
      ok: false,
      reason: `Restore failed after ${snapshotNote}: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}
const sessions = /* @__PURE__ */ new Map();
let activeWindow = null;
function rebindWindow(win) {
  activeWindow = win;
  bridgeServer.setWindow(win);
}
async function buildExtraInstructions(topicId) {
  const settings = await getTopicSettings(topicId);
  const parts = [];
  if (settings.systemPromptExtra.trim()) parts.push(settings.systemPromptExtra.trim());
  if (settings.contextFiles.length > 0) {
    parts.push(
      `Before teaching this topic, read these reference files for context (use the Read tool):
${settings.contextFiles.map((p) => `- ${p}`).join("\n")}`
    );
  }
  return parts.length > 0 ? parts.join("\n\n") : void 0;
}
function abortAllSessions() {
  for (const manager of sessions.values()) manager.abort();
  sessions.clear();
}
function hasLiveSessions() {
  return sessions.size > 0;
}
async function startSession(initialMessage, kind, resumeSessionId, topicId) {
  const manager = new SessionManager(resumeSessionId);
  sessions.set(manager.sessionId, manager);
  manager.on("event", (event) => {
    activeWindow?.webContents.send("session:event", { sessionId: manager.sessionId, event });
    if (event.type === "closed") sessions.delete(manager.sessionId);
  });
  const extraInstructions = !resumeSessionId && topicId ? await buildExtraInstructions(topicId) : void 0;
  await manager.start(initialMessage, extraInstructions);
  await recordSession(topicId ?? kind, manager.sessionId);
  return { sessionId: manager.sessionId };
}
function registerSessionHandlers(win) {
  rebindWindow(win);
  ipcMain.handle(
    "session:start",
    (_e, initialMessage, kind, topicId) => startSession(initialMessage, kind, void 0, topicId)
  );
  ipcMain.handle("session:resume", async (_e, initialMessage, kind, topicId) => {
    const previous = await lastSessionFor(topicId ?? kind);
    return startSession(initialMessage, kind, previous ?? void 0, topicId);
  });
  ipcMain.handle("session:lastFor", (_e, kind, topicId) => lastSessionFor(topicId ?? kind));
  ipcMain.handle("session:historyFor", (_e, kind, topicId) => sessionHistoryFor(topicId ?? kind));
  ipcMain.handle("session:transcript", (_e, sessionId) => readTranscript(sessionId));
  ipcMain.handle("topicSettings:get", (_e, topicId) => getTopicSettings(topicId));
  ipcMain.handle(
    "topicSettings:set",
    (_e, topicId, settings) => setTopicSettings(topicId, settings)
  );
  ipcMain.handle("session:anyActive", () => sessions.size > 0);
  ipcMain.handle("session:send", (_e, sessionId, text) => {
    return sessions.get(sessionId)?.sendUserMessageWhenReady(text);
  });
  ipcMain.handle("session:abort", (_e, sessionId) => {
    sessions.get(sessionId)?.abort();
    sessions.delete(sessionId);
  });
  ipcMain.handle("bridge:answer", (_e, requestId, response) => {
    bridgeServer.answer(requestId, response);
  });
  ipcMain.handle(
    "session:export",
    (_e, req) => exportSitting(activeWindow, req)
  );
  ipcMain.handle(
    "map:export",
    (_e, req) => exportMap(activeWindow, req)
  );
  ipcMain.handle("backup:now", (_e, destDir) => backupNow(destDir));
  ipcMain.handle("backup:describe", (_e, archivePath) => describeArchive(archivePath));
  ipcMain.handle(
    "backup:restore",
    (_e, archivePath, confirmation) => restoreFromArchive(archivePath, confirmation, () => sessions.size > 0)
  );
  ipcMain.handle("backup:pickArchive", () => pickBackupArchivePath());
  ipcMain.handle("backup:info", () => getBackupInfo());
}
async function buildMobileOverview(packedFor) {
  const topics = await engramRead("topics");
  const due = await engramRead("due", ["--limit", "500"]);
  const dueByTopic = /* @__PURE__ */ new Map();
  for (const item of due) {
    dueByTopic.set(item.topic, (dueByTopic.get(item.topic) ?? 0) + 1);
  }
  const overview = [];
  for (const entry of topics) {
    overview.push({
      topic: entry.topic,
      title: entry.title ?? entry.topic,
      due: dueByTopic.get(entry.topic) ?? 0,
      packed: (await packedFor(entry.topic)).length,
      states: {
        new: entry.states?.new ?? 0,
        learning: entry.states?.learning ?? 0,
        review: entry.states?.review ?? 0
      },
      folder: entry.folder ?? null
    });
  }
  overview.sort((a, b) => b.due - a.due || b.packed - a.packed);
  return {
    topics: overview,
    dueTotal: due.length,
    minutesPerItem: null
  };
}
async function buildConstellationGraph(topic) {
  const graph = await readTopicGraph(topic);
  const present = new Set(Object.keys(graph.nodes ?? {}));
  const nodes = Object.entries(graph.nodes ?? {}).map(([id, node]) => ({
    id,
    state: typeof node.state === "string" ? node.state : "new",
    threshold: node.threshold === true,
    // Filtered to drawn nodes: an edge to something absent is a line to
    // nowhere, and the client should not have to guess.
    requires: (node.edges?.requires ?? []).filter((req) => present.has(req))
  }));
  return { topic, order: graph.order ?? [], nodes };
}
const DAYS_BACK = 180;
const WEEKS_BACK = 26;
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
function mondayOf(dateStr) {
  const d = /* @__PURE__ */ new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return isoDate(d);
}
async function readReceiptsHistory() {
  const home = await engramLearningHome();
  const receiptsDir = join(home, "receipts");
  let files = [];
  try {
    files = (await readdir(receiptsDir)).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return { days: [], weeks: [], receipts: [] };
  }
  const dayItems = /* @__PURE__ */ new Map();
  const weekTotals = /* @__PURE__ */ new Map();
  const rawReceipts = [];
  const cutoff = /* @__PURE__ */ new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - DAYS_BACK);
  await Promise.all(
    files.map(async (file) => {
      let raw;
      try {
        raw = await readFile(join(receiptsDir, file), "utf-8");
      } catch {
        return;
      }
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (!entry.ts || !entry.topic || !entry.node) continue;
        rawReceipts.push({
          id: typeof entry.id === "string" ? entry.id : null,
          ts: entry.ts,
          topic: entry.topic,
          node: entry.node,
          kind: typeof entry.kind === "string" ? entry.kind : null,
          grade: entry.grade ?? null,
          rating: typeof entry.rating === "string" ? entry.rating : null,
          sBefore: typeof entry.s_before === "number" ? entry.s_before : null,
          sAfter: typeof entry.s_after === "number" ? entry.s_after : null,
          capstone: entry.capstone === true,
          intervalDays: typeof entry.interval_days === "number" ? entry.interval_days : null,
          dueNext: typeof entry.due_next === "string" ? entry.due_next : null,
          relearn: entry.relearn === true,
          source: typeof entry.source === "string" ? entry.source : null,
          productionTruncated: entry.production_truncated === true
        });
        const entryDate = /* @__PURE__ */ new Date(`${entry.ts}T00:00:00Z`);
        if (entryDate < cutoff) continue;
        const items = dayItems.get(entry.ts) ?? [];
        items.push({ topic: entry.topic, node: entry.node, grade: entry.grade ?? null });
        dayItems.set(entry.ts, items);
        const week = mondayOf(entry.ts);
        const bucket = weekTotals.get(week) ?? { total: 0, recalled: 0 };
        bucket.total += 1;
        if (entry.grade === "recalled") bucket.recalled += 1;
        weekTotals.set(week, bucket);
      }
    })
  );
  const days = [];
  const today = /* @__PURE__ */ new Date();
  for (let i = DAYS_BACK - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const date = isoDate(d);
    const items = dayItems.get(date) ?? [];
    days.push({ date, count: items.length, items });
  }
  const weeks = [];
  for (let i = WEEKS_BACK - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i * 7);
    const weekStart = mondayOf(isoDate(d));
    const bucket = weekTotals.get(weekStart);
    weeks.push({
      weekStart,
      total: bucket?.total ?? 0,
      recalled: bucket?.recalled ?? 0,
      rate: bucket && bucket.total > 0 ? bucket.recalled / bucket.total : null
    });
  }
  const seen = /* @__PURE__ */ new Set();
  const dedupedWeeks = weeks.filter((w) => seen.has(w.weekStart) ? false : (seen.add(w.weekStart), true));
  return { days, weeks: dedupedWeeks, receipts: rawReceipts };
}
const MAX_RECEIPTS = 60;
function projectTopicReceipts(topic, receipts, titles) {
  const mine = receipts.filter((r) => r.topic === topic).slice().sort((a, b) => b.ts.localeCompare(a.ts));
  const latestSource = /* @__PURE__ */ new Map();
  for (const r of mine) {
    if (!latestSource.has(r.node)) latestSource.set(r.node, r.source);
  }
  const provisional = [...latestSource.entries()].filter(([, source]) => isPhoneSource(source)).map(([node]) => node).sort();
  return {
    topic,
    receipts: mine.slice(0, MAX_RECEIPTS).map((r) => ({
      node: r.node,
      title: titles[r.node] ?? r.node,
      ts: r.ts,
      kind: r.kind,
      grade: r.grade,
      rating: r.rating,
      source: r.source,
      dueNext: r.dueNext,
      intervalDays: r.intervalDays,
      relearn: r.relearn,
      fromPhone: isPhoneSource(r.source)
    })),
    provisional
  };
}
function isPhoneSource(source) {
  return source !== null && PHONE_SOURCE_STAMPS.includes(source);
}
async function buildTopicReceipts(topic) {
  const [history, titles] = await Promise.all([readReceiptsHistory(), readNodeTitles(topic)]);
  return projectTopicReceipts(topic, history.receipts, titles);
}
async function readNodeTitles(topic) {
  let graph;
  try {
    graph = await readTopicGraph(topic);
  } catch {
    return {};
  }
  const nodes = graph?.nodes;
  if (!Array.isArray(nodes)) return {};
  const out = {};
  for (const node of nodes) {
    const id = node?.id;
    const title = node?.title;
    if (typeof id === "string" && typeof title === "string") out[id] = title;
  }
  return out;
}
let server = null;
let pairing = null;
let outbox = null;
let packs = null;
let boundHost = "127.0.0.1";
let lastError = null;
function userDataPath(...parts) {
  return join(app.getPath("userData"), ...parts);
}
function lanAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return null;
}
function ensureStores() {
  pairing ??= createPairingStore({ filePath: userDataPath("paired-devices.json") });
  outbox ??= createOutboxStore({ filePath: userDataPath("outbox.jsonl") });
  packs ??= createCardPackStore({ rootDir: userDataPath("card-packs") });
}
async function startLinkServer(options = {}) {
  ensureStores();
  const host = options.exposeToLan ? "0.0.0.0" : "127.0.0.1";
  if (server && host === boundHost) return linkStatus();
  if (server) await server.stop();
  boundHost = host;
  lastError = null;
  server = createLinkServer({
    pairing,
    outbox,
    packs,
    // Counts only, built outside main/link/ — see mobileOverview.ts for why
    // the engine read lives on the other side of the inertness boundary.
    overview: () => buildMobileOverview((topic) => packs.listFor(topic)),
    graph: (topic) => buildConstellationGraph(topic),
    // The return leg: what the desk decided about work the phone sent up.
    // Grades, never content — see mobileReceipts.ts for why a receipt may
    // cross a boundary a due item may not.
    receipts: (topic) => buildTopicReceipts(topic),
    // Read-modify-write, so filing from the phone cannot clobber a display
    // title or any other setting the learner set at the desk.
    setFolder: async (topic, folder) => {
      const current = await getTopicSettings(topic);
      await setTopicSettings(topic, { ...current, folder });
    },
    host,
    // A fixed port so a paired phone keeps working across restarts. An
    // ephemeral port would force re-entry of the host every launch, which is
    // exactly the friction this service exists to remove.
    port: 8787
  });
  try {
    await server.start();
  } catch (err) {
    server = null;
    lastError = err instanceof Error ? err.message : String(err);
  }
  return linkStatus();
}
async function stopLinkServer() {
  await server?.stop();
  server = null;
}
async function linkStatus() {
  ensureStores();
  const exposed = boundHost !== "127.0.0.1";
  return {
    running: server !== null,
    port: server?.port ?? 0,
    lanUrl: exposed && server ? `http://${lanAddress() ?? "0.0.0.0"}:${server.port}` : null,
    exposed,
    devices: await pairing.list(),
    queued: (await outbox.pending()).length,
    error: lastError
  };
}
function registerLinkHandlers() {
  ipcMain.handle("link:status", () => linkStatus());
  ipcMain.handle("link:beginPairing", async () => {
    ensureStores();
    const offer = await pairing.beginPairing();
    const status = await linkStatus();
    return {
      code: offer.code,
      expiresAt: offer.expiresAt,
      // What the phone needs typed in. On loopback this is only reachable
      // from a simulator on this Mac, which is stated rather than implied.
      url: status.lanUrl ?? `http://127.0.0.1:${status.port}`,
      loopbackOnly: !status.exposed
    };
  });
  ipcMain.handle("link:expose", (_event, exposeToLan) => startLinkServer({ exposeToLan }));
  ipcMain.handle("link:settle", () => settleQueue());
  ipcMain.handle("link:revoke", async (_event, deviceId) => {
    ensureStores();
    await pairing.revoke(deviceId);
    return linkStatus();
  });
}
async function showPairingCode() {
  ensureStores();
  if (!server) await startLinkServer();
  const offer = await pairing.beginPairing();
  const status = await linkStatus();
  const address = status.lanUrl ?? `http://127.0.0.1:${status.port}`;
  const minutes = Math.max(1, Math.round((offer.expiresAt - Date.now()) / 6e4));
  const detail = status.exposed ? `On your phone, enter this host and code.

Host  ${address}
Code  ${offer.code}

The code is single-use and expires in about ${minutes} minute(s). This connection is NOT encrypted — only use it on a network you trust.` : `Host  ${address}
Code  ${offer.code}

The code is single-use and expires in about ${minutes} minute(s).

The link is currently loopback-only, so only this Mac can reach it — a simulator will connect, a real phone will not. Choose “Allow on this network” to expose it. There is no transport encryption yet, so only do that on a network you trust.`;
  const { response } = await dialog.showMessageBox({
    type: "info",
    message: "Link a phone",
    detail,
    buttons: status.exposed ? ["Done"] : ["Done", "Allow on this network"],
    defaultId: 0,
    cancelId: 0
  });
  if (!status.exposed && response === 1) {
    await startLinkServer({ exposeToLan: true });
    await showPairingCode();
  }
}
async function settleQueue() {
  ensureStores();
  return drainOutbox({
    outbox,
    batchDir: join(tmpdir(), "engram-mobile-batches"),
    startSession: async (message, kind, topic) => {
      const { sessionId } = await startSession(message, kind, void 0, topic);
      return sessionId;
    }
  });
}
function isReviewRateCommand(command) {
  return command.includes(" rate ") && command.includes("--rating") && !command.includes("--kind pretest");
}
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}
function buildPaceModel(samples) {
  const grouped = /* @__PURE__ */ new Map();
  for (const s of samples) {
    if (!Number.isFinite(s.seconds) || s.seconds <= 0) continue;
    const list = grouped.get(s.topic);
    if (list) list.push(s.seconds);
    else grouped.set(s.topic, [s.seconds]);
  }
  const byTopic = {};
  for (const [topic, xs] of grouped) {
    byTopic[topic] = { topic, medianSeconds: median(xs), samples: xs.length };
  }
  const all = [...grouped.values()].flat();
  return {
    byTopic,
    overallMedianSeconds: all.length > 0 ? median(all) : null,
    totalSamples: all.length
  };
}
const MAX_ITEM_SECONDS = 20 * 60;
const MIN_ITEM_SECONDS = 5;
const MAX_FILES = 120;
const TOPIC_FLAG = /--topic\s+["']?([a-z0-9][a-z0-9-]*)/;
function parseTs(v) {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}
function rateEventsIn(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    if (!raw) continue;
    let line;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    const at = parseTs(line.timestamp);
    if (at === null) continue;
    const content = line.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block;
      if (b.type !== "tool_use" || b.name !== "Bash") continue;
      const cmd = String(b.input?.command ?? "");
      if (!isReviewRateCommand(cmd)) continue;
      out.push({ at, topic: TOPIC_FLAG.exec(cmd)?.[1] ?? null });
    }
  }
  return out;
}
function samplesFromTranscript(text) {
  const events = rateEventsIn(text);
  if (events.length === 0) return [];
  const firstLine = text.slice(0, text.indexOf("\n") + 1 || void 0);
  let prev = null;
  try {
    prev = parseTs(JSON.parse(firstLine).timestamp);
  } catch {
    prev = null;
  }
  const out = [];
  for (const e of events) {
    if (prev !== null && e.topic) {
      const seconds = (e.at - prev) / 1e3;
      if (seconds >= MIN_ITEM_SECONDS && seconds <= MAX_ITEM_SECONDS) {
        out.push({ topic: e.topic, seconds });
      }
    }
    prev = e.at;
  }
  return out;
}
let cached = null;
const CACHE_MS = 60 * 60 * 1e3;
async function measurePace(now = Date.now()) {
  if (cached && now - cached.at < CACHE_MS) return cached.model;
  const model = await scan();
  cached = { model, at: now };
  return model;
}
async function scan() {
  const samples = [];
  try {
    const root = join(homedir(), ".claude", "projects");
    const dirs = await readdir(root, { withFileTypes: true });
    const files = [];
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const dir = join(root, d.name);
      let entries;
      try {
        entries = await readdir(dir);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (!name.endsWith(".jsonl")) continue;
        const path = join(dir, name);
        try {
          const s = await stat(path);
          files.push({ path, mtime: s.mtimeMs });
        } catch {
        }
      }
    }
    files.sort((a, b) => b.mtime - a.mtime);
    for (const f of files.slice(0, MAX_FILES)) {
      try {
        samples.push(...samplesFromTranscript(await readFile(f.path, "utf-8")));
      } catch {
      }
    }
  } catch {
  }
  return buildPaceModel(samples);
}
function buildDueArgs(opts) {
  const args = [];
  if (opts.limit != null) args.push("--limit", String(opts.limit));
  if (opts.topic) args.push("--topic", opts.topic);
  return args;
}
function buildDueCappedArgs(cap, topic) {
  const args = ["--cap", String(cap)];
  if (topic) args.push("--topic", topic);
  return args;
}
const GRAPHS_DIR = join(homedir(), ".claude", "learning", "graphs");
let cache = null;
async function computeSignature() {
  let names;
  try {
    names = (await readdir(GRAPHS_DIR)).filter((n) => n.endsWith(".json") && !n.endsWith(".bak"));
  } catch {
    return "";
  }
  const stats = await Promise.all(
    names.map(async (n) => {
      const s = await stat(join(GRAPHS_DIR, n));
      return `${n}:${s.mtimeMs}`;
    })
  );
  return stats.sort().join("|");
}
async function getTopicsCached() {
  const signature = await computeSignature();
  let topics;
  if (cache && cache.signature === signature) {
    topics = cache.topics;
  } else {
    topics = await engramRead("topics");
    cache = { signature, topics };
  }
  const [renames, folders] = await Promise.all([getDisplayTitles(), getTopicFolders()]);
  if (Object.keys(renames).length === 0 && Object.keys(folders).length === 0) return topics;
  return topics.map((t) => {
    const renamed = renames[t.topic] ? { ...t, engineTitle: t.title, title: renames[t.topic] } : t;
    return folders[t.topic] ? { ...renamed, folder: folders[t.topic] } : renamed;
  });
}
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v) {
  return typeof v === "string" ? v : null;
}
function parseThresholds(v) {
  if (typeof v !== "object" || v === null) return null;
  const r = v;
  const qwk_floor = num(r.qwk_floor);
  const qwk_target = num(r.qwk_target);
  const bias_max = num(r.bias_max);
  if (qwk_floor === null || qwk_target === null || bias_max === null) return null;
  return {
    qwk_floor,
    qwk_target,
    bias_max,
    min_n: num(r.min_n) ?? 0,
    min_runs: num(r.min_runs) ?? 0,
    paradox_retest: num(r.paradox_retest) ?? 0
  };
}
function parseAuditFile(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw;
  const ts = str(r.ts);
  const verdict = str(r.verdict);
  if (ts === null || verdict === null) return null;
  return {
    ts,
    verdict,
    qwk: num(r.qwk),
    n: num(r.n),
    runs: num(r.runs),
    thresholds: parseThresholds(r.thresholds),
    bias_note: str(r.bias_note)
  };
}
function auditSortKey(filename) {
  const stem = filename.endsWith(".json") ? filename.slice(0, -5) : filename;
  const i = stem.lastIndexOf("-");
  if (i < 0) return [stem, -1];
  const head = stem.slice(0, i);
  const tail = stem.slice(i + 1);
  const seq = Number(tail);
  return Number.isInteger(seq) ? [head, seq] : [stem, -1];
}
async function readGraderAuditHistory() {
  const home = await engramLearningHome();
  const dir = join(home, "audits");
  let names;
  try {
    names = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  names.sort((a, b) => {
    const [aHead, aSeq] = auditSortKey(a);
    const [bHead, bSeq] = auditSortKey(b);
    if (aHead !== bHead) return aHead < bHead ? -1 : 1;
    return aSeq - bSeq;
  });
  const parsed = await Promise.all(
    names.map(async (name) => {
      try {
        const raw = JSON.parse(await readFile(join(dir, name), "utf-8"));
        return parseAuditFile(raw);
      } catch {
        return null;
      }
    })
  );
  return parsed.filter((f) => f !== null).reverse();
}
const GRADE_OF_RATING = {
  again: "lapsed",
  hard: "partial",
  good: "recalled",
  easy: "recalled"
};
function asNumberOrNull(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const first = content.find((b) => b && typeof b === "object" && "text" in b);
    if (first && typeof first.text === "string") return first.text;
  }
  return null;
}
function toGradeResult(raw) {
  if (!raw || typeof raw !== "object") return null;
  const r = raw;
  const rating = r.rating;
  if (rating !== "again" && rating !== "hard" && rating !== "good" && rating !== "easy") return null;
  if (typeof r.node !== "string") return null;
  return {
    node: r.node,
    rating,
    grade: GRADE_OF_RATING[rating],
    state: typeof r.state === "string" ? r.state : null,
    sBefore: asNumberOrNull(r.s_before),
    sAfter: asNumberOrNull(r.s_after),
    intervalDays: asNumberOrNull(r.interval_days),
    daysSinceEncode: asNumberOrNull(r.days_since_encode)
  };
}
function extractFirstJson(text, open) {
  const close = open === "[" ? "]" : "}";
  const start = text.indexOf(open);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open || ch === (open === "[" ? "{" : "[")) depth++;
    else if (ch === close || ch === (open === "[" ? "}" : "]")) {
      depth--;
      if (depth === 0 && text[i] === close) return text.slice(start, i + 1);
    }
  }
  return null;
}
function parseLoose(text, open) {
  try {
    return JSON.parse(text);
  } catch {
    const slice = extractFirstJson(text, open);
    if (slice == null) return null;
    try {
      return JSON.parse(slice);
    } catch {
      return null;
    }
  }
}
function parseGradeResult(content) {
  const text = contentToText(content);
  if (!text) return null;
  return toGradeResult(parseLoose(text, "{"));
}
function parseGradeResults(content) {
  const text = contentToText(content);
  if (!text) return [];
  const parsed = parseLoose(text, "[");
  if (!Array.isArray(parsed)) return [];
  return parsed.map(toGradeResult).filter((r) => r !== null);
}
const CACHE_FILE = "session-scan-cache.json";
const MAX_SWEEP_FILE_BYTES = 25 * 1024 * 1024;
function cachePath() {
  return join(app.getPath("userData"), CACHE_FILE);
}
async function readCache$1() {
  try {
    return JSON.parse(await readFile(cachePath(), "utf-8"));
  } catch {
    return {};
  }
}
async function writeCache$1(cache2) {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(cachePath(), JSON.stringify(cache2), "utf-8");
}
function looksLikeReceiptCall(input) {
  const command = String(input.command ?? "");
  return command.includes("receipt") && command.includes("--file");
}
function looksLikePretestRate(input) {
  const command = String(input.command ?? "");
  if (!command.includes(" rate ") || !command.includes("--kind pretest")) return null;
  const m = command.match(/--node\s+"?([^"\s]+)"?/);
  return m ? m[1] : null;
}
function looksLikeRateCall(input) {
  const command = String(input.command ?? "");
  return command.includes(" rate ") && command.includes("--rating");
}
function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dateOf(entry) {
  const ts = typeof entry.timestamp === "string" ? entry.timestamp : "";
  const parsed = ts ? new Date(ts) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? localDate(parsed) : localDate(/* @__PURE__ */ new Date());
}
function contentBlocks(entry) {
  if (!entry || typeof entry !== "object") return [];
  const message = entry.message;
  const content = message && Array.isArray(message.content) ? message.content : [];
  return content.filter((b) => !!b && typeof b === "object");
}
function scanTranscriptEntries(lines, sittingKind) {
  const events = [];
  const pending = /* @__PURE__ */ new Map();
  for (let i = 0; i < lines.length; i++) {
    const entry = lines[i];
    if (!entry || typeof entry !== "object") continue;
    if (entry.type === "assistant") {
      for (const block of contentBlocks(entry)) {
        if (block.type !== "tool_use" || block.name !== "Bash") continue;
        const toolUseId = typeof block.id === "string" ? block.id : null;
        if (!toolUseId) continue;
        const input = block.input ?? {};
        if (sittingKind === "learn" || sittingKind === "sweep") {
          if (looksLikeReceiptCall(input)) {
            pending.set(toolUseId, { kind: "encode" });
            continue;
          }
          if (looksLikePretestRate(input)) {
            pending.set(toolUseId, { kind: "pretest" });
            continue;
          }
        }
        if ((sittingKind === "review" || sittingKind === "sweep") && looksLikeRateCall(input)) {
          pending.set(toolUseId, { kind: "review" });
        }
      }
      continue;
    }
    if (entry.type === "user") {
      for (const block of contentBlocks(entry)) {
        if (block.type !== "tool_result") continue;
        const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : null;
        if (!toolUseId) continue;
        const match = pending.get(toolUseId);
        if (!match) continue;
        pending.delete(toolUseId);
        const date = dateOf(entry);
        if (match.kind === "encode") {
          for (const r of parseGradeResults(block.content)) {
            events.push({ node: r.node, date, anchor: i, kind: "encode", grade: r.grade });
          }
        } else {
          const r = parseGradeResult(block.content);
          if (r) events.push({ node: r.node, date, anchor: i, kind: match.kind, grade: r.grade });
        }
      }
    }
  }
  return events;
}
async function scanOne(path, sessionId, sittingKind, cache2, maxBytes) {
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch {
    return null;
  }
  if (maxBytes != null && fileStat.size > maxBytes) return null;
  const cached2 = cache2[path];
  if (cached2 && cached2.mtimeMs === fileStat.mtimeMs) {
    return { events: cached2.events, dirty: false };
  }
  const lines = await readTranscriptFile(path);
  const events = scanTranscriptEntries(lines, sittingKind).map((e) => ({ ...e, sessionId }));
  cache2[path] = { mtimeMs: fileStat.mtimeMs, events };
  return { events, dirty: true };
}
async function allSweepTranscripts() {
  const out = [];
  try {
    const dirs = await readdir(projectsRoot(), { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const dirPath = join(projectsRoot(), dir.name);
      let files;
      try {
        files = await readdir(dirPath);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue;
        out.push({ path: join(dirPath, f), sessionId: f.slice(0, -".jsonl".length) });
      }
    }
  } catch {
  }
  return out;
}
async function nodeProvenance(topic, nodeIds) {
  const nodeIdSet = new Set(nodeIds);
  const cache2 = await readCache$1();
  let cacheDirty = false;
  const learnSittings = await sessionHistoryFor(topic);
  const legacyLearnSittings = await sessionHistoryFor("learn");
  const reviewSittings = await sessionHistoryFor("review");
  const seenSessionIds = /* @__PURE__ */ new Set();
  const jobs = [];
  for (const s of learnSittings) {
    if (seenSessionIds.has(s.sessionId)) continue;
    seenSessionIds.add(s.sessionId);
    jobs.push({ sessionId: s.sessionId, sittingKind: "learn" });
  }
  for (const s of legacyLearnSittings) {
    if (seenSessionIds.has(s.sessionId)) continue;
    seenSessionIds.add(s.sessionId);
    jobs.push({ sessionId: s.sessionId, sittingKind: "learn" });
  }
  for (const s of reviewSittings) {
    if (seenSessionIds.has(s.sessionId)) continue;
    seenSessionIds.add(s.sessionId);
    jobs.push({ sessionId: s.sessionId, sittingKind: "review" });
  }
  const allEvents = [];
  for (const job of jobs) {
    const res = await scanOne(transcriptPath(job.sessionId), job.sessionId, job.sittingKind, cache2, null);
    if (!res) continue;
    if (res.dirty) cacheDirty = true;
    allEvents.push(...res.events);
  }
  for (const t of await allSweepTranscripts()) {
    if (seenSessionIds.has(t.sessionId)) continue;
    seenSessionIds.add(t.sessionId);
    const res = await scanOne(t.path, t.sessionId, "sweep", cache2, MAX_SWEEP_FILE_BYTES);
    if (!res) continue;
    if (res.dirty) cacheDirty = true;
    allEvents.push(...res.events);
  }
  for (const path of Object.keys(cache2)) {
    if (!existsSync(path)) {
      delete cache2[path];
      cacheDirty = true;
    }
  }
  if (cacheDirty) await writeCache$1(cache2);
  const result = {};
  const encodeCandidatesByNode = /* @__PURE__ */ new Map();
  for (const id of nodeIdSet) result[id] = { firstEncoded: null, reviews: [] };
  for (const e of allEvents) {
    if (!nodeIdSet.has(e.node)) continue;
    const prov = result[e.node];
    const event = { sessionId: e.sessionId, date: e.date, anchor: e.anchor, kind: e.kind, grade: e.grade };
    if (e.kind === "review") {
      prov.reviews.push(event);
    } else {
      const candidates = encodeCandidatesByNode.get(e.node) ?? [];
      candidates.push(event);
      encodeCandidatesByNode.set(e.node, candidates);
    }
  }
  for (const [node, candidates] of encodeCandidatesByNode) {
    candidates.sort((a, b) => a.date.localeCompare(b.date));
    result[node].firstEncoded = candidates[0];
  }
  for (const prov of Object.values(result)) {
    prov.reviews.sort((a, b) => b.date.localeCompare(a.date) || b.anchor - a.anchor);
  }
  return result;
}
function empty() {
  return { version: 1, resolves: [] };
}
function storePath$1() {
  return join(app.getPath("userData"), "misconception-resolves.json");
}
async function read$2() {
  try {
    const parsed = JSON.parse(await readFile(storePath$1(), "utf-8"));
    if (parsed && parsed.version === 1 && Array.isArray(parsed.resolves)) return parsed;
    return empty();
  } catch {
    return empty();
  }
}
async function write$2(store) {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(storePath$1(), JSON.stringify(store, null, 2), "utf-8");
}
function localToday() {
  const d = /* @__PURE__ */ new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
async function recordManualResolve(id) {
  const store = await read$2();
  if (store.resolves.some((r) => r.id === id)) return;
  store.resolves.push({ id, resolvedVia: "manual", date: localToday() });
  await write$2(store);
}
async function getManualResolves() {
  const store = await read$2();
  const out = {};
  for (const r of store.resolves) out[r.id] = { date: r.date };
  return out;
}
function learningHome() {
  return process.env.ENGRAM_HOME ?? join(homedir(), ".claude", "learning");
}
async function moveTopicToTrash(topic, hasLiveSessions2) {
  if (!/^[a-z0-9-]+$/.test(topic)) {
    throw new Error(`moveTopicToTrash: malformed topic "${topic}"`);
  }
  if (hasLiveSessions2()) {
    throw new Error("moveTopicToTrash: refused while a session is live — end the sitting first");
  }
  const home = learningHome();
  const graphPath = join(home, "graphs", `${topic}.json`);
  if (!existsSync(graphPath)) {
    throw new Error(`moveTopicToTrash: no graph for topic "${topic}" — nothing to delete`);
  }
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const destRoot = join(app.getPath("userData"), "topic-trash", `${topic}-${stamp}`);
  await mkdir(destRoot, { recursive: true });
  const moved = [];
  for (const rel of [`graphs/${topic}.json`, `receipts/${topic}.jsonl`]) {
    const src = join(home, rel);
    if (!existsSync(src)) continue;
    await rename(src, join(destRoot, rel.replace("/", "__")));
    moved.push(rel);
  }
  return { trashedTo: destRoot, moved };
}
function isMisconception(row) {
  if (typeof row !== "object" || row === null) return false;
  const r = row;
  return typeof r.id === "string" && typeof r.ts === "string" && typeof r.topic === "string" && typeof r.node === "string" && typeof r.description === "string" && (r.status === "open" || r.status === "resolved") && // resolved_ts: optional (open rows never carry it); a non-string value
  // is hand-edit damage and drops the row, same discipline as above.
  (r.resolved_ts === void 0 || typeof r.resolved_ts === "string");
}
function isActiveExperiment(row) {
  if (typeof row !== "object" || row === null) return false;
  const r = row;
  return r.status === "active" && typeof r.id === "string" && typeof r.question === "string" && typeof r.started === "string" && typeof r.metric === "string" && Array.isArray(r.arms) && r.arms.every((a) => typeof a === "string");
}
async function artifactListWithMtime() {
  const raw = await engramArtifactList();
  return Promise.all(
    raw.map(async (e) => {
      let mtimeMs = null;
      try {
        mtimeMs = (await stat(e.artifact)).mtimeMs;
      } catch {
      }
      return { ...e, mtimeMs };
    })
  );
}
function registerReadHandlers() {
  ipcMain.handle("engram:topics", () => getTopicsCached());
  ipcMain.handle("engram:stats", () => engramRead("stats"));
  ipcMain.handle("engram:pendingProductions", () => engramRead("stash", ["count"]));
  ipcMain.handle("engram:sittingPace", () => measurePace());
  ipcMain.handle("engram:due", (_e, limit, topic) => engramRead("due", buildDueArgs({ limit, topic })));
  ipcMain.handle("engram:dueCapped", (_e, cap, topic) => engramRead("due", buildDueCappedArgs(cap, topic)));
  ipcMain.handle("engram:decay", (_e, topic, horizon) => {
    const args = [];
    if (topic) args.push("--topic", topic);
    if (horizon != null) args.push("--horizon", String(horizon));
    return engramRead("decay", args);
  });
  ipcMain.handle("engram:next", (_e, topic) => engramRead("next", ["--topic", topic]));
  ipcMain.handle("engram:doctor", () => engramRead("doctor"));
  ipcMain.handle("engram:model", () => engramRead("model"));
  ipcMain.handle("engram:graderHealth", () => engramRead("grader-health"));
  ipcMain.handle("engram:graderAuditHistory", () => readGraderAuditHistory());
  ipcMain.handle("engram:topicStatusText", (_e, topic) => engramTopicStatusText(topic));
  ipcMain.handle("engram:topicGraph", async (_e, topic) => {
    const graph = await readTopicGraph(topic);
    const rename2 = (await getDisplayTitles())[topic];
    return rename2 ? { ...graph, title: rename2 } : graph;
  });
  ipcMain.handle("engram:artifactList", () => artifactListWithMtime());
  ipcMain.handle("engram:receiptsHistory", () => readReceiptsHistory());
  ipcMain.handle("engram:misconceptions", async () => {
    const rows = await engramRead("misconception", ["list"]);
    return Array.isArray(rows) ? rows.filter(isMisconception) : [];
  });
  ipcMain.handle("engram:activeExperiment", async () => {
    const rows = await engramRead("experiment", ["list"]);
    return (Array.isArray(rows) ? rows.find(isActiveExperiment) : void 0) ?? null;
  });
  ipcMain.handle("mapAnnotations:get", (_e, topicId) => getMapAnnotations(topicId));
  ipcMain.handle("engram:nodeProvenance", async (_e, topic) => {
    const graph = await readTopicGraph(topic);
    return nodeProvenance(topic, Object.keys(graph.nodes));
  });
  ipcMain.handle(
    "engram:visuals",
    (_e, mode) => engramDirectMutate("visuals", [mode])
  );
  ipcMain.handle(
    "engram:focus",
    (_e, mode) => engramDirectMutate("focus", [mode])
  );
  ipcMain.handle(
    "engram:modelSet",
    (_e, path, value) => engramDirectMutate("model", ["--set", `${path}=${value}`])
  );
  ipcMain.handle(
    "engram:modelAddInterest",
    (_e, interest) => engramDirectMutate("model", ["--add-interest", interest])
  );
  ipcMain.handle(
    "engram:commit",
    (_e, cue, action) => engramDirectMutate("commit", ["--cue", cue, "--action", action])
  );
  ipcMain.handle("engram:misconceptionResolve", async (_e, id) => {
    if (!/^m_[A-Za-z0-9_]+$/.test(id)) throw new Error(`misconceptionResolve: malformed id "${id}"`);
    const result = await engramDirectMutate("misconception", ["resolve", "--id", id]);
    await recordManualResolve(id);
    return result;
  });
  ipcMain.handle("engram:misconceptionManualResolves", () => getManualResolves());
  ipcMain.handle("engram:retireTopic", (_e, topic, restore) => {
    if (!/^[a-z0-9-]+$/.test(topic)) throw new Error(`retireTopic: malformed topic "${topic}"`);
    return engramDirectMutate("retire", restore ? ["--topic", topic, "--restore"] : ["--topic", topic]);
  });
  ipcMain.handle("engram:deleteTopic", (_e, topic) => moveTopicToTrash(topic, hasLiveSessions));
}
const allowedRoots = /* @__PURE__ */ new Set();
function registerExplorableRoot(absolutePath) {
  allowedRoots.add(dirname(resolve(absolutePath)));
}
async function resolveExplorablePath(rawPath) {
  const home = await engramLearningHome();
  const absolute = isAbsolute(rawPath) ? rawPath : join(home, rawPath);
  try {
    const st = await stat(absolute);
    if (!st.isFile()) return null;
  } catch {
    return null;
  }
  return absolute;
}
function registerExplorableSchemePrivileges() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "explorable",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        stream: true
      }
    }
  ]);
}
function installExplorableProtocolHandler() {
  protocol.handle("explorable", async (request) => {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }
    let requestedPath;
    try {
      requestedPath = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const resolved = resolve(requestedPath);
    const declaredRoot = dirname(resolved);
    if (!allowedRoots.has(declaredRoot)) {
      return new Response("Not found", { status: 404 });
    }
    let realFile;
    let realRoot;
    try {
      ;
      [realFile, realRoot] = await Promise.all([realpath(resolved), realpath(declaredRoot)]);
    } catch {
      return new Response("Not found", { status: 404 });
    }
    if (dirname(realFile) !== realRoot) {
      return new Response("Not found", { status: 404 });
    }
    try {
      const st = await stat(realFile);
      if (!st.isFile()) return new Response("Not found", { status: 404 });
    } catch {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(realFile).toString());
  });
}
const DEFAULTS$1 = {
  remindersEnabled: true,
  cadenceMinutes: 30,
  dockBadgeEnabled: true,
  lastNotifiedAt: null,
  lastSignature: null
};
function statePath$1() {
  return join(app.getPath("userData"), "notifier-state.json");
}
async function read$1() {
  try {
    return { ...DEFAULTS$1, ...JSON.parse(await readFile(statePath$1(), "utf-8")) };
  } catch {
    return { ...DEFAULTS$1 };
  }
}
async function write$1(state) {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(statePath$1(), JSON.stringify(state, null, 2), "utf-8");
}
async function getNotifierSettings() {
  const { remindersEnabled, cadenceMinutes, dockBadgeEnabled } = await read$1();
  return { remindersEnabled, cadenceMinutes, dockBadgeEnabled };
}
async function setNotifierSettings(patch) {
  const state = await read$1();
  const next = { ...state, ...patch };
  await write$1(next);
  return { remindersEnabled: next.remindersEnabled, cadenceMinutes: next.cadenceMinutes, dockBadgeEnabled: next.dockBadgeEnabled };
}
async function getNotifiedSignature() {
  const { lastNotifiedAt, lastSignature } = await read$1();
  return { lastNotifiedAt, lastSignature };
}
async function recordNotified(signature) {
  const state = await read$1();
  await write$1({ ...state, lastNotifiedAt: (/* @__PURE__ */ new Date()).toISOString(), lastSignature: signature });
}
function storePath() {
  return join(app.getPath("userData"), "achievements.json");
}
async function read() {
  try {
    return JSON.parse(await readFile(storePath(), "utf-8"));
  } catch {
    return [];
  }
}
async function write(unlocked) {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(storePath(), JSON.stringify(unlocked, null, 2), "utf-8");
}
async function getUnlockedAchievements() {
  return read();
}
async function recordUnlocked(ids) {
  const current = await read();
  const known = new Set(current.map((a) => a.id));
  const additions = ids.filter((id) => !known.has(id)).map((id) => ({ id, unlockedAt: (/* @__PURE__ */ new Date()).toISOString() }));
  if (additions.length === 0) return current;
  const next = [...current, ...additions];
  await write(next);
  return next;
}
const CHECK_INTERVAL_MS = 5 * 6e4;
let timer = null;
async function currentDue() {
  return engramRead("due", ["--limit", "50"]);
}
function updateBadge(settings, dueCount) {
  app.setBadgeCount(settings.dockBadgeEnabled ? dueCount : 0);
}
async function checkAndMaybeNotify(onClick, onDueCount) {
  const settings = await getNotifierSettings();
  const due = await currentDue().catch(() => []);
  updateBadge(settings, due.length);
  onDueCount?.(due.length);
  if (!settings.remindersEnabled) return;
  if (due.length === 0) return;
  const signature = due.map((d) => `${d.topic}:${d.id}`).sort().join(",");
  const { lastNotifiedAt, lastSignature } = await getNotifiedSignature();
  const elapsedMs = lastNotifiedAt ? Date.now() - new Date(lastNotifiedAt).getTime() : Infinity;
  if (signature === lastSignature && elapsedMs < settings.cadenceMinutes * 6e4) return;
  fireNotification(due.length, onClick);
  await recordNotified(signature);
}
function fireNotification(count, onClick) {
  const n = new Notification({
    title: count === 1 ? "1 review due" : `${count} reviews due`,
    body: "Engram Desktop — clear them in a couple of minutes.",
    actions: [{ type: "button", text: "Review now" }]
  });
  n.on("click", onClick);
  n.on("action", onClick);
  n.show();
}
function startReviewNotifier(onClick, onDueCount) {
  if (timer) return;
  checkAndMaybeNotify(onClick, onDueCount);
  timer = setInterval(() => checkAndMaybeNotify(onClick, onDueCount), CHECK_INTERVAL_MS);
}
function stopReviewNotifier() {
  if (timer) clearInterval(timer);
  timer = null;
}
async function checkReviewsNow(onClick, onDueCount) {
  const settings = await getNotifierSettings();
  const due = await currentDue().catch(() => []);
  updateBadge(settings, due.length);
  onDueCount?.(due.length);
  if (due.length > 0) {
    fireNotification(due.length, onClick);
    const signature = due.map((d) => `${d.topic}:${d.id}`).sort().join(",");
    await recordNotified(signature);
  }
  return { dueCount: due.length };
}
async function refreshDueCount(onDueCount) {
  const settings = await getNotifierSettings();
  const due = await currentDue().catch(() => []);
  updateBadge(settings, due.length);
  onDueCount?.(due.length);
  return { dueCount: due.length };
}
const execFileAsync$1 = promisify(execFile);
const REPO = "nullgeodesic0/engram-desktop";
const GH_TIMEOUT_MS = 1e4;
function statePath() {
  return join(app.getPath("userData"), "update-state.json");
}
async function readCache() {
  try {
    const raw = JSON.parse(await readFile(statePath(), "utf-8"));
    if (!raw?.result || !raw?.checkedAt) return null;
    return raw;
  } catch {
    return null;
  }
}
async function writeCache(state) {
  try {
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(statePath(), JSON.stringify(state, null, 2), "utf-8");
  } catch {
  }
}
function isSameLocalDay(isoA, isoB) {
  const a = new Date(isoA);
  const b = new Date(isoB);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
async function getCachedUpdateCheck() {
  const cache2 = await readCache();
  return cache2?.result ?? null;
}
async function checkedToday() {
  const cache2 = await readCache();
  return cache2 != null && isSameLocalDay(cache2.checkedAt, (/* @__PURE__ */ new Date()).toISOString());
}
function reasonForError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/ENOENT/.test(msg)) return "the gh CLI isn’t installed";
  if (/timed out|ETIMEDOUT/i.test(msg)) return "the check timed out";
  if (/not logged into any|authentication|HTTP 401|HTTP 403|gh auth login/i.test(msg))
    return "gh isn’t signed in to GitHub";
  if (/HTTP 404/.test(msg)) return "couldn’t reach the repo (check gh auth/access)";
  if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|network/i.test(msg)) return "no network connection";
  return "couldn’t reach GitHub";
}
async function checkForUpdate() {
  const checkedAt = (/* @__PURE__ */ new Date()).toISOString();
  const buildCommit = "4ae2035";
  const buildDate = "2026-08-10T01:09:59-04:00";
  try {
    const { stdout } = await execFileAsync$1(
      "gh",
      ["api", `repos/${REPO}/commits/main`, "--jq", "{sha:.sha,date:.commit.committer.date}"],
      { timeout: GH_TIMEOUT_MS }
    );
    const parsed = JSON.parse(stdout.trim());
    if (!parsed?.sha) throw new Error("malformed gh output");
    const remoteCommit = parsed.sha.slice(0, 7);
    const remoteDate = parsed.date;
    const state = parsed.sha.toLowerCase().startsWith(buildCommit.toLowerCase()) ? "current" : "behind";
    const result = { state, buildCommit, buildDate, remoteCommit, remoteDate, checkedAt };
    await writeCache({ result, checkedAt });
    return result;
  } catch (err) {
    const result = {
      state: "unknown",
      buildCommit,
      buildDate,
      checkedAt,
      reason: reasonForError(err)
    };
    await writeCache({ result, checkedAt });
    return result;
  }
}
async function maybeAutoCheckForUpdate() {
  try {
    if (await checkedToday()) return;
    await checkForUpdate();
  } catch {
  }
}
const FILE = () => join(app.getPath("userData"), "window-state.json");
const DEFAULTS = { width: 1280, height: 840 };
function restoreWindowState() {
  try {
    const saved = JSON.parse(readFileSync(FILE(), "utf-8"));
    const area = screen.getDisplayMatching(saved).workArea;
    const width = Math.min(saved.width, area.width);
    const height = Math.min(saved.height, area.height);
    const x = Math.min(Math.max(saved.x, area.x), area.x + area.width - width);
    const y = Math.min(Math.max(saved.y, area.y), area.y + area.height - height);
    return { x, y, width, height };
  } catch {
    return { ...DEFAULTS };
  }
}
function trackWindowState(win) {
  let timer2 = null;
  const save = () => {
    if (win.isDestroyed() || win.isFullScreen()) return;
    try {
      writeFileSync(FILE(), JSON.stringify(win.getNormalBounds()));
    } catch {
    }
  };
  const debounced = () => {
    if (timer2) clearTimeout(timer2);
    timer2 = setTimeout(save, 500);
  };
  win.on("move", debounced);
  win.on("resize", debounced);
  win.on("close", save);
}
function installAppMenu(focusOrCreateWindow2) {
  const isDev = !app.isPackaged;
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Settings…", accelerator: "Cmd+,", click: () => focusOrCreateWindow2("settings") },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    // Without an Edit menu, macOS has no route for the standard clipboard
    // accelerators — ⌘C/⌘V/⌘X/⌘A silently die in every text field.
    { role: "editMenu" },
    {
      label: "Session",
      submenu: [
        { label: "New Topic", accelerator: "Cmd+N", click: () => focusOrCreateWindow2("learn:new-topic") },
        { label: "Resume Last Learn", accelerator: "Cmd+L", click: () => focusOrCreateWindow2("learn") },
        { label: "Review Now", accelerator: "Shift+Cmd+R", click: () => focusOrCreateWindow2("review") },
        { type: "separator" },
        { label: "Session History…", accelerator: "Shift+Cmd+H", click: () => focusOrCreateWindow2("history:all") },
        { type: "separator" },
        // The link server is already listening — a paired phone needs nothing
        // from this menu. This is only for admitting a NEW device, which is
        // why it opens a short-lived code rather than living in Settings as a
        // toggle: pairing is an event, not a state.
        { label: "Link a Phone…", click: () => void showPairingCode() }
      ]
    },
    {
      label: "View",
      submenu: [
        { label: "Home", accelerator: "Cmd+0", click: () => focusOrCreateWindow2("home") },
        { label: "Learn", accelerator: "Cmd+1", click: () => focusOrCreateWindow2("learn") },
        { label: "Review", accelerator: "Cmd+2", click: () => focusOrCreateWindow2("review") },
        { label: "Topic Map", accelerator: "Cmd+3", click: () => focusOrCreateWindow2("topics") },
        { label: "Coach", accelerator: "Cmd+4", click: () => focusOrCreateWindow2("dashboard") },
        { label: "Artifacts", accelerator: "Cmd+5", click: () => focusOrCreateWindow2("artifacts") },
        { label: "Grades", accelerator: "Cmd+7", click: () => focusOrCreateWindow2("grades") },
        { type: "separator" },
        ...isDev ? [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }] : [],
        { role: "togglefullscreen" }
      ]
    },
    { role: "windowMenu" },
    {
      label: "Help",
      submenu: [{ label: "Keyboard Shortcuts && Glossary", click: () => focusOrCreateWindow2("help") }]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
const MAX_ENTRIES = 200;
function logPath() {
  return join(app.getPath("userData"), "crash-log.jsonl");
}
function readEntries() {
  try {
    const raw = readFileSync(logPath(), "utf-8");
    return raw.split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
function logCrash(source, err) {
  try {
    const dir = app.getPath("userData");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const entry = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      source,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : void 0
    };
    appendFileSync(logPath(), JSON.stringify(entry) + "\n", "utf-8");
    const entries = readEntries();
    if (entries.length > MAX_ENTRIES) {
      writeFileSync(logPath(), entries.slice(-MAX_ENTRIES).map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
    }
  } catch {
  }
}
function getCrashLog() {
  return readEntries().reverse();
}
function installGlobalErrorHandlers() {
  process.on("uncaughtException", (err) => {
    logCrash("uncaughtException", err);
    console.error("[engram-desktop] uncaught exception, exiting:", err);
    app.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    logCrash("unhandledRejection", reason);
    console.error("[engram-desktop] unhandled rejection:", reason);
  });
}
const MAX_GOAL_LEN = 2e3;
const MAX_INSTRUCTIONS_LEN = 4e3;
const MAX_CONTEXT_FILES = 8;
const DEADLINE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const ALLOWED_CONTEXT_EXTENSIONS = /* @__PURE__ */ new Set([".pdf", ".md", ".txt"]);
const HOSTILE_CONTROL_CHARS_RE = /[\x00-\x08\x0B-\x1F\x7F]/g;
const ZERO_WIDTH_AND_BIDI_RE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;
const HOSTILE_HORIZONTAL_SPACE_RUN_RE = /[^\S\n]{8,}/g;
function normalizeHostileWhitespace(s) {
  return s.replace(ZERO_WIDTH_AND_BIDI_RE, "").replace(HOSTILE_CONTROL_CHARS_RE, "").replace(HOSTILE_HORIZONTAL_SPACE_RUN_RE, " ").replace(/\n{3,}/g, "\n\n").trim();
}
function deadlineNote(deadline) {
  return `I need this understood by ${deadline} — pace the curriculum accordingly.`;
}
function parseEngramDeepLink(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { error: `not a valid URL: ${url}` };
  }
  if (parsed.protocol !== "engram:") {
    return { error: `wrong scheme: ${parsed.protocol}` };
  }
  if (parsed.hostname.toLowerCase() !== "new-topic") {
    return { error: `wrong host: ${parsed.hostname}` };
  }
  const payload = parsed.searchParams.get("payload");
  if (!payload) {
    return { error: "missing payload parameter" };
  }
  if (!BASE64URL_RE.test(payload)) {
    return { error: "payload is not valid base64url" };
  }
  let decoded;
  try {
    const json = Buffer.from(payload, "base64url").toString("utf-8");
    decoded = JSON.parse(json);
  } catch {
    return { error: "payload does not decode to valid JSON" };
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    return { error: "payload is not a JSON object" };
  }
  const p = decoded;
  if (p.v !== 1) {
    return { error: `unsupported payload version: ${JSON.stringify(p.v)}` };
  }
  if (typeof p.goal !== "string" || p.goal.length > MAX_GOAL_LEN) {
    return { error: `goal must be a string of at most ${MAX_GOAL_LEN} characters` };
  }
  const goal = normalizeHostileWhitespace(p.goal);
  if (goal.length === 0) {
    return { error: "goal must not be empty (after removing control characters)" };
  }
  let contextFiles = [];
  if (p.contextFiles !== void 0) {
    if (!Array.isArray(p.contextFiles) || p.contextFiles.length > MAX_CONTEXT_FILES || p.contextFiles.some((f) => typeof f !== "string")) {
      return { error: `contextFiles must be an array of at most ${MAX_CONTEXT_FILES} strings` };
    }
    contextFiles = p.contextFiles;
  }
  let instructions = "";
  if (p.instructions !== void 0) {
    if (typeof p.instructions !== "string" || p.instructions.length > MAX_INSTRUCTIONS_LEN) {
      return { error: `instructions must be a string of at most ${MAX_INSTRUCTIONS_LEN} characters` };
    }
    instructions = normalizeHostileWhitespace(p.instructions);
  }
  if (p.deadline !== void 0) {
    if (typeof p.deadline !== "string" || !DEADLINE_RE.test(p.deadline)) {
      return { error: "deadline must be a YYYY-MM-DD string" };
    }
    const note = deadlineNote(p.deadline);
    if (!instructions.includes(note)) {
      instructions = instructions.length > 0 ? `${instructions} ${note}` : note;
    }
  }
  return { goal, instructions, contextFiles };
}
function validateContextFiles(paths) {
  return paths.filter((p) => {
    if (!isAbsolute(p)) return false;
    if (normalize(p) !== p) return false;
    if (!ALLOWED_CONTEXT_EXTENSIONS.has(extname(p).toLowerCase())) return false;
    try {
      return existsSync(p) && lstatSync(p).isFile();
    } catch {
      return false;
    }
  });
}
function buildNewTopicPrefill(url) {
  const parsed = parseEngramDeepLink(url);
  if ("error" in parsed) return parsed;
  const validated = validateContextFiles(parsed.contextFiles);
  return {
    goal: parsed.goal,
    instructions: parsed.instructions,
    contextFiles: validated,
    droppedContextFileCount: parsed.contextFiles.length - validated.length
  };
}
function createDeepLinkQueue() {
  let pending = null;
  return {
    handle(url, isReady) {
      if (!isReady()) {
        pending = url;
        return null;
      }
      return url;
    },
    drain() {
      const url = pending;
      pending = null;
      return url;
    }
  };
}
const execFileAsync = promisify(execFile);
installGlobalErrorHandlers();
app.setName("Engram Desktop");
registerExplorableSchemePrivileges();
app.setAsDefaultProtocolClient("engram");
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const deepLink = argv.find((a) => a.toLowerCase().startsWith("engram://"));
    if (deepLink) handleDeepLink(deepLink);
    focusOrCreateWindow();
  });
}
async function checkEnvironment() {
  const result = { pluginOk: false, claudeOk: false };
  try {
    const plugin = resolveEngramPlugin();
    result.pluginOk = true;
    result.pluginVersion = plugin.version;
  } catch (err) {
    result.pluginError = err instanceof Error ? err.message : String(err);
  }
  try {
    const claudeBin = await resolveClaudeBinary();
    await execFileAsync(claudeBin, ["--version"], { timeout: 8e3 });
    result.claudeOk = true;
    result.claudePath = claudeBin;
  } catch (err) {
    result.claudeError = err instanceof Error ? err.message : String(err);
  }
  return result;
}
let mainWindow = null;
let tray = null;
const deepLinkQueue = createDeepLinkQueue();
function resourcePath(name) {
  return app.isPackaged ? join(process.resourcesPath, name) : join(__dirname, "../../resources", name);
}
function sendNav(view) {
  mainWindow?.webContents.send("app:navigate", view);
}
function sendDueCount(count) {
  mainWindow?.webContents.send("engram:due-count", count);
}
function focusOrCreateWindow(navigateTo) {
  if (mainWindow) {
    const win2 = mainWindow;
    if (win2.isMinimized()) win2.restore();
    win2.show();
    win2.focus();
    if (navigateTo) {
      if (win2.webContents.isLoading()) {
        win2.webContents.once("did-finish-load", () => sendNav(navigateTo));
      } else {
        sendNav(navigateTo);
      }
    }
    return;
  }
  const win = createWindow();
  rebindWindow(win);
  if (navigateTo) win.webContents.once("did-finish-load", () => sendNav(navigateTo));
}
function deliverDeepLink(url) {
  const prefill = buildNewTopicPrefill(url);
  if ("error" in prefill) {
    console.log("[engram-desktop] ignoring engram:// deep link —", prefill.error);
    return;
  }
  focusOrCreateWindow("learn");
  const win = mainWindow;
  if (!win) return;
  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", () => win.webContents.send("app:new-topic-prefill", prefill));
  } else {
    win.webContents.send("app:new-topic-prefill", prefill);
  }
}
function handleDeepLink(url) {
  const ready = deepLinkQueue.handle(url, () => app.isReady());
  if (ready !== null) deliverDeepLink(ready);
}
function createTray() {
  const icon = nativeImage.createFromPath(resourcePath("trayTemplate.png"));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Engram Desktop");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open", click: () => focusOrCreateWindow() },
      { label: "Check reviews now", click: () => checkReviewsNow(() => focusOrCreateWindow("review")) },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() }
    ])
  );
  tray.on("click", () => focusOrCreateWindow());
}
function createWindow() {
  const win = new BrowserWindow({
    ...restoreWindowState(),
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow = win;
  trackWindowState(win);
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.on("enter-full-screen", () => win.webContents.send("window:fullscreen", true));
  win.on("leave-full-screen", () => win.webContents.send("window:fullscreen", false));
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return win;
}
app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  app.setAboutPanelOptions({
    applicationName: "Engram Desktop",
    applicationVersion: app.getVersion(),
    credits: `First-principles learning, verified by free recall.
Built on the engram learning plugin (nagisanzenin).
© ${(/* @__PURE__ */ new Date()).getFullYear()} Tyler Hadsell.`
  });
  installAppMenu(focusOrCreateWindow);
  checkEnvironment().then((r) => {
    console.log("[engram-desktop] environment check:", r);
  });
  ipcMain.handle("engram:environmentCheck", () => checkEnvironment());
  registerReadHandlers();
  registerLinkHandlers();
  void startLinkServer().catch((err) => {
    console.error("[engram-desktop] link server failed to start:", err);
  });
  installExplorableProtocolHandler();
  ipcMain.handle("engram:openArtifact", async (_e, absolutePath) => {
    const win = new BrowserWindow({
      width: 900,
      height: 720,
      title: "Engram Explorable",
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    });
    try {
      await win.loadFile(absolutePath);
    } catch (err) {
      dialog.showErrorBox("Couldn't open explorable", `${absolutePath}

${err instanceof Error ? err.message : String(err)}`);
      win.close();
    }
  });
  ipcMain.handle(
    "engram:openExplorable",
    async (_e, rawPath) => {
      const resolved = await resolveExplorablePath(rawPath);
      if (!resolved) return { error: `Explorable file not found: ${rawPath}` };
      registerExplorableRoot(resolved);
      return { url: `explorable://local${resolved}`, absolutePath: resolved };
    }
  );
  ipcMain.handle("dialog:pickFiles", async () => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile", "multiSelections"],
      title: "Attach files"
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("dialog:saveIncomingImage", async (_e, payload) => {
    const EXT = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/heic": "heic",
      "image/heif": "heif",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/tiff": "tif"
    };
    const ext = EXT[payload.mime];
    if (!ext) return { error: `unsupported image type: ${payload.mime || "unknown"}` };
    const bytes = Buffer.from(payload.bytes);
    if (bytes.byteLength === 0) return { error: "empty image" };
    if (bytes.byteLength > 40 * 1024 * 1024) return { error: "image is too large (over 40 MB)" };
    const dir = join(tmpdir(), "engram-handwriting");
    await mkdir(dir, { recursive: true });
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const safe = (payload.name ?? "pasted").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40);
    const path = join(dir, `${stamp}-${safe}.${ext}`);
    await writeFile(path, bytes);
    return { path };
  });
  ipcMain.handle("dialog:pickHandwriting", async () => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile", "multiSelections"],
      title: "Photograph pages of your handwritten work, in order",
      buttonLabel: "Transcribe",
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "heic", "heif", "webp", "gif", "tif", "tiff"] }]
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("engram:exportData", async () => {
    if (!mainWindow) return { canceled: true };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a folder to save your Engram backup into",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    const home = await engramLearningHome();
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const dest = join(result.filePaths[0], `engram-learning-backup-${stamp}`);
    await mkdir(dest, { recursive: true });
    await cp(home, dest, { recursive: true });
    return { canceled: false, path: dest };
  });
  ipcMain.handle("auth:getSettings", () => getAuthSettings());
  ipcMain.handle("auth:setMode", (_e, mode) => {
    if (mode !== "subscription" && mode !== "apiKey") throw new Error(`auth:setMode: invalid mode: ${JSON.stringify(mode)}`);
    return setAuthMode(mode);
  });
  ipcMain.handle("auth:keyStatus", () => apiKeyStore().status());
  ipcMain.handle("auth:setApiKey", (_e, key) => {
    if (!isPlausibleApiKey(key)) throw new Error("auth:setApiKey: not a plausible API key (8–256 printable characters, no spaces)");
    apiKeyStore().set(key);
    return apiKeyStore().status();
  });
  ipcMain.handle("auth:clearApiKey", () => {
    apiKeyStore().set(null);
    return apiKeyStore().status();
  });
  ipcMain.handle("notifier:getSettings", () => getNotifierSettings());
  ipcMain.handle(
    "notifier:setSettings",
    async (_e, patch) => {
      const next = await setNotifierSettings(patch);
      if (!next.dockBadgeEnabled) app.setBadgeCount(0);
      return next;
    }
  );
  ipcMain.handle("notifier:checkNow", () => checkReviewsNow(() => focusOrCreateWindow("review"), sendDueCount));
  ipcMain.handle("engram:refresh-due-count", () => refreshDueCount(sendDueCount));
  ipcMain.handle("app:getLoginItemSettings", () => ({ openAtLogin: app.getLoginItemSettings().openAtLogin }));
  ipcMain.handle("app:setLoginItemSettings", (_e, openAtLogin) => {
    app.setLoginItemSettings({ openAtLogin });
    return { openAtLogin };
  });
  ipcMain.handle("app:checkForUpdate", () => checkForUpdate());
  ipcMain.handle("app:cachedUpdateCheck", () => getCachedUpdateCheck());
  ipcMain.handle("app:getCachedUpdateCheck", () => getCachedUpdateCheck());
  ipcMain.handle("app:getCrashLog", () => getCrashLog());
  ipcMain.handle("app:getVersion", () => app.getVersion());
  ipcMain.handle("achievements:getUnlocked", () => getUnlockedAchievements());
  ipcMain.handle("achievements:recordUnlocked", (_e, ids) => recordUnlocked(ids));
  ipcMain.handle("window:close", () => {
    mainWindow?.close();
  });
  ipcMain.handle("window:minimize", () => {
    mainWindow?.minimize();
  });
  ipcMain.handle("window:zoom", () => {
    if (!mainWindow) return;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });
  ipcMain.handle("window:maximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  registerSessionHandlers(createWindow());
  createTray();
  startReviewNotifier(() => focusOrCreateWindow("review"), sendDueCount);
  const drainedDeepLink = deepLinkQueue.drain();
  if (drainedDeepLink) deliverDeepLink(drainedDeepLink);
  setTimeout(() => {
    void maybeAutoCheckForUpdate();
  }, 3e4);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) rebindWindow(createWindow());
  });
});
app.on("window-all-closed", () => {
});
app.on("before-quit", () => {
  stopReviewNotifier();
  abortAllSessions();
  bridgeServer.stop();
  void stopLinkServer();
});
function sweepOrphanTutors() {
  execFile("ps", ["ax", "-o", "pid=,command="], (err, stdout) => {
    if (err) return;
    for (const line of stdout.split("\n")) {
      if (!line.includes("engram-desktop-mcp-")) continue;
      const pid = Number(line.trim().split(/\s+/, 1)[0]);
      if (Number.isFinite(pid) && pid > 1 && pid !== process.pid) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
        }
      }
    }
  });
}
sweepOrphanTutors();
