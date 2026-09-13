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

import { stripVTControlCharacters } from "node:util";

import { Chalk } from "chalk";
import { renderToString } from "ink";
import type * as Ink from "ink";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentActivity } from "@/tui/agent-activity.js";
import { CommittedMessage } from "@/tui/chat.js";
import { renderMarkdown, renderStreamingMarkdown, type MarkdownCache } from "@/tui/markdown.js";
import { setThemeMode } from "@/tui/styles.js";
import { truncateToWidth, visibleWidth, wrapToLines } from "@/tui/terminal-text.js";
import { ThinkingBlock } from "@/tui/thinking-block.js";
import { ToolBlock } from "@/tui/tool-display.js";
import { formatToolOutputPreview } from "@/tui/tool-preview.js";

// ToolCard and ThinkingBlock size themselves from useStdout().stdout.columns, which
// renderToString never provides — Ink returns the process.stdout default (columns
// undefined under vitest, so they fall back to 80). Mock useStdout so the { columns }
// argument passed to renderToString actually constrains the rendered cards.
const terminal = vi.hoisted(() => ({ columns: 40 }));

vi.mock("ink", async (importOriginal) => {
  const ink = await importOriginal<typeof Ink>();
  return {
    ...ink,
    useStdout: () => ({ stdout: { columns: terminal.columns, rows: 24 } }),
  };
});

const colors = new Chalk({ level: 3 });
beforeEach(() => {
  terminal.columns = 40;
});
afterEach(() => {
  setThemeMode("dark");
});

describe("terminal column handling", () => {
  it("measures ANSI, CJK and combining characters without splitting glyphs", () => {
    const text = colors.red("中文e\u0301");
    expect(visibleWidth(text)).toBe(5);
    expect(visibleWidth(truncateToWidth(text, 4))).toBeLessThanOrEqual(4);
    expect(stripVTControlCharacters(truncateToWidth(text, 4))).toBe("中…");
    expect(wrapToLines(colors.green("中文中文"), 4).map(stripVTControlCharacters)).toEqual([
      "中文",
      "中文",
    ]);
    expect(truncateToWidth(text, 0)).toBe("");
  });

  it("counts shell previews in visual lines", () => {
    const output = "1234567890".repeat(6);
    const preview = stripVTControlCharacters(formatToolOutputPreview("Bash", output, 10));
    expect(preview.split("\n").slice(0, 5)).toEqual(Array.from({ length: 5 }, () => "1234567890"));
    expect(preview).toContain("1 more lines");
  });
});

