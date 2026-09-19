import { randomBytes } from "node:crypto";

import { z } from "zod";

import { JAVASCRIPT_BACKGROUND_DESCRIPTION, JAVASCRIPT_DESCRIPTION } from "./descriptions.js";
import {
  BACKGROUND_NOTIFICATION_CHARS,
  backgroundTaskName,
  type BackgroundReason,
  type CommandHandle,
} from "./shell-background.js";
import type { Tool, ToolCategory, ToolContext, ToolResult, ToolSchema } from "./types.js";

import { TaskFailure, type TaskManager } from "@/subagent/task-manager.js";
import { persistLargeResult } from "@/tool-result/index.js";
import { asErrorString } from "@/utils/index.js";

const DEFAULT_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 10_000;
const DEFAULT_MEMORY_LIMIT_MB = 64;
const MAX_MEMORY_LIMIT_MB = 256;
const MAX_CODE_BYTES = 256 * 1024;
const MAX_LOG_CHARS = 64 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;

const JavaScriptArgumentsSchema = z.object({
  code: z.string().min(1),
  input: z.json().optional(),
  timeout_ms: z.number().int().min(1).max(MAX_TIMEOUT_MS).default(DEFAULT_TIMEOUT_MS),
  memory_limit_mb: z
    .number()
    .int()
    .min(8)
    .max(MAX_MEMORY_LIMIT_MB)
    .default(DEFAULT_MEMORY_LIMIT_MB),
  // Accepted even when backgrounding is unavailable (then simply ignored):
  // the JSON schema gates what the model sees per host.
  run_in_background: z.boolean().optional(),
});

const JavaScriptEvaluationOptionsSchema = z.object({
  input: z.json().optional(),
  timeoutMs: z.number().int().min(1).max(MAX_TIMEOUT_MS).default(DEFAULT_TIMEOUT_MS),
  memoryLimitMb: z.number().int().min(8).max(MAX_MEMORY_LIMIT_MB).default(DEFAULT_MEMORY_LIMIT_MB),
});

const JavaScriptEvaluationSchema = z.object({
  logs: z.array(z.string()),
  value: z.json(),
  logsTruncated: z.boolean(),
});

export type JavaScriptEvaluation = z.infer<typeof JavaScriptEvaluationSchema>;
export type JavaScriptEvaluationOptions = z.input<typeof JavaScriptEvaluationOptionsSchema> & {
  abortSignal?: AbortSignal;
};

export function isolatedVmSupported(nodeVersion = process.versions.node): boolean {
  const major = Number.parseInt(nodeVersion.split(".")[0] ?? "", 10);
  return Number.isFinite(major) && major >= 24;
}

export async function evaluateJavaScript(
  code: string,
  options: JavaScriptEvaluationOptions = {},
): Promise<JavaScriptEvaluation> {
  const { abortSignal, ...values } = options;
  const parsed = JavaScriptEvaluationOptionsSchema.parse(values);
  return await runJavaScript(
    code,
    parsed.input,
    parsed.timeoutMs,
    parsed.memoryLimitMb,
    abortSignal,
  );
}

