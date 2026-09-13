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

import { homedir } from "node:os";

import { Box, Text, useBoxMetrics, useStdout, type DOMElement } from "ink";
import { useLayoutEffect, useRef } from "react";

import { THEME } from "./styles.js";
import { truncateToWidth, visibleWidth, wrapToLines } from "./terminal-text.js";

interface FooterProps {
  /** Current context occupancy in tokens (not the cumulative session total). */
  contextTokens: number;
  contextWindow: number;
  inputTokens: number;
  model: string;
  outputTokens: number;
  onHeightChange?: (height: number) => void;
  permissionMode: string;
  provider: string;
  sessionId: string;
  workDir: string;
}

const MODE_DISPLAY: Record<string, string> = {
  default: "default",
  acceptEdits: "Accept Edits",
  plan: "Plan",
  bypassPermissions: "YOLO",
};

function permissionModeColor(mode: string): string {
  if (mode === "acceptEdits") {
    return THEME.success;
  }
  if (mode === "plan") {
    return THEME.warning;
  }
  if (mode === "bypassPermissions") {
    return THEME.error;
  }
  return THEME.dim;
}

function compactPath(path: string): string {
  const home = homedir();
  return path === home
    ? "~"
    : path.startsWith(`${home}/`)
      ? `~/${path.slice(home.length + 1)}`
      : path;
}

function formatTokens(value: number): string {
  if (value < 1000) {
    return String(value);
  }
  if (value < 1_000_000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }
  return `${(value / 1_000_000).toFixed(1)}M`;
}

function locationLines(workDir: string, sessionId: string, width: number): string[] {
  const path = compactPath(workDir);
  if (!sessionId) {
    return [truncateToWidth(path, width)];
  }
  const pathWidth = width - visibleWidth(sessionId) - 3;
  if (pathWidth >= 1) {
    const cwd = truncateToWidth(path, pathWidth);
    return [`${cwd}${" ".repeat(pathWidth - visibleWidth(cwd))} · ${sessionId}`];
  }
  // Session IDs are copyable identifiers, never ellipsize them to make room
  // for a path. On very small terminals they get their own wrapped rows.
  return [truncateToWidth(path, width), ...wrapToLines(sessionId, width)];
}

export function Footer(props: FooterProps) {
  const {
    contextTokens,
    contextWindow,
    inputTokens,
    model,
    outputTokens,
    permissionMode,
    provider,
    sessionId,
    workDir,
  } = props;
  const { stdout } = useStdout();
  const ref = useRef<DOMElement>(null);
  const { height, hasMeasured } = useBoxMetrics(ref);
  useLayoutEffect(() => {
    if (hasMeasured) {
      props.onHeightChange?.(height);
    }
  }, [hasMeasured, height, props.onHeightChange]);
  const columns = Math.max(1, stdout.columns || 80);
  const padding = columns > 2 ? 1 : 0;
  const width = columns - padding * 2;
  // Context occupancy, not the cumulative session total: the latter grows
  // unboundedly across turns and would report well over 100%.
  const percentage = contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0;
  const contextColor =
    percentage >= 90 ? THEME.error : percentage >= 70 ? THEME.warning : THEME.dim;
  const tokens = `↑${formatTokens(inputTokens)} ↓${formatTokens(outputTokens)}`;
  const context = `${percentage.toFixed(1)}%/${formatTokens(contextWindow)}`;
  const statsWidth = visibleWidth(`${tokens} ${context}`);
  const mode = MODE_DISPLAY[permissionMode] ?? permissionMode;
  const rightWidth = width - statsWidth - 2;
  const separateMode = rightWidth < visibleWidth(mode);
  const cycleHint = "  Shift+Tab to cycle";
  let identity = provider ? `${provider}/${model}` : model;
  let hint = "";

  if (!separateMode) {
    if (visibleWidth(`${identity} · ${mode}${cycleHint}`) <= rightWidth) {
      hint = cycleHint;
    } else if (visibleWidth(`${identity} · ${mode}`) > rightWidth) {
      // Provider is secondary; only shorten the model once it is gone.
      const modelWidth = rightWidth - visibleWidth(mode) - 3;
      identity = modelWidth >= 2 ? truncateToWidth(model, modelWidth) : "";
    }
  }
  const modelPrefix = identity ? `${identity} · ` : "";
  const gap = Math.max(2, width - statsWidth - visibleWidth(`${modelPrefix}${mode}${hint}`));
  const stats = (
    <Text color={THEME.dim}>
      {tokens} <Text color={contextColor}>{context}</Text>
    </Text>
  );

  return (
    <Box
      ref={ref}
      flexDirection="column"
      width={columns}
      paddingLeft={padding}
      paddingRight={padding}
    >
      <Text color={THEME.dim}>{locationLines(workDir, sessionId, width).join("\n")}</Text>
      {separateMode ? (
        <>
          {stats}
          <Text color={permissionModeColor(permissionMode)}>
            {wrapToLines(mode, width).join("\n")}
          </Text>
        </>
      ) : (
        <Text color={THEME.dim}>
          {stats}
          {" ".repeat(gap)}
          {modelPrefix}
          <Text color={permissionModeColor(permissionMode)}>{mode}</Text>
          {hint}
        </Text>
      )}
    </Box>
  );
}
