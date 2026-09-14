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

// Library entry: re-exports every TUI-independent module of @swifty.js/swifty.
// The CLI entry (bin) is dist/main.js; nothing here may import from src/tui or
// any ink/react dependency (enforced at build time by the ban-tui-and-ink
// esbuild plugin in tsup.config.ts and by import/no-restricted-paths in
// eslint.config.js).

export * from "./agent/agent.js";
export * from "./agent/events.js";
export * from "./agent/streaming-executor.js";
export * from "./code-review/handler.js";
export * from "./code-review/manager.js";
export * from "./code-review/session.js";
export * from "./commands/commands.js";
export * from "./commands/loader.js";
export * from "./commands/usage-tracker.js";
export * from "./compact/compact.js";
export * from "./compact/recovery.js";
export * from "./config/config.js";
export * from "./conversation/at-expand.js";
export * from "./conversation/conversation.js";
export * from "./conversation/pairing.js";
export * from "./file-history/file-history.js";
export * from "./history/history.js";
export * from "./hooks/hooks.js";
export * from "./images/clipboard.js";
export * from "./images/image.js";
export * from "./llm/anthropic.js";
export * from "./llm/client.js";
export * from "./llm/errors.js";
export * from "./llm/events.js";
export * from "./llm/model-resolver.js";
export * from "./llm/openai.js";
export * from "./logger/logger.js";
export * from "./mcp/client.js";
export * from "./mcp/manager.js";
export * from "./mcp/strategy.js";
export * from "./mcp/tool-wrapper.js";
export * from "./memory/consolidation.js";
export * from "./memory/extractor.js";
export * from "./memory/instructions.js";
export * from "./memory/manager.js";
export * from "./memory/memory-age.js";
export * from "./permissions/checker.js";
export * from "./plan-file/plan-file.js";

// Process-level headless entry points. They carry no TUI, but on failure they
// may write crash dumps or process.exit() — prefer the composable modules
// above (Agent, ToolRegistry, ...) in long-lived host processes.
export * from "./print-mode.js";
export * from "./recover.js";
export * from "./remote/log.js";
export * from "./remote/server.js";
export * from "./teammate.js";

export * from "./prompt/builder.js";
export * from "./prompt/coordinator.js";
export * from "./prompt/plan-mode.js";
export * from "./prompt/sections.js";
export * from "./sandbox/bwrap.js";
export * from "./sandbox/index.js";
export * from "./sandbox/seatbelt.js";
export * from "./session/session.js";
export * from "./skills/catalog.js";
export * from "./skills/executor.js";
export * from "./skills/install-tool.js";
export * from "./skills/load-skill-tool.js";
export * from "./skills/skill.js";
export * from "./subagent/agent-tool.js";
export * from "./subagent/definition.js";
export * from "./subagent/loader.js";
export * from "./subagent/spawn.js";
export * from "./subagent/task-manager.js";
export * from "./subagent/tool-filter.js";
export * from "./teams/backend.js";
export * from "./teams/coordinator.js";
export * from "./teams/file-mailbox.js";
export * from "./teams/progress.js";
export * from "./teams/protocol.js";
export * from "./teams/registry.js";
export * from "./teams/shared-task.js";
export * from "./teams/task-stop.js";
export * from "./teams/team-file.js";
export * from "./teams/team.js";
export * from "./teams/tools.js";
export * from "./teams/transcript.js";
export * from "./tool-result/budget.js";
export * from "./tools/ask-user.js";
export * from "./tools/bash.js";
export * from "./tools/descriptions.js";
export * from "./tools/diff.js";
export * from "./tools/edit-file.js";
export * from "./tools/enter-worktree.js";
export * from "./tools/exit-plan-mode.js";
export * from "./tools/exit-worktree.js";
export * from "./tools/file-state-cache.js";
export * from "./tools/glob.js";
export * from "./tools/grep.js";
export * from "./tools/is-diff-tool.js";
export * from "./tools/mcp-call.js";
export * from "./tools/powershell.js";
export * from "./tools/read-file.js";
export * from "./tools/registry.js";
export * from "./tools/synthetic-output.js";
export * from "./tools/tool-names.js";
export * from "./tools/tool-search.js";
export * from "./tools/types.js";
export * from "./tools/write-file.js";
export * from "./utils/index.js";
export * from "./utils/verbs.js";
export * from "./version.js";
export * from "./vscode/ide-client.js";
export * from "./vscode/lockfile.js";
export * from "./vscode/ws-transport.js";
export * from "./worktree/worktree.js";

// Conflict groups — `export *` would silently drop these duplicate names, so
// they are re-exported explicitly with disambiguating aliases:
// - `Task` is a type (todo/todo.js view-model interface, todo/store.js
//   zod-inferred store model) defined in both modules.
// - TaskCreateTool/TaskGetTool/TaskListTool/TaskUpdateTool exist both for the
//   local todo list (todo/tools.js, keeps the plain names) and for team task
//   boards (teams/task-tools.js, aliased with a Team prefix).
export { TaskList } from "./todo/todo.js";
export type { Task } from "./todo/todo.js";
export { TaskStore } from "./todo/store.js";
export type { TaskStatus, Task as StoredTask } from "./todo/store.js";
export { TaskCreateTool, TaskGetTool, TaskListTool, TaskUpdateTool } from "./todo/tools.js";
export {
  TaskCreateTool as TeamTaskCreateTool,
  TaskGetTool as TeamTaskGetTool,
  TaskListTool as TeamTaskListTool,
  TaskUpdateTool as TeamTaskUpdateTool,
} from "./teams/task-tools.js";
