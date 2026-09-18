import { z } from "zod";

import { JAVASCRIPT_DESCRIPTION } from "./descriptions.js";
import type { Tool, ToolCategory, ToolContext, ToolResult, ToolSchema } from "./types.js";

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
  const ivm = module.default;
  const isolate = new ivm.Isolate({ memoryLimit: memoryLimitMb });
  const context = await isolate.createContext();
  const onAbort = () => {
    isolate.dispose();
  };
  abortSignal?.addEventListener("abort", onAbort, { once: true });

  try {
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
    const raw: unknown = await context.eval(source, {
      timeout: timeoutMs,
      promise: true,
      copy: true,
      filename: "swifty-sandbox.js",
    });
    if (typeof raw !== "string") {
      throw new Error("JavaScript sandbox returned an invalid result");
    }
    if (Buffer.byteLength(raw) > MAX_OUTPUT_BYTES) {
      throw new Error("JavaScript sandbox result exceeds output limit");
    }
    const decoded: unknown = JSON.parse(raw);
    return JavaScriptEvaluationSchema.parse(decoded);
  } finally {
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

export class JavaScriptTool implements Tool {
  name = "JavaScript";
  description = JAVASCRIPT_DESCRIPTION;
  category: ToolCategory = "command";

  schema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
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
        },
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

    try {
      const result = await runJavaScript(
        parsed.data.code,
        parsed.data.input,
        parsed.data.timeout_ms,
        parsed.data.memory_limit_mb,
        ctx.abortSignal,
      );
      const sections: string[] = [];
      if (result.logs.length > 0) {
        sections.push(`Console:\n${result.logs.join("\n")}`);
      }
      if (result.logsTruncated) {
        sections.push("Console output truncated");
      }
      sections.push(`Result:\n${JSON.stringify(result.value, null, 2)}`);
      return { output: sections.join("\n\n"), isError: false };
    } catch (error) {
      return { output: `Error executing JavaScript: ${asErrorString(error)}`, isError: true };
    }
  }
}
