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

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { ChatMessage, ToolSummaryItem } from "./chat.js";
import type { ToolBlockInfo } from "./tool-display.js";

import type { AgentEvent } from "@/agent/events.js";
import { toDisplayPreview } from "@/tool-result/budget.js";
import { formatToolArgs } from "@/utils/utils.js";

export function useAgentOutput(setMessages: Dispatch<SetStateAction<ChatMessage[]>>) {
  const [streamingText, setStreamingText] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [retryStatus, setRetryStatus] = useState<string | undefined>();
  const [activeTools, setActiveTools] = useState<ToolBlockInfo[]>([]);
  const [inputTokens, setInputTokens] = useState(0);
  const [outputTokens, setOutputTokens] = useState(0);
  const streamingTextRef = useRef("");
  const streamThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelFlush = () => {
    if (streamThrottleRef.current) {
      clearTimeout(streamThrottleRef.current);
      streamThrottleRef.current = null;
    }
  };

  useEffect(() => cancelFlush, []);

  const clearTools = () => {
    setActiveTools([]);
  };

  const prepareTurn = () => {
    setStreamingText("");
    setRetryStatus(undefined);
    clearTools();
  };

  const finishTurn = () => {
    cancelFlush();
    setStreamingThinking("");
    setRetryStatus(undefined);
    clearTools();
  };

  const resetUsage = () => {
    setInputTokens(0);
    setOutputTokens(0);
  };

  const createEventHandler = () => {
    setStreamingThinking("");
    let fullText = "";
    let turnThinkingText = "";
    let turnThinkingStart = 0;
    let turnThinkingDuration = 0;
    const turnToolCalls = new Map<string, ToolSummaryItem | undefined>();
    const pendingToolArgs = new Map<string, string>();

    const resetTurn = () => {
      turnThinkingText = "";
      turnThinkingStart = 0;
      turnThinkingDuration = 0;
      turnToolCalls.clear();
      setStreamingThinking("");
      pendingToolArgs.clear();
    };

    return (event: AgentEvent) => {
      if (event.type !== "retry" && event.type !== "usage" && event.type !== "permission_request") {
        setRetryStatus(undefined);
      }
      switch (event.type) {
        case "stream_text": {
          fullText += event.text;
          streamingTextRef.current = fullText;
          streamThrottleRef.current ??= setTimeout(() => {
            setStreamingText(streamingTextRef.current);
            streamThrottleRef.current = null;
          }, 50);
          break;
        }
        case "thinking_text": {
          if (!turnThinkingStart) {
            turnThinkingStart = Date.now();
          }
          turnThinkingText += event.text;
          setStreamingThinking(turnThinkingText);
          break;
        }
        case "thinking_complete": {
          if (turnThinkingStart) {
            turnThinkingDuration = (Date.now() - turnThinkingStart) / 1000;
          }
          break;
        }
        case "tool_use": {
          pendingToolArgs.set(`${event.toolName}:${event.toolId}`, formatToolArgs(event.args));
          turnToolCalls.set(event.toolId, undefined);
          setActiveTools((tools) => [
            ...tools,
            {
              toolId: event.toolId,
              toolName: event.toolName,
              args: event.args,
              loading: true,
            },
          ]);
          break;
        }
        case "tool_result": {
          const output = toDisplayPreview(event.output);
          setActiveTools((tools) =>
            tools.map((tool) =>
              tool.toolId === event.toolId
                ? {
                    ...tool,
                    output,
                    isError: event.isError,
                    elapsed: event.elapsed,
                    loading: false,
                  }
                : tool,
            ),
          );
          turnToolCalls.set(event.toolId, {
            toolName: event.toolName,
            argsSummary: pendingToolArgs.get(`${event.toolName}:${event.toolId}`) ?? "",
            output,
            isError: event.isError,
            elapsed: event.elapsed,
          });
          break;
        }
        case "usage": {
          setInputTokens((tokens) => tokens + event.usage.inputTokens);
          setOutputTokens((tokens) => tokens + event.usage.outputTokens);
          break;
        }
        case "compact": {
          setMessages((messages) => [
            ...messages,
            { role: "system", content: `⊙ ${event.message}` },
          ]);
          break;
        }
        case "retry": {
          setRetryStatus(
            `Retrying${event.delay ? ` (${String(Math.round(event.delay / 1000))}s delay)` : ""}: ${event.reason}`,
          );
          setMessages((messages) => [
            ...messages,
            {
              role: "system",
              content: `↻ ${event.reason}${event.delay ? ` (waiting ${String(Math.round(event.delay / 1000))}s)` : ""}`,
            },
          ]);
          break;
        }
        case "turn_complete":
        case "loop_complete": {
          cancelFlush();
          setStreamingText("");
          const turnText = fullText;
          fullText = "";
          streamingTextRef.current = "";
          clearTools();
          const commits: ChatMessage[] = [];
          if (turnThinkingText || turnThinkingDuration >= 1) {
            commits.push({
              role: "turn_summary",
              content: turnThinkingText,
              thinkingDuration: turnThinkingDuration > 0 ? turnThinkingDuration : undefined,
            });
          }
          if (turnText) {
            commits.push({ role: "assistant", content: turnText });
          }
          const toolSummary = [...turnToolCalls.values()].filter(
            (tool): tool is ToolSummaryItem => tool !== undefined,
          );
          if (toolSummary.length > 0) {
            commits.push({ role: "turn_summary", content: "", toolSummary });
          }
          if (commits.length > 0) {
            setMessages((messages) => [...messages, ...commits]);
          }
          resetTurn();
          break;
        }
      }
    };
  };

  return {
    streamingText,
    streamingThinking,
    retryStatus,
    streamingTextRef,
    activeTools,
    inputTokens,
    outputTokens,
    resetUsage,
    prepareTurn,
    finishTurn,
    clearTools,
    createEventHandler,
  };
}
