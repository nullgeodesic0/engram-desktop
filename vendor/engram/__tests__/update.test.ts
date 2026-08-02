import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { tmpdir } from "node:os"
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { writeUpdateManifest, readManifest, saveManifest, clearUpdate, getUpdateSummary } from "../.opencode-plugin/update"

/** Creates a real source dir with 4 categories, each containing file.md that differs from dest. */
function setupRealDirs(base: string): string {
  const src = resolve(base, "src-pkg")
  for (const cat of ["skills", "agents", "scripts", "commands"]) {
    mkdirSync(resolve(src, cat), { recursive: true })
    writeFileSync(resolve(src, cat, "file.md"), "v2")
    mkdirSync(resolve(base, cat), { recursive: true })
    writeFileSync(resolve(base, cat, "file.md"), "v1")
  }
  return src
}

describe("update manifest state machine", () => {
  let tmp: string
  let src: string

  beforeEach(() => {
    tmp = mkdtempSync(resolve(tmpdir(), "engram-test-"))
    src = setupRealDirs(tmp)
  })
  afterEach(() => rmSync(tmp, { recursive: true }))

  it("writes manifest with state: pending", () => {
    writeUpdateManifest(src, tmp, "0.9.0", "1.0.2")
    const m = readManifest(tmp)
    expect(m).not.toBeNull()
    expect(m!.state).toBe("pending")
    expect(m!.applied).toEqual([])
    expect(m!.from).toBe("0.9.0")
    expect(m!.to).toBe("1.0.2")
    expect(m!.source).toBe(src)
  })

  it("writes categories with diff info", () => {
    writeUpdateManifest(src, tmp, "0.9.0", "1.0.2")
    const m = readManifest(tmp)!
    expect(m.categories.skills).toBeDefined()
    expect(m.categories.agents).toBeDefined()
    expect(m.categories.scripts).toBeDefined()
    expect(m.categories.commands).toBeDefined()
    expect(Array.isArray(m.categories.skills.added)).toBe(true)
    expect(Array.isArray(m.categories.skills.skipped)).toBe(true)
  })

  it("remaining only includes categories with skipped files", () => {
    writeUpdateManifest(src, tmp, "0.9.0", "1.0.2")
    const m = readManifest(tmp)!
    for (const cat of m.remaining) {
      expect(m.categories[cat].skipped.length).toBeGreaterThan(0)
    }
  })

  it("saveManifest persists state change", () => {
    writeUpdateManifest(src, tmp, "0.9.0", "1.0.2")
    const m = readManifest(tmp)!
    m.state = "in_progress"
    m.applied = ["skills"]
    m.remaining = ["agents", "scripts"]
    saveManifest(tmp, m)

    const reloaded = readManifest(tmp)!
    expect(reloaded.state).toBe("in_progress")
    expect(reloaded.applied).toEqual(["skills"])
    expect(reloaded.remaining).toEqual(["agents", "scripts"])
  })

  it("clearUpdate removes manifest file", () => {
    writeUpdateManifest(src, tmp, "0.9.0", "1.0.2")
    expect(existsSync(resolve(tmp, ".engram-update.jsonc"))).toBe(true)
    clearUpdate(tmp)
    expect(existsSync(resolve(tmp, ".engram-update.jsonc"))).toBe(false)
  })

  // A manifest written by <=1.9.1 uses the singular `command` key, because that was the
  // directory name then. `readManifest` is the single gate that normalises it — and the
  // normalisation shipped with no test, so an old-format manifest was back-compat by
  // inspection only. These pin every place the old key appears, not just `categories`:
  // `remaining` is what /engram-update iterates, and `applied` is what stops a category
  // being offered twice.
  it("migrates a pre-1.10 manifest's singular `command` key on read", () => {
    writeFileSync(resolve(tmp, ".engram-update.jsonc"), JSON.stringify({
      from: "1.9.1", to: "1.10.1", state: "pending",
      remaining: ["skills", "command"],
      applied: ["command"],
      categories: {
        skills: { added: ["a.md"], skipped: [] },
        command: { added: ["learn.md"], skipped: ["coach.md"] },
      },
    }))
    const m = readManifest(tmp)!
    expect(m.categories.commands, "categories.command -> commands").toBeDefined()
    expect(m.categories.command, "the old key is gone, not duplicated").toBeUndefined()
    expect(m.categories.commands.skipped).toEqual(["coach.md"])
    // the arrays matter as much as the object: `remaining` drives the update loop, and a
    // stale "command" there names a category that no longer exists in `categories`
    expect(m.remaining, "remaining is migrated").toEqual(["skills", "commands"])
    expect(m.applied, "applied is migrated").toEqual(["commands"])
  })

  it("does not clobber a manifest that already has both keys", () => {
    writeFileSync(resolve(tmp, ".engram-update.jsonc"), JSON.stringify({
      from: "1.9.1", to: "1.10.1", state: "pending", remaining: [], applied: [],
      categories: {
        command: { added: ["old.md"], skipped: [] },
        commands: { added: ["new.md"], skipped: [] },
      },
    }))
    const m = readManifest(tmp)!
    expect(m.categories.commands.added, "the NEW key wins").toEqual(["new.md"])
  })

  it("readManifest returns null when no manifest exists", () => {
    expect(readManifest(tmp)).toBeNull()
  })

  it("readManifest returns null for corrupt JSON", () => {
    writeFileSync(resolve(tmp, ".engram-update.jsonc"), "not-json")
    expect(readManifest(tmp)).toBeNull()
  })
})

