/**
 * Engram re-anchor hook — OpenClaw port.
 *
 * Runs `engram.py session-start` on /new and /reset and delivers its output as
 * a chat reply. The engine prints at most two lines and stays silent when
 * nothing is due, so this handler only forwards; it never composes a nudge.
 *
 * Silence is also the failure mode. No python3, no engine, non-zero exit,
 * timeout, empty stdout — every path returns without pushing a message.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// hooks/engram-due/handler.js -> plugin root
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENGINE = join(PLUGIN_ROOT, "scripts", "engram.py");

const TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

/** The engine's own cap is two lines; truncate rather than trust it blindly. */
const MAX_LINES = 2;

const handler = async (event) => {
  if (event?.type !== "command") return;
  if (event.action !== "new" && event.action !== "reset") return;
  if (!existsSync(ENGINE)) return;

  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("python3", [ENGINE, "session-start"], {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
    }));
  } catch {
    return; // missing python3, non-zero exit, timeout, oversized output
  }

  const nudge = String(stdout ?? "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(0, MAX_LINES)
    .join("\n");

  if (!nudge) return;

  // Delivery is guarded too, not just the engine call. OpenClaw does wrap handlers
  // in try/catch, but "the host logs my exception" is not the same as silence, and
  // the contract this hook advertises is silence on every failure path.
  try {
    event.messages.push(nudge);
  } catch {
    /* frozen, absent, or non-array messages — nothing to deliver into */
  }
};

export default handler;
