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

import { Box, Text } from "ink";

import { THEME } from "./cross-platform/styles.js";

import type { TeammateUIState } from "@/teams/progress.js";
import { formatTokens, summarizeActivities } from "@/teams/progress.js";

interface TeammateSpinnerLineProps {
  state: TeammateUIState;
  isLast: boolean;
  isSelected?: boolean;
}

function statusColor(status: TeammateUIState["status"]): string {
  if (status === "completed") {
    return THEME.success;
  }
  if (status === "failed") {
    return THEME.error;
  }
  if (status === "stopped") {
    return THEME.warning;
  }
  return THEME.muted;
}

export function TeammateSpinnerLine({ state, isLast, isSelected }: TeammateSpinnerLineProps) {
  const activity = summarizeActivities(state.progress.recentActivities) || state.spinnerVerb;
  const status = state.status === "running" ? `${activity}${activity ? "..." : ""}` : state.status;

  return (
    <Box>
      <Text color={isSelected ? THEME.accent : THEME.dim}>{isSelected ? "› " : "  "}</Text>
      <Text color={THEME.dim}>{isLast ? "└─ " : "├─ "}</Text>
      <Text color={THEME.accent}>@{state.name}</Text>
      <Text color={statusColor(state.status)}> {status}</Text>
      <Text color={THEME.dim}>
        {` · ${String(state.progress.toolUseCount)} tools · ${formatTokens(state.progress.tokenCount)} tokens`}
      </Text>
    </Box>
  );
}