describe("pi Markdown presentation", () => {
  it.each(["```", "~~~~"])("does not flash partial closing %s fences during streaming", (fence) => {
    const cache: MarkdownCache = { prefix: "", rendered: "", width: 0, theme: "" };
    const source = `${fence}ts\nconst value = 1;\n`;
    const expected = renderMarkdown(source + fence, 40);
    for (let count = 1; count < fence.length; count++) {
      expect(renderStreamingMarkdown(source + fence.slice(0, count), 40, cache)).toBe(expected);
    }
    // Completed content is never silently stripped, even if it ends in fence-like text.
    expect(renderMarkdown(source + fence[0], 40)).not.toBe(expected);
    expect(renderStreamingMarkdown(source + fence[0] + "\n", 40, cache)).toBe(
      renderMarkdown(source + fence[0] + "\n", 40),
    );
    expect(renderStreamingMarkdown(`${fence}ts\n${fence[0]}`, 40, cache)).toBe(
      renderMarkdown(`${fence}ts\n${fence}`, 40),
    );
  });
  it.each([20, 40, 80, 120])("fits long text, code and tables in %i columns", (width) => {
    for (const source of [
      "中文测试".repeat(30),
      "```unknown-language\n" + "const value = 123; ".repeat(20) + "\n```",
      "| Long column one | Long column two |\n| --- | --- |\n| " +
        "value".repeat(15) +
        " | 中文测试中文测试 |",
      "[label](https://example.com/" + "long-path/".repeat(15) + ")",
    ]) {
      expect(
        renderMarkdown(source, width)
          .split("\n")
          .every((line) => visibleWidth(line) <= width),
      ).toBe(true);
    }
  });

  it("preserves the source numbering and escaped syntax of user messages", () => {
    const text = renderMarkdown("3. first\n8. \\*literal\\*\n", 80, "user");
    const plain = stripVTControlCharacters(text);
    expect(plain).toContain("3. first");
    expect(plain).toContain("8. \\*literal\\*");
  });

  it("keeps streamed fences, lists and reference links consistent with committed Markdown", () => {
    const cache: MarkdownCache = { prefix: "", rendered: "", width: 0, theme: "" };
    const sources = [
      "Intro\n\n```ts\nconst first = 1;\n\nconst second",
      "Intro\n\n```ts\nconst first = 1;\n\nconst second = 2;\n```\n\nDone",
      "Intro\n\n1. one\n2. two\n\nNext",
      "A [reference][target]\n\n[target]: https://example.com",
    ];
    for (const text of sources) {
      expect(renderStreamingMarkdown(text, 40, cache)).toBe(renderMarkdown(text, 40));
    }
    setThemeMode("light");
    expect(renderStreamingMarkdown(sources[1], 20, cache)).toBe(renderMarkdown(sources[1], 20));
  });

  it("collapses thinking to one line and expands it as italic Markdown", () => {
    const text = "**Reasoning**\n\n" + "detail ".repeat(40);
    const collapsed = renderToString(createElement(ThinkingBlock, { text, expanded: false }), {
      columns: 40,
    });
    expect(stripVTControlCharacters(collapsed).trim()).toBe("Thinking...");
    const expanded = renderToString(createElement(ThinkingBlock, { text, expanded: true }), {
      columns: 40,
    });
    expect(stripVTControlCharacters(expanded)).toContain("Reasoning");
    expect(stripVTControlCharacters(expanded)).not.toContain("**Reasoning**");
  });
});

describe("shared live and committed tool cards", () => {
  it("keeps every Agent call visible while subagent progress changes", () => {
    const output = stripVTControlCharacters(
      renderToString(
        createElement(AgentActivity, {
          tools: [
            { toolId: "a", toolName: "Agent", args: { description: "first-task" }, loading: true },
            { toolId: "b", toolName: "Agent", args: { description: "second-task" }, loading: true },
          ],
          subagents: [{ id: 2, label: "explorer", turn: 3 }],
          teammates: [],
          isStreaming: true,
          isAsking: false,
          expanded: false,
          leaderTokens: 0,
        }),
        { columns: 40 },
      ),
    );
    expect(output).toContain("first-task");
    expect(output).toContain("second-task");
    expect(output).toContain("explorer subagent · turn 3");
    expect(output.split("\n").every((line) => visibleWidth(line) <= 40)).toBe(true);
  });
  it.each(["dark", "light"] as const)(
    "keeps live and saved tool layout identical in %s mode",
    (mode) => {
      setThemeMode(mode);
      const tool = {
        toolId: "read-a",
        toolName: "Read",
        args: { file_path: "src/main.tsx" },
        output: "line one\nline two",
        isError: false,
        elapsed: 0.5,
      };
      const live = renderToString(createElement(ToolBlock, { tool }), { columns: 40 });
      const saved = renderToString(
        createElement(CommittedMessage, {
          message: {
            role: "turn_summary",
            content: "",
            toolSummary: [
              {
                toolName: tool.toolName,
                argsSummary: "src/main.tsx",
                output: tool.output,
                isError: tool.isError,
                elapsed: tool.elapsed,
              },
            ],
          },
        }),
        { columns: 40 },
      );
      expect(saved).toBe(live);
      expect(stripVTControlCharacters(live)).toContain("Read src/main.tsx");
      expect(stripVTControlCharacters(live)).toContain("Took 0.5s");
    },
  );

  it("uses command titles for shell calls and hides unknown durations", () => {
    terminal.columns = 20;
    const output = renderToString(
      createElement(ToolBlock, {
        tool: { toolId: "bash-a", toolName: "Bash", args: { command: "pwd" }, loading: true },
      }),
      { columns: 20 },
    );
    expect(stripVTControlCharacters(output)).toContain("$ pwd");
    expect(stripVTControlCharacters(output)).not.toContain("Took");
  });
});
