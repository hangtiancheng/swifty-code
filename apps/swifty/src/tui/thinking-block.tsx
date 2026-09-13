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

import { Box, Text, useStdout } from "ink";

import { renderMarkdown } from "./markdown.js";
import { THEME } from "./styles.js";
import { truncateToWidth, wrapToLines } from "./terminal-text.js";

interface Props {
  text: string;
  duration?: number;
  expanded: boolean;
  streaming?: boolean;
}

export function ThinkingBlock({ text, duration, expanded, streaming = false }: Props) {
  const { stdout } = useStdout();
  if (!text.trim() && !duration) {
    return null;
  }
  const width = Math.max(1, (stdout.columns || 80) - 2);
  const label = duration ? `Thinking (${duration.toFixed(1)}s)` : "Thinking...";
  let content =
    expanded && text.trim()
      ? renderMarkdown(text.trim(), width, "thinking")
      : truncateToWidth(label, width);
  if (streaming && expanded) {
    const lines = wrapToLines(content, width);
    const limit = Math.max(1, Math.floor((stdout.rows || 24) / 4));
    if (lines.length > limit) {
      content = limit === 1 ? "…" : ["…", ...lines.slice(-(limit - 1))].join("\n");
    }
  }
  return (
    <Box paddingLeft={1} paddingRight={1} marginTop={1}>
      <Text color={THEME.thinkingText} italic>
        {content}
      </Text>
    </Box>
  );
}