async function runJavaScript(
  code: string,
  input: z.infer<typeof JavaScriptEvaluationOptionsSchema>["input"],
  timeoutMs: number,
  memoryLimitMb: number,
  abortSignal?: AbortSignal,
): Promise<JavaScriptEvaluation> {
  if (!isolatedVmSupported()) {
    throw new Error("isolated-vm requires Node.js 24 or newer");
  }
  if (Buffer.byteLength(code) > MAX_CODE_BYTES) {
    throw new Error(`JavaScript source exceeds the ${String(MAX_CODE_BYTES)} byte limit`);
  }

  abortSignal?.throwIfAborted();
  const module = await import("isolated-vm");
  abortSignal?.throwIfAborted();
  const ivm = module.default;
  const isolate = new ivm.Isolate({ memoryLimit: memoryLimitMb });
  const context = await isolate.createContext();
  const onAbort = () => {
    if (!isolate.isDisposed) {
      isolate.dispose();
    }
  };
  abortSignal?.addEventListener("abort", onAbort, { once: true });
  let wallTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (abortSignal?.aborted) {
      // An abort that landed during isolate startup never fires the listener
      // (addEventListener on an already-aborted signal is a no-op): dispose
      // now and surface the interruption instead of running to the V8 cap.
      onAbort();
      abortSignal.throwIfAborted();
    }

    await context.global.set("input", input ?? null, { copy: true });
    const source = `
(async () => {
  "use strict";
  const __logs = [];
  let __logChars = 0;
  let __logsTruncated = false;
  const __format = (value) => {
    if (typeof value === "string") return value;
    if (typeof value === "bigint") return String(value) + "n";
    try {
      const encoded = JSON.stringify(value);
      return encoded === undefined ? String(value) : encoded;
    } catch {
      try { return String(value); } catch { return "[unprintable]"; }
    }
  };
  const __write = (...values) => {
    if (__logsTruncated) return;
    const line = values.map(__format).join(" ");
    const remaining = ${String(MAX_LOG_CHARS)} - __logChars;
    if (line.length > remaining) {
      if (remaining > 0) __logs.push(line.slice(0, remaining));
      __logChars = ${String(MAX_LOG_CHARS)};
      __logsTruncated = true;
      return;
    }
    __logs.push(line);
    __logChars += line.length;
  };
  const console = Object.freeze({ log: __write, info: __write, warn: __write, error: __write });
  const __value = await (async () => {
${code}
  })();
  const __payload = JSON.stringify({
    logs: __logs,
    value: __value === undefined ? null : __value,
    logsTruncated: __logsTruncated,
  });
  if (__payload === undefined) throw new Error("Result is not JSON serializable");
  if (__payload.length > ${String(MAX_OUTPUT_BYTES)}) throw new Error("Result exceeds output limit");
  return __payload;
})()
`;
    const evaluation = context.eval(source, {
      timeout: timeoutMs,
      promise: true,
      copy: true,
      filename: "swifty-sandbox.js",
    });
    const deadline = new Promise<never>((_, reject) => {
      wallTimer = setTimeout(() => {
        reject(new Error(`JavaScript evaluation timed out after ${String(timeoutMs)}ms`));
        onAbort();
      }, timeoutMs);
    });
    const raw: unknown = await Promise.race([evaluation, deadline]);
    if (typeof raw !== "string") {
      throw new Error("JavaScript sandbox returned an invalid result");
    }
    if (Buffer.byteLength(raw) > MAX_OUTPUT_BYTES) {
      throw new Error("JavaScript sandbox result exceeds output limit");
    }
    const decoded: unknown = JSON.parse(raw);
    return JavaScriptEvaluationSchema.parse(decoded);
  } finally {
    clearTimeout(wallTimer);
    abortSignal?.removeEventListener("abort", onAbort);
    try {
      context.release();
    } catch {
      // The context is already invalid after isolate disposal.
    }
    if (!isolate.isDisposed) {
      isolate.dispose();
    }
  }
}

function formatEvaluation(result: JavaScriptEvaluation): string {
  const sections: string[] = [];
  if (result.logs.length > 0) {
    sections.push(`Console:\n${result.logs.join("\n")}`);
  }
  if (result.logsTruncated) {
    sections.push("Console output truncated");
  }
  sections.push(`Result:\n${JSON.stringify(result.value, null, 2)}`);
  return sections.join("\n\n");
}

function jsBackgroundMessage(reason: BackgroundReason, taskId: string): string {
  return reason === "user"
    ? `JavaScript evaluation was manually backgrounded by the user (task_id: ${taskId}). It is still running — you will be notified when it completes.`
    : `JavaScript running in background (task_id: ${taskId}). You will be notified when it completes; do not poll. Use TaskStop with task_id to abort it early.`;
}

export class JavaScriptTool implements Tool {
  name = "JavaScript";
  description = JAVASCRIPT_DESCRIPTION;
  category: ToolCategory = "command";

