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
