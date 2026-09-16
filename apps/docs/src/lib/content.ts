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

import { icons } from "./icons";

export const REPO_URL = "https://github.com/hangtiancheng/swifty-code";
export const NPM_URL = "https://www.npmjs.com/package/@swifty.js/swifty";
export const DOCS_URL = `${REPO_URL}/blob/main/apps/swifty/README.md`;
export const SITE_URL = "https://hangtiancheng.github.io/swifty-code/";
// Injected from apps/swifty/package.json at build time (see vite.config.ts).
export const VERSION = `v${__SWIFTY_VERSION__}`;

export const INSTALL_METHODS = [
  {
    id: "curl",
    label: "curl",
    hint: "macOS · Linux · one-liner",
    command:
      "curl -fsSL https://raw.githubusercontent.com/hangtiancheng/swifty-code/main/install.sh | bash",
  },
  {
    id: "powershell",
    label: "PowerShell",
    hint: "Windows · one-liner",
    command:
      "irm https://raw.githubusercontent.com/hangtiancheng/swifty-code/main/install.ps1 | iex",
  },
  {
    id: "npm",
    label: "npm",
    hint: "Node.js 20+",
    command: "npm install -g @swifty.js/swifty",
  },
  {
    id: "pnpm",
    label: "pnpm",
    hint: "Node.js 20+",
    command: "pnpm add -g @swifty.js/swifty",
  },
] as const;

export const QUICK_COMMANDS = [
  { command: "swifty", label: "Interactive TUI", tone: "brand" },
  {
    command: 'swifty -p "explain this codebase"',
    label: "Print mode",
    tone: "accent",
  },
  { command: "swifty --remote", label: "Browser UI", tone: "neutral" },
] as const;

export const navLinks = [
  { label: "Features", href: "#features" },
  { label: "Workflow", href: "#workflow" },
  { label: "Tools", href: "#tools" },
  { label: "Providers", href: "#providers" },
  { label: "Safety", href: "#safety" },
  { label: "Agents", href: "#agents" },
  { label: "Install", href: "#install" },
] as const;

export interface Stat {
  value: string;
  label: string;
}

export const stats: Stat[] = [
  { value: "3", label: "LLM protocols" },
  { value: "28", label: "Built-in tools" },
  { value: "4", label: "Permission modes" },
  { value: "1M", label: "Context window" },
];

export interface Feature {
  icon: string;
  title: string;
  description: string;
  span?: "wide" | "tall" | "normal";
  accent?: "brand" | "accent" | "neutral";
  decor?: "providers" | "safety" | "agents";
}

export const features: Feature[] = [
  {
    icon: icons.blocks,
    title: "Multi-provider by design",
    description:
      "Anthropic, OpenAI, or any OpenAI-compatible endpoint. /login discovers available models automatically, keys resolve from the environment, and /provider switches live.",
    span: "wide",
    accent: "brand",
    decor: "providers",
  },
  {
    icon: icons.terminal,
    title: "A terminal UI that keeps up",
    description:
      "Streaming text, thinking blocks and live tool output rendered with React + Ink. Queue follow-ups while a task runs, paste images, and cycle modes with Shift+Tab.",
    accent: "accent",
  },
  {
    icon: icons.wrench,
    title: "A real toolbelt",
    description:
      "Read, write and edit files, run Bash or PowerShell, glob and grep the tree, search deferred tools and call MCP servers.",
    accent: "neutral",
  },
  {
    icon: icons.shieldCheck,
    title: "Safety you can tune",
    description:
      "Four permission modes, two-tier allow/deny/ask rules, lifecycle hooks, and OS-level sandboxing via seatbelt on macOS and bwrap on Linux.",
    span: "wide",
    accent: "brand",
    decor: "safety",
  },
  {
    icon: icons.brainCircuit,
    title: "Memory that compounds",
    description:
      "Memories are extracted in the background, recalled per turn and consolidated overnight, so Swifty remembers how your codebase works.",
    accent: "accent",
  },
  {
    icon: icons.hardDrive,
    title: "Sessions & compaction",
    description:
      "JSONL session logs resume exactly where you left off, while automatic compaction keeps long conversations inside the window.",
    accent: "neutral",
  },
  {
    icon: icons.command,
    title: "Skills & slash commands",
    description:
      "A skill catalog with hot-reload, inline and fork execution, plus user-defined slash commands from .swifty/commands.",
    accent: "brand",
  },
  {
    icon: icons.network,
    title: "Multi-agent workflows",
    description:
      "Spawn subagents, coordinate teams over file mailboxes, and isolate parallel work in git worktrees.",
    span: "wide",
    accent: "accent",
    decor: "agents",
  },
  {
    icon: icons.cable,
    title: "MCP, three ways",
    description:
      "Eager, native deferred loading, or dispatch — chosen automatically so a fleet of MCP tools never blows up your context cache.",
    accent: "neutral",
  },
  {
    icon: icons.listTree,
    title: "Plan before it writes",
    description:
      "Plan mode locks the agent to read-only exploration. The plan lands in a file, and ExitPlanMode hands you an approval dialog before anything changes.",
    accent: "brand",
  },
  {
    icon: icons.workflow,
    title: "Hooks on every event",
    description:
      "Fire commands, prompts or HTTP calls on session, turn and tool events — with a condition DSL and the power to reject a tool call before it runs.",
    accent: "accent",
  },
  {
    icon: icons.monitor,
    title: "IDE & browser companions",
    description:
      "@-mention files straight from VS Code, or run swifty --remote to drive the same agent from a browser over WebSocket.",
    accent: "neutral",
  },
];

