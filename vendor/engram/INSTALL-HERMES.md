# Engram on Hermes Agent

Engram is an **omni-repo**: one codebase that runs on Claude Code, OpenAI Codex, OpenCode — and Nous Research's [Hermes Agent](https://hermes-agent.nousresearch.com). The core is the same everywhere: the `skills/` (Agent Skills standard `SKILL.md`) and the dependency-free `scripts/engram.py` engine, shared verbatim. This file covers the Hermes-specific glue.

> Everything below was verified against a live **Hermes Agent v0.18.2** install (macOS, local model). The receipts are in the [honest status](#honest-status-of-the-hermes-glue) section.

## What ships for Hermes

```
skills/                            # SHARED — the same skills every platform uses
scripts/engram.py                  # SHARED — the same engine
hooks/session-start-hermes.sh      # Hermes pre_llm_call hook: the due-review nudge, once per session
agents/*.md                        # prompt sources for delegate_task (assessor, architect, artifact-smith)
```

## Install

**1 · Clone** (don't use `hermes skills install` — see the warning below):

```bash
git clone https://github.com/nagisanzenin/engram ~/engram
```

**2 · Register the skills and the engine root** — add to `~/.hermes/config.yaml` under the existing `skills:` section:

```yaml
skills:
  external_dirs:
    - ~/engram/skills
```

and tell the skills where their engine lives:

```bash
echo "ENGRAM_ROOT=$HOME/engram" >> ~/.hermes/.env
```

(The skills resolve `scripts/engram.py` through `$ENGRAM_ROOT` when no platform plugin-root variable is set — and Hermes sets none. Hermes loads `~/.hermes/.env` into its process at startup and local terminal subprocesses inherit it, so the variable reaches the skill's shell commands.)

That's the whole install. `/review` and `/coach` appear as slash commands on every Hermes surface (CLI, TUI, dashboard, Telegram, Discord, …), and all three skills join the agent's skill index for natural-language activation.

**3 · Optional — the ambient nudge** (the "[engram] 7 reviews due · ~4 min" line, once per session, silent otherwise). Add a top-level `hooks:` block to `~/.hermes/config.yaml`:

```yaml
hooks:
  pre_llm_call:
    - command: "/Users/you/engram/hooks/session-start-hermes.sh"   # absolute path
      timeout: 15
```

Hermes asks for consent on first use (or set `hooks_auto_accept: true`). The hook is self-resolving, dedupes per session, and degrades to silence on any failure — same contract as the Claude Code SessionStart hook.

**4 · Optional — a `/study` alias.** Create `~/.hermes/skill-bundles/study.yaml`:

```yaml
name: study
description: Engram learning loop — first-principles tutoring with verified recall.
skills:
  - learn
```

### ⚠ Why not `hermes skills install`?

Hermes' hub installer copies each skill folder plus only the files referenced *inside it* — "unreferenced repository files are not copied." Engram's skills share one repo-level engine (`scripts/engram.py`) and `skills/_shared/`, so hub-installed copies would be severed from their engine. The clone + `external_dirs` route keeps the repo layout intact; external skills are fully integrated (index, `/skill-name` commands) and read-only to the agent in v0.18.2.

## Invoking the skills

| You want | Type | Why |
|---|---|---|
| a review session | `/review` | direct slash command (verified) |
| stats & coaching | `/coach` | direct slash command (verified) |
| to learn a topic | `/skill learn <topic>` — or `/study <topic>` with the bundle, or just say "teach me X" | **`/learn` is Hermes' own built-in** (it authors new agent skills from sources). Hermes detects the collision and skips auto-registering engram's `learn`, printing exactly this alternative. |

Two Hermes-specific notes:
- Slash-skill expansion happens in the **interactive** CLI/TUI and gateway platforms. Headless `hermes chat -q "…"` passes slash commands through as literal text — don't test the install that way.
- Tutoring quality is your configured model's quality. The mechanics run on anything; the pedagogy deserves a capable model.

## The assessor (blind grading) on Hermes

Hermes has real subagents: `delegate_task` children start with "a completely fresh conversation … zero knowledge of the parent's conversation history" — engram's separation of powers is preserved *structurally*. When a skill says "spawn the engram-assessor", the agent should delegate:

```
delegate_task(
  goal="Act as the engram-assessor and grade these productions.",
  context="<contents of ~/engram/agents/engram-assessor.md>\n\nItems to grade:\n<stash JSON>"
)
```

As on Codex, the trigger is explicit rather than auto-routed — the blindness (assessor never sees the tutoring dialogue) is identical to Claude Code.

## Where state lives

`engram.py` keeps state in `~/.claude/learning` (override with `ENGRAM_HOME`) **on whatever host runs Hermes' terminal backend**. On the default `local` backend that's your machine, and Claude Code / Codex / OpenCode / Hermes all share one memory schedule. On remote backends (Docker, SSH, Modal, Daytona), clone the repo and keep state on that host.

## Verify the install

```bash
python3 ~/engram/scripts/engram.py selftest    # same engine, same checks, every platform
echo '{"session_id":"t"}' | ~/engram/hooks/session-start-hermes.sh   # nudge hook dry-run
```

## Honest status of the Hermes glue

**Verified live on v0.18.2:** external-dir discovery of all three skills (`_shared/` correctly ignored); `/review` and `/coach` slash registration; full SKILL.md content injection on invocation (11.5 KB for `/review`) and via the `/study` bundle (17.9 KB); the `/learn` collision handling and Hermes' printed `/skill learn` escape hatch; the nudge hook firing, deduping per session, and landing in the composed user message at the wire level (request-dump inspected).

**Not yet verified:** the delegate_task assessor flow end-to-end with a capable model, gateway surfaces (Telegram/Discord), and cron delivery of the nudge — `hermes cron create --no-agent --script ~/engram/hooks/session-start-hermes.sh --deliver telegram` should put due-counts on your phone (the hook detects the no-stdin cron case and prints plain, `/skill learn`-rewritten text; nothing when nothing is due) — reports welcome. If anything misbehaves, open an issue with what you see.
