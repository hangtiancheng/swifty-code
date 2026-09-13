import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import yaml from "js-yaml";
import { z } from "zod";

import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_OUTPUT_TOKENS,
  defaultThinkingLevelFor,
  ProviderConfigSchema,
  type ProviderConfig,
  THINKING_LEVELS,
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

export function saveLocalProvider(
  workDir: string,
  input: unknown,
  available: ProviderConfig[],
): {
  provider: ProviderConfig;
  providers: ProviderConfig[];
  path: string;
} {
  const provider = ProviderLoginSchema.parse(input);
  const directory = join(workDir, ".swifty");
  const path = join(directory, "config.local.yaml");
  let raw: unknown = {};
  if (existsSync(path)) {
    try {
      raw = yaml.load(readFileSync(path, "utf-8"));
    } catch {
      throw new Error(
        "Unable to read existing .swifty/config.local.yaml; it has not been changed.",
      );
    }
  }
  const config = z.record(z.string(), z.unknown()).parse(raw ?? {});
  const local = z.array(z.record(z.string(), z.unknown())).parse(config.providers ?? []);
  // A local provider list replaces earlier config layers, so retain every currently available provider.
  const stored = [...local];
  for (const existing of available) {
    if (!stored.some((entry) => entry.name === existing.name)) {
      stored.push({ ...existing });
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
  mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `.config.local-${randomUUID()}.tmp`);
  try {
    writeFileSync(
      temporary,
      yaml.dump({ ...config, providers: stored }, { lineWidth: -1, noRefs: true }),
      { encoding: "utf-8", mode: 0o600, flag: "wx" },
    );
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) {
      unlinkSync(temporary);
    }
  }
  return { provider, providers, path };
}
