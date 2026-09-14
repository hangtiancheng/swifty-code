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

import { THEME } from "./styles.js";
import { TeammateSpinnerLine } from "./teammate-spinner-line.js";

import type { TeammateUIState } from "@/teams/progress.js";
import { formatTokens } from "@/teams/progress.js";

interface TeammateSpinnerTreeProps {
  teammates: TeammateUIState[];
  leaderVerb?: string;
  leaderTokens?: number;
}

export function TeammateSpinnerTree({
  teammates,
  leaderVerb,
  leaderTokens,
}: TeammateSpinnerTreeProps) {
  if (teammates.length === 0) {
    return null;
  }

  const tokenSuffix =
    leaderTokens !== undefined && leaderTokens > 0 ? ` · ${formatTokens(leaderTokens)} tokens` : "";

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={THEME.muted}>
        ┌─ team lead · {leaderVerb ?? "thinking"}...{tokenSuffix}
      </Text>
      {teammates.map((teammate, index) => (
        <TeammateSpinnerLine
          key={`${teammate.teamName}/${teammate.name}`}
          state={teammate}
          isLast={index === teammates.length - 1}
        />
      ))}
    </Box>
  );
}
