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

import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type * as nodeOs from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDefaultRegistry } from "../src/commands/commands.js";
import { globalConfigPath, loadConfig } from "../src/config/config.js";
import {
  persistThinkingLevel,
  ProviderLoginSchema,
  saveProvider,
} from "../src/config/provider-login.js";

// Redirect $HOME to a temp dir so saveProvider/persistThinkingLevel write to an
// isolated global config instead of the real ~/.swifty/config.yaml.
const homeRef = vi.hoisted(() => ({ current: "" }));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof nodeOs>();
  return { ...actual, homedir: () => homeRef.current };
});

const input = {
  name: "custom",
  protocol: "anthropic",
  base_url: "https://example.com",
  api_key: "test-key",
  model: "test-model",
};

beforeEach(() => {
  homeRef.current = mkdtempSync(join(tmpdir(), "swifty-home-"));
});

describe("provider login", () => {
  it("registers /login as a local UI command", () => {
    const command = createDefaultRegistry().find("login");
    expect(command?.type).toBe("local_ui");
    expect(command?.handler({ workDir: "/tmp", args: "" })).toBe("login");
  });

  it("validates required fields and fills optional defaults", () => {
    const result = ProviderLoginSchema.parse({
      ...input,
      context_window: "",
      max_output_tokens: " ",
    });
    expect(result).toMatchObject({
      thinking: "high",
      context_window: 1000000,
      max_output_tokens: 128000,
    });
    for (const field of ["name", "protocol", "base_url", "api_key", "model"]) {
      expect(ProviderLoginSchema.safeParse({ ...input, [field]: " " }).success).toBe(false);
    }
  });

  it("defaults thinking to high for every protocol", () => {
    expect(ProviderLoginSchema.parse({ ...input, protocol: "openai" }).thinking).toBe("high");
    expect(ProviderLoginSchema.parse({ ...input, protocol: "openai-compat" }).thinking).toBe(
      "high",
    );
    expect(ProviderLoginSchema.parse({ ...input, protocol: "anthropic" }).thinking).toBe("high");
  });

  it("rejects the legacy boolean thinking values", () => {
    expect(ProviderLoginSchema.safeParse({ ...input, thinking: true }).success).toBe(false);
    expect(ProviderLoginSchema.safeParse({ ...input, thinking: false }).success).toBe(false);
  });

  it.each(["-1", "0", "1.5", "NaN", "Infinity", "999999999", "oops"])(
    "rejects invalid numeric context %s",
    (value) => {
      expect(ProviderLoginSchema.safeParse({ ...input, context_window: value }).success).toBe(
        false,
      );
    },
  );

  it("checks output bounds and its relationship to the context window", () => {
    for (const value of ["0", "-1", "1.5", "Infinity", "1000001"]) {
      expect(ProviderLoginSchema.safeParse({ ...input, max_output_tokens: value }).success).toBe(
        false,
      );
    }
    expect(
      ProviderLoginSchema.safeParse({
        ...input,
        context_window: "10000",
        max_output_tokens: "20000",
      }).success,
    ).toBe(false);
    expect(
      ProviderLoginSchema.parse({
        ...input,
        thinking: "off",
        context_window: "10000",
        max_output_tokens: "2048",
      }),
    ).toMatchObject({ thinking: "off", context_window: 10000, max_output_tokens: 2048 });
  });

  it("validates the thinking level", () => {
    expect(ProviderLoginSchema.safeParse({ ...input, thinking: "bogus" }).success).toBe(false);
    expect(ProviderLoginSchema.parse({ ...input, thinking: "max" })).toMatchObject({
      thinking: "max",
    });
    expect(ProviderLoginSchema.parse({ ...input, thinking: "off" })).toMatchObject({
      thinking: "off",
    });
  });

  it("saves to the global config, preserving settings and suffixing duplicate names", () => {
    mkdirSync(join(homeRef.current, ".swifty"));
    const path = globalConfigPath();
    writeFileSync(
      path,
      "permission_mode: plan\nenable_fork: false\nsandbox:\n  enabled: true\ncustom_setting: keep\n",
    );
    const first = saveProvider(input, []);
    const second = saveProvider(input, first.providers);
    const third = saveProvider(input, second.providers);
    expect(third.provider.name).toBe("custom3");
    expect(third.providers.map((provider) => provider.name)).toEqual([
      "custom",
      "custom2",
      "custom3",
    ]);
    const reloaded = loadConfig(path);
    expect(reloaded.providers).toEqual(third.providers);
    expect(reloaded.enable_fork).toBe(false);
    expect(reloaded.sandbox?.enabled).toBe(true);
    expect(readFileSync(path, "utf-8")).toContain("custom_setting: keep");
    if (process.platform !== "win32") {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  });

  it("creates the global config when it does not exist", () => {
    const path = globalConfigPath();
    const saved = saveProvider(input, []);
    expect(saved.path).toBe(path);
    expect(loadConfig(path).providers.map((p) => p.name)).toEqual(["custom"]);
  });

  it("keeps an existing config untouched when parsing fails", () => {
    mkdirSync(join(homeRef.current, ".swifty"));
    const path = globalConfigPath();
    const before = "providers: [invalid YAML";
    writeFileSync(path, before);
    expect(() => saveProvider(input, [])).toThrow();
    expect(readFileSync(path, "utf-8")).toBe(before);
  });

  it("persists a thinking level update to the global config", () => {
    saveProvider(input, []);
    const path = globalConfigPath();
    persistThinkingLevel("custom", "max");
    expect(loadConfig(path).providers[0].thinking).toBe("max");
  });

  it("throws when persisting a thinking level for an unknown provider", () => {
    saveProvider(input, []);
    expect(() => persistThinkingLevel("nope", "max")).toThrow();
  });

  it("applies defaults to old configuration without model-name inference", () => {
    const directory = mkdtempSync(join(tmpdir(), "swifty-defaults-"));
    const path = join(directory, "config.yaml");
    writeFileSync(
      path,
      "providers:\n  - name: old\n    protocol: anthropic\n    base_url: https://example.com\n    model: claude-old\n",
    );
    expect(loadConfig(path).providers[0]).toMatchObject({
      thinking: "high",
      context_window: 1000000,
      max_output_tokens: 128000,
    });
  });

  it("reports invalid provider fields instead of dropping the provider", () => {
    const directory = mkdtempSync(join(tmpdir(), "swifty-invalid-thinking-"));
    const path = join(directory, "config.yaml");
    writeFileSync(
      path,
      "providers:\n  - name: old\n    protocol: anthropic\n    base_url: https://example.com\n    model: claude-old\n    thinking: true\n",
    );
    expect(() => loadConfig(path)).toThrow(/Invalid provider configuration/);
  });

  it("reports a missing global config file with a clean error", () => {
    expect(() => loadConfig()).toThrow(/No config file found/);
  });
});
