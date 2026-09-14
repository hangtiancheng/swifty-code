async function script() {
  const m = await import(process.env.SWIFTY_LIB_ENTRY);
  const symbols = [
    "Agent",
    "ToolRegistry",
    "MCPManager",
    "PermissionChecker",
    "loadConfig",
    "createClient",
    "buildSystemPrompt",
    "TeamManager",
    "TaskCreateTool",
    "TeamTaskCreateTool",
    "TaskStopTool",
    "TaskStore",
    "recover",
    "runPrintMode",
    "RemoteServer",
    "ComputerUseTool",
  ];
  console.log(
    JSON.stringify({
      totalExports: Object.keys(m).length,
      version: m.version,
      symbols: Object.fromEntries(symbols.map((k) => [k, typeof m[k]])),
    }),
  );
}

await script();
