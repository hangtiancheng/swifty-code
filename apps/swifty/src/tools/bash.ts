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

import { spawn } from "node:child_process";

import { BASH_DESCRIPTION } from "./descriptions.js";
import { exitCodeHint } from "./exit-code-hints.js";
import {
  formatShellOutput,
  MAX_SHELL_OUTPUT_BYTES,
  takeUtf8Prefix,
  utf8ByteLength,
} from "./shell-output.js";
import {
  type Tool,
  type ToolCategory,
  type ToolContext,
  type ToolResult,
  type ToolSchema,
} from "./types.js";

import { isSafeCommand } from "@/permissions/checker.js";
import type { Sandbox, SandboxConfig } from "@/sandbox/index.js";
import { intArg, strArg } from "@/utils/index.js";

const MAX_TIMEOUT = 600;
// Grace period between SIGTERM and the SIGKILL escalation when terminating a command.
const KILL_GRACE_MS = 3000;

export class BashTool implements Tool {
  // Use a hardcoded string instead of BashTool.name.replace("Tool", "")
  // because class names are not stable after minification — bundlers like
  // Terser/esbuild may rename or mangle them, producing incorrect tool names at runtime.
  name = "Bash";

  description: string = BASH_DESCRIPTION;
  category: ToolCategory = "command";

  // OS-level sandbox instance and config, injected externally
  sandbox: Sandbox | null = null;
  sandboxConfig: SandboxConfig = {
    allowWrite: [],
    denyWrite: [],
    networkEnabled: true,
  };

  /**
   * Read-only commands can run concurrently with other read-only tools;
   * mutating commands must run exclusively.
   *
   * Commands like ls, cat, git status don't mutate external state — same as
   * ReadFile — so there's no risk of interference. But rm, mv, npm install
   * would break the model's intended execution order if run concurrently.
   * The check reuses the permission layer's safe-command allowlist; redirects,
   * pipes, command chaining, and command substitution are already excluded.
   */
  isConcurrencySafe(args: Record<string, unknown>): boolean {
    const command = args.command;
    return typeof command === "string" && isSafeCommand(command);
  }

  schema(): ToolSchema {
    const inputSchema = {
      type: "object" as const,
      properties: {
        command: {
          type: "string" as const,
          description: "Shell command to execute",
        },
        timeout: {
          type: "integer" as const,
          description: "Timeout in seconds (max 600)",
          default: 120,
        },
      },
      required: ["command"],
    };

    return {
      name: this.name,
      description: this.description,
      input_schema: inputSchema,
    };
  }

  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    // TODO: Migrate manual parse to zod.
    const command = strArg(args, "command");
    if (!command) {
      return Promise.resolve({
        output: "Error: command is required",
        isError: true,
      });
    }

    let timeout = intArg(args, "timeout", 120);
    if (!Number.isFinite(timeout) || timeout <= 0) {
      return Promise.resolve({
        output: "Error: timeout must be a finite number greater than 0 seconds",
        isError: true,
      });
    }
    if (timeout > MAX_TIMEOUT) {
      timeout = MAX_TIMEOUT;
    }

    // Sandbox wrapping: if a sandbox is available, wrap the command in the sandbox environment
    let actualCommand = command;
    if (this.sandbox?.available()) {
      actualCommand = this.sandbox.wrap(command, this.sandboxConfig);
    }

    if (ctx.abortSignal?.aborted) {
      return Promise.resolve({
        output: "Error: command interrupted",
        isError: true,
      });
    }

