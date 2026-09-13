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

import { describe, expect, it, vi } from "vitest";

import { createDefaultRegistry } from "../src/commands/commands.js";

describe("/thinking command", () => {
  const registry = createDefaultRegistry();
  const command = registry.find("thinking");

  it("is registered as a local command", () => {
    expect(command?.type).toBe("local");
  });

  it("shows the current level when called without args", () => {
    const output = command?.handler({
      workDir: "/tmp",
      args: "",
      thinkingLevel: () => "medium",
    });
    expect(output).toContain("medium");
  });

  it("sets a valid level", () => {
    const setThinkingLevel = vi.fn();
    const output = command?.handler({
      workDir: "/tmp",
      args: "max",
      setThinkingLevel,
    });
    expect(setThinkingLevel).toHaveBeenCalledWith("max");
    expect(output).toContain("max");
  });

  it("rejects an unknown level", () => {
    const setThinkingLevel = vi.fn();
    const output = command?.handler({
      workDir: "/tmp",
      args: "bogus",
      setThinkingLevel,
    });
    expect(setThinkingLevel).not.toHaveBeenCalled();
    expect(output).toContain("Unknown thinking level");
  });

  it("persists the level when a persistence hook is provided", () => {
    const setThinkingLevel = vi.fn();
    const persistThinkingLevel = vi.fn();
    const output = command?.handler({
      workDir: "/tmp",
      args: "low",
      setThinkingLevel,
      persistThinkingLevel,
    });
    expect(setThinkingLevel).toHaveBeenCalledWith("low");
    expect(persistThinkingLevel).toHaveBeenCalledWith("low");
    expect(output).toContain("saved");
  });

  it("keeps the runtime change but reports a persistence failure", () => {
    const setThinkingLevel = vi.fn();
    const persistThinkingLevel = vi.fn(() => {
      throw new Error("boom");
    });
    const output = command?.handler({
      workDir: "/tmp",
      args: "low",
      setThinkingLevel,
      persistThinkingLevel,
    });
    expect(setThinkingLevel).toHaveBeenCalledWith("low");
    expect(output).toContain("saving failed");
    expect(output).toContain("boom");
  });
});
