# Swifty

Swifty is a terminal-based AI coding agent. It provides an interactive TUI (terminal user interface) for conversing with large language models, executing code, manipulating files, and orchestrating multi-agent workflows, all from the command line.

## Overview

Swifty runs as a single CLI binary that connects to configurable LLM providers (Anthropic, OpenAI, or any OpenAI-compatible endpoint). It renders a rich terminal interface using React and Ink, giving you streaming responses, tool execution feedback, permission prompts, and slash commands in a single pane.

Beyond interactive use, Swifty supports a non-interactive print mode for scripting, a remote mode that serves a browser-based chat UI over WebSocket, and a teammate mode that lets one lead agent coordinate multiple subagents working in parallel.

## Features

### Core Capabilities

- Multi-provider LLM support with Anthropic, OpenAI, and OpenAI-compatible protocols
- Interactive terminal UI with streaming text, thinking indicators, and tool execution display
- Built-in tool set: ReadFile, WriteFile, EditFile, Bash, Glob, Grep, ToolSearch, EnterWorktree, ExitWorktree, ExitPlanMode
- MCP (Model Context Protocol) server integration for extending the tool set with external services
- Permission system with four modes: default, acceptEdits, plan (read-only), and bypassPermissions
- Sandbox support via bwrap (Linux) and seatbelt (macOS) for isolated command execution
- Dangerous command pattern detection with human-in-the-loop approval dialogs

### Conversation and Memory

- Session persistence with JSONL-based storage for cross-session resume
- Automatic context compaction when conversations approach the model's context window
- Long-term memory extraction and recall across sessions
- Instructions file support for persistent project-level guidance

### Skills and Commands

- Skill catalog with three-tier loading: built-in, user-global (~/.agents/skills/), and project-level (.agents/skills/)
- Hot-reload support for skills edited on disk
- Inline and fork execution modes for skills
- Slash command system with built-in commands and user-defined commands from .swifty/commands/
- Skill installation from URLs

### Agent Orchestration

- Subagent spawning with built-in agent types: general-purpose, plan (read-only architect), explore (read-only code explorer)
- Team coordination with file-based mailboxes and lead/member communication
- Coordinator mode for managing multi-agent workflows
- Git worktree isolation for parallel agent tasks

### Hooks

- Event-driven hook engine supporting: session_start, session_end, turn_start, turn_end, pre_send, post_receive, pre_tool_use, post_tool_use, shutdown
- Hook actions: shell commands, HTTP requests, prompt injection
- Conditional execution, reject-on-failure, and async options

### Remote Mode

- Koa HTTP server with WebSocket bridge for browser-based access
- React frontend served at a configurable address
- Bidirectional message streaming between browser and agent

## Installation

```bash
npm install -g @swifty.js/swifty
```

Or use the one-line installers ([macOS / Linux](../../install.sh), [Windows](../../install.ps1)):

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/hangtiancheng/swifty-code/main/install.sh | bash
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/hangtiancheng/swifty-code/main/install.ps1 | iex
```

Both installers write a default `~/.swifty/config.yaml` if none exists, verify Node.js >= 20, and support uninstall / pinned-version / dist-tag options (see their `--help` / `-Help` output).

Or run directly from the monorepo:

```bash
pnpm dev
```

## Configuration

Swifty reads a single global YAML configuration file:

- ~/.swifty/config.yaml

At least one provider must be configured. Example config.yaml:

```yaml
providers:
  - name: anthropic
    protocol: anthropic
    base_url: https://api.anthropic.com
    model: claude-sonnet-4-6
    # api_key defaults to $ANTHROPIC_API_KEY
    thinking: high # off | minimal | low | medium | high | xhigh | max

permission_mode: default

mcp_servers:
  - name: database
    command: npx
    args: ["-y", "@swifty-db/mcp@latest"]
    env: # map<string, string>; ${VAR} / $VAR expands from the environment
      API_BASE_URL: "https://swifty-db.dev"
      API_KEY: "${DATABASE_API_KEY}"

hooks:
  - event: pre_tool_use
    condition: "Bash"
    action:
      type: command
      command: "echo tool about to run"

sandbox:
  enabled: false
  auto_allow: false
  network_enabled: true

