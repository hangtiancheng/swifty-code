import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import yaml from "js-yaml";
import { z } from "zod";

import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_OUTPUT_TOKENS,
  defaultThinkingLevelFor,
  globalConfigPath,
  ProviderConfigSchema,
  type ProviderConfig,
  THINKING_LEVELS,
  type ThinkingLevel,
} from "./config.js";

const tokenLimit = (fallback: number, min: number, max: number) =>
  z.preprocess(
    (value) =>
      value === undefined || (typeof value === "string" && !value.trim()) ? fallback : value,
    z
      .union([
        z.number(),
        z.string().trim().regex(/^\d+$/, "Enter a whole number").transform(Number),
      ])
      .pipe(z.number().int().min(min).max(max)),
  );

export const ProviderLoginSchema = ProviderConfigSchema.extend({
  name: z.string().trim().min(1, "Name is required"),
  base_url: z
    .string()
    .trim()
    .url("Enter a valid HTTP(S) URL")
    .refine((url) => /^https?:\/\//i.test(url), "Use an HTTP(S) URL"),
  api_key: z.string().trim().min(1, "API key is required"),
  model: z.string().trim().min(1, "Model is required"),
  thinking: z.enum(THINKING_LEVELS).optional(),
  context_window: tokenLimit(DEFAULT_CONTEXT_WINDOW, 1_000, 10_000_000),
  max_output_tokens: tokenLimit(DEFAULT_MAX_OUTPUT_TOKENS, 1, 1_000_000),
})
  .refine((provider) => provider.max_output_tokens <= provider.context_window, {
    path: ["max_output_tokens"],
    message: "Max output tokens must not exceed the context window",
  })
  // Old providers may omit `thinking`; default it per protocol so the form and
  // saved YAML always carry an explicit level.
  .transform((provider) => ({
    ...provider,
    thinking: provider.thinking ?? defaultThinkingLevelFor(provider.protocol),
  }));

/** Read the raw global config as a record; an absent file yields {}. */
function readConfigRaw(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  let raw: unknown;
  try {
    raw = yaml.load(readFileSync(path, "utf-8"));
  } catch {
    throw new Error(`Unable to read existing ${path}; it has not been changed.`);
  }
  return z.record(z.string(), z.unknown()).parse(raw ?? {});
}

/** Atomically write the global config, preserving 0600 permissions. */
function writeConfigAtomic(path: string, raw: Record<string, unknown>): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `.config-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, yaml.dump(raw, { lineWidth: -1, noRefs: true }), {
      encoding: "utf-8",
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) {
      unlinkSync(temporary);
    }
  }
}

/**
 * Save a new provider to the single global config ($HOME/.swifty/config.yaml),
 * retaining every currently available provider and suffixing duplicate names.
 */
export function saveProvider(
  input: unknown,
  available: ProviderConfig[],
): {
  provider: ProviderConfig;
  providers: ProviderConfig[];
  path: string;
} {
  const provider = ProviderLoginSchema.parse(input);
  const path = globalConfigPath();
  const config = readConfigRaw(path);
  const existing = z.array(z.record(z.string(), z.unknown())).parse(config.providers ?? []);
  // Retain every currently available provider so an in-memory list never loses
  // entries that are not yet written to the file.
  const stored = [...existing];
  for (const entry of available) {
    if (!stored.some((existingEntry) => existingEntry.name === entry.name)) {
      stored.push({ ...entry });
    }
  }
  const names = new Set(stored.map((entry) => entry.name));
  const baseName = provider.name;
  let suffix = 2;
  while (names.has(provider.name)) {
    provider.name = `${baseName}${String(suffix++)}`;
  }
  stored.push(provider);
  const providers = stored.map((entry) => ProviderConfigSchema.parse(entry));
  writeConfigAtomic(path, { ...config, providers: stored });
  return { provider, providers, path };
}

/**
 * Persist a provider's thinking level to the global config. Throws when the
 * named provider is absent so callers can surface a clear error.
 */
export function persistThinkingLevel(providerName: string, level: ThinkingLevel): void {
  const path = globalConfigPath();
  const config = readConfigRaw(path);
  const providers = z.array(z.record(z.string(), z.unknown())).parse(config.providers ?? []);
  const target = providers.find((entry) => entry.name === providerName);
  if (!target) {
    throw new Error(`Provider "${providerName}" not found in ${path}.`);
  }
  // Avoid rewriting (and reformatting) the file when nothing changes.
  if (target.thinking === level) {
    return;
  }
  target.thinking = level;
  writeConfigAtomic(path, { ...config, providers });
}
