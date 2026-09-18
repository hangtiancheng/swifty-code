import { describe, expect, it } from "vitest";

import { createToolRegistry } from "@/bootstrap/tool-registry.js";
import { TaskList } from "@/todo/index.js";
import { evaluateJavaScript, isolatedVmSupported, JavaScriptTool } from "@/tools/javascript.js";
import type { ToolContext } from "@/tools/types.js";

const context: ToolContext = { workDir: process.cwd() };

const describeIsolatedVm = isolatedVmSupported() ? describe : describe.skip;

describe("JavaScriptTool", () => {
  it("is registered as a model-callable tool", () => {
    const registry = createToolRegistry(process.cwd(), new TaskList());
    expect(registry.get("JavaScript")).toBeInstanceOf(JavaScriptTool);
  });

  it("rejects invalid arguments at the tool boundary", async () => {
    const result = await new JavaScriptTool().execute(context, { code: "" });
    expect(result.isError).toBe(true);
  });

  it("detects unsupported Node versions without loading the native addon", () => {
    expect(isolatedVmSupported("20.19.0")).toBe(false);
    expect(isolatedVmSupported("24.0.0")).toBe(true);
  });
});

describeIsolatedVm("isolated JavaScript evaluation", () => {
  it("copies JSON input and returns JSON output", async () => {
    const result = await evaluateJavaScript("return { sum: input.a + input.b };", {
      input: { a: 19, b: 23 },
    });

    expect(result).toEqual({ logs: [], value: { sum: 42 }, logsTruncated: false });
  });

  it("captures console output without exposing Node host capabilities", async () => {
    const result = await evaluateJavaScript(
      'console.log("sandboxed"); return { process: typeof process, require: typeof require };',
    );

    expect(result).toEqual({
      logs: ["sandboxed"],
      value: { process: "undefined", require: "undefined" },
      logsTruncated: false,
    });
  });

  it("interrupts non-terminating code", async () => {
    await expect(evaluateJavaScript("while (true) {}", { timeoutMs: 20 })).rejects.toThrow();
  });

  it("uses a fresh global context for each invocation", async () => {
    await evaluateJavaScript("globalThis.saved = 42; return null;");
    const result = await evaluateJavaScript("return typeof globalThis.saved;");

    expect(result.value).toBe("undefined");
  });
});