enable_coordinator_mode: false
```

Provider fields:

| Field             | Required | Description                                                                                                                |
| ----------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| name              | yes      | Display name for the provider                                                                                              |
| protocol          | yes      | One of: anthropic, openai, openai-compat                                                                                   |
| base_url          | yes      | API base URL                                                                                                               |
| model             | yes      | Model identifier                                                                                                           |
| api_key           | no       | API key (falls back to environment variable)                                                                               |
| thinking          | no       | Thinking level: off, minimal, low, medium, high, xhigh, max (default: `high` for every protocol).                          |
| context_window    | no       | Context window in tokens (default: 1000000; no model-name inference)                                                       |
| max_output_tokens | no       | Output cap for the model (default: 128000, never above `context_window`). Set this for models with a smaller output limit. |

The thinking level controls reasoning depth. For `anthropic` it maps to a thinking token budget (minimal 1024, low 2048, medium 8192, high 16384, xhigh 32768, max 65536); for `openai` and `openai-compat` it maps to the provider reasoning effort. The budget shares `max_output_tokens` and always leaves at least 1024 answer tokens, so lower `max_output_tokens` shrinks the thinking budget instead of disabling it (below a 2048-token cap no valid budget remains and thinking falls back to disabled). On `openai`/`openai-compat`, the effort string is passed through verbatim, and only levels supported by the model are accepted (`xhigh`/`max` are model-specific). Use `/thinking <level>` to change it at runtime (the change is applied to the active client and saved to `~/.swifty/config.yaml`), or `/thinking` to show the current level.

API keys are resolved in this order: explicit api_key field, then environment variables (ANTHROPIC_API_KEY for anthropic, OPENAI_API_KEY for openai and openai-compat).

### Project-level MCP servers (.mcp.json)

In addition to `mcp_servers` in `config.yaml`, Swifty reads a project-level `.mcp.json` from the working directory, using the Claude Code-compatible format:

```json
{
  "mcpServers": {
    "database": {
      "command": "npx",
      "args": ["-y", "@swifty-db/mcp@latest"],
      "env": { "API_KEY": "${DATABASE_API_KEY}" }
    },
    "remote": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ${TOKEN}" }
    }
  }
}
```

Each entry takes `command`/`args`/`env` (stdio) or `url`/`headers` with `type` of `http` or `sse`; `${VAR}` / `$VAR` in values expands from the environment. These servers are merged with the user-level `mcp_servers`; on a name collision the user-level entry wins. A malformed `.mcp.json` is ignored (logged) rather than blocking startup.

After editing `.mcp.json` or `config.yaml`, use `/mcp reload` in the TUI to re-read both sources and reconnect all servers without restarting.

## Usage

### Interactive TUI Mode

```bash
swifty
```

Launches the terminal interface. If multiple providers are configured, a provider selection screen appears first.

Use `/login` to configure and activate a provider from the TUI. When no provider is configured, the login form opens automatically. Name, protocol, base URL, API key, and model are required in the form. Use ↑↓ or Tab to move between fields, ←→ to select protocol or cycle the thinking level, Enter to save, and Esc to cancel. Changing the protocol also moves an untouched thinking level to that protocol's default.

The form saves to `~/.swifty/config.yaml`, retaining existing providers and other settings. `base_url` is the provider identity: saving a provider whose `base_url` already exists replaces that entry in place instead of adding another one, and names may repeat freely. Context window accepts integers from 1000 to 10000000; max output accepts integers from 1 to 1000000 and must not exceed the context window. Empty optional fields use the defaults above.

### Print Mode (Non-Interactive)

```bash
swifty -p "explain this codebase"
swifty -p "fix the failing test" --output-format stream-json
```

The -p flag sends a single prompt, runs the agent loop, and prints the result to stdout. Useful for scripting and CI pipelines.

### Remote Mode (Browser UI)

```bash
swifty --remote                  # listens on 127.0.0.1:18888
swifty --remote :9000            # custom loopback port
swifty --remote 0.0.0.0:9000      # explicitly expose on all interfaces (no built-in authentication)
```

Starts a Koa HTTP server and WebSocket bridge. The bundled React frontend is served at the configured address for browser-based interaction.

### Slash Commands

Inside the TUI, these commands are available:

| Command                 | Description                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| /login                  | Configure, save, and activate an LLM provider                                                                             |
| /status                 | Show current session status (model, tokens, tools, sandbox, memories, skills, MCP)                                        |
| /permission mode <mode> | Change permission mode (default, acceptEdits, plan, bypassPermissions)                                                    |
| /memory                 | List stored memories                                                                                                      |
| /memory clear           | Clear all memories                                                                                                        |
| /skills                 | List available skills                                                                                                     |
| /skills reload          | Hot-reload skills from disk                                                                                               |
| /skill <name> [args]    | Run a skill by name                                                                                                       |
| /plan                   | Enter plan mode (read-only investigation)                                                                                 |
| /do                     | Exit plan mode and execute the approved plan                                                                              |
| /compact                | Force conversation compaction                                                                                             |
| /clear                  | Reset the session and clear the terminal                                                                                  |
| /resume [id]            | List or restore a previous session                                                                                        |
| /rewind                 | Open checkpoint rewind dialog                                                                                             |
| /sandbox [1/2/3]        | Configure sandbox (1=on+auto, 2=on+manual, 3=off)                                                                         |
| /worktree               | List git worktrees                                                                                                        |
| /mcp                    | Show MCP server status                                                                                                    |
| /mcp reload             | Re-read MCP config (config.yaml + .mcp.json) and reconnect all servers                                                    |
| /thinking [level]       | Show or set the thinking level (off, minimal, low, medium, high, xhigh, max); setting persists to `~/.swifty/config.yaml` |
| /quit                   | Exit the application                                                                                                      |

### Keyboard Shortcuts

| Key       | Action                                                                              |
| --------- | ----------------------------------------------------------------------------------- |
| Ctrl+C    | Clear input or interrupt streaming (first press), exit app (second press within 2s) |
| Ctrl+O    | Toggle full vs. truncated tool output                                               |
| Ctrl+T    | Toggle Teams dialog overlay                                                         |
| Ctrl+V    | Paste a clipboard image (Alt+V on Windows)                                          |
| Shift+Tab | Cycle permission modes                                                              |

Pastes longer than 10 lines or 1,000 characters collapse to `[paste #1 +124 lines]` or `[paste #1 1234 chars]`. Clipboard images appear as `[Image #1]`. Arrow keys move across each placeholder as a unit, and Backspace/Delete remove it as a unit. Placeholders survive dialog switches; submitting restores the full text and image attachments.

Pasting an image saves it as a PNG under `.swifty/file-history/<session-id>/`. Its placeholder expands to a workDir-relative `@` reference on submit and loads as an inline image block. Linux requires `wl-clipboard` (Wayland) or `xclip` (X11).
