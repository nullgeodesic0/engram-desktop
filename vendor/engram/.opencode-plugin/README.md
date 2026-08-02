# Develop Engram Plugin

## Local setup

1. Clone the repo:

   ```bash
   git clone https://github.com/nagisanzenin/engram
   cd engram
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create `opencode.json` in this repo (OpenCode accepts relative paths):

   ```bash
   cat > opencode.json <<EOF
   {
     "\$schema": "https://opencode.ai/config.json",
     "plugin": ["."]
   }
   EOF
   ```

## How it works

The plugin entry is at `.opencode-plugin/index.ts` (defined in `package.json`'s `"main"`). When OpenCode loads the plugin by path:

1. `server()` registers the tool, session hooks, and shell-env hooks
2. `config()` runs `selfExtract()` — copies `skills/`, `agents/`, `scripts/` to `.opencode/` in the test project
3. On first execution, the bridge registers agents, commands, and skills via `cfg.*`
4. Subsequent sessions use OpenCode's native disk discovery

## Structure

| Path                | Purpose                                                               |
| --------------------|---------------------------------------------------------------------- |
| `.opencode-plugin/` | TypeScript source (entry, install, update, tools, agents)             |
| `hooks/`            | Session hooks (notifications, shell env)                              |
| `scripts/`          | Python engine (`engram.py`) and git filter scripts                    |
| `skills/`           | Skill definitions (learn, review, coach)                              |
| `agents/`           | Subagent definitions (assessor, curriculum-architect, artifact-smith) |
| `package.json`      | Npm manifest — `"main"` resolves to `.opencode-plugin/index.ts`       |
