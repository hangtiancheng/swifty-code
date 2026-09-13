import { icons } from "./icons";

export const REPO_URL = "https://github.com/hangtiancheng/swifty-code";
export const NPM_URL = "https://www.npmjs.com/package/@swifty.js/swifty";
export const DOCS_URL = `${REPO_URL}/blob/main/apps/swifty/README.md`;
export const VERSION = "v0.0.29";

export const INSTALL_METHODS = [
  {
    id: "curl",
    label: "curl",
    hint: "macOS · Linux · one-liner",
    command:
      "curl -fsSL https://raw.githubusercontent.com/hangtiancheng/swifty-code/main/install.sh | bash",
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
  { label: "Tools", href: "#tools" },
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
  { value: "20+", label: "Built-in tools" },
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
      "Anthropic, OpenAI, or any OpenAI-compatible endpoint. Switch providers per project with a YAML config — API keys resolve from the environment automatically.",
    span: "wide",
    accent: "brand",
    decor: "providers",
  },
  {
    icon: icons.terminal,
    title: "A terminal UI that keeps up",
    description:
      "Streaming text, thinking indicators and live tool output rendered with React + Ink. Paste images, collapse long pastes, and cycle modes with a keystroke.",
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
      "Four permission modes, glob-based allow/deny rules, and OS-level sandboxing via seatbelt on macOS and bwrap on Linux.",
    span: "wide",
    accent: "brand",
    decor: "safety",
  },
  {
    icon: icons.brainCircuit,
    title: "Memory that compounds",
    description:
      "Long-term memory is extracted in the background and recalled across sessions, so Swifty remembers how your codebase works.",
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
];

export interface ToolItem {
  name: string;
  icon: string;
  group: "Files" | "Shell" | "Search" | "Orchestrate" | "Integrate";
}

export const tools: ToolItem[] = [
  { name: "ReadFile", icon: icons.fileCode, group: "Files" },
  { name: "WriteFile", icon: icons.fileCode, group: "Files" },
  { name: "EditFile", icon: icons.fileCode, group: "Files" },
  { name: "Bash", icon: icons.terminal, group: "Shell" },
  { name: "PowerShell", icon: icons.terminal, group: "Shell" },
  { name: "Glob", icon: icons.folderTree, group: "Search" },
  { name: "Grep", icon: icons.search, group: "Search" },
  { name: "ToolSearch", icon: icons.search, group: "Search" },
  { name: "McpCall", icon: icons.plug, group: "Integrate" },
  { name: "AskUserQuestion", icon: icons.sparkles, group: "Integrate" },
  { name: "EnterWorktree", icon: icons.network, group: "Orchestrate" },
  { name: "ExitWorktree", icon: icons.network, group: "Orchestrate" },
  { name: "ExitPlanMode", icon: icons.listTree, group: "Orchestrate" },
  { name: "TaskCreate", icon: icons.scrollText, group: "Orchestrate" },
  { name: "TaskUpdate", icon: icons.scrollText, group: "Orchestrate" },
  { name: "SpawnTeammate", icon: icons.network, group: "Orchestrate" },
  { name: "SendMessage", icon: icons.server, group: "Orchestrate" },
  { name: "InstallSkill", icon: icons.sparkles, group: "Integrate" },
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
  "/status",
  "/permission",
  "/memory",
  "/skills",
  "/skill",
  "/plan",
  "/do",
  "/compact",
  "/clear",
  "/resume",
  "/rewind",
  "/sandbox",
  "/worktree",
  "/mcp",
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
      "Any provider that speaks the Anthropic or OpenAI protocol — Anthropic, OpenAI, and any OpenAI-compatible endpoint such as a local gateway. Configure several and switch per project.",
  },
  {
    question: "Do I need to run it in a sandbox?",
    answer:
      "No, but you can. Swifty ships with OS-level sandboxing: seatbelt on macOS and bwrap on Linux. Enable it in config.yaml and command tools run isolated, with optional auto-approval.",
  },
  {
    question: "How does it handle my data?",
    answer:
      "Everything is local. Sessions, memory, file history and logs live under .swifty/ in your project or ~/.swifty in your home directory. Nothing is sent anywhere except your configured model provider.",
  },
  {
    question: "Can it run without a terminal?",
    answer:
      'Yes. Use print mode for scripts and CI (swifty -p "…" --output-format stream-json), or start remote mode to drive the same agent from a browser over WebSocket.',
  },
  {
    question: "What are teammate agents?",
    answer:
      "A lead agent can spawn named teammates that work in parallel, exchanging messages through file mailboxes and isolating risky work in git worktrees.",
  },
];

export const footerColumns = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "Tools", href: "#tools" },
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
