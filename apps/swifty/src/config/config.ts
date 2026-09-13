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

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { getParseErrorMessage, safeParse } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import yaml from "js-yaml";
import { z } from "zod";

import { createChildLogger } from "../logger/logger.js";

const log = createChildLogger({ module: "config" });

const ENV_KEY_MAP = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  "openai-compat": "OPENAI_API_KEY",
};

function isKeyofTypeofEnvKeyMap(k: string): k is keyof typeof ENV_KEY_MAP {
  return VALID_PROTOCOLS.has(k);
}

/** enum: "anthropic", "openai", "openai-compat" */
const VALID_PROTOCOLS = new Set(Object.keys(ENV_KEY_MAP));

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** The single global config file: $HOME/.swifty/config.yaml. */
export function globalConfigPath(): string {
  return join(homedir(), ".swifty", "config.yaml");
}

/**
 * PI-equivalent thinking levels. `off` disables reasoning entirely; the rest
 * map to a provider-native effort string (openai / openai-compat) or a thinking
 * token budget (anthropic).
 */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const ProviderConfigSchema = z.object({
  name: z.string(),
  /**
   * enum: ["anthropic", "openai", "openai-compat"]
   */
  protocol: z.enum(["anthropic", "openai", "openai-compat"]),
  base_url: z.string(),
  model: z.string(),
  api_key: z.string().optional(),
  thinking: z.enum(THINKING_LEVELS).optional(),
  context_window: z.coerce.number().optional(),
  /**
   * The model's output ceiling (PI's `model.maxTokens`). Clamped to the
   * context window; reasoning shares this ceiling instead of raising it.
   */
  max_output_tokens: z.coerce.number().optional(),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const DEFAULT_THINKING_LEVEL: ThinkingLevel = "high";
export const DEFAULT_CONTEXT_WINDOW = 1_000_000;
/**
 * Fallback output-token ceiling used when `max_output_tokens` is unset (PI's
 * custom-model `maxTokens` default).
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 128_000;

/**
 * PI-equivalent thinking token budgets, used by the anthropic budget-based
 * thinking path. Must stay below DEFAULT_MAX_OUTPUT_TOKENS so the answer keeps
 * room after the thinking budget is reserved.
 */
export const THINKING_BUDGETS: Record<Exclude<ThinkingLevel, "off">, number> = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 32768,
  max: 65536,
};

export function isValidThinkingLevel(value: string): value is ThinkingLevel {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return (THINKING_LEVELS as readonly string[]).includes(value);
}

/** Normalize the config `thinking` field to a level; unset means the default. */
export function getThinkingLevel(provider: ProviderConfig): ThinkingLevel {
  return provider.thinking ?? DEFAULT_THINKING_LEVEL;
}

/** Thinking token budget for a level; 0 when thinking is off. */
export function thinkingBudgetForLevel(level: ThinkingLevel): number {
  return level === "off" ? 0 : THINKING_BUDGETS[level];
}

/** Map a PI thinking level to an OpenAI reasoning effort string. */
export function toReasoningEffort(
  level: ThinkingLevel,
): "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" {
  return level === "off" ? "none" : level;
}

export function withProviderDefaults(provider: ProviderConfig): ProviderConfig {
  return {
    ...provider,
    thinking: getThinkingLevel(provider),
    context_window: getContextWindow(provider),
    max_output_tokens: getMaxOutputTokens(provider),
  };
}

export function getContextWindow(provider: ProviderConfig): number {
  return Number.isSafeInteger(provider.context_window) && (provider.context_window ?? 0) > 0
    ? (provider.context_window ?? DEFAULT_CONTEXT_WINDOW)
    : DEFAULT_CONTEXT_WINDOW;
}

/**
 * Effective output cap for a provider. Configured value wins, otherwise the
 * 128k fallback applies; the result never exceeds the context window (PI's
 * `clampMaxTokensToContext`). This keeps small-output models from being sent an
 * over-large `max_tokens` while still letting users lower the cap.
 */
export function getMaxOutputTokens(provider: ProviderConfig): number {
  const configured = provider.max_output_tokens;
  const maxOutput =
    Number.isSafeInteger(configured) && (configured ?? 0) > 0
      ? (configured ?? DEFAULT_MAX_OUTPUT_TOKENS)
      : DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.min(maxOutput, getContextWindow(provider));
}

export function resolveAPIKey(p: ProviderConfig): string {
  if (p.api_key) {
    return p.api_key;
  }

  const envVar = isKeyofTypeofEnvKeyMap(p.protocol) ? ENV_KEY_MAP[p.protocol] : "";
  if (!envVar) {
    return "";
  }
  return process.env[envVar] ?? "";
}

const MCPServerConfigSchema = z.object({
  name: z.string(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  transport: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;

export const HookConfigSchema = z.object({
  id: z.string().optional(),
  event: z.string(),
  condition: z.string().optional(),
  action: z.object({
    type: z.string(),
    command: z.string().optional(),
    url: z.string().optional(),
    method: z.string().optional(),
    prompt: z.string().optional(),
  }),
  reject: z.boolean().optional(),
  once: z.boolean().optional(),
  async: z.boolean().optional(),
  on_error: z.string().optional(),
});

export type HookConfig = z.infer<typeof HookConfigSchema>;

const SandboxYamlConfigSchema = z.object({
  enabled: z.boolean().optional(),
  auto_allow: z.boolean().optional(),
  network_enabled: z.boolean().optional(),
});

export type SandboxYamlConfig = z.infer<typeof SandboxYamlConfigSchema>;

const AppConfigSchema = z.looseObject({
  providers: z.array(ProviderConfigSchema),
  permission_mode: z.string().optional(),
  mcp_servers: z.array(MCPServerConfigSchema).default([]),
  hooks: z.array(HookConfigSchema).default([]),
  sandbox: SandboxYamlConfigSchema.optional(),
  enable_coordinator_mode: z.boolean().optional(),
  /**
   * Whether to fork when subagent_type is omitted. Enabled by default, so this
   * field is left as undefined to represent "not specified in config". Using a
   * concrete boolean would make it impossible to distinguish "not set" from
   * "explicitly false", and the latter could never be turned back off.
   */
  enable_fork: z.boolean().optional(),
});

/** Whether fork is available. Defaults to enabled when not specified in config. */
export function forkEnabled(cfg: AppConfig): boolean {
  return cfg.enable_fork !== false;
}

export type AppConfig = z.infer<typeof AppConfigSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function loadSingleFile(path: string): AppConfig {
  const data = readFileSync(path, "utf-8");
  const raw: unknown = yaml.load(data);
  if (!isRecord(raw)) {
    log.error({ path }, "invalid yaml");
    return { providers: [], mcp_servers: [], hooks: [] };
  }
  const parsed = safeParse(AppConfigSchema, raw);
  if (parsed.success) {
    const data = parsed.data;
    return {
      ...data,
      providers: data.providers.map(withProviderDefaults),
    };
  }
  log.error({ error: parsed.error }, "config error");
  let providers: ProviderConfig[] = [];
  let permissionMode: string | undefined;
  let mcpServers: MCPServerConfig[] = [];
  let hooks: HookConfig[] = [];
  let sandbox: SandboxYamlConfig | undefined = undefined;
  let enableCoordinatorMode = false;
  let enableFork = true;

  if ("providers" in raw) {
    const parsed = safeParse(z.array(ProviderConfigSchema), raw.providers);
    if (parsed.success) {
      providers = parsed.data.map(withProviderDefaults);
    } else {
      // Providers are required for the app to function; surface schema errors
      // (e.g. a removed legacy field) instead of silently dropping them.
      throw new ConfigError(
        `Invalid provider configuration in ${path}: ${getParseErrorMessage(parsed.error)}`,
      );
    }
  }
  if ("permission_mode" in raw && typeof raw.permission_mode === "string") {
    permissionMode = raw.permission_mode;
  }
  if ("mcp_servers" in raw) {
    const parsed = safeParse(z.array(MCPServerConfigSchema), raw.mcp_servers);
    if (parsed.success) {
      mcpServers = parsed.data;
    }
  }
  if ("hooks" in raw) {
    const parsed = safeParse(z.array(HookConfigSchema), raw.hooks);
    if (parsed.success) {
      hooks = parsed.data;
    }
  }
  if ("sandbox" in raw) {
    const parsed = safeParse(SandboxYamlConfigSchema, raw.sandbox);
    if (parsed.success) {
      sandbox = parsed.data;
    }
  }
  if ("enable_coordinator_mode" in raw) {
    enableCoordinatorMode = Boolean(raw.enable_coordinator_mode);
  }
  if ("enable_fork" in raw) {
    enableFork = Boolean(raw.enable_fork);
  }
  return {
    providers,
    permission_mode: permissionMode,
    mcp_servers: mcpServers,
    hooks,
    sandbox,
    enable_coordinator_mode: enableCoordinatorMode,
    enable_fork: enableFork,
  };
}

function validateProviders(config: AppConfig): void {
  if (config.providers.length === 0) {
    throw new ConfigError("At least one provider MUST be configured.");
  }

  const requiredFields = ["name", "protocol", "base_url", "model"] as const;
  for (let i = 0; i < config.providers.length; i++) {
    const p = config.providers[i];
    const values = {
      name: p.name,
      protocol: p.protocol,
      base_url: p.base_url,
      model: p.model,
    } as const;
    const missing = requiredFields.filter((field) => !values[field].trim());
    if (missing.length > 0) {
      throw new ConfigError(`Provider #${String(i + 1)}: missing fields: ${missing.join(", ")}`);
    }

    if (!VALID_PROTOCOLS.has(p.protocol)) {
      throw new ConfigError(
        `Provider #${String(i + 1)}: invalid protocol '${p.protocol}', MUST be one of: ${Array.from(VALID_PROTOCOLS).join(", ")}`,
      );
    }
  }
}

export function loadConfig(
  path?: string,
  options: { allowEmptyProviders?: boolean } = {},
): AppConfig {
  if (path) {
    const config = loadSingleFile(path);
    if (!options.allowEmptyProviders || config.providers.length > 0) {
      validateProviders(config);
    }
    return config;
  }

  const candidate = globalConfigPath();

  if (!existsSync(candidate)) {
    if (options.allowEmptyProviders) {
      return { providers: [], mcp_servers: [], hooks: [] };
    }
    // Point at leftover project-level configs: Swifty used to merge them, so
    // upgrading users would otherwise just see "no config file found".
    const legacy = [
      join(process.cwd(), ".swifty/config.yaml"),
      join(process.cwd(), ".swifty/config.local.yaml"),
    ]
      .filter((legacyPath) => existsSync(legacyPath))
      .join(", ");
    throw new ConfigError(
      `No config file found, expected ${candidate}.` +
        (legacy ? ` Found project config at ${legacy}; move it to ${candidate}.` : ""),
    );
  }

  const config = loadSingleFile(candidate);
  if (!options.allowEmptyProviders || config.providers.length > 0) {
    validateProviders(config);
  }
  return config;
}
