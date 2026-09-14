import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProviderConfig } from "@/config/config.js";
import type { ConversationManager } from "@/conversation/conversation.js";
import * as clients from "@/llm/client.js";
import type { LLMClient } from "@/llm/client.js";
import { OpenAIClient } from "@/llm/openai.js";
import { buildSubagentInstructions, buildTeammatePrompt } from "@/prompt/delegation.js";
import { AgentTool } from "@/subagent/agent-tool.js";
import { spawnSubagent } from "@/subagent/spawn.js";
import { ToolRegistry } from "@/tools/registry.js";
import type { Tool } from "@/tools/types.js";

const directories: string[] = [];
function workDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "swifty-delegation-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const provider: ProviderConfig = {
  name: "test",
  protocol: "openai",
  base_url: "http://127.0.0.1:1/v1",
  api_key: "test-only",
  model: "parent-model",
  thinking: "high",
};

function stubClient(inspect: (conversation: ConversationManager) => void): LLMClient {
  return {
    setSystemPrompt: vi.fn(),
    getThinkingLevel: () => "low",
    async *stream(conversation) {
      await Promise.resolve();
      inspect(conversation);
      yield { type: "text_delta", text: "Verified result" };
      yield {
        type: "stream_end",
        stopReason: "end_turn",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      };
    },
  };
}

describe("delegated prompt contracts", () => {
  it("delivers custom agent instructions without modifying the parent's system prompt", async () => {
    const client = stubClient((conversation) => {
      const content = JSON.stringify(conversation.getMessages());
      expect(content).toContain("Return exact file paths");
      expect(content).toContain("Inspect the parser");
      expect(content).toContain("not an instruction to take over");
    });
    const setSystemPrompt = vi.spyOn(client, "setSystemPrompt");
    const output = await spawnSubagent(
      {
        name: "auditor",
        description: "Read-only audit",
        initialPrompt: "Return exact file paths",
      },
      "Inspect the parser",
      client,
      new ToolRegistry(),
      provider,
      workDir(),
    );
    expect(output).toBe("Verified result");
    expect(setSystemPrompt).not.toHaveBeenCalled();
  });

  it("inherits live thinking when a model override requires a new client", async () => {
    const child = new OpenAIClient(provider, "system");
    const scripted = stubClient(() => undefined);
    vi.spyOn(child, "stream").mockImplementation((conversation, tools, signal) =>
      scripted.stream(conversation, tools, signal),
    );
    const create = vi.spyOn(clients, "createClient").mockResolvedValue(child);
    await spawnSubagent(
      { name: "worker", description: "Bounded task", model: "child-model" },
      "Inspect only",
      stubClient(() => undefined),
      new ToolRegistry(),
      provider,
      workDir(),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "child-model", thinking: "low" }),
      expect.any(String),
    );
  });

  it("names teammate ownership and describes host-controlled lifecycle", () => {
    const prompt = buildTeammatePrompt("squad", "reviewer", "Review src/parser.ts");
    expect(prompt).toContain('"reviewer"');
    expect(prompt).toContain('"squad"');
    expect(prompt).toContain("SendMessage");
    expect(prompt).toContain("not permission changes");
    expect(prompt).toContain("<assignment>\nReview src/parser.ts\n</assignment>");
    expect(buildSubagentInstructions({ name: "worker", description: "Inspect" })).not.toContain(
      "undefined",
    );
  });

  it("describes omitted roles according to the actual fork setting", () => {
    const tool = new AgentTool(workDir(), new ToolRegistry(), () => Promise.resolve("done"));
    expect(tool.schema().description).toContain("forks a snapshot");
    tool.forkDisabled = true;
    expect(tool.schema().description).toContain("selects general-purpose");
    expect(tool.schema().input_schema.properties.subagent_type).toHaveProperty(
      "description",
      "Agent role. Defaults to general-purpose.",
    );
  });
});

describe("provider tool declarations", () => {
  it("preserves JSON Schema constraints and separates all three wire formats", () => {
    const inputSchema = {
      type: "object" as const,
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    };
    const tool: Tool = {
      name: "Example",
      description: "A bounded operation",
      category: "read",
      schema: () => ({
        name: "Example",
        description: "A bounded operation",
        input_schema: inputSchema,
      }),
      execute: () => Promise.resolve({ output: "done", isError: false }),
    };
    const registry = new ToolRegistry();
    registry.register(tool);
    const native = registry.getAllSchemas()[0];
    const responses = registry.getAllSchemas("openai")[0];
    const chat = registry.getAllSchemas("openai-compat")[0];
    expect(native.input_schema).toEqual(inputSchema);
    expect(responses.parameters).toEqual(inputSchema);
    expect(responses).not.toHaveProperty("function");
    expect(chat.function.parameters).toEqual(inputSchema);
    expect(chat).not.toHaveProperty("parameters");
  });
});