export interface ToolItem {
  name: string;
  icon: string;
  group: "Files" | "Shell" | "Search" | "Orchestrate" | "Teams" | "Integrate";
}

export const tools: ToolItem[] = [
  { name: "ReadFile", icon: icons.fileCode, group: "Files" },
  { name: "WriteFile", icon: icons.fileCode, group: "Files" },
  { name: "EditFile", icon: icons.fileCode, group: "Files" },
  { name: "Bash", icon: icons.terminal, group: "Shell" },
  { name: "PowerShell", icon: icons.terminal, group: "Shell" },
  { name: "ComputerUse", icon: icons.mousePointerClick, group: "Shell" },
  { name: "Glob", icon: icons.folderTree, group: "Search" },
  { name: "Grep", icon: icons.search, group: "Search" },
  { name: "ToolSearch", icon: icons.search, group: "Search" },
  { name: "TaskCreate", icon: icons.scrollText, group: "Orchestrate" },
  { name: "TaskGet", icon: icons.scrollText, group: "Orchestrate" },
  { name: "TaskList", icon: icons.scrollText, group: "Orchestrate" },
  { name: "TaskUpdate", icon: icons.scrollText, group: "Orchestrate" },
  { name: "ExitPlanMode", icon: icons.listTree, group: "Orchestrate" },
  { name: "EnterWorktree", icon: icons.gitBranch, group: "Orchestrate" },
  { name: "ExitWorktree", icon: icons.gitBranch, group: "Orchestrate" },
  { name: "Agent", icon: icons.bot, group: "Teams" },
  { name: "TeamCreate", icon: icons.users, group: "Teams" },
  { name: "SpawnTeammate", icon: icons.users, group: "Teams" },
  { name: "SendMessage", icon: icons.inbox, group: "Teams" },
  { name: "ListTeams", icon: icons.users, group: "Teams" },
  { name: "TeamDelete", icon: icons.users, group: "Teams" },
  { name: "TaskStop", icon: icons.x, group: "Teams" },
  { name: "McpCall", icon: icons.plug, group: "Integrate" },
  { name: "LoadSkill", icon: icons.sparkles, group: "Integrate" },
  { name: "InstallSkill", icon: icons.sparkles, group: "Integrate" },
  { name: "AskUserQuestion", icon: icons.sparkles, group: "Integrate" },
  { name: "SyntheticOutput", icon: icons.sparkle, group: "Integrate" },
];

export interface PermissionMode {
  name: string;
  mode: string;
  description: string;
  detail: string;
  icon: string;
}

export const permissionModes: PermissionMode[] = [
  {
    name: "default",
    mode: "default",
    description: "Reads run freely. Writes and commands ask first.",
    detail: "The safe baseline for everyday work.",
    icon: icons.lock,
  },
  {
    name: "acceptEdits",
    mode: "acceptEdits",
    description: "File edits are accepted, commands still ask.",
    detail: "Move fast on refactors you already trust.",
    icon: icons.wrench,
  },
  {
    name: "plan",
    mode: "plan",
    description: "Read-only investigation. No writes at all.",
    detail: "Explore, then approve the plan before anything changes.",
    icon: icons.listTree,
  },
  {
    name: "bypassPermissions",
    mode: "bypassPermissions",
    description: "No prompts. Full autonomy.",
    detail: "For sandboxes, CI and disposable worktrees.",
    icon: icons.zap,
  },
];

export const slashCommands = [
  "/login",
  "/help",
  "/status",
  "/provider",
  "/thinking",
  "/plan",
  "/compact",
  "/clear",
  "/resume",
  "/session",
  "/rewind",
  "/memory",
  "/skills",
  "/worktree",
  "/mcp",
  "/sandbox",
  "/review",
  "/code-review",
  "/quit",
];

export interface WorkflowStep {
  step: string;
  title: string;
  description: string;
  icon: string;
}

