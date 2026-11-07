#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.1.0 (Claude Code)'); process.exit(0); }
const i = args.indexOf('--session-id'); const j = args.indexOf('--resume');
const sid = i >= 0 ? args[i+1] : j >= 0 ? args[j+1] : 'stub-session';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const replies = [
`## Ladder operators

We're picking up at **ladder operators** — the node your map marks as *learn next*. Before I say anything about it, a retrieval warm-up from last time.

You encoded the Hamiltonian eleven days ago:

$$H = \\frac{p^2}{2m} + \\frac{1}{2} m\\omega^2 x^2$$

**From memory:** why is it useful that $H$ is quadratic in *both* $x$ and $p$? One or two sentences — then pick your confidence before I respond.`,
`Good — that's the core of it. Because both terms are squares, $H$ factors (almost) like $u^2 + v^2 = (u - iv)(u + iv)$, and the "almost" is exactly the commutator $[x, p] = i\\hbar$.

That factorisation *is* the ladder operator. Define

$$a = \\sqrt{\\frac{m\\omega}{2\\hbar}}\\left(x + \\frac{i}{m\\omega}p\\right)$$

Now the probe for this node:

> Show what $a$ does to an energy eigenstate $|n\\rangle$. You may use $[H, a] = -\\hbar\\omega\\, a$ without deriving it.

Take your time. Write it on paper if that helps, then type the key step.`,
`That's the right move: $H(a|n\\rangle) = (aH - \\hbar\\omega a)|n\\rangle = (E_n - \\hbar\\omega)\\, a|n\\rangle$.

So $a|n\\rangle$ is *also* an eigenstate, with energy lowered by exactly $\\hbar\\omega$. I've stashed your production for blind grading.`,
];
let k = 0;
// Lecture Notes: when the kickoff carries the learner's election, publish
// notes through the app's real bridge endpoint (as the MCP worker would),
// then walk a short notes-first dialogue ending at a cold VERIFY.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const notesPath = join(dirname(fileURLToPath(import.meta.url)), 'lecture-notes.md');
const mc = args.indexOf('--mcp-config');
let bridgeEnv = null;
try { const cfg = JSON.parse(readFileSync(args[mc + 1], 'utf-8')); bridgeEnv = Object.values(cfg.mcpServers)[0].env; } catch {}
const notesReplies = [
`## Ladder operators

**OPEN A GAP** You can now write $x$ and $p$ in terms of $a$ and $a^\\dagger$. Here is what the notes did not do.

**Predict, then commit:** the notes worked $a$ on nothing in particular. What do you expect $a^\\dagger$ does to the energy of an eigenstate $|n\\rangle$, and by how much? Give a number and a one-line reason, then pick your confidence.`,
`Right direction, and the step size is exactly $\\hbar\\omega$, for the same commutator reason the notes gave for the $\\tfrac12$.

**VERIFY — cold, no notes.**

From memory: define the lowering operator $a$ and say, in one or two sentences, what it does to an energy eigenstate.`,
];
let notesMode = false;
async function publishNotes() {
  const markdown = readFileSync(notesPath, 'utf-8');
  const input = { topic: 'quantum-harmonic-oscillator', node: 'ladder-operators', title: 'Ladder Operators', markdown };
  let result = { accepted: false, reasons: ['no bridge'] };
  if (bridgeEnv) {
    const r = await fetch(`http://127.0.0.1:${bridgeEnv.ENGRAM_BRIDGE_PORT}/bridge/${encodeURIComponent(bridgeEnv.ENGRAM_BRIDGE_SESSION_ID)}/lecture-notes`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    }).catch(() => null);
    if (r) result = await r.json().catch(() => result);
  }
  out({ type: 'assistant', session_id: sid, message: { id: 'msg_notes', type: 'message', role: 'assistant', model: 'claude-stub', content: [{ type: 'tool_use', id: 'toolu_notes', name: 'mcp__engram-ui-bridge__publish_lecture_notes', input }], stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 900 } } });
  out({ type: 'user', session_id: sid, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_notes', content: JSON.stringify(result) }] } });
  return 'Your lecture notes for **Ladder operators** are ready. Read them, then tell me when you are done.';
}
out({ type: 'system', subtype: 'init', session_id: sid, model: 'claude-stub', tools: [], mcp_servers: [] });
let buf = '';
process.stdin.on('data', (c) => {
  buf += c; const lines = buf.split('\n'); buf = lines.pop();
  for (const l of lines) { if (!l.trim()) continue;
    if (k === 0 && l.includes('turned on Lecture Notes')) notesMode = true;
    const turn = k; k++;
    setTimeout(async () => {
      const text = notesMode
        ? (turn === 0 ? await publishNotes() : notesReplies[Math.min(turn - 1, notesReplies.length - 1)])
        : replies[Math.min(turn, replies.length-1)];
      out({ type: 'assistant', session_id: sid, message: { id: 'msg_'+k, type: 'message', role: 'assistant', model: 'claude-stub', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 200 } } });
      out({ type: 'result', subtype: 'success', session_id: sid, is_error: false, duration_ms: 1200, num_turns: 1, result: text, total_cost_usd: 0, usage: { input_tokens: 1000, output_tokens: 200 } });
    }, 400);
  }
});
process.stdin.on('end', () => process.exit(0));
