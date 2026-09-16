import { memo } from "react";

import { AgentToolProgress, type SubagentProgress } from "./agent-tool-progress.js";
import type { ToolBlockInfo } from "./tool-display.js";

import type { TeammateUIState } from "@/teams/progress.js";

export type { SubagentProgress } from "./agent-tool-progress.js";

interface Props {
  tools: ToolBlockInfo[];
  teammateTools: ToolBlockInfo[];
  subagents: SubagentProgress[];
  teammates: TeammateUIState[];
  isAsking: boolean;
  expanded: boolean;
}

export const AgentActivity = memo(function AgentActivity({
  tools,
  teammateTools,
  subagents,
  teammates,
  isAsking,
  expanded,
}: Props) {
  const merged = new Map(teammateTools.map((tool) => [tool.toolId, tool]));
  for (const tool of tools) {
    merged.set(tool.toolId, tool);
  }

  return !isAsking && merged.size > 0 ? (
    <AgentToolProgress
      tools={[...merged.values()]}
      subagents={subagents}
      teammates={teammates}
      expanded={expanded}
    />
  ) : null;
});