describe("getUpdateSummary", () => {
  let tmp: string
  let src: string

  beforeEach(() => {
    tmp = mkdtempSync(resolve(tmpdir(), "engram-test-"))
    src = setupRealDirs(tmp)
  })
  afterEach(() => rmSync(tmp, { recursive: true }))

  it("returns summary string for valid manifest", () => {
    writeUpdateManifest(src, tmp, "0.9.0", "1.0.2")
    const summary = getUpdateSummary(tmp)
    expect(summary).toContain("Engram 0.9.0 → 1.0.2")
    expect(summary).toContain("/engram-update")
    expect(summary).toContain("auto")
    expect(summary).toContain("manual")
  })

  it("returns null when no manifest exists", () => {
    expect(getUpdateSummary(tmp)).toBeNull()
  })
})

describe("content-aware diff", () => {
  let tmp: string
  /** Source root dir, contents differ from dest by default. */
  let src: string

  beforeEach(() => {
    tmp = mkdtempSync(resolve(tmpdir(), "engram-test-"))
    src = resolve(tmp, "src-pkg")
    mkdirSync(resolve(src, "skills"), { recursive: true })
    mkdirSync(resolve(tmp, "skills"), { recursive: true })
  })
  afterEach(() => rmSync(tmp, { recursive: true }))

  it("identical files are not in skipped", () => {
    writeFileSync(resolve(src, "skills", "learn.md"), "same content")
    writeFileSync(resolve(tmp, "skills", "learn.md"), "same content")

    writeUpdateManifest(src, tmp, "0.9.0", "1.0.2")
    expect(existsSync(resolve(tmp, ".engram-update.jsonc"))).toBe(false)
  })

  it("modified file appears in skipped", () => {
    writeFileSync(resolve(src, "skills", "learn.md"), "new version")
    writeFileSync(resolve(tmp, "skills", "learn.md"), "old version")

    writeUpdateManifest(src, tmp, "0.9.0", "1.0.2")
    const m = readManifest(tmp)!
    expect(m).not.toBeNull()
    expect(m.categories.skills.skipped).toContain("skills/learn.md")
  })

  it("new file appears in added when manifest exists (alongside a modified file)", () => {
    writeFileSync(resolve(src, "skills", "new.md"), "brand new file")
    mkdirSync(resolve(src, "agents"), { recursive: true })
    mkdirSync(resolve(tmp, "agents"), { recursive: true })
    writeFileSync(resolve(src, "agents", "agent.md"), "v2")
    writeFileSync(resolve(tmp, "agents", "agent.md"), "v1")

    writeUpdateManifest(src, tmp, "0.9.0", "1.0.2")
    const m = readManifest(tmp)!
    expect(m).not.toBeNull()
    expect(m.categories.skills.added).toContain("skills/new.md")
    expect(m.categories.skills.skipped).not.toContain("skills/new.md")
  })

  it("new-only files do NOT trigger manifest generation (no modifications)", () => {
    writeFileSync(resolve(src, "skills", "new.md"), "brand new file")

    writeUpdateManifest(src, tmp, "0.9.0", "1.0.2")
    expect(existsSync(resolve(tmp, ".engram-update.jsonc"))).toBe(false)
  })

  it("mixed: manifest generated when at least one file differs", () => {
    writeFileSync(resolve(src, "skills", "learn.md"), "updated")
    writeFileSync(resolve(tmp, "skills", "learn.md"), "original")
    writeFileSync(resolve(src, "skills", "new.md"), "added file")

    writeUpdateManifest(src, tmp, "0.9.0", "1.0.2")
    const m = readManifest(tmp)!
    expect(m).not.toBeNull()
    expect(m.categories.skills.skipped).toContain("skills/learn.md")
    expect(m.categories.skills.added).toContain("skills/new.md")
    expect(m.remaining).toContain("skills")
  })

  it("empty file identical both sides → not in skipped", () => {
    writeFileSync(resolve(src, "skills", "empty.md"), "")
    writeFileSync(resolve(tmp, "skills", "empty.md"), "")

    writeUpdateManifest(src, tmp, "0.9.0", "1.0.2")
    expect(existsSync(resolve(tmp, ".engram-update.jsonc"))).toBe(false)
  })

  it("generates .engram-update.diff when files differ", () => {
    writeFileSync(resolve(src, "skills", "learn.md"), "line1\nline2\nline3")
    writeFileSync(resolve(tmp, "skills", "learn.md"), "line1\nCHANGED\nline3")

    writeUpdateManifest(src, tmp, "0.9.0", "1.0.2")
    expect(existsSync(resolve(tmp, ".engram-update.diff"))).toBe(true)

    const diff = readFileSync(resolve(tmp, ".engram-update.diff"), "utf-8")
    expect(diff).toContain("--- skills/learn.md (preserved)")
    expect(diff).toContain("+++ skills/learn.md (v1.0.2)")
    expect(diff).toContain("+line2")
    expect(diff).toContain("-CHANGED")
  })

  it("does NOT generate .engram-update.diff when all files identical", () => {
    writeFileSync(resolve(src, "skills", "learn.md"), "same")
    writeFileSync(resolve(tmp, "skills", "learn.md"), "same")

    writeUpdateManifest(src, tmp, "0.9.0", "1.0.2")
    expect(existsSync(resolve(tmp, ".engram-update.diff"))).toBe(false)
  })
})
