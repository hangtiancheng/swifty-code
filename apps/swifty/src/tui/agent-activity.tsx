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
import { TeammateSpinnerTree } from "./teammate-spinner-tree.js";
import { ToolDisplay, type ToolBlockInfo } from "./tool-display.js";

import type { TeammateUIState } from "@/teams/progress.js";

export interface SubagentProgress {
  id: number;
  label: string;
  turn: number;
  lastTool?: string;
}

interface Props {
  tools: ToolBlockInfo[];
  subagents: SubagentProgress[];
  teammates: TeammateUIState[];
  isStreaming: boolean;
  isAsking: boolean;
  expanded: boolean;
  leaderTokens: number;
}

export function AgentActivity({
  tools,
  subagents,
  teammates,
  isStreaming,
  isAsking,
  expanded,
  leaderTokens,
}: Props) {
  return (
    <>
      {tools.length > 0 && !isAsking && <ToolDisplay tools={tools} expanded={expanded} />}
      {subagents.length > 0 && !isAsking && (
        <Box flexDirection="column" paddingX={1}>
          {subagents.map((subagent) => (
            <Text key={subagent.id} color={THEME.customMessageLabel} wrap="truncate-end">
              • {subagent.label} subagent · turn {subagent.turn}
              {subagent.lastTool ? ` · ${subagent.lastTool}` : ""}
            </Text>
          ))}
        </Box>
      )}
      {isStreaming && !isAsking && teammates.length > 0 && (
        <Box paddingLeft={1}>
          <TeammateSpinnerTree teammates={teammates} leaderTokens={leaderTokens} />
        </Box>
      )}
      {!isStreaming && teammates.some((teammate) => teammate.status === "running") && (
        <Box paddingLeft={1}>
          <TeammateSpinnerTree teammates={teammates} />
        </Box>
      )}
    </>
  );
}
