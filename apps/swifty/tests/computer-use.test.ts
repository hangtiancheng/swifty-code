import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { createToolRegistry } from "@/bootstrap/tool-registry.js";
import { extractContent } from "@/permissions/checker.js";
import { cloneRegistryForFork, filterToolsForAgent } from "@/subagent/tool-filter.js";
import { TaskList } from "@/todo/todo.js";
import { ComputerUseTool } from "@/tools/computer-use.js";
import { ToolRegistry } from "@/tools/registry.js";
import type { ToolContext } from "@/tools/types.js";

const context: ToolContext = { workDir: tmpdir() };

describe("ComputerUseTool", () => {
  it("exposes Anthropic actions and OpenAI aliases through one custom schema", () => {
    const tool = new ComputerUseTool({ platform: "linux", environment: "browser" });
    const schema = tool.schema();
    const action = schema.input_schema.properties.action;

    expect(tool.name).toBe("ComputerUse");
    expect(tool.category).toBe("command");
    expect(tool.isConcurrencySafe()).toBe(false);
    expect(action).toMatchObject({ type: "string" });
    expect(action).toHaveProperty(
      "enum",
      expect.arrayContaining(["left_click", "zoom", "click", "drag", "keypress"]),
    );
    expect(tool.description).toContain("browser");
  });

  it("rejects invalid action arguments without invoking the host", async () => {
    const runCommand = vi.fn(() =>
      Promise.resolve({ code: 0, stdout: Buffer.alloc(0), stderr: "" }),
    );
    const tool = new ComputerUseTool({ platform: "linux", runCommand });

    const result = await tool.execute(context, { action: "left_click" });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("requires coordinate or x and y");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("normalizes OpenAI click actions for the Linux backend", async () => {
    const runCommand = vi.fn(() =>
      Promise.resolve({ code: 0, stdout: Buffer.alloc(0), stderr: "" }),
    );
    const tool = new ComputerUseTool({ platform: "linux", runCommand });

    const result = await tool.execute(context, {
      action: "click",
      button: "right",
      x: 20,
      y: 30,
    });

    expect(result.isError).toBe(false);
    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      "xdotool",
      ["mousemove", "--sync", "20", "30"],
      expect.objectContaining({}),
    );
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      "xdotool",
      ["click", "--repeat", "1", "--delay", "80", "3"],
      expect.objectContaining({}),
    );
  });

  it("returns screenshots as image tool-result blocks and scales later coordinates", async () => {
    const png = await sharp({
      create: {
        width: 2_000,
        height: 1_000,
        channels: 4,
        background: "#0a141e",
      },
    })
      .png()
      .toBuffer();
    const calls: { command: string; args: readonly string[] }[] = [];
    const runCommand = vi.fn(async (command: string, args: readonly string[]) => {
      calls.push({ command, args });
      if (command === "gnome-screenshot") {
        const outputPath = args[1];
        if (!outputPath) {
          throw new Error("missing screenshot path");
        }
        await writeFile(outputPath, png);
      }
      return { code: 0, stdout: Buffer.alloc(0), stderr: "" };
    });
    const tool = new ComputerUseTool({ platform: "linux", runCommand });

    const screenshot = await tool.execute(context, { action: "screenshot" });
    expect(screenshot.isError).toBe(false);
    expect(screenshot.output).toContain("Screenshot 1366x683");
    expect(screenshot.contentBlocks?.[0]).toMatchObject({
      type: "image",
      source: { type: "base64", media_type: "image/png" },
    });

    await tool.execute(context, { action: "mouse_move", coordinate: [683, 342] });
    expect(calls.at(-1)).toEqual({
      command: "xdotool",
      args: ["mousemove", "--sync", "1000", "501"],
    });
  });
});

describe("ComputerUse availability", () => {
  it("registers for main agents and filters from all subagent registry paths", () => {
    const main = createToolRegistry(process.cwd(), new TaskList());
    expect(main.get("ComputerUse")).toBeInstanceOf(ComputerUseTool);

    const filtered = filterToolsForAgent(main, ["*"], undefined, false);
    expect(filtered.get("ComputerUse")).toBeUndefined();

    const forked = cloneRegistryForFork(main);
    expect(forked.get("ComputerUse")).toBeUndefined();
  });

  it("scopes permission rules to the requested action", () => {
    expect(extractContent("ComputerUse", { action: "screenshot" })).toBe("screenshot");
  });

  it("does not leak through a manually assembled subagent registry", () => {
    const registry = new ToolRegistry();
    registry.register(new ComputerUseTool({ platform: "linux" }));

    expect(filterToolsForAgent(registry, undefined, undefined, false).listTools()).toEqual([]);
  });
});
