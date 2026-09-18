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

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { BROWSER_TOOLS } from "./browser-tools.js";
import { createMcpSocketClient } from "./mcp-socket-client.js";
import { createMcpSocketPool } from "./mcp-socket-pool.js";
import { handleToolCall } from "./tool-calls.js";
import type { ClaudeForChromeContext, SocketClient } from "./types.js";

/**
 * Create the local socket client for the Chrome extension MCP server.
 * Exported so Desktop can share a single instance between the registered
 * MCP server and the InternalMcpServerManager (CCD sessions).
 */
export function createChromeSocketClient(context: ClaudeForChromeContext): SocketClient {
  return context.getSocketPaths ? createMcpSocketPool(context) : createMcpSocketClient(context);
}

export function createClaudeForChromeMcpServer(
  context: ClaudeForChromeContext,
  existingSocketClient?: SocketClient,
): Server {
  const { serverName, logger } = context;

  // Choose transport: socket pool (multi-profile) > single socket.
  const socketClient = existingSocketClient ?? createChromeSocketClient(context);

  const server = new Server(
    {
      name: serverName,
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (context.isDisabled?.()) {
      return { tools: [] };
    }
    return { tools: BROWSER_TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    logger.info(`[${serverName}] Executing tool: ${request.params.name}`);

    return handleToolCall(
      context,
      socketClient,
      request.params.name,
      request.params.arguments || {},
    );
  });

  socketClient.setNotificationHandler((notification) => {
    logger.info(`[${serverName}] Forwarding MCP notification: ${notification.method}`);
    server
      .notification({
        method: notification.method,
        params: notification.params,
      })
      .catch((error) => {
        // Server may not be connected yet (e.g., during startup or after disconnect)
        logger.info(`[${serverName}] Failed to forward MCP notification: ${error.message}`);
      });
  });

  return server;
}
