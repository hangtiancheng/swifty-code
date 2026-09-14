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

import { MCPClient } from "./client.js";
import type { MCPTool } from "./client.js";

import type { MCPServerConfig } from "@/config/config.js";
import { createChildLogger } from "@/logger/logger.js";
import { asErrorString } from "@/utils/index.js";

const log = createChildLogger({ module: "mcp" });

export interface ConnectResult {
  tools: { serverName: string; tool: MCPTool }[];
  servers: string[];
  errors: { serverName: string; error: string }[];
  instructions: { serverName: string; text: string }[];
}

export class MCPManager {
  private clients = new Map<string, MCPClient>();

  /**
   * Brings up every configured server that has no live connection yet and reports what
   * this pass added. Servers already connected are left untouched, so calling it again
   * retries only the ones that failed — a server that was down earlier can join later
   * without disturbing the working ones.
   */
  async connectAll(configs: MCPServerConfig[]): Promise<ConnectResult> {
    const result: ConnectResult = {
      tools: [],
      servers: [],
      errors: [],
      instructions: [],
    };

    for (const cfg of configs) {
      if (this.clients.has(cfg.name)) {
        continue;
      }
      const client = new MCPClient(cfg);
      try {
        await client.connect();
        const tools = await client.listTools();

        // Recorded only once the tool list is in hand: a server that cannot be
        // listed is of no use, and keeping it here would make it look connected
        // on the next pass.
        this.clients.set(cfg.name, client);
        result.servers.push(cfg.name);
        for (const tool of tools) {
          result.tools.push({ serverName: cfg.name, tool });
        }

        const instructions = client.getInstructions();
        if (instructions) {
          result.instructions.push({
            serverName: cfg.name,
            text: instructions,
          });
        }
      } catch (err) {
        log.error({ err }, "mcp operation failed");
        result.errors.push({
          serverName: cfg.name,
          error: asErrorString(err),
        });
        await client.disconnect();
      }
    }

    return result;
  }

  getClient(name: string): MCPClient | undefined {
    return this.clients.get(name);
  }

  /** Every server with a live connection, across all connect passes. */
  connectedServers(): string[] {
    return [...this.clients.keys()];
  }

  /** The configured servers that are still not connected. */
  missingServers(configs: MCPServerConfig[]): string[] {
    return configs.filter((cfg) => !this.clients.has(cfg.name)).map((cfg) => cfg.name);
  }

  async disconnectAll(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.disconnect();
    }
    this.clients.clear();
  }
}
