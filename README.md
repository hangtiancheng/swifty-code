<p align="center">
  <img src="./assets/favicon.svg" width="300" alt="Swifty" />
</p>

<h1 align="center">Swifty</h1>

<p align="center">
  <strong>Swifty</strong> is a terminal-based AI coding agent — chat with LLMs, edit files, run commands,<br/>and orchestrate multi-agent workflows, all from your terminal.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@swifty.js/swifty"><img src="https://img.shields.io/npm/v/@swifty.js/swifty.svg?label=swifty" alt="swifty npm version" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@swifty.js/swifty.svg" alt="node version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@swifty.js/swifty.svg" alt="license" /></a>
</p>

---

## Highlights

- **Multi-provider** — Anthropic, OpenAI, or any OpenAI-compatible endpoint, configured in YAML
- **Rich TUI** — streaming responses, tool execution feedback, permission prompts and slash commands, rendered with React + Ink
- **Built-in tools** — file read/write/edit, Bash/PowerShell, glob, grep and more, extensible through **MCP** servers
- **Safety first** — four permission modes, OS-level sandboxing (bwrap / seatbelt), dangerous-command approval dialogs
- **Memory & sessions** — resumable sessions, automatic context compaction, long-term memory across sessions
- **Skills & commands** — loadable skill catalog with hot-reload, plus user-defined slash commands
- **Multi-agent** — spawn subagents, coordinate teams with mailboxes, isolate parallel work in git worktrees
- **Hooks** — event-driven shell / HTTP / prompt-injection hooks on every lifecycle event
- **Beyond the terminal** — print mode for scripting & CI, remote mode serving a browser chat UI over WebSocket, VSCode integration with `@`-mentions from the editor

Full documentation lives in [apps/swifty/README.md](./apps/swifty/README.md).

## Quick Start

Requires **Node.js >= 20**.

### One-line installer

```bash
curl -fsSL https://raw.githubusercontent.com/hangtiancheng/swifty-code/main/install.sh | bash
```

The installer supports `--uninstall`, `--version=X.Y.Z`, `--alpha`, `--beta`, `--rc`, `--canary`, `--nightly` and `--tag=NAME`:

```bash
curl -fsSL https://raw.githubusercontent.com/hangtiancheng/swifty-code/main/install.sh | bash -s -- --alpha
```

### Via npm

```bash
npm install -g @swifty.js/swifty
```

### Run it

```bash
swifty                              # interactive TUI
swifty -p "explain this codebase"   # print mode (non-interactive, CI-friendly)
swifty --remote                     # browser chat UI on http://localhost:18888
```

### Configuration

Swifty reads a single global YAML config file: `~/.swifty/config.yaml`. At least one provider is required:

```yaml
providers:
  - name: anthropic
    protocol: anthropic
    base_url: https://api.anthropic.com
    model: claude-sonnet-4-20250514
    # api_key defaults to $ANTHROPIC_API_KEY
```

See the [full configuration reference](./apps/swifty/README.md#configuration) for MCP servers, hooks, sandboxing and all provider fields.

## Repository Layout

This is a pnpm monorepo (workspace `apps/*`):

| Package                                    | Description                                                      |
| ------------------------------------------ | ---------------------------------------------------------------- |
| [`@swifty.js/swifty`](./apps/swifty)       | The terminal AI coding agent (Node.js)                           |
| [`@swifty.js/mcp`](./apps/mcp)             | Official Swifty MCP tools collection — semantic doc search (RAG) |
| [`@swifty.js/glob-wasm`](./apps/glob-wasm) | WebAssembly-powered glob matching and scanning                   |

## Development

```bash
pnpm install                          # pnpm 10, Node >= 20

pnpm --filter @swifty.js/swifty dev   # launch the TUI from source
pnpm build                            # build all publishable packages
```

## License

[MIT](./LICENSE) © [hangtiancheng](https://github.com/hangtiancheng)
