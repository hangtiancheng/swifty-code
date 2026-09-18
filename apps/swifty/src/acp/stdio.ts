import { Readable, Writable } from "node:stream";

import { ndJsonStream } from "@agentclientprotocol/sdk";

import { createSwiftyAcpApp } from "./agent.js";

function redirectConsoleToStderr(): void {
  const write = (...args: unknown[]): void => {
    process.stderr.write(`${args.map(String).join(" ")}\n`);
  };
  console.log = write;
  console.info = write;
  console.warn = write;
  console.debug = write;
}

export async function runAcpStdio(): Promise<void> {
  redirectConsoleToStderr();
  const implementation = createSwiftyAcpApp();
  const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
  const connection = implementation.app.connect(stream);
  process.stdin.resume();

  try {
    await connection.closed;
  } finally {
    await implementation.dispose();
  }
}
