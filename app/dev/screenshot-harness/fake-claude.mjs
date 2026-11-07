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
out({ type: 'system', subtype: 'init', session_id: sid, model: 'claude-stub', tools: [], mcp_servers: [] });
let buf = '';
process.stdin.on('data', (c) => {
  buf += c; const lines = buf.split('\n'); buf = lines.pop();
  for (const l of lines) { if (!l.trim()) continue;
    const text = replies[Math.min(k, replies.length-1)]; k++;
    setTimeout(() => {
      out({ type: 'assistant', session_id: sid, message: { id: 'msg_'+k, type: 'message', role: 'assistant', model: 'claude-stub', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 200 } } });
      out({ type: 'result', subtype: 'success', session_id: sid, is_error: false, duration_ms: 1200, num_turns: 1, result: text, total_cost_usd: 0, usage: { input_tokens: 1000, output_tokens: 200 } });
    }, 400);
  }
});
process.stdin.on('end', () => process.exit(0));
