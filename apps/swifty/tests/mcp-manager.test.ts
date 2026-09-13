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

import { describe, expect, test } from "vitest";

import type { MCPServerConfig } from "../src/config/config.js";
import { MCPManager } from "../src/mcp/manager.js";

// Neither `command` nor `url`, so MCPClient.connect rejects before touching the
// network or spawning anything — a deterministic stand-in for a server that is down.
const unreachable: MCPServerConfig[] = [{ name: "broken" }];

describe("MCPManager", () => {
  test("a server that fails to come up counts as missing, never as connected", async () => {
    const mgr = new MCPManager();
    const result = await mgr.connectAll(unreachable);

    expect(result.servers).toEqual([]);
    expect(result.errors.map((e) => e.serverName)).toEqual(["broken"]);
    expect(mgr.connectedServers()).toEqual([]);
    expect(mgr.missingServers(unreachable)).toEqual(["broken"]);
  });

  test("a later connect pass retries the server instead of skipping it", async () => {
    const mgr = new MCPManager();
    await mgr.connectAll(unreachable);
    const second = await mgr.connectAll(unreachable);

    expect(second.errors.map((e) => e.serverName)).toEqual(["broken"]);
    expect(mgr.missingServers(unreachable)).toEqual(["broken"]);
  });
});
