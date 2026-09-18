import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createToolRegistry } from "@/bootstrap/tool-registry.js";
import { ConversationManager } from "@/conversation/index.js";
import { AnthropicClient } from "@/llm/anthropic.js";
import { OpenAIClient } from "@/llm/openai.js";
import { extractContent } from "@/permissions/index.js";
import { cloneRegistryForFork, filterToolsForAgent } from "@/subagent/tool-filter.js";
import { TaskList } from "@/todo/index.js";
import { ComputerUseTool } from "@/tools/computer-use.js";
import { ToolRegistry } from "@/tools/registry.js";
import type { ToolContext } from "@/tools/types.js";
import { asRecord } from "@/utils/index.js";

const context: ToolContext = { workDir: tmpdir() };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ComputerUseTool", () => {
  it("exposes Anthropic actions and OpenAI aliases through one custom schema", () => {
    const tool = new ComputerUseTool({ platform: "linux", environment: "browser" });
    const schema = tool.schema();
    const action = schema.input_schema.properties.action;

    expect(tool.name).toBe("ComputerUse");
    expect(tool.category).toBe("command");
    expect(tool.deferred).toBe(false);
    expect(tool.isConcurrencySafe({ action: "screenshot" })).toBe(false);
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

  it("exposes the OpenAI batch contract alongside Anthropic fields", () => {
    const tool = new ComputerUseTool({ platform: "linux" });
    const schema = tool.schema();

    expect(schema.input_schema.properties.actions).toMatchObject({
      type: "array",
      minItems: 1,
    });
    expect(schema.input_schema.properties.pendingSafetyChecks).toMatchObject({ type: "array" });
    expect(schema.input_schema.properties.status).toHaveProperty("enum", [
      "in_progress",
      "completed",
      "incomplete",
    ]);
    expect(schema.input_schema.required).toEqual([]);
  });

  it("serializes one schema for the anthropic, openai, and openai-compat protocols", () => {
    const registry = new ToolRegistry();
    registry.register(new ComputerUseTool({ platform: "linux" }));

    expect(registry.getAllSchemas("anthropic")[0]).toMatchObject({
      name: "computer",
      type: "computer_20251124",
      display_width_px: 1366,
      display_height_px: 900,
      enable_zoom: true,
    });
    expect(registry.getAllSchemas("openai")[0]).toEqual({ type: "computer" });
    expect(registry.getAllSchemas("openai-compat")[0]).toMatchObject({
      type: "function",
      function: { name: "ComputerUse" },
    });
  });

  it("sends the native OpenAI computer declaration through the Responses SDK", async () => {
    let request: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: unknown, init: RequestInit) => {
        request = asRecord(JSON.parse(z.string().parse(init.body)));
        return Promise.resolve(
          new Response(
            `event: response.completed\ndata: ${JSON.stringify({
              type: "response.completed",
              sequence_number: 0,
              response: {
                id: "resp_test",
                status: "completed",
                usage: { input_tokens: 1, output_tokens: 1 },
              },
            })}\n\n`,
            { headers: { "content-type": "text/event-stream" } },
          ),
        );
      }),
    );
    const registry = new ToolRegistry();
    registry.register(new ComputerUseTool({ platform: "linux" }));
    const conversation = new ConversationManager();
    conversation.addUserMessage("take a screenshot");
    const client = new OpenAIClient(
      {
        name: "test",
        protocol: "openai",
        base_url: "https://example.invalid",
        api_key: "test",
        model: "test",
      },
      "system",
    );

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _event of client.stream(conversation, registry.getAllSchemas("openai"))) {
      // drain
    }

    expect(request.tools).toEqual([{ type: "computer" }]);
  });

  it("sends the native Anthropic declaration and computer-use beta header", async () => {
    let request: Record<string, unknown> = {};
    let betaHeader = "";
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: unknown, init: RequestInit) => {
        request = asRecord(JSON.parse(z.string().parse(init.body)));
        betaHeader = new Headers(init.headers).get("anthropic-beta") ?? "";
        const events = [
          {
            type: "message_start",
            message: {
              id: "msg_test",
              type: "message",
              role: "assistant",
              model: "test",
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 0 },
            },
          },
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 1 },
          },
          { type: "message_stop" },
        ];
        return Promise.resolve(
          new Response(
            events
              .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
              .join(""),
            { headers: { "content-type": "text/event-stream" } },
          ),
        );
      }),
    );
    const registry = new ToolRegistry();
    registry.register(new ComputerUseTool({ platform: "linux" }));
    const conversation = new ConversationManager();
    conversation.addUserMessage("take a screenshot");
    const client = new AnthropicClient(
      {
        name: "test",
        protocol: "anthropic",
        base_url: "https://example.invalid",
        api_key: "test",
        model: "test",
      },
      "system",
    );

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _event of client.stream(conversation, registry.getAllSchemas("anthropic"))) {
      // drain
    }

    expect(request.tools).toEqual([
      expect.objectContaining({
        type: "computer_20251124",
        name: "computer",
        display_width_px: 1366,
        display_height_px: 900,
      }),
    ]);
    expect(betaHeader).toContain("computer-use-2025-11-24");
  });

  it("runs an OpenAI-style batch in order and returns the post-batch screenshot", async () => {
    const png = await sharp({
      create: { width: 800, height: 600, channels: 4, background: "#0a141e" },
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

    const result = await tool.execute(context, {
      actions: [
        { type: "move", x: 10, y: 20 },
        { type: "click", button: "right", x: 30, y: 40 },
        { type: "screenshot" },
      ],
      status: "in_progress",
      pendingSafetyChecks: [{ id: "check_1", code: "navigation" }],
    });

    expect(result.isError).toBe(false);
    expect(calls[0]).toEqual({
      command: "xdotool",
      args: ["mousemove", "--sync", "10", "20"],
    });
    expect(calls[1]).toEqual({
      command: "xdotool",
      args: ["mousemove", "--sync", "30", "40"],
    });
    expect(calls[2]).toEqual({
      command: "xdotool",
      args: ["click", "--repeat", "1", "--delay", "80", "3"],
    });
    expect(calls[3]?.command).toBe("gnome-screenshot");
    expect(result.contentBlocks?.[0]).toMatchObject({
      type: "image",
      source: { type: "base64", media_type: "image/png" },
    });
    expect(result.output).toContain("Executed 3 action(s): move, click, screenshot.");
    expect(result.output).toContain("Status: in_progress.");
    expect(result.output).toContain("Acknowledged safety checks: check_1.");
  });

  it("takes a follow-up screenshot when the batch has none", async () => {
    const png = await sharp({
      create: { width: 800, height: 600, channels: 4, background: "#0a141e" },
    })
      .png()
      .toBuffer();
    const commands: string[] = [];
    const runCommand = vi.fn(async (command: string, args: readonly string[]) => {
      commands.push(command);
      if (command === "gnome-screenshot" && args[1]) {
        await writeFile(args[1], png);
      }
      return { code: 0, stdout: Buffer.alloc(0), stderr: "" };
    });
    const tool = new ComputerUseTool({ platform: "linux", runCommand });

    const result = await tool.execute(context, {
      actions: [{ type: "keypress", keys: ["ctrl", "s"] }],
    });

    expect(result.isError).toBe(false);
    expect(commands).toContain("xdotool");
    expect(commands.at(-1)).toBe("gnome-screenshot");
    expect(result.contentBlocks?.[0]).toMatchObject({ type: "image" });
    expect(result.output).toContain("Executed 1 action(s): keypress.");
  });

  it("stops at the first failing action in a batch", async () => {
    const runCommand = vi.fn(() =>
      Promise.resolve({ code: 0, stdout: Buffer.alloc(0), stderr: "" }),
    );
    const tool = new ComputerUseTool({ platform: "linux", runCommand });

    const result = await tool.execute(context, {
      actions: [{ type: "click" }, { type: "screenshot" }],
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Error at actions[0] (click)");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("rejects mixing or omitting both call styles", async () => {
    const tool = new ComputerUseTool({ platform: "linux" });

    const both = await tool.execute(context, {
      action: "screenshot",
      actions: [{ type: "screenshot" }],
    });
    expect(both.isError).toBe(true);
    expect(both.output).toContain("not both");

    const neither = await tool.execute(context, {});
    expect(neither.isError).toBe(true);
    expect(neither.output).toContain("is required");
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

  it("summarizes batched OpenAI-style actions for permission rules", () => {
    expect(
      extractContent("ComputerUse", {
        actions: [
          { type: "move", x: 1, y: 2 },
          { type: "click", x: 3, y: 4 },
        ],
      }),
    ).toBe("move,click");
  });

  it("does not leak through a manually assembled subagent registry", () => {
    const registry = new ToolRegistry();
    registry.register(new ComputerUseTool({ platform: "linux" }));

    expect(filterToolsForAgent(registry, undefined, undefined, false).listTools()).toEqual([]);
  });
});
