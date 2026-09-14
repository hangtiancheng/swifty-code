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

import { describe, it, expect } from "vitest";

import {
  clampThinkingLevel,
  DEFAULT_MAX_OUTPUT_TOKENS,
  forkEnabled,
  getContextWindow,
  getMaxOutputTokens,
  getSupportedThinkingLevels,
  getThinkingLevel,
  isValidThinkingLevel,
  ProviderConfigSchema,
  resolveAPIKey,
  THINKING_LEVELS,
  thinkingBudgetForLevel,
  toReasoningEffort,
  withProviderDefaults,
  type AppConfig,
  type ProviderConfig,
} from "../src/config/config.js";

describe("config", () => {
  describe("getContextWindow", () => {
    it("returns configured value if set", () => {
      const p: ProviderConfig = {
        context_window: 100000,
        name: "p",
        protocol: "anthropic",
        base_url: "#",
        model: "",
      };
      expect(getContextWindow(p)).toBe(100000);
    });

    it("uses the 1M default independently of model names", () => {
      const p: ProviderConfig = {
        model: "claude-sonnet-4-6",
        name: "p",
        protocol: "anthropic",
        base_url: "#",
      };
      expect(getContextWindow(p)).toBe(1000000);
    });

    it("uses the same default for OpenAI models", () => {
      const p: ProviderConfig = {
        model: "gpt-4o",
        name: "p",
        protocol: "openai",
        base_url: "#",
      };
      expect(getContextWindow(p)).toBe(1000000);
    });
  });

  describe("getMaxOutputTokens", () => {
    const base = {
      name: "p",
      base_url: "#",
      protocol: "anthropic",
      model: "m",
    } as const;

    it("returns the configured cap when set", () => {
      expect(getMaxOutputTokens({ ...base, max_output_tokens: 4096 })).toBe(4096);
    });

    it("falls back to the 128k default", () => {
      expect(getMaxOutputTokens({ ...base })).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    });

    it("ignores non-positive or non-integer values", () => {
      expect(getMaxOutputTokens({ ...base, max_output_tokens: 0 })).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
      expect(getMaxOutputTokens({ ...base, max_output_tokens: 1.5 })).toBe(
        DEFAULT_MAX_OUTPUT_TOKENS,
      );
    });

    it("never exceeds the context window (PI clampMaxTokensToContext)", () => {
      expect(
        getMaxOutputTokens({ ...base, context_window: 16_000, max_output_tokens: 32_000 }),
      ).toBe(16_000);
      expect(getMaxOutputTokens({ ...base, context_window: 16_000 })).toBe(16_000);
    });
  });

  describe("getThinkingLevel", () => {
    const base = {
      name: "p",
      base_url: "#",
      protocol: "anthropic",
      model: "m",
    } as const;

    it("defaults to high for every protocol when unset", () => {
      expect(getThinkingLevel({ ...base })).toBe("high");
      expect(getThinkingLevel({ ...base, protocol: "openai" })).toBe("high");
      expect(getThinkingLevel({ ...base, protocol: "openai-compat" })).toBe("high");
    });

    it("passes an explicit level through", () => {
      expect(getThinkingLevel({ ...base, thinking: "max" })).toBe("max");
      expect(getThinkingLevel({ ...base, thinking: "off" })).toBe("off");
      expect(getThinkingLevel({ ...base, protocol: "openai", thinking: "low" })).toBe("low");
    });
  });

  describe("withProviderDefaults", () => {
    it("normalizes thinking and carries the output cap", () => {
      const provider = withProviderDefaults({
        name: "p",
        protocol: "openai",
        base_url: "#",
        model: "m",
      });
      expect(provider.thinking).toBe("high");
      expect(provider.context_window).toBe(1000000);
      expect(provider.max_output_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    });
  });

  describe("thinking level helpers", () => {
    it("validates level strings", () => {
      expect(isValidThinkingLevel("high")).toBe(true);
      expect(isValidThinkingLevel("bogus")).toBe(false);
    });

    it("maps levels to anthropic thinking budgets", () => {
      expect(thinkingBudgetForLevel("minimal")).toBe(1024);
      expect(thinkingBudgetForLevel("high")).toBe(16384);
      expect(thinkingBudgetForLevel("max")).toBe(65536);
      expect(thinkingBudgetForLevel("off")).toBe(0);
    });

    it("maps levels to OpenAI reasoning effort", () => {
      expect(toReasoningEffort("off")).toBe("none");
      expect(toReasoningEffort("low")).toBe("low");
      expect(toReasoningEffort("max")).toBe("max");
    });
  });

  describe("explicit thinking capabilities", () => {
    const base: ProviderConfig = { name: "p", base_url: "#", protocol: "openai", model: "m" };

    it.each(["gpt-4o", "o3", "claude-haiku", "arbitrary-model"])(
      "does not infer capabilities from %s",
      (model) => {
        expect(getSupportedThinkingLevels({ ...base, model })).toEqual(THINKING_LEVELS);
        expect(getThinkingLevel({ ...base, model })).toBe("high");
      },
    );

    it("retains capability metadata and unrecognized fields while adding defaults", () => {
      const provider = withProviderDefaults(
        ProviderConfigSchema.parse({
          ...base,
          reasoning: true,
          thinking_mode: "adaptive",
          thinking_level_map: { low: "medium", xhigh: null },
          future_capability: { enabled: true },
        }),
      );
      expect(provider).toMatchObject({
        reasoning: true,
        thinking_mode: "adaptive",
        thinking_level_map: { low: "medium", xhigh: null },
        future_capability: { enabled: true },
        thinking: "high",
        context_window: 1000000,
        max_output_tokens: 128000,
      });
    });

    it.each([
      { reasoning: "false" },
      { thinking_mode: "automatic" },
      { thinking_level_map: { high: "unsupported-native-effort" } },
      { thinking_level_map: { unknown: "low" } },
      { thinking_level_map: { off: "high" } },
      { thinking_level_map: { max: false } },
    ])("rejects malformed capabilities: %j", (metadata) => {
      expect(ProviderConfigSchema.safeParse({ ...base, ...metadata }).success).toBe(false);
    });

    it("only exposes off when configured as non-reasoning", () => {
      const provider = { ...base, reasoning: false };
      expect(getSupportedThinkingLevels(provider)).toEqual(["off"]);
      expect(getThinkingLevel(provider)).toBe("off");
      expect(toReasoningEffort("off", provider)).toBeNull();
      expect(withProviderDefaults(provider).thinking).toBe("off");
    });

    it("uses partial overrides and clamps down rather than raising a requested level", () => {
      const provider: ProviderConfig = {
        ...base,
        thinking_level_map: { minimal: null, low: null, high: null, max: "max" },
      };
      expect(getSupportedThinkingLevels(provider)).toEqual(["off", "medium", "xhigh", "max"]);
      expect(clampThinkingLevel(provider, "low")).toBe("off");
      expect(clampThinkingLevel(provider, "high")).toBe("medium");
      expect(clampThinkingLevel(provider, "max")).toBe("max");
      expect(getThinkingLevel(provider)).toBe("medium");
      expect(toReasoningEffort("max", provider)).toBe("max");
    });

    it("accounts for the context-clamped Anthropic budget ceiling", () => {
      const provider: ProviderConfig = {
        ...base,
        protocol: "anthropic",
        context_window: 1024,
        max_output_tokens: 128000,
      };
      expect(getSupportedThinkingLevels(provider)).toEqual(["off"]);
      expect(getThinkingLevel(provider)).toBe("off");
      expect(getSupportedThinkingLevels({ ...provider, thinking_mode: "adaptive" })).toEqual(
        THINKING_LEVELS,
      );
    });
  });

  describe("resolveAPIKey", () => {
    it("returns config api_key first", () => {
      const p: ProviderConfig = {
        api_key: "sk-test",
        name: "p",
        base_url: "#",
        protocol: "anthropic",
        model: "m",
      };
      expect(resolveAPIKey(p)).toBe("sk-test");
    });

    it("falls back to env var", () => {
      process.env.ANTHROPIC_API_KEY = "sk-from-env";
      const p: ProviderConfig = {
        name: "p",
        base_url: "#",
        protocol: "anthropic",
        model: "m",
      };
      expect(resolveAPIKey(p)).toBe("sk-from-env");
      delete process.env.ANTHROPIC_API_KEY;
    });
  });

  // enable_fork is on by default, and an explicit false in the config must
  // actually turn it off. Storing it as a required boolean would make "unset"
  // indistinguishable from "set to false", so the latter could never be disabled.
  describe("enable_fork", () => {
    const bare = (): AppConfig => ({ providers: [], mcp_servers: [], hooks: [] });

    it("defaults to enabled when unset", () => {
      expect(forkEnabled(bare())).toBe(true);
    });

    it("disables for real when set to false", () => {
      expect(forkEnabled({ ...bare(), enable_fork: false })).toBe(false);
      expect(forkEnabled({ ...bare(), enable_fork: true })).toBe(true);
    });
  });
});