    // Async execution keeps the Node event loop free: with spawnSync the TUI
    // froze (spinner animation, elapsed timers, keyboard input) for the whole
    // command duration.
    //
    // Timeout and abort are handled manually instead of via execFile's
    // timeout/signal options: those only SIGTERM the direct child, so a
    // command that spawns children (dev servers, npm scripts) or traps
    // SIGTERM keeps running and the callback never fires, wedging the agent
    // loop and making Esc appear dead. `detached` puts the child in its own
    // process group so the whole tree can be killed, with SIGKILL escalation
    // for processes that ignore SIGTERM.
    return new Promise<ToolResult>((resolve) => {
      let timedOut = false;
      let aborted = false;
      let terminating = false;
      let escalateTimer: NodeJS.Timeout | null = null;

      const child = spawn("bash", ["-c", actualCommand], {
        cwd: ctx.workDir,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Same 10MB cap as execFile's maxBuffer: on overflow the child is
      // killed and the truncated output is still returned.
      let stdout = "";
      let stderr = "";
      let total = 0;
      let outputTruncated = false;

      // Kill the child's whole process group; fall back to the direct child
      // when the group is already gone (or group kill is unsupported).
      const killTree = (signal: NodeJS.Signals) => {
        if (typeof child.pid !== "number") {
          return;
        }
        try {
          process.kill(-child.pid, signal);
        } catch {
          try {
            child.kill(signal);
          } catch {
            /* already dead */
          }
        }
      };

      const terminate = () => {
        if (terminating) {
          return;
        }
        terminating = true;
        killTree("SIGTERM");
        escalateTimer = setTimeout(() => {
          killTree("SIGKILL");
          // A daemonized grandchild can inherit the pipes and hold `close`
          // hostage; dropping our ends lets the callback fire once the
          // direct child is gone.
          child.stdout.destroy();
          child.stderr.destroy();
        }, KILL_GRACE_MS);
        escalateTimer.unref();
      };

      const appendChunk = (chunk: string, target: "stdout" | "stderr") => {
        if (outputTruncated) {
          return;
        }
        const remaining = MAX_SHELL_OUTPUT_BYTES - total;
        const piece = takeUtf8Prefix(chunk, remaining);
        total += utf8ByteLength(piece);
        if (piece.length < chunk.length) {
          outputTruncated = true;
          terminate();
        }
        if (target === "stdout") {
          stdout += piece;
        } else {
          stderr += piece;
        }
      };

      child.stdout.setEncoding("utf-8");
      child.stdout.on("data", (chunk: string) => {
        appendChunk(chunk, "stdout");
      });
      child.stderr.setEncoding("utf-8");
      child.stderr.on("data", (chunk: string) => {
        appendChunk(chunk, "stderr");
      });

      // `exit` can precede `close` while a descendant still holds inherited pipes.
      const onAbort = () => {
        aborted = true;
        terminate();
      };

      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, timeout * 1000);
      timeoutTimer.unref();

      ctx.abortSignal?.addEventListener("abort", onAbort, { once: true });
      if (ctx.abortSignal?.aborted) {
        onAbort();
      }

      const cleanup = () => {
        clearTimeout(timeoutTimer);
        if (escalateTimer) {
          clearTimeout(escalateTimer);
        }
        ctx.abortSignal?.removeEventListener("abort", onAbort);
      };

      // Spawn-level failure (e.g. bash not found): no close event guaranteed.
      child.on("error", (err) => {
        cleanup();
        resolve({
          output: `Error executing command: ${err.message}`,
          isError: true,
        });
      });

      child.on("close", (code, signal) => {
        cleanup();

        if (aborted) {
          const captured =
            stdout || stderr || outputTruncated
              ? formatShellOutput("$ ", command, stdout, stderr, outputTruncated)
              : "";
          resolve({
            output: captured
              ? `${captured}\nError: command interrupted`
              : "Error: command interrupted",
            isError: true,
          });
          return;
        }

        if (timedOut) {
          const captured =
            stdout || stderr || outputTruncated
              ? formatShellOutput("$ ", command, stdout, stderr, outputTruncated)
              : "";
          resolve({
            output: captured
              ? `${captured}\nError: command timed out after ${String(timeout)}s`
              : `Error: command timed out after ${String(timeout)}s`,
            isError: true,
          });
          return;
        }

        const exitCode = code ?? 0;
        let output = formatShellOutput("$ ", command, stdout, stderr, outputTruncated);

        if (outputTruncated) {
          resolve({ output, isError: true });
          return;
        }

        if (exitCode !== 0) {
          const hint = exitCodeHint(command, exitCode);
          output += hint
            ? `\nExit code ${String(exitCode)} (${hint})`
            : `\nExit code ${String(exitCode)}`;
        }

        if (code === null) {
          output += `\nProcess terminated${signal ? ` by ${signal}` : " unexpectedly"}`;
        }

        resolve({ output, isError: exitCode !== 0 || code === null });
      });
    });
  }
}
