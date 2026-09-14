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

import type { ProviderConfig, ThinkingLevel } from "../config/config.js";
import type { ConversationManager } from "../conversation/conversation.js";

import type { StreamEvent } from "./events.js";

import type { ToolSchema } from "@/tools/types.js";

// export interface ToolSchema {
// 	name: string;
// 	parameters?: Record<string, unknown> | null;
// 	strict?: boolean | null;
// 	/** For OpenAI, this must be "function"; for Anthropic, it can be "custom" or null */
// 	type?: "function" | "custom" | null;
// 	defer_loading?: boolean | null;
// 	description?: string | null;

// 	/** Only for OpenAI */
// 	function: {
// 		name: string;
// 		description: string;
// 		parameters: ToolSchema["input_schema"];
// 	};

// 	/** The input schema for the tool. */
// 	input_schema: {
// 		type: "object";
// 		properties?: Record<
// 			string,
// 			{
// 				type: "object" | "array" | "string" | "integer" | "boolean";
// 				items?: {
// 					type: "object" | "array" | "string" | "integer" | "boolean";
// 					properties: ToolSchema["input_schema"]["properties"];
// 					required?: string[] | null;
// 				} | null;
// 				minItems?: number | null;
// 				maxItems?: number | null;
// 				description: string;
// 				default?: unknown;
// 			}
// 		> | null;
// 		required?: string[] | null;
// 	};
// 	allowed_callers?:
// 		| ("direct" | "code_execution_20250825" | "code_execution_20260120")[]
// 		| null;
// 	cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" } | null;
// 	eager_input_streaming?: boolean | null;
// }

export interface LLMClient extends Partial<MaxTokensSetter>, Partial<ThinkingLevelControl> {
  stream(
    conversationManager: ConversationManager,
    toolSchemas: ToolSchema[],
    abortSignal?: AbortSignal,
  ): AsyncGenerator<StreamEvent>;

  setSystemPrompt(prompt: string): void;
}

export interface MaxTokensSetter {
  setMaxOutputTokens(maxTokens: number): void;
}

/** Runtime control of the effective logical thinking level. */
export interface ThinkingLevelControl {
  /** Built-in clients return the effective level; legacy controls may return void. */
  setThinkingLevel(level: ThinkingLevel): ThinkingLevel | void;
  getThinkingLevel(): ThinkingLevel;
  getSupportedThinkingLevels?(): readonly ThinkingLevel[];
}

// Use dynamic import for lazy loading
export async function createClient(config: ProviderConfig, systemPrompt: string) {
  switch (config.protocol) {
    case "anthropic": {
      const { AnthropicClient } = await import("./anthropic.js");
      return new AnthropicClient(config, systemPrompt);
    }

    case "openai": {
      const { OpenAIClient } = await import("./openai.js");
      return new OpenAIClient(config, systemPrompt);
    }

    case "openai-compat": {
      const { OpenAICompatClient } = await import("./openai.js");
      return new OpenAICompatClient(config, systemPrompt);
    }

    default:
      throw new Error(`Unknown protocol: ${String(config.protocol)}`);
  }
}
