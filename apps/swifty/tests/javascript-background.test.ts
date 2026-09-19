import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TaskManager } from "@/subagent/task-manager.js";
import { isolatedVmSupported, JavaScriptTool } from "@/tools/javascript.js";
import type { ToolContext } from "@/tools/types.js";

const describeIsolatedVm = isolatedVmSupported() ? describe : describe.skip;

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workDir: mkdtempSync(join(tmpdir(), "swifty-js-bg-")),
    ...overrides,
  };
}

function makeTool(): { js: JavaScriptTool; tasks: TaskManager } {
  const js = new JavaScriptTool();
  const tasks = new TaskManager();
  js.taskManager = tasks;
  return { js, tasks };
}

function taskIdFrom(output: string): string {
  const match = /task_id: (js-\d+)\)/.exec(output);
  expect(match, `expected a task_id in: ${output}`).not.toBeNull();
  return match?.[1] ?? "";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describeIsolatedVm("JavaScript background execution", () => {
  it("gates run_in_background on the task manager", () => {
    const bare = new JavaScriptTool();
    expect(bare.backgroundEnabled()).toBe(false);
    expect(JSON.stringify(bare.schema())).not.toContain("run_in_background");

    const { js } = makeTool();
    expect(js.backgroundEnabled()).toBe(true);
    expect(JSON.stringify(js.schema())).toContain("run_in_background");
  });

  it("runs run_in_background evaluations as tasks and notifies with the result", async () => {
    const { js, tasks } = makeTool();
    const result = await js.execute(makeContext(), {
      code: "console.log('bg-log'); return 21 * 2;",
      run_in_background: true,
    });
    expect(result.isError).toBe(false);
    expect(result.output).toContain("do not poll");
    const taskId = taskIdFrom(result.output);

    const task = tasks.get(taskId);
    await task?.done;
    expect(task?.status).toBe("completed");
    expect(task?.output).toContain("bg-log");
    expect(task?.output).toContain("42");
  });

  it("marks throwing evaluations as failed with the error preserved", async () => {
    const { js, tasks } = makeTool();
    const result = await js.execute(makeContext(), {
      code: "throw new Error('boom-js');",
      run_in_background: true,
    });
    const taskId = taskIdFrom(result.output);
    const task = tasks.get(taskId);
    await task?.done;
    expect(task?.status).toBe("failed");
    expect(task?.output).toContain("boom-js");
    expect(task?.output).toContain("Error executing JavaScript");
  });

  it("backgrounds a running evaluation on demand (Ctrl+B path)", async () => {
    const { js, tasks } = makeTool();
    const pending = js.execute(makeContext(), {
      code: "const t = Date.now(); while (Date.now() - t < 1200) {} return 'js-manual';",
      timeout_ms: 5000,
    });
    await sleep(200);
    expect(js.hasForegroundTasks()).toBe(true);
    expect(js.backgroundForegroundTasks()).toBe(1);
    expect(js.hasForegroundTasks()).toBe(false);

    const result = await pending;
    expect(result.isError).toBe(false);
    expect(result.output).toContain("manually backgrounded by the user");
    const taskId = taskIdFrom(result.output);

    const task = tasks.get(taskId);
    await task?.done;
    expect(task?.status).toBe("completed");
    expect(task?.output).toContain("js-manual");
  }, 10_000);

  it("marks a stopped background evaluation cancelled (isolate ends at its timeout cap)", async () => {
    const { js, tasks } = makeTool();
    const result = await js.execute(makeContext(), {
      code: "const t = Date.now(); while (Date.now() - t < 8000) {} return 'never';",
      timeout_ms: 2000,
      run_in_background: true,
    });
    const taskId = taskIdFrom(result.output);
    const task = tasks.get(taskId);
    expect(task?.status).toBe("running");

    // stop() marks the task cancelled immediately. isolate.dispose() cannot
    // interrupt a synchronous script already running — V8's timeout_ms is the
    // only hard kill — so the loop ends at the 2s cap and the runner's late
    // result is discarded.
    expect(tasks.stop(taskId)).toBe(true);
    expect(task?.status).toBe("cancelled");
    const stopped = Date.now();
    await task?.done;
    expect(Date.now() - stopped).toBeLessThan(4000);
    expect(task?.status).toBe("cancelled");
    expect(task?.output).toBe("Stopped by user");
  }, 15_000);

  it("prefers ctx.taskManager over the instance default", async () => {
    const ctxManager = new TaskManager();
    const instanceManager = new TaskManager();
    const js = new JavaScriptTool();
    js.taskManager = instanceManager;

    const result = await js.execute(makeContext({ taskManager: ctxManager }), {
      code: "return 'routed';",
      run_in_background: true,
    });
    const taskId = taskIdFrom(result.output);
    expect(ctxManager.get(taskId)).toBeDefined();
    expect(instanceManager.list()).toHaveLength(0);
    await ctxManager.get(taskId)?.done;
    expect(ctxManager.get(taskId)?.output).toContain("routed");
  });

  it("keeps foreground behavior unchanged without a task manager", async () => {
    const js = new JavaScriptTool();
    const result = await js.execute(makeContext(), {
      code: "return 'fg';",
      // Ignored when no task manager is wired: the evaluation runs inline.
      run_in_background: true,
    });
    expect(result.isError).toBe(false);
    expect(result.output).toContain("Result:");
    expect(result.output).toContain("fg");
  });

  it("spills concurrent same-ID background results to distinct files", async () => {
    // Task IDs are per-manager counters: two concurrent loops both produce
    // "js-1", and runs without a sessionId share the "default" session spill
    // dir. The random filename suffix must keep the second task's notification
    // from pointing at the first task's content (writeSpill's wx flag would
    // otherwise silently reuse the existing file).
    const workDir = mkdtempSync(join(tmpdir(), "swifty-js-spill-"));
    const first = makeTool();
    const second = makeTool();
    const spillPath = async (tool: ReturnType<typeof makeTool>, letter: string) => {
      const result = await tool.js.execute(
        { workDir },
        { code: `return '${letter}'.repeat(40000);`, run_in_background: true },
      );
      const task = tool.tasks.get(taskIdFrom(result.output));
      await task?.done;
      expect(task?.status).toBe("completed");
      const match = /Full content saved to:\n(\S+)/.exec(task?.output ?? "");
      expect(
        match,
        `expected a persisted path in: ${task?.output.slice(0, 200) ?? ""}`,
      ).not.toBeNull();
      return match?.[1] ?? "";
    };
    const [pathA, pathB] = await Promise.all([spillPath(first, "a"), spillPath(second, "b")]);
    expect(pathA).not.toBe(pathB);
    expect(readFileSync(pathA, "utf-8")).toContain("a".repeat(1000));
    expect(readFileSync(pathB, "utf-8")).toContain("b".repeat(1000));
  }, 20_000);
});
