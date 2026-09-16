import { Box } from "ink";

import { ToolBlock, type ToolBlockInfo } from "./tool-display.js";

import { formatTokens, type TeammateUIState } from "@/teams/progress.js";
import { strArg } from "@/utils/utils.js";

export interface SubagentProgress {
  toolCallId: string;
  role: string;
  turnCount: number;
  activeTools: { toolId: string; toolName: string }[];
  status: "running" | "completed" | "failed" | "stopped";
}

interface Props {
  tools: ToolBlockInfo[];
  subagents: SubagentProgress[];
  teammates: TeammateUIState[];
  expanded: boolean;
}

function subagentProgress(subagent: SubagentProgress): string {
  const currentTool = subagent.activeTools.at(-1)?.toolName ?? subagent.status;
  return `${subagent.role} subagent | ${String(subagent.turnCount)} turns | ${currentTool}`;
}

function teammateProgress(teammate: TeammateUIState): string {
  const currentTool = teammate.progress.activeTools.at(-1)?.toolName ?? teammate.status;
  return `@${teammate.name} | ${currentTool} | ${String(teammate.progress.turnCount)} turns | ${formatTokens(teammate.progress.tokenCount)} tokens`;
}

function progressForTool(
  tool: ToolBlockInfo,
  subagents: Map<string, SubagentProgress>,
  teammates: Map<string, TeammateUIState>,
): string | undefined {
  if (tool.toolName !== "Agent") {
    return undefined;
  }

  const teammate = teammates.get(tool.toolId);
  if (teammate) {
    return teammateProgress(teammate);
  }

  const subagent = subagents.get(tool.toolId);
  if (subagent) {
    return subagentProgress(subagent);
  }

  if (strArg(tool.args, "team_name")) {
    return "waiting | 0 turns | 0 tokens";
  }

  const role = strArg(tool.args, "subagent_type") || "general-purpose";
  return `${role} subagent | 0 turns | waiting`;
}

export function AgentToolProgress({ tools, subagents, teammates, expanded }: Props) {
  const subagentsByTool = new Map(subagents.map((subagent) => [subagent.toolCallId, subagent]));
  const teammatesByTool = new Map(
    teammates.flatMap((teammate) =>
      teammate.originToolCallId ? [[teammate.originToolCallId, teammate]] : [],
    ),
  );

  return (
    <Box flexDirection="column">
      {tools.map((tool) => (
        <ToolBlock
          key={tool.toolId}
          tool={{ ...tool, progress: progressForTool(tool, subagentsByTool, teammatesByTool) }}
          expanded={expanded}
        />
      ))}
    </Box>
  );
}
