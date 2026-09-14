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

import { execFile, spawn } from "node:child_process";

import { asRecord, intArg, strArg } from "../utils/index.js";

import { POWERSHELL_DESCRIPTION } from "./descriptions.js";
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

const MAX_TIMEOUT = 600;
// Grace period between the graceful kill and the forced-kill escalation.
const KILL_GRACE_MS = 3000;

export class PowerShellTool implements Tool {
  // Use a hardcoded string instead of PowerShellTool.name.replace("Tool", "")
  // because class names are not stable after minification — bundlers like
  // Terser/esbuild may rename or mangle them, producing incorrect tool names at runtime.
  name = "PowerShell";

  description: string = POWERSHELL_DESCRIPTION;
  category: ToolCategory = "command";

  schema(): ToolSchema {
    const inputSchema = {
      type: "object" as const,
      properties: {
        command: {
          type: "string" as const,
          description: "PowerShell command to execute",
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

    // No OS-sandbox wrapping here: the seatbelt/bwrap wrappers are bash-specific
    // (`... bash -c '...'`), and Windows — this tool's primary platform — has no
    // OS sandbox support anyway.
    const shell = process.platform === "win32" ? "powershell.exe" : "pwsh";

    if (ctx.abortSignal?.aborted) {
      return Promise.resolve({ output: "Error: command interrupted", isError: true });
    }

    // Async execution keeps the Node event loop free (see BashTool for details).
    //
    // Timeout and abort are handled manually instead of via execFile's
    // timeout/signal options: those only signal the direct child, so a
    // command that spawns children or ignores the signal keeps running and
    // the callback never fires, wedging the agent loop and making Esc appear
    // dead. On POSIX `detached` puts the child in its own process group so
    // the whole tree can be killed (SIGTERM, then SIGKILL escalation); on
    // Windows the tree is killed via `taskkill /T`, forced after the grace
    // period.
    return new Promise<ToolResult>((resolve) => {
      let timedOut = false;
      let aborted = false;
      let terminating = false;
      let escalateTimer: NodeJS.Timeout | null = null;

      const shellCommand =
        process.platform === "win32"
          ? "try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\n" + command
          : command;
      const shellArgs =
        process.platform === "win32"
          ? [
              "-NoProfile",
              "-NonInteractive",
              "-ExecutionPolicy",
              "Bypass",
              "-Command",
              shellCommand,
            ]
          : ["-NoProfile", "-NonInteractive", "-Command", shellCommand];
      const child = spawn(shell, shellArgs, {
        cwd: ctx.workDir,
        // Only POSIX needs its own process group for kill(-pid); the Windows
        // tree kill goes through taskkill and needs no new group.
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Same 10MB cap as execFile's maxBuffer: on overflow the child is
      // killed and the truncated output is still returned.
      let stdout = "";
      let stderr = "";
      let total = 0;
      let outputTruncated = false;

      const alreadyExited = () => child.exitCode !== null || child.signalCode !== null;

      // Kill the child's whole process tree; fall back to the direct child
      // when the group is already gone or the tree kill fails.
      const killTree = (signal: NodeJS.Signals) => {
        if (typeof child.pid !== "number") {
          return;
        }
        if (process.platform === "win32") {
          // taskkill /T terminates the whole tree; /F is the forced variant.
          const flags = ["/pid", String(child.pid), "/T"];
          if (signal === "SIGKILL") {
            flags.push("/F");
          }
          execFile("taskkill", flags, (err) => {
            if (err && !alreadyExited()) {
              try {
                child.kill(signal);
              } catch {
                /* already dead */
              }
            }
          });
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

      // Spawn-level failure (e.g. pwsh not installed): no close event guaranteed.
      child.on("error", (err) => {
        cleanup();
        const hint =
          strArg(asRecord(err), "code") === "ENOENT" && process.platform !== "win32"
            ? " (pwsh is required on macOS/Linux — install PowerShell Core)"
            : "";
        resolve({
          output: `Error executing command: ${err.message}${hint}`,
          isError: true,
        });
      });

      child.on("close", (code, signal) => {
        cleanup();

        if (aborted) {
          const captured =
            stdout || stderr || outputTruncated
              ? formatShellOutput("PS> ", command, stdout, stderr, outputTruncated)
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
              ? formatShellOutput("PS> ", command, stdout, stderr, outputTruncated)
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
        let output = formatShellOutput("PS> ", command, stdout, stderr, outputTruncated);

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