  /**
   * Background task registry, injected by the host — same contract as
   * BashTool.taskManager. Unlike the shell tools there is no timeout
   * auto-background: timeout_ms is the isolate's hard safety cap — V8 kills a
   * synchronous script at the cap, and a wall-clock deadline disposes the
   * isolate when an evaluation is suspended on a promise — so nothing is left
   * to keep running.
   */
  taskManager: TaskManager | null = null;

  /** Running foreground evaluations eligible for manual backgrounding (Ctrl+B). */
  private foreground = new Map<string, { background: () => boolean }>();
  private nextForegroundId = 1;

  /** Instance-level background gate; see BashTool.backgroundEnabled. */
  backgroundEnabled(): boolean {
    return this.taskManager !== null && process.env.SWIFTY_DISABLE_BACKGROUND_TASKS !== "1";
  }

  /** True while at least one foreground evaluation runs. */
  hasForegroundTasks(): boolean {
    return this.foreground.size > 0;
  }

  /** Move every running foreground evaluation to the background (Ctrl+B). */
  backgroundForegroundTasks(): number {
    let count = 0;
    for (const entry of [...this.foreground.values()]) {
      if (entry.background()) {
        count++;
      }
    }
    return count;
  }

  schema(): ToolSchema {
    const properties: Record<string, object> = {
      code: {
        type: "string",
        description: "JavaScript function body to execute; use return to produce a result",
      },
      input: {
        description: "Optional JSON-compatible value exposed as globalThis.input",
      },
      timeout_ms: {
        type: "integer",
        minimum: 1,
        maximum: MAX_TIMEOUT_MS,
        default: DEFAULT_TIMEOUT_MS,
      },
      memory_limit_mb: {
        type: "integer",
        minimum: 8,
        maximum: MAX_MEMORY_LIMIT_MB,
        default: DEFAULT_MEMORY_LIMIT_MB,
      },
    };
    let description = this.description;
    if (this.backgroundEnabled()) {
      properties.run_in_background = {
        type: "boolean",
        description:
          "Run the evaluation in the background. Returns a task ID immediately; the result arrives later as a task notification.",
        default: false,
      };
      description = `${this.description}\n${JAVASCRIPT_BACKGROUND_DESCRIPTION}`;
    }
    return {
      name: this.name,
      description,
      input_schema: {
        type: "object",
        properties,
        required: ["code"],
        additionalProperties: false,
      },
    };
  }

  async execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const parsed = JavaScriptArgumentsSchema.safeParse(args);
    if (!parsed.success) {
      return { output: `Error: ${parsed.error.message}`, isError: true };
    }

    // `ctx.taskManager === null` explicitly disables backgrounding for this
    // call (in-process teammate turns) and must not fall back to the instance
    // manager; only `undefined` (no loop-level decision) falls back.
    const manager = ctx.taskManager !== undefined ? ctx.taskManager : this.taskManager;
    const backgroundAvailable =
      manager !== null && process.env.SWIFTY_DISABLE_BACKGROUND_TASKS !== "1";
    const runInBackground = parsed.data.run_in_background === true && backgroundAvailable;

