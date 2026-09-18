import { runAcpStdio } from "./stdio.js";
import { runAcpWebSocket } from "./websocket.js";

export type AcpMode = { transport: "stdio" } | { transport: "websocket"; address?: string };

export function parseAcpMode(args: string[]): AcpMode | null {
  const stdioIndex = args.indexOf("--acp");
  const websocketIndex = args.indexOf("--acp-ws");
  if (stdioIndex === -1 && websocketIndex === -1) {
    return null;
  }
  if (stdioIndex !== -1 && websocketIndex !== -1) {
    throw new Error("Use either --acp or --acp-ws, not both.");
  }
  if (stdioIndex !== -1) {
    if (args.length !== 1) {
      throw new Error("--acp cannot be combined with other CLI options.");
    }
    return { transport: "stdio" };
  }

  const address = args[websocketIndex + 1];
  const consumed = address && !address.startsWith("-") ? 2 : 1;
  if (args.length !== consumed) {
    throw new Error("--acp-ws accepts only an optional host:port address.");
  }
  return {
    transport: "websocket",
    ...(consumed === 2 ? { address } : {}),
  };
}

export async function runAcp(args: string[]): Promise<void> {
  const mode = parseAcpMode(args);
  if (!mode) {
    throw new Error("ACP mode was not selected.");
  }
  if (mode.transport === "stdio") {
    await runAcpStdio();
    return;
  }
  await runAcpWebSocket(mode.address);
}
