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

/* eslint-disable no-console -- process entry point: pre-init errors and crash handlers need stderr output */

import { render } from "ink";

import {
  formatInteractionSummary,
  type InteractionSummary,
} from "./bootstrap/interaction-summary.js";
import { TerminalInput } from "./bootstrap/terminal-input.js";
import { detectTerminalTheme } from "./bootstrap/terminal-theme.js";
import { parseResumeArgument } from "./bootstrap/tui-selection.js";
import { forkEnabled, loadConfig, withProjectMcpServers } from "./config/config.js";
import { initLogger, logger } from "./logger/logger.js";
import { parsePrintFlags, runPrintMode } from "./print-mode.js";
import { recover, recordError, recordExit } from "./recover.js";
import { newSessionId } from "./session/session.js";
import { parseTeammateFlags, runTeammate } from "./teammate.js";
import { App } from "./tui/app.js";
import { setThemeMode } from "./tui/styles.js";
import { installSyncOutput } from "./tui/sync-output.js";
import { asErrorString } from "./utils/index.js";

async function main() {
  recover();
  const args = process.argv.slice(2);

  const teammateArgs = parseTeammateFlags(args);
  if (teammateArgs) {
    try {
      await runTeammate(teammateArgs);
    } catch (err) {
      console.error(`teammate: ${asErrorString(err)}`);
      process.exit(1);
    }
    return;
  }

  // Parse --remote mode flags.
  let remoteAddr = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--remote") {
      remoteAddr = ":18888";
      if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        remoteAddr = args[i + 1];
        i++;
      }
    }
  }

  const printArgs = parsePrintFlags(args);
  if (printArgs) {
    try {
      await runPrintMode(printArgs);
    } catch (err) {
      console.error(`Error: ${asErrorString(err)}`);
      process.exit(1);
    }
    return;
  }

  let cfg;
  try {
    cfg = withProjectMcpServers(
      loadConfig(undefined, { allowEmptyProviders: !remoteAddr }),
      process.cwd(),
    );
  } catch (err) {
    console.error(`Error: ${asErrorString(err)}`);
    process.exit(1);
  }

  if (args.includes("--remote") && remoteAddr) {
    const { RemoteServer } = await import("./remote/server.js");
    initLogger({ sessionId: newSessionId(), mode: "remote", stdout: true });
    const srv = new RemoteServer({
      providers: cfg.providers,
      mcpServers: cfg.mcp_servers,
      hookConfigs: cfg.hooks,
      addr: remoteAddr,
      enableCoordinatorMode: cfg.enable_coordinator_mode ?? false,
      forkDisabled: !forkEnabled(cfg),
    });
    try {
      await srv.run();
      // await new Promise(() => {
      //   /** noop */
      // });
    } catch (err) {
      console.error(`Remote server error: ${asErrorString(err)}`);
      process.exit(1);
    }
    return;
  }

  // TUI mode: initialize logger before rendering.
  initLogger({ sessionId: newSessionId(), mode: "tui" });
  const terminalInput = new TerminalInput(process.stdin);
  setThemeMode(await detectTerminalTheme(terminalInput));
  installSyncOutput();
  let interactionSummary: InteractionSummary | undefined;
  const appProps = {
    providers: cfg.providers,
    permissionMode: cfg.permission_mode,
    mcpServers: cfg.mcp_servers,
    hooks: cfg.hooks,
    sandboxConfig: cfg.sandbox,
    enableCoordinatorMode: cfg.enable_coordinator_mode,
    forkDisabled: !forkEnabled(cfg),
  };
  const application = (
    <App
      {...appProps}
      resume={parseResumeArgument(args)}
      onExitSummary={(summary) => {
        interactionSummary = summary;
      }}
    />
  );
  try {
    const instance = render(application, { exitOnCtrlC: false, stdin: terminalInput.stdin });
    await instance.waitUntilExit();
  } finally {
    terminalInput.dispose();
  }
  if (interactionSummary) {
    process.stdout.write(`\n${formatInteractionSummary(interactionSummary)}\n`);
  }
}

main()
  .then(() => {
    recordExit(0);
  })
  .catch((err: unknown) => {
    recordError("main", err);
    logger.fatal({ err }, "main() unhandled error");
    process.exit(-1);
  });