    const handle = this.startEvaluation(ctx, parsed.data, manager, backgroundAvailable);
    if (runInBackground) {
      const taskId = handle.background("explicit");
      if (taskId !== null) {
        return {
          output: jsBackgroundMessage("explicit", taskId),
          isError: false,
        };
      }
      // The evaluation ended before it could be backgrounded; report its actual result.
    }
    return handle.result;
  }

  /**
   * Start the isolated evaluation. The returned handle mirrors the shell
   * tools: background() transitions the pending evaluation into a TaskManager
   * task — the isolate keeps running on its own thread, the tool call
   * resolves immediately, and completion arrives as a task notification.
   * While foreground, the caller's abort signal (Esc) disposes the isolate;
   * once backgrounded, only TaskStop or session shutdown can abort it.
   */
  private startEvaluation(
    ctx: ToolContext,
    data: z.infer<typeof JavaScriptArgumentsSchema>,
    manager: TaskManager | null,
    backgroundAvailable: boolean,
  ): CommandHandle {
    let backgroundFn: ((reason: BackgroundReason) => string | null) | undefined;
    const result = new Promise<ToolResult>((resolve) => {
      let settled = false;
      let backgrounded = false;

      // Internal controller forwards the caller's abort only while foreground.
      const controller = new AbortController();
      const onCallerAbort = () => {
        controller.abort();
      };

      if (ctx.abortSignal?.aborted) {
        resolve({ output: "Error: command interrupted", isError: true });
        return;
      }
      ctx.abortSignal?.addEventListener("abort", onCallerAbort, { once: true });

      const evalPromise = runJavaScript(
        data.code,
        data.input,
        data.timeout_ms,
        data.memory_limit_mb,
        controller.signal,
      );

      const foregroundKey = `js-${String(this.nextForegroundId++)}`;

      const settle = (finalResult: ToolResult) => {
        if (settled) {
          // Already resolved: backgroundExecution moved the evaluation to the
          // background (its task runner owns the completion from here).
          return;
        }
        settled = true;
        ctx.abortSignal?.removeEventListener("abort", onCallerAbort);
        this.foreground.delete(foregroundKey);
        resolve(finalResult);
      };

      const backgroundExecution = (reason: BackgroundReason): string | null => {
        if (
          backgrounded ||
          settled ||
          controller.signal.aborted ||
          !manager ||
          !backgroundAvailable
        ) {
          return null;
        }
        backgrounded = true;
        settled = true;
        ctx.abortSignal?.removeEventListener("abort", onCallerAbort);
        this.foreground.delete(foregroundKey);

        const task = manager.create(
          backgroundTaskName(data.code),
          async (backgroundTask) => {
            // Evaluation results can reach the 1MB sandbox ceiling; spill
            // anything past the notification budget like the shell tools do.
            // The random suffix keeps filenames unique across concurrent
            // TaskManagers: task IDs are per-manager counters, and subagent
            // runs share the "default" session spill dir, so a bare
            // `<taskId>.txt` would collide (writeSpill's wx flag silently
            // reuses the first writer's content).
            const cap = (text: string): string =>
              text.length > BACKGROUND_NOTIFICATION_CHARS
                ? persistLargeResult(
                    ctx.workDir,
                    ctx.sessionId ?? "",
                    `${backgroundTask.id}-${randomBytes(4).toString("hex")}`,
                    text,
                  )
                : text;
            try {
              const evaluation = await evalPromise;
              return cap(formatEvaluation(evaluation));
            } catch (error) {
              // A stop's own fallout (dispose/timeout errors arriving after
              // cancel) is not a result worth surfacing: rethrow plainly so
              // the task keeps "Stopped by user". Genuine failures carry
              // their formatted text via TaskFailure.
              if (backgroundTask.status === "cancelled") {
                throw error;
              }
              throw new TaskFailure(cap(`Error executing JavaScript: ${asErrorString(error)}`));
            }
          },
          () => {
            // Request isolate disposal. Note: dispose() cannot interrupt a
            // synchronous script already running — only the timeout_ms cap
            // (V8's script timeout, or runJavaScript's wall-clock deadline for
            // an evaluation suspended on a promise) is a hard kill. The task
            // is reported cancelled immediately and the runner's late result
            // is discarded by the task manager.
            controller.abort();
          },
          { originToolCallId: ctx.toolCallId, idPrefix: "js", kind: "js" },
        );
        resolve({
          output: jsBackgroundMessage(reason, task.id),
          isError: false,
        });
        return task.id;
      };

      if (backgroundAvailable) {
        this.foreground.set(foregroundKey, {
          background: () => backgroundExecution("user") !== null,
        });
      }

      evalPromise.then(
        (evaluation) => {
          settle({ output: formatEvaluation(evaluation), isError: false });
        },
        (error: unknown) => {
          settle({
            output: `Error executing JavaScript: ${asErrorString(error)}`,
            isError: true,
          });
        },
      );

      backgroundFn = backgroundExecution;
    });

    return {
      result,
      background: (reason) => backgroundFn?.(reason) ?? null,
    };
  }
}
