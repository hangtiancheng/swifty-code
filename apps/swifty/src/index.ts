/**
 * Copyright (c) 2026 hangtiancheng
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// Library entry: re-exports every terminal-independent module of
// @swifty.js/swifty. The CLI entry (bin) is dist/main.js; nothing here may
// import from src/tui or any terminal-only dependency (ink, chalk, ...). That is
// enforced at build time by the ban-terminal-only-deps esbuild plugin in
// tsup.config.ts: reaching one of them fails the build. react/react-dom are not
// in that set — the cross-platform hooks under src/ui/** are public API.

// === acp ===

// === agent ===
export * from "./agent/index.js";
export * from "./agent/events.js";
export * from "./agent/streaming-executor.js";

// === bootstrap ===
export * from "./bootstrap/interaction-summary.js";
export * from "./bootstrap/tool-registry.js";

// === code-review ===
export * from "./code-review/handler.js";
export * from "./code-review/manager.js";
export * from "./code-review/session.js";

// === commands ===
export * from "./commands/commands.js";
export * from "./commands/loader.js";
export * from "./commands/usage-tracker.js";

// === compact ===
export * from "./compact/compact.js";
export * from "./compact/prompts.js";
export * from "./compact/recovery.js";

// === config ===
export * from "./config/index.js";
export * from "./config/provider-login.js";

// === conversation ===
export * from "./conversation/at-expand.js";
export * from "./conversation/index.js";
export * from "./conversation/pairing.js";

// === file-history ===
export * from "./file-history/index.js";

// === history ===
export * from "./history/index.js";

// === hooks ===
export * from "./hooks/index.js";

// === images ===
export * from "./images/clipboard.js";
export * from "./images/index.js";

// === llm ===
export * from "./llm/anthropic.js";
export * from "./llm/client.js";
export * from "./llm/errors.js";
export * from "./llm/events.js";
export * from "./llm/model-discovery.js";
export * from "./llm/model-resolver.js";
export * from "./llm/openai.js";

// === logger ===
export * from "./logger/index.js";

// === mcp ===
export * from "./mcp/client.js";
export * from "./mcp/instructions.js";
export * from "./mcp/manager.js";
export * from "./mcp/strategy.js";
export * from "./mcp/tool-wrapper.js";

// === memory ===
export * from "./memory/consolidation.js";
export * from "./memory/extractor.js";
export * from "./memory/instructions.js";
export * from "./memory/manager.js";
export * from "./memory/memory-age.js";
export * from "./memory/permissions.js";
export * from "./memory/written-paths.js";

// === permissions ===
export * from "./permissions/index.js";

// === plan-file ===
export * from "./plan-file/index.js";

// === prompt ===
export * from "./prompt/builder.js";
export * from "./prompt/coordinator.js";
export * from "./prompt/delegation.js";
export * from "./prompt/plan-mode.js";
export * from "./prompt/sections.js";

// === remote ===
export * from "./remote/address.js";
export * from "./remote/log.js";
export * from "./remote/server.js";
export * from "./remote/session-state.js";

// === sandbox ===
export * from "./sandbox/bwrap.js";
export * from "./sandbox/index.js";
export * from "./sandbox/seatbelt.js";

// === session ===
export * from "./session/index.js";

// === skills ===
export * from "./skills/catalog.js";
export * from "./skills/executor.js";
export * from "./skills/install-tool.js";
export * from "./skills/load-skill-tool.js";
export * from "./skills/index.js";

// === subagent ===
export * from "./subagent/agent-tool.js";
export * from "./subagent/definition.js";
export * from "./subagent/loader.js";
export * from "./subagent/spawn.js";
export * from "./subagent/task-manager.js";
export * from "./subagent/tool-filter.js";

// === teams ===
export * from "./teams/backend.js";
export * from "./teams/coordinator.js";
export * from "./teams/file-mailbox.js";
export * from "./teams/progress.js";
export * from "./teams/protocol.js";
export * from "./teams/registry.js";
export * from "./teams/shared-task.js";
export * from "./teams/task-stop.js";
export * from "./teams/task-tools.js";
export * from "./teams/team-file.js";
export * from "./teams/index.js";
export * from "./teams/tools.js";
export * from "./teams/transcript.js";

// === todo ===
export * from "./todo/store.js";
export * from "./todo/index.js";
export * from "./todo/tools.js";

// === tool-result ===
export * from "./tool-result/index.js";

// === tools ===
export * from "./tools/ask-user.js";
export * from "./tools/bash.js";
export * from "./tools/computer-use.js";
export * from "./tools/descriptions.js";
export * from "./tools/diff.js";
export * from "./tools/edit-file.js";
export * from "./tools/enter-worktree.js";
export * from "./tools/exit-plan-mode.js";
export * from "./tools/exit-worktree.js";
export * from "./tools/file-mutation-queue.js";
export * from "./tools/file-state-cache.js";
export * from "./tools/glob.js";
export * from "./tools/grep.js";
export * from "./tools/is-diff-tool.js";
export * from "./tools/mcp-call.js";
export * from "./tools/powershell.js";
export * from "./tools/read-file.js";
export * from "./tools/registry.js";
export * from "./tools/shell-output.js";
export * from "./tools/snippets.js";
export * from "./tools/synthetic-output.js";
export * from "./tools/tool-search.js";
export * from "./tools/types.js";
export * from "./tools/write-file.js";

// === ui ===
export * from "./ui/styles.js";
export * from "./ui/use-follow-up-queue.js";
export * from "./ui/use-ide-input.js";
export * from "./ui/use-teammate-states.js";

// === utils ===
export * from "./utils/paths.js";
export * from "./utils/index.js";
export * from "./utils/verbs.js";

// === vscode ===
export * from "./vscode/ide-client.js";
export * from "./vscode/lockfile.js";
export * from "./vscode/ws-transport.js";

// === worktree ===
export * from "./worktree/index.js";

// Process-level headless entry points. They carry no TUI, but on failure they
// may write crash dumps or process.exit() — prefer the composable modules
// above (Agent, ToolRegistry, ...) in long-lived host processes.
export * from "./print-mode.js";
export * from "./recover.js";
export * from "./teammate.js";
export * from "./version.js";

// Anything Conflict?
