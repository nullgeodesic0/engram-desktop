import { describe, it, expect } from "vitest"
import { tmpdir } from "node:os"
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { syncProjectState } from "../.opencode-plugin/install"

// syncAgentsExclude rewrites a USER-OWNED file by splitting on newline and
// rejoining. That is the riskiest edit in v1.2.0 — these hold it honest.
describe("user's .git/info/exclude survives", () => {
  it("preserves comments, blank lines, ordering and every user pattern", () => {
    const tmp = mkdtempSync(resolve(tmpdir(), "excl-"))
    const target = resolve(tmp, ".opencode")
    mkdirSync(resolve(tmp, ".git", "info"), { recursive: true })
    mkdirSync(target, { recursive: true })

    const original = [
      "# my personal ignores",
      "*.log",
      "",
      "# build junk",
      "dist/",
      "scratch/**/*.tmp",
      "!keep-me.log",
      "",
    ].join("\n")
    writeFileSync(resolve(tmp, ".git", "info", "exclude"), original)
    writeFileSync(resolve(tmp, "AGENTS.md"), "<!-- engram v1.2.0 -->\nB\n<!-- /engram -->\n")

    syncProjectState(target, () => {})
    const after = readFileSync(resolve(tmp, ".git", "info", "exclude"), "utf-8")

    for (const line of ["# my personal ignores", "*.log", "# build junk", "dist/", "scratch/**/*.tmp", "!keep-me.log"]) {
      expect(after, `lost ${line}`).toContain(line)
    }
    // user's lines must keep their relative order
    expect(after.indexOf("*.log")).toBeLessThan(after.indexOf("dist/"))
    expect(after.indexOf("dist/")).toBeLessThan(after.indexOf("scratch/**/*.tmp"))
    // and engram's entries got appended, not interleaved
    expect(after).toContain("AGENTS.md")
    expect(after.indexOf("!keep-me.log")).toBeLessThan(after.indexOf("AGENTS.md"))
  })

  it("is idempotent across many sessions — no growth, no duplicates", () => {
    const tmp = mkdtempSync(resolve(tmpdir(), "excl-"))
    const target = resolve(tmp, ".opencode")
    mkdirSync(resolve(tmp, ".git", "info"), { recursive: true })
    mkdirSync(target, { recursive: true })
    writeFileSync(resolve(tmp, "AGENTS.md"), "<!-- engram v1.2.0 -->\nB\n<!-- /engram -->\n")

    syncProjectState(target, () => {})
    const first = readFileSync(resolve(tmp, ".git", "info", "exclude"), "utf-8")
    for (let i = 0; i < 25; i++) syncProjectState(target, () => {})
    const after = readFileSync(resolve(tmp, ".git", "info", "exclude"), "utf-8")

    expect(after).toBe(first)
    expect((after.match(/^AGENTS\.md$/gm) || []).length).toBe(1)
    expect((after.match(/^\.engram-\*$/gm) || []).length).toBe(1)
  })

  it("does not touch a user's own hand-written AGENTS.md exclude line when they own the file", () => {
    const tmp = mkdtempSync(resolve(tmpdir(), "excl-"))
    const target = resolve(tmp, ".opencode")
    mkdirSync(resolve(tmp, ".git", "info"), { recursive: true })
    mkdirSync(target, { recursive: true })
    // user has their OWN content in AGENTS.md -> engram un-excludes it
    writeFileSync(resolve(tmp, "AGENTS.md"), "<!-- engram v1.2.0 -->\nB\n<!-- /engram -->\n\n## mine\n")
    writeFileSync(resolve(tmp, ".git", "info", "exclude"), "*.log\nAGENTS.md\nnotes.md\n")

    syncProjectState(target, () => {})
    const after = readFileSync(resolve(tmp, ".git", "info", "exclude"), "utf-8")
    expect(after).toContain("*.log")
    expect(after).toContain("notes.md")
  })

  it("no-ops safely when .git is a FILE (worktree / submodule)", () => {
    const tmp = mkdtempSync(resolve(tmpdir(), "excl-"))
    const target = resolve(tmp, ".opencode")
    mkdirSync(target, { recursive: true })
    writeFileSync(resolve(tmp, ".git"), "gitdir: /elsewhere/.git/worktrees/wt\n")
    writeFileSync(resolve(tmp, "AGENTS.md"), "<!-- engram v1.2.0 -->\nB\n<!-- /engram -->\n")
    expect(() => syncProjectState(target, () => {})).not.toThrow()
  })
})