export const workflowSteps: WorkflowStep[] = [
  {
    step: "01",
    title: "Connect a provider",
    description:
      "Run /login or drop a config.yaml. Anthropic, OpenAI and OpenAI-compatible endpoints all work out of the box.",
    icon: icons.plug,
  },
  {
    step: "02",
    title: "Describe the task",
    description:
      "Ask in plain language. Swifty plans, streams its reasoning and reaches for the right tools on its own.",
    icon: icons.sparkles,
  },
  {
    step: "03",
    title: "Approve the risky bits",
    description:
      "Every write and command surfaces as a reviewable prompt — with allow-always rules when you want them out of the way.",
    icon: icons.shieldCheck,
  },
  {
    step: "04",
    title: "Ship and rewind",
    description:
      "Snapshots and checkpoints let you undo a turn, fork the conversation, or hand the work to a teammate agent.",
    icon: icons.zap,
  },
];

export interface AgentCard {
  name: string;
  role: string;
  description: string;
  icon: string;
  tools: string[];
}

export const agentCards: AgentCard[] = [
  {
    name: "general-purpose",
    role: "Executor",
    description:
      "Researches complex questions, explores the codebase and runs multi-step tasks.",
    icon: icons.zap,
    tools: ["all tools", "full context"],
  },
  {
    name: "plan",
    role: "Architect",
    description:
      "Read-only planning. Understands requirements and designs the solution before code.",
    icon: icons.listTree,
    tools: ["read-only", "no writes"],
  },
  {
    name: "explore",
    role: "Scout",
    description:
      "Fast code exploration with parallel Glob, Grep and ReadFile calls.",
    icon: icons.search,
    tools: ["read-only", "parallel"],
  },
];

export interface Faq {
  question: string;
  answer: string;
}

export const faqs: Faq[] = [
  {
    question: "Which models and providers are supported?",
    answer:
      "Any provider that speaks the Anthropic or OpenAI protocol — Anthropic, OpenAI, and any OpenAI-compatible endpoint such as a local gateway. Configure several in ~/.swifty/config.yaml, switch anytime with /provider, and /login discovers available models for you.",
  },
  {
    question: "What is plan mode?",
    answer:
      "A read-only mode for investigation and design. Enter it with /plan or Shift+Tab: Swifty explores freely, writes its plan to a file, and only ExitPlanMode ends the mode — with an approval dialog before any write happens.",
  },
  {
    question: "Do I need to run it in a sandbox?",
    answer:
      "No, but you can. Swifty ships with OS-level sandboxing: seatbelt on macOS and bwrap on Linux. Enable it in config.yaml (or toggle with /sandbox) and command tools run isolated, with optional auto-approval.",
  },
  {
    question: "How does it handle my data?",
    answer:
      "Everything is local. Sessions, memory, file history and logs live under .swifty/ in your project or ~/.swifty in your home directory. Nothing is sent anywhere except your configured model provider.",
  },
  {
    question: "Can it run without a terminal?",
    answer:
      'Yes. Use print mode for scripts and CI (swifty -p "…" --output-format stream-json), or start remote mode (swifty --remote) to drive the same agent from a browser over WebSocket.',
  },
  {
    question: "Does Swifty work inside my IDE?",
    answer:
      "Yes — in VS Code it connects to the Claude Code extension and turns editor @-mentions into file references in your prompt, with line ranges included. Any other editor works through the plain terminal.",
  },
  {
    question: "Can I hook into the agent lifecycle?",
    answer:
      "Hooks in config.yaml fire on session, turn and tool events. Actions run shell commands, inject prompts or call HTTP endpoints, and a pre_tool_use hook can even reject a tool call before it runs.",
  },
  {
    question: "What are teammate agents?",
    answer:
      "A lead agent can spawn named teammates that work in parallel, exchanging messages through file mailboxes and isolating risky work in git worktrees. Backends: in-process, tmux or iTerm2.",
  },
  {
    question: "Forks, subagents, teammates — what's the difference?",
    answer:
      "A fork (Agent without subagent_type) inherits your entire conversation and keeps nearly the full toolset — it's you, with full context. A defined subagent (explore, plan, general-purpose, or your own Markdown definition) starts fresh with a restricted toolbelt; pass run_in_background=true and it returns a task id immediately, delivering its result as a notification. Teammates are persistent named agents that outlive a single call and coordinate through mailboxes and a shared task board.",
  },
];

export const footerColumns = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "Workflow", href: "#workflow" },
      { label: "Tools", href: "#tools" },
      { label: "Providers", href: "#providers" },
      { label: "Safety", href: "#safety" },
      { label: "Agents", href: "#agents" },
      { label: "Install", href: "#install" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Documentation", href: DOCS_URL },
      { label: "npm package", href: NPM_URL },
      { label: "GitHub", href: REPO_URL },
      { label: "Releases", href: `${REPO_URL}/releases` },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "MCP", href: "https://modelcontextprotocol.io" },
      { label: "Anthropic", href: "https://www.anthropic.com" },
      { label: "OpenAI", href: "https://openai.com" },
      { label: "License", href: `${REPO_URL}/blob/main/LICENSE` },
    ],
  },
];

export const providerList = [
  { name: "Anthropic", protocol: "anthropic" },
  { name: "OpenAI", protocol: "openai" },
  { name: "OpenAI-compatible", protocol: "openai-compat" },
] as const;
