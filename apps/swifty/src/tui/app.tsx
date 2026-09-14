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

import { existsSync, readFileSync } from "node:fs";

import { Box, Text, useApp } from "ink";
import { useState, useEffect, useRef, useCallback } from "react";

import { AgentActivity, type SubagentProgress } from "./agent-activity.js";
import { ChatView, type ChatMessage, type ToolSummaryItem } from "./chat.js";
import { Footer } from "./footer.js";
import { InteractionDock } from "./interaction-dock.js";
import { PendingQueue } from "./pending-queue.js";
import type { PlanChoice } from "./plan-approval.js";
import { ProviderLogin } from "./provider-login.js";
import { ProviderSelect } from "./provider-select.js";
import type { RewindAction } from "./rewind-dialog.js";
import { activityStatusColor, THEME, thinkingLevelColor } from "./styles.js";
import { TeamStatus } from "./team-status.js";
import { Transcript } from "./transcript.js";
import { useAgentOutput } from "./use-agent-output.js";
import { useFollowUpQueue } from "./use-follow-up-queue.js";
import { useIdeInput } from "./use-ide-input.js";
import { useTeammateStates } from "./use-teammate-states.js";
import { useTerminalControls } from "./use-terminal-controls.js";

import { Agent } from "@/agent/agent.js";
import type { InteractionSummary } from "@/bootstrap/interaction-summary.js";
import {
  countMcpTools,
  createToolRegistry,
  removeMcpTools,
  wireSkillsToRegistry,
  buildComposedToolFilter,
  formatToolArgs,
} from "@/bootstrap/utils.js";
import {
  parse as parseCommand,
  createDefaultRegistry as createCommandRegistry,
} from "@/commands/commands.js";
import { loadUserCommands } from "@/commands/loader.js";
import { CommandUsageTracker } from "@/commands/usage-tracker.js";
import { currentContextTokens, forceCompact } from "@/compact/compact.js";
import { RecoveryState } from "@/compact/recovery.js";
import type {
  ProviderConfig,
  MCPServerConfig,
  HookConfig,
  SandboxYamlConfig,
} from "@/config/config.js";
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_THINKING_LEVEL,
  getContextWindow,
  getMaxOutputTokens,
  getSupportedThinkingLevels,
  loadConfig,
  withProjectMcpServers,
} from "@/config/config.js";
import { persistThinkingLevel, saveProvider } from "@/config/provider-login.js";
import { expandAtRefsWithImages } from "@/conversation/at-expand.js";
import { ConversationManager } from "@/conversation/conversation.js";
import { FileHistory } from "@/file-history/file-history.js";
import type { Snapshot } from "@/file-history/file-history.js";
import * as historyMod from "@/history/history.js";
import { HookEngine, validate as validateHooks } from "@/hooks/hooks.js";
import type { LLMClient } from "@/llm/client.js";
import { createClient } from "@/llm/client.js";
import { createChildLogger } from "@/logger/logger.js";
import { MCPManager } from "@/mcp/manager.js";
import { applyMode, decideAndApply } from "@/mcp/strategy.js";
import { MCPToolWrapper } from "@/mcp/tool-wrapper.js";
import { MemoryExtractor } from "@/memory/extractor.js";
import { loadInstructions } from "@/memory/instructions.js";
import { MemoryManager, type RecallResult } from "@/memory/manager.js";
import { PermissionChecker, type PermissionMode } from "@/permissions/checker.js";
import { getOrCreatePlanPath, loadPlan, planExists, resetPlanPath } from "@/plan-file/plan-file.js";
import { buildSystemPrompt, detectEnvironment } from "@/prompt/builder.js";
import { buildPlanModeExitReminder, buildPlanModeReentryReminder } from "@/prompt/plan-mode.js";
import { createSandbox, type Sandbox } from "@/sandbox/index.js";
import * as sessionMod from "@/session/session.js";
import { SkillCatalog, buildSkillSection } from "@/skills/catalog.js";
import { runFork as runSkillFork } from "@/skills/executor.js";
import { InstallSkillTool } from "@/skills/install-tool.js";
import { LoadSkillTool } from "@/skills/load-skill-tool.js";
import type { SkillHost, SkillForkHost } from "@/skills/skill.js";
import { AgentTool } from "@/subagent/agent-tool.js";
import { BUILTIN_AGENTS } from "@/subagent/definition.js";
import { spawnSubagent } from "@/subagent/spawn.js";
import { coordinatorToolFilter, coordinatorActive } from "@/teams/coordinator.js";
import { TaskStopTool } from "@/teams/task-stop.js";
import type { RunAgent } from "@/teams/team.js";
import { TeamManager } from "@/teams/team.js";
import {
  TeamCreateTool,
  SpawnTeammateTool,
  SendMessageTool,
  ListTeamsTool,
  TeamDeleteTool,
} from "@/teams/tools.js";
import { TaskStore } from "@/todo/store.js";
import { TaskList } from "@/todo/todo.js";
import { toDisplayPreview } from "@/tool-result/budget.js";
import { AskUserQuestionTool, type Question } from "@/tools/ask-user.js";
import type { BashTool } from "@/tools/bash.js";
import type { ExitPlanModeTool } from "@/tools/exit-plan-mode.js";
import { FileStateCache } from "@/tools/file-state-cache.js";
import type { ToolRegistry } from "@/tools/registry.js";
import { SyntheticOutputTool } from "@/tools/synthetic-output.js";
import { asErrorString, asRecord, contentToText, strArg } from "@/utils/index.js";

const log = createChildLogger({ module: "tui" });

type AppState = "providerSelect" | "chat";

interface Props {
  providers: ProviderConfig[];
  permissionMode?: string;
  mcpServers: MCPServerConfig[];
  hooks: HookConfig[];
  sandboxConfig?: SandboxYamlConfig;
  enableCoordinatorMode?: boolean;
  forkDisabled?: boolean;
  resume?: true | string;
  onExitSummary?: (summary: InteractionSummary) => void;
}

// Maximum number of recent tool names (deduplicated) passed to the memory recall selector
const MAX_RECENT_TOOLS = 10;

