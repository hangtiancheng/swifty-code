import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createDefaultRegistry } from "../src/commands/commands.js";
import { loadConfig } from "../src/config/config.js";
import { ProviderLoginSchema, saveLocalProvider } from "../src/config/provider-login.js";

const input = {
  name: "custom",
  protocol: "anthropic",
  base_url: "https://example.com",
  api_key: "test-key",
  model: "test-model",
};

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

  it("defaults thinking per protocol", () => {
    expect(ProviderLoginSchema.parse({ ...input, protocol: "openai" }).thinking).toBe("off");
    expect(ProviderLoginSchema.parse({ ...input, protocol: "openai-compat" }).thinking).toBe("off");
    expect(ProviderLoginSchema.parse({ ...input, protocol: "anthropic" }).thinking).toBe("high");
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

  it("preserves local settings and providers, suffixes duplicate names, and writes private YAML", () => {
    const directory = mkdtempSync(join(tmpdir(), "swifty-login-"));
    mkdirSync(join(directory, ".swifty"));
    const path = join(directory, ".swifty/config.local.yaml");
    writeFileSync(
      path,
      "permission_mode: plan\nenable_fork: false\nsandbox:\n  enabled: true\ncustom_setting: keep\n",
    );
    const first = saveLocalProvider(directory, input, []);
    const second = saveLocalProvider(directory, input, first.providers);
    const third = saveLocalProvider(directory, input, second.providers);
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

  it("keeps an existing config untouched when parsing or validation fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "swifty-login-invalid-"));
    mkdirSync(join(directory, ".swifty"));
    const path = join(directory, ".swifty/config.local.yaml");
    const before = "providers: [invalid YAML";
    writeFileSync(path, before);
    expect(() => saveLocalProvider(directory, input, [])).toThrow();
    expect(readFileSync(path, "utf-8")).toBe(before);
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
});