export function App({
  providers: initialProviders,
  permissionMode,
  mcpServers,
  hooks,
  sandboxConfig: sandboxYaml,
  enableCoordinatorMode,
  forkDisabled,
  resume,
  onExitSummary,
}: Props) {
  const { exit } = useApp();
  const [providers, setProviders] = useState(initialProviders);
  const [loginActive, setLoginActive] = useState(initialProviders.length === 0);
  const [appState, setAppState] = useState<AppState>(
    providers.length === 1 ? "chat" : "providerSelect",
  );
  const [selectedProvider, setSelectedProvider] = useState<ProviderConfig>(
    providers[0] ?? {
      name: "",
      protocol: "anthropic",
      base_url: "",
      model: "",
    },
  );
  const selectedProviderRef = useRef(selectedProvider);
  const [providerDialogActive, setProviderDialogActive] = useState(false);
  const [thinkingDialogActive, setThinkingDialogActive] = useState(false);
  const [providerSwitching, setProviderSwitching] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const output = useAgentOutput(setMessages);
  const {
    streamingText,
    streamingThinking,
    streamingTextRef,
    activeTools,
    inputTokens,
    outputTokens,
  } = output;
  const [isStreaming, setIsStreaming] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const [permMode, setPermMode] = useState<PermissionMode>(() => {
    if (process.env.SWIFTY_BYPASS_PERMISSIONS === "1") {
      return "bypassPermissions";
    }
    const isPermissionMode = (mode: string): mode is PermissionMode =>
      ["default", "acceptEdits", "plan", "bypassPermissions"].includes(mode);
    if (permissionMode && isPermissionMode(permissionMode)) {
      return permissionMode;
    }
    return "default";
  });
  const [error, setError] = useState<string | null>(null);
  const [planApprovalActive, setPlanApprovalActive] = useState(false);
  const [prePlanMode, setPrePlanMode] = useState<PermissionMode>("default");
  // Tracks whether plan mode has been exited
  // Recently invoked tool names, deduplicated and kept in call order. Passed to the
  // memory recall selector so it skips usage-guide memories for these tools, while
  // still surfacing pitfall and warning memories
  const recentToolsRef = useRef<string[]>([]);
  // Memory paths already injected this session; pre-filtered before recall to avoid
  // the same memory occupying a slot every turn
  const surfacedMemoriesRef = useRef<Set<string>>(new Set());
  const hasExitedPlanModeRef = useRef(false);
  const permModeRef = useRef(permMode);
  useEffect(() => {
    permModeRef.current = permMode;
  }, [permMode]);
  const [mcpInfo, setMcpInfo] = useState<{
    servers: string[];
    toolCount: number;
  } | null>(null);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [footerRows, setFooterRows] = useState(2);

  const workDir = process.cwd();
  const historyDir = `${workDir}/.swifty`;

  const clientRef = useRef<LLMClient | null>(null);
  // Resolved context window for the active provider. Seeded synchronously
  // (layers 1/3/4) and upgraded in initClient via the async auto-fetch (layer 2).
  const contextWindowRef = useRef(
    providers[0] ? getContextWindow(providers[0]) : DEFAULT_CONTEXT_WINDOW,
  );
  // Output ceiling for the active provider (PI's model.maxTokens equivalent).
  const maxOutputRef = useRef(providers[0] ? getMaxOutputTokens(providers[0]) : undefined);
  const convRef = useRef(new ConversationManager());
  const sessionIdRef = useRef(sessionMod.newSessionId());
  const interactionStatsRef = useRef({
    agentActiveMs: 0,
    failedToolCalls: 0,
    startedAt: Date.now(),
    successfulToolCalls: 0,
    toolTimeMs: 0,
  });
  const activeToolIdsRef = useRef(new Set<string>());
  const activeToolBatchStartedAtRef = useRef<number | null>(null);
  const taskListRef = useRef(new TaskList(new TaskStore(workDir, sessionIdRef.current)));
  const registryRef = useRef(
    (() => {
      const reg = createToolRegistry(workDir, taskListRef.current);

      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const exitPlan = reg.get("ExitPlanMode") as ExitPlanModeTool | undefined;
      if (exitPlan) {
        exitPlan.isPlanMode = () => permModeRef.current === "plan";
        exitPlan.planExists = () => {
          const p = getOrCreatePlanPath(workDir);
          return existsSync(p);
        };
      }
      return reg;
    })(),
  );
  const cmdRegistryRef = useRef(
    (() => {
      const registry = createCommandRegistry();
      registry.register({
        name: "provider",
        aliases: [],
        type: "local_ui",
        description: "Switch the active provider",
        handler: () => "provider",
      });
      return registry;
    })(),
  );
  const usageTrackerRef = useRef(new CommandUsageTracker(workDir));
  const mcpManagerRef = useRef<MCPManager | null>(null);
  // Current MCP server list. Starts as the prop but /mcp reload replaces it
  // with the freshly read config, so consumers must read this ref, not the prop.
  const mcpServersRef = useRef<MCPServerConfig[]>(mcpServers);
  // The MCP load mode is decided once per session; a later retry pass must
  // reapply that decision rather than recompute it.
  const mcpModeDecidedRef = useRef(false);
  const hookEngineRef = useRef<HookEngine | null>(null);
  const skillCatalogRef = useRef<SkillCatalog | null>(null);
  // Skills already announced to the model. The first system-reminder of the
  // session carries the full list; afterwards only new skills are sent as a
  // delta to avoid wasting context on duplicates.
  const announcedSkillsRef = useRef<Set<string>>(new Set());

  // Returns the skills not yet announced to the model and records them in
  // announcedSkillsRef.
  const skillDelta = (): string => {
    const catalog = skillCatalogRef.current;
    if (!catalog) {
      return "";
    }
    const lines: string[] = [];
    for (const meta of catalog.list()) {
      if (announcedSkillsRef.current.has(meta.name)) {
        continue;
      }
      announcedSkillsRef.current.add(meta.name);
      const desc =
        meta.description.length > 200 ? meta.description.slice(0, 200) + "…" : meta.description;
      lines.push(`- /${meta.name}: ${desc}`);
    }
    return lines.join("\n");
  };

  const recoveryStateRef = useRef(new RecoveryState());
  const memCursorRef = useRef(0);
  const memExtractingRef = useRef(false);
  const memExtractorRef = useRef<InstanceType<typeof MemoryExtractor> | null>(null);
  const memManagerRef = useRef<InstanceType<typeof MemoryManager> | null>(null);
  const activeSkillsRef = useRef(new Map<string, string>());
  const toolFilterRef = useRef<((name: string) => boolean) | null>(null);
  const skillHostRef = useRef<SkillHost>({
    activateSkill: (name, body) => activeSkillsRef.current.set(name, body),
  });
  const teamManagerRef = useRef(new TeamManager(workDir));
  const fileHistoryRef = useRef<FileHistory | null>(null);
  const fileStateCacheRef = useRef(new FileStateCache());
  const sandboxRef = useRef<Promise<Sandbox | null>>(createSandbox());
  const [sandboxEnabled, setSandboxEnabled] = useState(sandboxYaml?.enabled ?? false);
  const [sandboxAutoAllow, setSandboxAutoAllow] = useState(sandboxYaml?.auto_allow ?? false);
  const sandboxEnabledRef = useRef(sandboxYaml?.enabled ?? false);
  const sandboxAutoAllowRef = useRef(sandboxYaml?.auto_allow ?? false);
  const sandboxNetworkEnabled = sandboxYaml?.network_enabled ?? true;
  useEffect(() => {
    sandboxEnabledRef.current = sandboxEnabled;
  }, [sandboxEnabled]);
  useEffect(() => {
    sandboxAutoAllowRef.current = sandboxAutoAllow;
  }, [sandboxAutoAllow]);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Checker of the in-flight agent loop: a fresh checker is created per loop,
  // so mid-loop permission-mode changes (Shift+Tab) must be applied to this
  // live instance to take effect before the loop ends.
  const checkerRef = useRef<PermissionChecker | null>(null);
  const permissionResolveRef = useRef<((v: "allow" | "deny" | "allowAlways") => void) | null>(null);
  const [rewindDialogActive, setRewindDialogActive] = useState(false);
  const [rewindSnapshots, setRewindSnapshots] = useState<Snapshot[]>([]);
  const [resumeSessions, setResumeSessions] = useState<sessionMod.SessionInfo[]>([]);
  const [resumeDialogActive, setResumeDialogActive] = useState(false);
  const initialResumeHandledRef = useRef(false);
  const [permissionRequest, setPermissionRequest] = useState<{
    toolName: string;
    argsSummary: string;
    reason: string;
  } | null>(null);
  const [askRequest, setAskRequest] = useState<Question[] | null>(null);
  const askResolveRef = useRef<((a: Record<string, string>) => void) | null>(null);
  const teammateStates = useTeammateStates(teamManagerRef.current);
  const [teamsDialogOpen, setTeamsDialogOpen] = useState(false);
  const [subagents, setSubagents] = useState<SubagentProgress[]>([]);
  const subagentIdRef = useRef(0);
  const { insertInputTextRef, clearInputRef } = useIdeInput(workDir);

  const requestExit = useCallback(() => {
    const activeToolTime = activeToolBatchStartedAtRef.current
      ? Date.now() - activeToolBatchStartedAtRef.current
      : 0;
    onExitSummary?.({
      ...interactionStatsRef.current,
      sessionId: sessionIdRef.current,
      toolTimeMs: interactionStatsRef.current.toolTimeMs + activeToolTime,
    });
    exit();
  }, [exit, onExitSummary]);

  const { termWidth, toolsExpanded, ctrlCHint } = useTerminalControls({
    isStreaming,
    abortControllerRef,
    clearInputRef,
    onExit: requestExit,
    teamsDialogOpen,
    onToggleTeams: () => {
      setTeamsDialogOpen((open) => !open);
    },
  });

  const activityStatus = error
    ? ("error" as const)
    : output.retryStatus
      ? ("retry" as const)
      : isCompacting || providerSwitching
        ? ("compacting" as const)
        : isStreaming
          ? ("working" as const)
          : ("idle" as const);

  // Connects every configured MCP server that has no live connection yet and
  // registers the tools it reports. Safe to call repeatedly: connectAll skips
  // servers that are already up, so /mcp retries only the ones that failed.
  // Reads the server list from mcpServersRef so /mcp reload takes effect here.
  const connectMcpServers = useCallback(async (mgr: MCPManager, provider: ProviderConfig) => {
    const result = await mgr.connectAll(mcpServersRef.current);
    for (const { serverName, tool } of result.tools) {
      const client = mgr.getClient(serverName);
      if (client) {
        registryRef.current.register(new MCPToolWrapper(client, serverName, tool));
      }
    }
    if (result.errors.length > 0) {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `MCP errors: ${result.errors.map((e) => `${e.serverName}: ${e.error}`).join("; ")}`,
        },
      ]);
    }
    setMcpInfo({
      servers: mgr.connectedServers(),
      toolCount: countMcpTools(registryRef.current),
    });
    if (result.tools.length > 0) {
      if (mcpModeDecidedRef.current) {
        // The mode is fixed for the session — re-deciding it now could flip
        // tools[] mid-flight and break the cache prefix. Reapply the standing
        // mode so the tools this pass added inherit its defer flag.
        applyMode(registryRef.current, registryRef.current.mcpLoadingMode);
      } else {
        // Only decide the load mode after all tools are registered: it compares total schema size against the context window
        decideAndApply(registryRef.current, provider.base_url, getContextWindow(provider));
        mcpModeDecidedRef.current = true;
      }
    }
    // Inject each server's instructions into the conversation so the
    // model knows how to use that server's tools.
    for (const { serverName, text } of result.instructions) {
      convRef.current.addSystemReminder(`# MCP Server: ${serverName}\n${text}`);
    }
    return result;
  }, []);

  // /mcp reload — re-reads the MCP server list from disk (config.yaml plus the
  // project .mcp.json), tears down every live connection and its registered
  // tools, then connects and registers whatever the fresh config lists.
  const reloadMcpServers = useCallback(async () => {
    let servers: MCPServerConfig[];
    try {
      servers = withProjectMcpServers(loadConfig(), workDir).mcp_servers;
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "system", content: `MCP reload failed: ${asErrorString(err)}` },
      ]);
      return;
    }
    mcpServersRef.current = servers;

    // Drop the previously registered wrappers first: they hold references to
    // clients that disconnectAll is about to tear down, and tools of servers
    // removed from the config must not linger in the registry.
    removeMcpTools(registryRef.current);

    if (servers.length === 0) {
      await mcpManagerRef.current?.disconnectAll();
      mcpManagerRef.current = null;
      setMcpInfo({ servers: [], toolCount: 0 });
      setMessages((prev) => [
        ...prev,
        { role: "system", content: "MCP config reloaded: no MCP servers configured." },
      ]);
      return;
    }

    const mgr = mcpManagerRef.current ?? new MCPManager();
    mcpManagerRef.current = mgr;
    setMessages((prev) => [
      ...prev,
      {
        role: "system",
        content: `Reloading MCP server(s): ${servers.map((s) => s.name).join(", ")}`,
      },
    ]);
    await mgr.disconnectAll();
    const result = await connectMcpServers(mgr, selectedProviderRef.current);
    setMessages((prev) => [
      ...prev,
      {
        role: "system",
        content:
          `MCP reloaded: ${String(result.servers.length)} server(s) connected, ` +
          `${String(countMcpTools(registryRef.current))} tool(s)`,
      },
    ]);
  }, [workDir, connectMcpServers]);

  const initClient = useCallback(
    async (provider: ProviderConfig) => {
      try {
        const env = detectEnvironment(workDir);
        env.model = provider.model;
        const systemPrompt = buildSystemPrompt(env);
        const client = await createClient(provider, systemPrompt);
        clientRef.current = client;

        contextWindowRef.current = getContextWindow(provider);
        maxOutputRef.current = getMaxOutputTokens(provider);

        // Init file history
        fileHistoryRef.current = new FileHistory(workDir, sessionIdRef.current);

        // Inject long-term memory
        const instructions = loadInstructions(workDir);
        const memMgr = new MemoryManager(workDir);
        memManagerRef.current = memMgr;
        const memReminder = memMgr.buildSystemReminder();
        convRef.current.injectLongTermMemory(instructions, memReminder);

        // Load prompt history
        setPromptHistory(historyMod.load(historyDir));

        // Init hooks
        const hookErr = validateHooks(hooks);
        if (hookErr) {
          setMessages((prev) => [
            ...prev,
            { role: "system", content: `Hook warning: ${hookErr.message}` },
          ]);
        }
        hookEngineRef.current = new HookEngine(hooks);

        // Load skills
        const catalog = new SkillCatalog();
        catalog.load(workDir);
        skillCatalogRef.current = catalog;

        // The skill catalog is project-scoped and never baked into the system
        // prompt; the Agent injects it via the first system-reminder, and
        // skills added mid-session are appended by skillDelta.

        // Register the LoadSkill tool so the model can activate skills on demand.
        registryRef.current.register(new LoadSkillTool(catalog, skillHostRef.current));
        // Register InstallSkill so the model can install skills from a path/URL.
        // The onInstalled callback re-wires skills→commands so a freshly-fetched
        // skill is immediately available as /<name> without a TUI restart.
        registryRef.current.register(
          new InstallSkillTool(workDir, catalog, () => {
            // Only rewire the slash commands; leave the system prompt alone.
            // Newly installed skills are delivered by skillDelta as a
            // system-reminder on the next turn.
            wireSkillsToRegistry(catalog, cmdRegistryRef.current, skillHostRef.current);
          }),
        );

        // Register AskUserQuestion, delegating the prompt to the TUI dialog.
        registryRef.current.register(
          new AskUserQuestionTool(
            (questions) =>
              new Promise<Record<string, string>>((resolve) => {
                askResolveRef.current = resolve;
                setAskRequest(questions);
              }),
          ),
        );

        // Register team coordination tools. Teammates run as background
        // general-purpose subagents whose results return via the team channel.
        const teamRunAgent: RunAgent = (task, onEvent, abortSignal) =>
          spawnSubagent(
            BUILTIN_AGENTS[0],
            task,
            clientRef.current ?? client,
            registryRef.current,
            selectedProviderRef.current,
            workDir,
            undefined,
            onEvent,
            undefined,
            undefined,
            { abortSignal },
          );
        // Teammate-scoped registry factory: injects shared task-board tools, then runs the teammate agent main loop
        const teamRunAgentFactory =
          (
            registry: ToolRegistry,
            teamChecker?: PermissionChecker,
            memberWorkDir = workDir,
          ): RunAgent =>
          (task, onEvent, abortSignal) =>
            spawnSubagent(
              BUILTIN_AGENTS[0],
              task,
              clientRef.current ?? client,
              registry,
              selectedProviderRef.current,
              memberWorkDir,
              undefined,
              onEvent,
              undefined,
              teamChecker,
              { abortSignal },
            );
        registryRef.current.register(new TeamCreateTool(teamManagerRef.current));
        registryRef.current.register(new SpawnTeammateTool(teamManagerRef.current, teamRunAgent));
        registryRef.current.register(new SendMessageTool(teamManagerRef.current));
        registryRef.current.register(new ListTeamsTool(teamManagerRef.current));
        registryRef.current.register(new TeamDeleteTool(teamManagerRef.current));
        registryRef.current.register(new TaskStopTool(teamManagerRef.current));
        registryRef.current.register(new SyntheticOutputTool());

        // Load user-defined slash commands from .swifty/commands/*.md.
        for (const cmd of loadUserCommands(workDir)) {
          try {
            cmdRegistryRef.current.register(cmd);
          } catch {
            // name clash with a built-in command → keep the built-in
          }
        }

        // Wire every loaded skill as a slash command (inline → "prompt",
        // fork → "skill_fork"). Runs after user commands so user *.md files
        // take precedence. Idempotent: skips names already taken.
        wireSkillsToRegistry(catalog, cmdRegistryRef.current, skillHostRef.current);

        // Register AgentTool with real spawn + live progress reporting.
        const agentTool = new AgentTool(
          workDir,
          registryRef.current,
          async (def, prompt, background, modelOverride?, workDirOverride?, context?) => {
            const id = ++subagentIdRef.current;
            setSubagents((prev) => [...prev, { id, label: def.name, turn: 0 }]);
            const onProgress = (p: { turn?: number; lastTool?: string }) => {
              setSubagents((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
            };
            try {
              return await spawnSubagent(
                def,
                prompt,
                clientRef.current ?? client,
                registryRef.current,
                selectedProviderRef.current,
                workDirOverride ?? workDir,
                onProgress,
                undefined,
                modelOverride,
                workDirOverride
                  ? context?.permissionChecker?.forWorkDir(workDirOverride)
                  : context?.permissionChecker,
                {
                  abortSignal: context?.abortSignal,
                  background,
                  onPermissionRequest: context?.onPermissionRequest,
                  permissionMode: context?.permissionChecker?.mode,
                },
              );
            } finally {
              setSubagents((prev) => prev.filter((s) => s.id !== id));
            }
          },
          convRef.current,
          (prompt, conversation, registry, modelOverride, context) =>
            spawnSubagent(
              BUILTIN_AGENTS[0],
              prompt,
              clientRef.current ?? client,
              registry,
              selectedProviderRef.current,
              context?.workDir ?? workDir,
              undefined,
              undefined,
              modelOverride,
              context?.permissionChecker,
              {
                conversation,
                abortSignal: context?.abortSignal,
                onPermissionRequest: context?.onPermissionRequest,
              },
            ),
        );
        agentTool.forkDisabled = forkDisabled ?? false;
        // Wire the team manager into AgentTool to enable the team_name teammate path (teammates receive shared task-board tools)
        agentTool.setTeamManager(teamManagerRef.current, teamRunAgentFactory);
        registryRef.current.register(agentTool);

        // Connect MCP servers in background
        if (mcpServers.length > 0) {
          const mgr = new MCPManager();
          mcpManagerRef.current = mgr;
          void connectMcpServers(mgr, provider);
        }
      } catch (err) {
        setError(`Failed to init LLM client: ${asErrorString(err)}`);
      }
    },
    [workDir, mcpServers, connectMcpServers],
  );

  useEffect(() => {
    if (appState === "chat" && !clientRef.current) {
      void initClient(selectedProvider);
    }
  }, [appState, selectedProvider, initClient]);

  const handleProviderSelect = (provider: ProviderConfig) => {
    if (appState === "providerSelect" || !clientRef.current) {
      selectedProviderRef.current = provider;
      setSelectedProvider(provider);
      setAppState("chat");
      return;
    }

    setProviderDialogActive(false);
    setProviderSwitching(true);
    const previousProvider = selectedProviderRef.current;
    void (async () => {
      try {
        const environment = detectEnvironment(workDir);
        environment.model = provider.model;
        const client = await createClient(provider, buildSystemPrompt(environment));
        clientRef.current = client;
        selectedProviderRef.current = provider;
        setSelectedProvider(provider);
        contextWindowRef.current = getContextWindow(provider);
        maxOutputRef.current = getMaxOutputTokens(provider);
        decideAndApply(registryRef.current, provider.base_url, contextWindowRef.current);
        setMessages((current) => [
          ...current,
          {
            role: "system",
            content: `Provider switched to ${provider.name} · ${provider.model}.`,
          },
        ]);
      } catch (err) {
        selectedProviderRef.current = previousProvider;
        setError(`Failed to switch provider: ${asErrorString(err)}`);
      } finally {
        setProviderSwitching(false);
      }
    })();
  };

  const handleSlashCommand = async (text: string): Promise<boolean> => {
    let parsed = parseCommand(text);
    if (!parsed) {
      return false;
    }

    // /mcp — show MCP server status, first retrying any server still not
    // connected; /mcp reload re-reads the config from disk and reconnects all.
    if (parsed.name === "mcp") {
      usageTrackerRef.current.record("mcp");
      if (parsed.args.trim().toLowerCase() === "reload") {
        await reloadMcpServers();
        return true;
      }
      const mgr = mcpManagerRef.current;
      if (!mgr) {
        setMessages((prev) => [...prev, { role: "system", content: "No MCP servers configured." }]);
        return true;
      }
      const down = mgr.missingServers(mcpServersRef.current);
      if (down.length > 0) {
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: `Connecting MCP server(s): ${down.join(", ")}`,
          },
        ]);
        await connectMcpServers(mgr, selectedProvider);
      }
      const connected = mgr.connectedServers();
      const stillDown = mgr.missingServers(mcpServersRef.current);
      const lines =
        connected.length === 0
          ? ["No MCP servers connected."]
          : [
              `MCP servers (${String(connected.length)}):`,
              ...connected.map((s) => `  · ${s}`),
              `Tools: ${String(countMcpTools(registryRef.current))} total`,
            ];
      if (stillDown.length > 0) {
        lines.push(`Not connected: ${stillDown.join(", ")}`);
      }
      setMessages((prev) => [...prev, { role: "system", content: lines.join("\n") }]);
      return true;
    }

    // `/skill <name> [args]` shorthand: rewrite to `/<name> [args]` so it
    // goes through the normal command registry path (skills are wired there).
    // Exception: `/skill reload` routes to the /skills handler instead.
    if (parsed.name === "skill" && parsed.args.trim()) {
      const parts = parsed.args.trim().split(/\s+/);
      if (parts[0] === "reload") {
        parsed = { name: "skills", args: "reload" };
      } else {
        parsed = { name: parts[0], args: parts.slice(1).join(" ") };
      }
    }

    const cmd = cmdRegistryRef.current.find(parsed.name);
    if (cmd) {
      usageTrackerRef.current.record(cmd.name);
    }
    if (!cmd) {
      setMessages((prev) => [
        ...prev,
        { role: "system", content: `Unknown command: /${parsed.name}` },
      ]);
      return true;
    }

    // Rich status/memory commands need live app state, so handle them here.
    if (cmd.name === "status") {
      const sbStatus = sandboxEnabled
        ? sandboxAutoAllow
          ? "ON (auto-allow)"
          : "ON (manual)"
        : "OFF";
      const lines = [
        `Mode:      ${permMode}`,
        `Model:     ${selectedProvider.model}`,
        `Provider:  ${selectedProvider.name} (${selectedProvider.protocol})`,
        `Tokens:    ${String(inputTokens)} in / ${String(outputTokens)} out`,
        `Tools:     ${String(registryRef.current.listTools().length)}`,
        `Sandbox:   ${sbStatus}`,
        `Memories:  ${String(new MemoryManager(workDir).getMemories().length)}`,
        `Skills:    ${String(skillCatalogRef.current?.list().length ?? 0)}`,
        `MCP:       ${String(mcpInfo?.servers.length ?? 0)} server(s), ${String(mcpInfo?.toolCount ?? 0)} tool(s)`,
        `Session:   ${sessionIdRef.current}`,
        `Directory: ${workDir}`,
      ];
      setMessages((prev) => [...prev, { role: "system", content: lines.join("\n") }]);
      return true;
    }
    if (cmd.name === "memory") {
      const sub = parsed.args.trim().split(/\s+/)[0];
      const mgr = new MemoryManager(workDir);
      if (sub === "clear") {
        mgr.clear();
        setMessages((prev) => [...prev, { role: "system", content: "All memories cleared." }]);
      } else {
        const mems = mgr.getMemories();
        const body =
          mems.length === 0
            ? "No memories saved yet. They are auto-extracted; /memory clear wipes them."
            : `Memories (${String(mems.length)}):\n` +
              mems.map((m) => `  [${m.type}] ${m.name} — ${m.description}`).join("\n");
        setMessages((prev) => [...prev, { role: "system", content: body }]);
      }
      return true;
    }

    if (cmd.type === "local_ui") {
      const action = cmd.handler({ workDir, args: parsed.args });
      switch (action) {
        case "login": {
          setLoginActive(true);
          break;
        }
        case "provider": {
          if (providers.length < 2) {
            setMessages((current) => [
              ...current,
              {
                role: "system",
                content: `Provider: ${selectedProvider.name} · ${selectedProvider.model}`,
              },
            ]);
          } else {
            setProviderDialogActive(true);
          }
          break;
        }
        case "clear": {
          // Clear messages and start a fresh conversation. Reset in place —
          // AgentTool captures the manager for its fork path, so swapping the
          // instance would leave it pointing at the discarded history.
          setMessages([]);
          convRef.current.reset();
          announcedSkillsRef.current.clear();
          convRef.current.injectLongTermMemory(
            loadInstructions(workDir),
            memManagerRef.current?.buildSystemReminder() ?? "",
          );
          // Reset the session ID and the stores derived from it
          sessionIdRef.current = sessionMod.newSessionId();
          interactionStatsRef.current = {
            agentActiveMs: 0,
            failedToolCalls: 0,
            startedAt: Date.now(),
            successfulToolCalls: 0,
            toolTimeMs: 0,
          };
          activeToolIdsRef.current.clear();
          activeToolBatchStartedAtRef.current = null;
          taskListRef.current.useStore(new TaskStore(workDir, sessionIdRef.current));
          fileHistoryRef.current = new FileHistory(workDir, sessionIdRef.current);
          // Reset token counters
          output.resetUsage();
          // Reset memory extraction and recall state
          memCursorRef.current = 0;
          memExtractingRef.current = false;
          recentToolsRef.current = [];
          surfacedMemoriesRef.current.clear();
          recoveryStateRef.current = new RecoveryState();
          // Clear both the visible screen and terminal scrollback. Changing the
          // session ID remounts the static brand block on the next render.
          process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
          break;
        }
        case "quit":
          requestExit();
          break;
        case "plan": {
          setPrePlanMode(permMode);
          permModeRef.current = "plan";
          setPermMode("plan");
          const planPath = getOrCreatePlanPath(workDir);
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content:
                `Entered plan mode (read-only). Plan file: ${planPath}\n` +
                "Investigate and design your approach. The agent will call ExitPlanMode when the plan is ready.",
            },
          ]);
          // Re-enter plan mode: if a plan file already exists, rebuild the reminder
          if (hasExitedPlanModeRef.current && planExists(workDir)) {
            const reentryMsg = buildPlanModeReentryReminder(planPath, true);
            if (reentryMsg) {
              convRef.current.addSystemReminder(reentryMsg);
              setMessages((prev) => [...prev, { role: "system", content: reentryMsg }]);
            }
            hasExitedPlanModeRef.current = false;
          }
          if (parsed.args) {
            await runUserTurn(parsed.args, "plan");
          }
          break;
        }
        case "do": {
          setPermMode("default");
          // Exit plan mode for manual approval
          hasExitedPlanModeRef.current = true;
          const planContent = loadPlan(/** workDir */);
          const exitPlanPath = getOrCreatePlanPath(workDir);
          convRef.current.addSystemReminder(buildPlanModeExitReminder(exitPlanPath, !!planContent));
          if (planContent?.trim()) {
            // Feed the approved plan back to the agent and execute it.
            convRef.current.addUserMessage(
              "The plan below has been approved. Exit plan mode and carry it out now.\n\n" +
                "# Approved Plan\n" +
                planContent,
            );
            resetPlanPath();
            setMessages((prev) => [
              ...prev,
              { role: "system", content: "✓ Plan approved — executing." },
            ]);
            setIsStreaming(true);
            output.prepareTurn();
            await runAgentLoopWithStats("default")
              .then(() => {
                setIsStreaming(false);
                output.clearTools();
              })
              .catch((err: unknown) => {
                setError(asErrorString(err));
                setIsStreaming(false);
              });
          } else {
            setMessages((prev) => [...prev, { role: "system", content: "Exited plan mode." }]);
          }
          break;
        }
        case "compact":
          if (clientRef.current) {
            const controller = new AbortController();
            abortControllerRef.current = controller;
            setIsCompacting(true);
            await forceCompact(
              convRef.current,
              clientRef.current,
              recoveryStateRef.current,
              registryRef.current.listTools().map((t) => t.name),

              registryRef.current.getAllSchemas(),
              sessionMod.getSessionFilePath(workDir, sessionIdRef.current),
              controller.signal,
              parsed.args,
            )
              .then((result) => {
                // Persist the boundary so the compacted state survives /resume.
                if (result.boundary) {
                  sessionMod.saveCompactBoundary(workDir, sessionIdRef.current, result.boundary);
                }
                setMessages((prev) => [
                  ...prev,
                  { role: "system", content: `Compact: ${result.message}` },
                ]);
              })
              .catch((err: unknown) => {
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "system",
                    content: `Compact failed: ${asErrorString(err)}`,
                  },
                ]);
              })
              .finally(() => {
                if (abortControllerRef.current === controller) {
                  abortControllerRef.current = null;
                }
                setIsCompacting(false);
              });
          }
          break;
        case "resume": {
          const arg = parsed.args.trim();
          if (!arg) {
            const sessions = sessionMod
              .listSessions(workDir)
              .filter((session) => session.messageCount > 0);
            if (sessions.length === 0) {
              setMessages((prev) => [...prev, { role: "system", content: "No sessions found." }]);
            } else {
              setResumeSessions(sessions);
              setResumeDialogActive(true);
            }
            break;
          }

          const saved = sessionMod.loadSession(workDir, arg);
          if (saved.length === 0) {
            const sessions = sessionMod
              .listSessions(workDir)
              .filter((session) => session.messageCount > 0);
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: `Session "${arg}" not found or empty.`,
              },
            ]);
            if (sessions.length > 0) {
              setResumeSessions(sessions);
              setResumeDialogActive(true);
            }
            break;
          }

          // Rebuild the conversation (with long-term memory re-injected) and the
          // visible transcript from the saved messages, then continue under the
          // resumed session id. rebuildFromSession honors compaction: if the
          // session contains a compact_boundary it replays the compacted state
          // (summary + inlined keep + post-boundary appends) instead of the full
          // pre-boundary history; with no boundary it replays everything.
          const conv = convRef.current;
          conv.reset();
          conv.injectLongTermMemory(
            loadInstructions(workDir),
            new MemoryManager(workDir).buildSystemReminder(),
          );
          const restored = sessionMod.rebuildFromSession(saved);
          conv.appendMessages(
            restored.map((message) => ({
              ...message,
              toolUses: message.toolUses?.map((tool) => ({
                ...tool,
                arguments: tool.arguments ?? {},
              })),
            })),
          );
          announcedSkillsRef.current.clear();
          sessionIdRef.current = arg;
          setResumeDialogActive(false);
          setResumeSessions([]);
          recentToolsRef.current = [];
          surfacedMemoriesRef.current.clear();
          recoveryStateRef.current = new RecoveryState();
          // Reload the task list for the resumed session.
          taskListRef.current.useStore(new TaskStore(workDir, arg));
          // Re-key file history to the resumed session. The previous instance's
          // snapshots store messageIndex values against the OLD conversation;
          // /rewind after a resume would truncate the rebuilt history at a
          // bogus point (possibly mid tool-chain).
          fileHistoryRef.current = new FileHistory(workDir, arg);
          // Rebuild the visible transcript. Tool chains are persisted as
          // assistant records with tool_uses and user records that carry only
          // tool_results (empty text). Mapping those verbatim used to emit
          // empty role:"user" messages, each rendering as a bare "❯" prompt
          // mark. Fold them into turn_summary messages instead, mirroring how
          // live turns are committed, and skip anything with no visible text.
          const pendingUses = new Map<string, { toolName: string; argsSummary: string }>();
          const resumedMessages: ChatMessage[] = [];
          for (const m of restored) {
            for (const tu of m.toolUses ?? []) {
              pendingUses.set(tu.toolUseId, {
                toolName: tu.toolName,
                argsSummary: formatToolArgs(tu.arguments ?? {}),
              });
            }
            if (m.toolResults?.length) {
              const toolSummary: ToolSummaryItem[] = m.toolResults.map((tr) => {
                const use = pendingUses.get(tr.toolUseId);
                pendingUses.delete(tr.toolUseId);
                return {
                  toolName: use?.toolName ?? "tool",
                  argsSummary: use?.argsSummary ?? "",
                  output: toDisplayPreview(tr.content),
                  isError: tr.isError,
                  // No timing data in the session log; 0 hides the suffix.
                  elapsed: 0,
                };
              });
              resumedMessages.push({
                role: "turn_summary",
                content: "",
                toolSummary,
              });
              continue;
            }
            const text = contentToText(m.content);
            if (text.trim()) {
              resumedMessages.push({ role: m.role, content: text });
            }
          }
          resumedMessages.push({
            role: "system",
            content: `⟲ Resumed session ${arg} (${String(restored.length)} messages).`,
          });
          setMessages(resumedMessages);
          break;
        }
        case "skills": {
          const catalog = skillCatalogRef.current;
          if (!catalog) {
            setMessages((prev) => [
              ...prev,
              { role: "system", content: "Skills: no catalog loaded." },
            ]);
          } else if (parsed.args.trim() === "reload") {
            // /skills reload — hot-reload the catalog from disk
            catalog.reload();
            wireSkillsToRegistry(catalog, cmdRegistryRef.current, skillHostRef.current);
            // Keep the system prompt untouched; newly added skills are sent
            // via skillDelta on the next turn
            const count = catalog.list().length;
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: `Skills reloaded. ${String(count)} skill(s) available.`,
              },
            ]);
          } else {
            const skills = catalog.list();
            if (skills.length === 0) {
              setMessages((prev) => [
                ...prev,
                {
                  role: "system",
                  content: "No skills found in .agents/skills/.",
                },
              ]);
            } else {
              const list = skills.map((s) => `  /${s.name} — ${s.description}`).join("\n");
              setMessages((prev) => [
                ...prev,
                {
                  role: "system",
                  content: `Available skills:\n${list}\n\nType /skills reload to hot-reload skills from disk.`,
                },
              ]);
            }
          }
          break;
        }
        case "worktree": {
          try {
            const { execSync } = await import("node:child_process");
            const output = execSync("git worktree list", {
              cwd: workDir,
              encoding: "utf-8",
            });
            setMessages((prev) => [
              ...prev,
              { role: "system", content: `Worktree list:\n${output}` },
            ]);
          } catch {
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: "Not a git repository or git worktree not available.",
              },
            ]);
          }
          break;
        }
        case "rewind": {
          const fh = fileHistoryRef.current;
          if (!fh?.hasSnapshots()) {
            setMessages((prev) => [
              ...prev,
              { role: "system", content: "No checkpoints to rewind to." },
            ]);
          } else {
            setRewindSnapshots(fh.getSnapshots());
            setRewindDialogActive(true);
          }
          break;
        }
        case "sandbox": {
          const arg = parsed.args.trim();
          const sbAvailable = (await sandboxRef.current)?.available() ?? false;
          if (arg === "1" || arg === "on") {
            // Mode 1: enable sandbox + auto-allow
            setSandboxEnabled(true);
            setSandboxAutoAllow(true);
            sandboxEnabledRef.current = true;
            sandboxAutoAllowRef.current = true;
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: `Sandbox: ON + auto-allow${sbAvailable ? "" : " (sandbox tool not found, wrapping disabled)"}`,
              },
            ]);
          } else if (arg === "2" || arg === "manual") {
            // Mode 2: enable sandbox + manual permission confirmation
            setSandboxEnabled(true);
            setSandboxAutoAllow(false);
            sandboxEnabledRef.current = true;
            sandboxAutoAllowRef.current = false;
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: `Sandbox: ON + manual permissions${sbAvailable ? "" : " (sandbox tool not found, wrapping disabled)"}`,
              },
            ]);
          } else if (arg === "3" || arg === "off") {
            // Mode 3: disable sandbox
            setSandboxEnabled(false);
            setSandboxAutoAllow(false);
            sandboxEnabledRef.current = false;
            sandboxAutoAllowRef.current = false;
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: "Sandbox: OFF",
              },
            ]);
          } else {
            // No/unknown argument: show current status and usage
            const status = sandboxEnabled
              ? sandboxAutoAllow
                ? "ON + auto-allow"
                : "ON + manual"
              : "OFF";
            const lines = [
              `Sandbox status: ${status}`,
              `Platform tool: ${sbAvailable ? "available" : "not found"}`,
              "",
              "Usage: /sandbox <mode>",
              "  1 (on)     — Enable sandbox + auto-allow (recommended)",
              "  2 (manual) — Enable sandbox + manual permission confirmation",
              "  3 (off)    — Disable sandbox",
            ];
            setMessages((prev) => [...prev, { role: "system", content: lines.join("\n") }]);
          }
          break;
        }
      }
      return true;
    }

    if (cmd.type === "local") {
      const client = clientRef.current;
      if (cmd.name === "thinking" && !parsed.args.trim() && client?.setThinkingLevel) {
        setThinkingDialogActive(true);
        return true;
      }
      const output = cmd.handler({
        workDir,
        args: parsed.args,
        thinkingLevel: () =>
          client?.getThinkingLevel?.() ??
          selectedProviderRef.current.thinking ??
          DEFAULT_THINKING_LEVEL,
        availableThinkingLevels: () =>
          client?.getSupportedThinkingLevels?.() ??
          getSupportedThinkingLevels(selectedProviderRef.current),
        setThinkingLevel: client?.setThinkingLevel
          ? (level) => {
              client.setThinkingLevel?.(level);
              const updated = {
                ...selectedProviderRef.current,
                thinking: client.getThinkingLevel?.() ?? level,
              };
              selectedProviderRef.current = updated;
              setSelectedProvider(updated);
              setProviders((current) =>
                current.map((provider) =>
                  provider.base_url === updated.base_url ? updated : provider,
                ),
              );
            }
          : undefined,
        persistThinkingLevel: (level) => {
          persistThinkingLevel(selectedProviderRef.current.base_url, level);
        },
      });
      setMessages((prev) => [...prev, { role: "system", content: output }]);
      return true;
    }

    if (cmd.type === "prompt") {
      // File-based custom command or inline skill: render the body and run it as a user turn.
      const promptText = cmd.handler({ workDir, args: parsed.args });
      if (clientRef.current && promptText.trim()) {
        setMessages((prev) => [...prev, { role: "user", content: promptText }]);
        convRef.current.addUserMessage(promptText);
        sessionMod.saveMessage(workDir, sessionIdRef.current, {
          role: "user",
          content: promptText,
          timestamp: Math.floor(Date.now() / 1000),
        });
        setIsStreaming(true);
        output.prepareTurn();
        await runAgentLoopWithStats()
          .then(() => {
            setIsStreaming(false);
            output.clearTools();
          })
          .catch((err: unknown) => {
            setError(asErrorString(err));
            setIsStreaming(false);
          });
      }
      return true;
    }

    if (cmd.type === "skill_fork") {
      const skill = skillCatalogRef.current?.get(parsed.name);
      if (!skill) {
        setMessages((prev) => [
          ...prev,
          { role: "system", content: `Skill not found: ${parsed.name}` },
        ]);
        return true;
      }
      const client = clientRef.current;
      if (!client) {
        setMessages((prev) => [...prev, { role: "system", content: "Client not ready." }]);
        return true;
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `Running skill "${parsed.name}" in fork mode…`,
        },
      ]);
      // Build a SkillForkHost backed by the live refs.
      const forkHost: SkillForkHost = {
        ...skillHostRef.current,
        runSubagent: (prompt: string) =>
          spawnSubagent(
            {
              name: skill.meta.name,
              description: skill.meta.description,
              model: skill.meta.model,
            },
            prompt,
            client,
            registryRef.current,
            selectedProvider,
            workDir,
          ),
        snapshotParentMessages: (count) => {
          const msgs = convRef.current.getMessages();
          return msgs
            .slice(-count)
            .map((m) => `[${m.role}] ${contentToText(m.content)}`)
            .join("\n");
        },
      };
      await runSkillFork(skill, parsed.args, forkHost)
        .then((result) => {
          setMessages((prev) => [...prev, { role: "assistant", content: result }]);
        })
        .catch((err: unknown) => {
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `Skill fork error: ${asErrorString(err)}`,
            },
          ]);
        });
      return true;
    }

    return false;
  };

  const runAgentLoop = async (modeOverride?: PermissionMode) => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const onAgentEvent = output.createEventHandler();

    // modeOverride avoids a stale-closure read of permMode right after a
    // setPermMode call (e.g. plan approval switching out of plan mode in the same tick).
    const checker = new PermissionChecker(workDir, modeOverride ?? permMode);
    checkerRef.current = checker;
    // Propagate the current sandbox settings to the permission checker
    checker.sandboxEnabled = sandboxEnabledRef.current;
    checker.sandboxAutoAllow = sandboxAutoAllowRef.current;

    // Attach the sandbox to the BashTool when sandboxing is enabled

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const bashTool = registryRef.current.get("Bash") as BashTool | undefined;
    if (bashTool && sandboxEnabledRef.current) {
      bashTool.sandbox = await sandboxRef.current;
      bashTool.sandboxConfig = {
        allowWrite: [workDir, "/tmp"],
        denyWrite: [],
        networkEnabled: sandboxNetworkEnabled,
      };
    } else if (bashTool) {
      bashTool.sandbox = null;
    }
    // Memory recall: query relevant memories and provide context to LLM
    const recallPromise =
      memManagerRef.current && clientRef.current
        ? memManagerRef.current
            .findRelevantMemories(
              contentToText(
                convRef.current
                  .getMessages()
                  .filter((m) => m.role === "user")
                  .pop()?.content ?? "",
              ),
              clientRef.current,
              [...recentToolsRef.current],
              new Set(surfacedMemoriesRef.current),
            )
            .then((memories): RecallResult => {
              // Only select and render here; the selected paths travel with the result
              // to the agent, which records them as surfaced upon actual injection
              const reminder = memManagerRef.current?.renderReminder(memories) ?? "";
              return { reminder, paths: memories.map((m) => m.path) };
            })
            .catch((): RecallResult => ({ reminder: "", paths: [] }))
        : undefined;

    if (!clientRef.current) {
      return;
    }

    const agent = new Agent({
      client: clientRef.current,
      registry: registryRef.current,
      checker,
      conversation: convRef.current,
      workDir,
      sessionId: sessionIdRef.current,
      hookEngine: hookEngineRef.current ?? undefined,
      fileHistory: fileHistoryRef.current ?? undefined,
      fileStateCache: fileStateCacheRef.current,
      abortSignal: controller.signal,
      contextWindow: contextWindowRef.current,
      maxOutput: maxOutputRef.current,
      recoveryState: recoveryStateRef.current,
      activeSkills: activeSkillsRef.current,
      // The first system-reminder carries the full skill list; later turns
      // only append the delta
      instructions: loadInstructions(workDir),
      memoryContent: memManagerRef.current?.buildSystemReminder() ?? "",
      skillSection: skillCatalogRef.current
        ? buildSkillSection(skillCatalogRef.current, workDir)
        : "",
      skillDeltaFn: skillDelta,
      memoryRecallPromise: recallPromise,
      onMemoriesSurfaced: (paths) => {
        for (const path of paths) {
          surfacedMemoriesRef.current.add(path);
        }
      },
      toolFilter: buildComposedToolFilter(
        coordinatorToolFilter(enableCoordinatorMode ?? false),
        toolFilterRef.current,
      ),
      coordinatorActiveFn: () => coordinatorActive(enableCoordinatorMode ?? false),
      // Surface teammate results (from team lead mailboxes) as reminders.
      notificationFn: () => teamManagerRef.current.drainLeads(),
      onLoopComplete: (conv) => {
        const client = clientRef.current;
        if (!client || memExtractingRef.current) {
          return;
        }
        if (conv.len() - memCursorRef.current < 2) {
          return;
        }
        memExtractingRef.current = true;
        const cursor = conv.len();
        const summary = conv
          .getMessages()
          .slice(-40)
          .map((m) => `[${m.role}]: ${contentToText(m.content)}`)
          .filter((s) => s.length > 12)
          .join("\n");
        // Lazy-init the Memory Extractor (one per session, reused across turns)
        memExtractorRef.current ??= new MemoryExtractor(client, workDir);
        memExtractorRef.current
          .extract(summary)
          .then((saved) => {
            memCursorRef.current = cursor;
            if (saved.length > 0) {
              setMessages((prev) => [
                ...prev,
                {
                  role: "system",
                  content: `Memory saved: ${saved.join(", ")}`,
                },
              ]);
            }
          })
          .catch((err: unknown) => {
            log.error({ err }, "memory extractor failed");
          })
          .finally(() => {
            memExtractingRef.current = false;
          });
      },
      onPermissionRequest: async (toolName, args, decision) => {
        return new Promise<"allow" | "deny" | "allowAlways">((resolve) => {
          permissionResolveRef.current = resolve;
          setPermissionRequest({
            toolName,
            argsSummary: formatToolArgs(args),
            reason: decision.reason,
          });
        });
      },
    });

    let exitPlanSucceeded = false;

    for await (const event of agent.run()) {
      onAgentEvent(event);
      switch (event.type) {
        case "tool_use": {
          if (activeToolIdsRef.current.size === 0) {
            activeToolBatchStartedAtRef.current = Date.now();
          }
          activeToolIdsRef.current.add(event.toolId);
          break;
        }
        case "tool_result": {
          activeToolIdsRef.current.delete(event.toolId);
          if (activeToolIdsRef.current.size === 0 && activeToolBatchStartedAtRef.current !== null) {
            interactionStatsRef.current.toolTimeMs +=
              Date.now() - activeToolBatchStartedAtRef.current;
            activeToolBatchStartedAtRef.current = null;
          }
          if (event.isError) {
            interactionStatsRef.current.failedToolCalls += 1;
          } else {
            interactionStatsRef.current.successfulToolCalls += 1;
          }
          if (event.toolName === "ExitPlanMode" && !event.isError) {
            exitPlanSucceeded = true;
          }
          const recent = recentToolsRef.current;
          const dup = recent.indexOf(event.toolName);
          if (dup >= 0) {
            recent.splice(dup, 1);
          }
          recent.push(event.toolName);
          if (recent.length > MAX_RECENT_TOOLS) {
            recent.shift();
          }
          break;
        }
        case "compact": {
          if (event.boundary) {
            sessionMod.saveCompactBoundary(workDir, sessionIdRef.current, event.boundary);
          }
          break;
        }
        case "loop_complete": {
          if (permModeRef.current === "plan" && exitPlanSucceeded) {
            setPlanApprovalActive(true);
          }
          break;
        }
        case "error": {
          throw event.error;
        }
      }
    }
  };

  const runAgentLoopWithStats = async (modeOverride?: PermissionMode) => {
    const startedAt = Date.now();
    try {
      await runAgentLoop(modeOverride);
    } finally {
      const endedAt = Date.now();
      interactionStatsRef.current.agentActiveMs += endedAt - startedAt;
      if (activeToolBatchStartedAtRef.current !== null) {
        interactionStatsRef.current.toolTimeMs += endedAt - activeToolBatchStartedAtRef.current;
        activeToolBatchStartedAtRef.current = null;
        activeToolIdsRef.current.clear();
      }
    }
  };

  const runUserTurn = async (text: string, modeOverride?: PermissionMode) => {
    if (!clientRef.current) {
      setError("LLM client not ready yet");
      return;
    }

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setIsStreaming(true);
    output.prepareTurn();
    setError(null);

    try {
      const expanded = await expandAtRefsWithImages(text, workDir);
      convRef.current.addUserMessage(expanded);
      sessionMod.saveMessage(workDir, sessionIdRef.current, {
        role: "user",
        content:
          typeof expanded === "string"
            ? text
            : [{ type: "text", text }, ...expanded.filter((block) => block.type === "image")],
        timestamp: Math.floor(Date.now() / 1000),
      });

      await runAgentLoopWithStats(modeOverride);
    } catch (err) {
      const msg = asErrorString(err);
      const isAbort = strArg(asRecord(err), "name") === "AbortError" || msg.includes("abort");
      if (isAbort) {
        const partialText = streamingTextRef.current;
        if (partialText) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: partialText + "\n\n*[cancelled]*" },
          ]);
        }
        setMessages((prev) => [...prev, { role: "system", content: "(response interrupted)" }]);
      } else {
        const partialText = streamingTextRef.current;
        if (partialText) {
          setMessages((prev) => [...prev, { role: "assistant", content: partialText }]);
        }
        setError(msg);
        setMessages((prev) => [...prev, { role: "system", content: `Error: ${msg}` }]);
      }
    } finally {
      setIsStreaming(false);
      output.finishTurn();
      abortControllerRef.current = null;
    }
  };

  const handlePlanApproval = useCallback(
    (choice: PlanChoice, feedback?: string) => {
      setPlanApprovalActive(false);
      const planPath = getOrCreatePlanPath(workDir);
      let planContent = "";
      try {
        if (existsSync(planPath)) {
          planContent = readFileSync(planPath, "utf-8");
        }
      } catch {
        /** noop */
      }

      if (choice === "yolo") {
        // Exit plan mode for YOLO approval
        hasExitedPlanModeRef.current = true;
        setPermMode("bypassPermissions");

        convRef.current.addSystemReminder(buildPlanModeExitReminder(planPath, !!planContent));
        setMessages((prev) => [
          ...prev,
          { role: "system", content: "Plan approved. Entered YOLO mode." },
        ]);
        if (planContent) {
          handleSubmit(`Execute this plan:\n\n${planContent}`);
        }
      } else if (choice === "manual") {
        // Exit plan mode and restore the pre-plan permission mode
        hasExitedPlanModeRef.current = true;
        setPermMode(prePlanMode);
        convRef.current.addSystemReminder(buildPlanModeExitReminder(planPath, !!planContent));
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: "Plan approved. Each edit requires confirmation.",
          },
        ]);
        if (planContent) {
          handleSubmit(`Execute this plan:\n\n${planContent}`);
        }
      } else if (choice === "feedback" && feedback) {
        handleSubmit(feedback);
      }
    },
    [workDir, prePlanMode],
  );

  const handleRewindAction = useCallback(
    (action: RewindAction) => {
      setRewindDialogActive(false);
      const fh = fileHistoryRef.current;
      if (!fh) {
        return;
      }

      switch (action.type) {
        case "code_and_conversation": {
          const changed = fh.rewind(action.snapshotIndex);
          const snap = rewindSnapshots[action.snapshotIndex];
          convRef.current.truncateTo(snap.messageIndex);
          const fileList = changed.length > 0 ? "\n" + changed.map((f) => "  " + f).join("\n") : "";
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `⟲ Rewound to checkpoint. Restored ${String(changed.length)} file(s) and conversation.${fileList}`,
            },
          ]);
          break;
        }
        case "conversation_only": {
          const snap = rewindSnapshots[action.snapshotIndex];
          convRef.current.truncateTo(snap.messageIndex);
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `⟲ Rewound conversation. Files unchanged.`,
            },
          ]);
          break;
        }
        case "code_only": {
          const changed = fh.rewind(action.snapshotIndex);
          const fileList = changed.length > 0 ? "\n" + changed.map((f) => "  " + f).join("\n") : "";
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `⟲ Restored ${String(changed.length)} file(s). Conversation unchanged.${fileList}`,
            },
          ]);
          break;
        }
        case "cancel":
          break;
      }
    },
    [rewindSnapshots],
  );

  /**
   * Before each turn, check whether the skill directory changed; if so, reload
   * the catalog and rewire the slash commands. The system prompt stays
   * untouched: newly added skills are delivered by skillDelta as a
   * system-reminder on the next turn, since mutating the system prompt would
   * invalidate the entire cached prefix.
   */
  const refreshSkillsIfNeeded = () => {
    const catalog = skillCatalogRef.current;
    if (!catalog) {
      return;
    }
    if (!catalog.needsReload()) {
      return;
    }
    catalog.reload();
    wireSkillsToRegistry(catalog, cmdRegistryRef.current, skillHostRef.current);
  };

  const processSubmission = async (text: string) => {
    refreshSkillsIfNeeded();
    setPromptHistory(historyMod.append(historyDir, text));
    if (text.startsWith("/") && (await handleSlashCommand(text))) {
      return;
    }
    await runUserTurn(text);
  };

  const followUps = useFollowUpQueue({
    blocked:
      appState !== "chat" ||
      !clientRef.current ||
      isStreaming ||
      isCompacting ||
      providerSwitching ||
      loginActive ||
      providerDialogActive ||
      thinkingDialogActive ||
      planApprovalActive ||
      rewindDialogActive ||
      resumeDialogActive ||
      permissionRequest !== null ||
      askRequest !== null ||
      teamsDialogOpen,
    send: processSubmission,
    onError: (error) => {
      setError(asErrorString(error));
    },
  });
  const pendingMessages = followUps.messages;
  const handleSubmit = followUps.enqueue;

  useEffect(() => {
    if (!resume || appState !== "chat" || initialResumeHandledRef.current) {
      return;
    }
    initialResumeHandledRef.current = true;
    void handleSlashCommand(resume === true ? "/resume" : `/resume ${resume}`);
  }, [appState, resume]);

  const handleLogin = async (input: ProviderConfig): Promise<void> => {
    const environment = detectEnvironment(workDir);
    environment.model = input.model;
    // Construct before saving so invalid client configuration leaves the form editable.
    const client = await createClient(input, buildSystemPrompt(environment));
    const saved = saveProvider(input, providers);
    setProviders(saved.providers);
    setError("");
    if (clientRef.current) {
      clientRef.current = client;
      selectedProviderRef.current = saved.provider;
      setSelectedProvider(saved.provider);
      contextWindowRef.current = getContextWindow(saved.provider);
      maxOutputRef.current = getMaxOutputTokens(saved.provider);
      decideAndApply(registryRef.current, saved.provider.base_url, contextWindowRef.current);
      memExtractorRef.current = null;
      setMessages((current) => [
        ...current,
        {
          role: "system",
          content: `Provider ${saved.provider.name} activated. ${saved.replaced ? "Updated" : "Saved to"} ~/.swifty/config.yaml.`,
        },
      ]);
    } else {
      handleProviderSelect(saved.provider);
    }
    setLoginActive(false);
  };

  const thinkingLevel =
    clientRef.current?.getThinkingLevel?.() ?? selectedProvider.thinking ?? DEFAULT_THINKING_LEVEL;
  const availableThinkingLevels =
    clientRef.current?.getSupportedThinkingLevels?.() ??
    getSupportedThinkingLevels(selectedProvider);
  const loginInitialValues = {
    ...selectedProvider,
    thinking: thinkingLevel,
  };

  if (appState === "providerSelect" && loginActive) {
    return (
      <ProviderLogin
        initialValues={loginInitialValues}
        onSubmit={handleLogin}
        onCancel={() => {
          if (providers.length === 0) {
            requestExit();
          } else {
            setLoginActive(false);
          }
        }}
      />
    );
  }
  if (appState === "providerSelect") {
    return (
      <ProviderSelect providers={providers} reservedRows={0} onSelect={handleProviderSelect} />
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box flexDirection="column" paddingTop={0} flexGrow={1}>
        <Transcript
          messages={messages}
          sessionId={sessionIdRef.current}
          termWidth={termWidth}
          expanded={toolsExpanded}
          model={selectedProvider.model || selectedProvider.name}
          workDir={workDir}
        />

        <ChatView
          messages={[]}
          streamingText={isStreaming ? streamingText : undefined}
          thinkingText={isStreaming ? streamingThinking : undefined}
          expanded={toolsExpanded}
        />

        <AgentActivity
          tools={activeTools}
          subagents={subagents}
          teammates={teammateStates}
          isStreaming={isStreaming}
          isAsking={askRequest !== null}
          expanded={toolsExpanded}
          leaderTokens={inputTokens + outputTokens}
        />

        {error && (
          <Box marginTop={1} paddingLeft={1}>
            <Text color={THEME.error}>Error: {error}</Text>
          </Box>
        )}

        <PendingQueue messages={pendingMessages} />
        <Text> </Text>
      </Box>

      {ctrlCHint && (
        <Box paddingLeft={1}>
          <Text color={THEME.dim}>Press Ctrl+C again to exit.</Text>
        </Box>
      )}
      <TeamStatus
        count={teammateStates.filter((t) => t.status === "running" || t.status === "idle").length}
      />
      <InteractionDock
        login={
          loginActive
            ? {
                initialValues: loginInitialValues,
                onSubmit: handleLogin,
                onCancel: () => {
                  setLoginActive(false);
                },
              }
            : undefined
        }
        provider={
          providerDialogActive
            ? {
                providers,
                currentBaseUrl: selectedProvider.base_url,
                reservedRows: footerRows,
                onCancel: () => {
                  setProviderDialogActive(false);
                },
                onSelect: handleProviderSelect,
              }
            : undefined
        }
        thinking={
          thinkingDialogActive
            ? {
                currentLevel: thinkingLevel,
                levels: availableThinkingLevels,
                onSelect: (level) => {
                  setThinkingDialogActive(false);
                  void handleSlashCommand(`/thinking ${level}`);
                },
                onCancel: () => {
                  setThinkingDialogActive(false);
                },
              }
            : undefined
        }
        planApproval={planApprovalActive ? { onSelect: handlePlanApproval } : undefined}
        rewind={
          rewindDialogActive
            ? {
                snapshots: rewindSnapshots,
                onComplete: handleRewindAction,
                onCancel: () => {
                  setRewindDialogActive(false);
                },
              }
            : undefined
        }
        resume={
          resumeDialogActive
            ? {
                sessions: resumeSessions,
                currentSessionId: sessionIdRef.current,
                reservedRows: footerRows,
                onCancel: () => {
                  setResumeDialogActive(false);
                },
                onSelect: (sessionId) => {
                  void handleSlashCommand(`/resume ${sessionId}`);
                },
              }
            : undefined
        }
        permission={
          permissionRequest
            ? {
                ...permissionRequest,
                onComplete: (action) => {
                  permissionResolveRef.current?.(action);
                  permissionResolveRef.current = null;
                  setPermissionRequest(null);
                },
              }
            : undefined
        }
        askUser={
          askRequest
            ? {
                questions: askRequest,
                onComplete: (answers) => {
                  askResolveRef.current?.(answers);
                  askResolveRef.current = null;
                  setAskRequest(null);
                },
              }
            : undefined
        }
        teams={
          teamsDialogOpen
            ? {
                teammates: teammateStates,
                onClose: () => {
                  setTeamsDialogOpen(false);
                },
                onKill: (name, teamName) => {
                  const team = teamManagerRef.current.get(teamName);
                  if (team) {
                    void team.stopMember(name);
                  }
                },
                onShutdown: (name, teamName) => {
                  const team = teamManagerRef.current.get(teamName);
                  if (team) {
                    void team.sendMessage("lead", name, "[shutdown] Please finish and exit");
                  }
                },
              }
            : undefined
        }
        composer={{
          onSubmit: (text) => {
            handleSubmit(text);
          },
          disabled: providerSwitching,
          history: promptHistory,
          commands: cmdRegistryRef.current.listCommands(),
          thinkingLevels: availableThinkingLevels,
          onRecallQueuedMessage: followUps.takeLast,
          usageTracker: usageTrackerRef.current,
          inputState: error
            ? "error"
            : isStreaming || isCompacting || providerSwitching
              ? "agent"
              : "focused",
          borderColor:
            activityStatus === "idle" || activityStatus === "working"
              ? thinkingLevelColor(thinkingLevel)
              : activityStatusColor(activityStatus),
          statusLabel: error
            ? "Error"
            : providerSwitching
              ? "Switching provider..."
              : isCompacting
                ? "Compacting context... (Esc to cancel)"
                : isStreaming
                  ? (output.retryStatus ?? "Working")
                  : undefined,
          permMode,
          onModeChange: (mode) => {
            setPermMode(mode);
            if (checkerRef.current) {
              checkerRef.current.mode = mode;
            }
          },
          workDir,
          sessionId: sessionIdRef.current,
          insertTextRef: insertInputTextRef,
          clearRef: clearInputRef,
          onEscape: () => {
            if (isStreaming || isCompacting) {
              abortControllerRef.current?.abort();
            }
          },
        }}
      />
      <Footer
        onHeightChange={setFooterRows}
        contextTokens={currentContextTokens(convRef.current)}
        contextWindow={contextWindowRef.current}
        inputTokens={inputTokens}
        model={selectedProvider.model}
        thinkingLevel={thinkingLevel}
        outputTokens={outputTokens}
        permissionMode={permMode}
        provider={selectedProvider.name}
        sessionId={sessionIdRef.current}
        workDir={workDir}
      />
    </Box>
  );
}
