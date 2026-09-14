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

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const libDir = join(pkgRoot, "dist", "lib");
const libEntry = join(libDir, "index.js");
const cliEntry = join(pkgRoot, "dist", "main.js");

describe("cli entry (dist/main.js)", () => {
  it("keeps the shebang for the bin target", () => {
    expect(existsSync(cliEntry)).toBe(true);
    expect(readFileSync(cliEntry, "utf-8").startsWith("#!/usr/bin/env node")).toBe(true);
  });
});

describe.skipIf(!existsSync(libEntry))("library entry (dist/lib)", () => {
  it("contains no ink/react/tui imports in any emitted module", () => {
    const banned = /(from|import)\s*\(?\s*["'][^"']*(\bink\b|\breact\b|\btui(?:-v2)?\/)/;
    const atAlias = /["']@\/[^"']*["']/;
    for (const file of readdirSync(libDir)) {
      if (!file.endsWith(".js") && !file.endsWith(".d.ts")) {
        continue;
      }
      const text = readFileSync(join(libDir, file), "utf-8");
      expect(banned.exec(text), `${file} must not reference TUI modules`).toBeNull();
      if (file.endsWith(".d.ts")) {
        expect(atAlias.exec(text), `${file} must not leak unresolved @/ type imports`).toBeNull();
      }
    }
  });

  it("loads in plain node and exposes the agent API", () => {
    const script = `
      const m = await import(process.env.SWIFTY_LIB_ENTRY);
      const symbols = [
        "Agent", "ToolRegistry", "MCPManager", "PermissionChecker",
        "loadConfig", "createClient", "buildSystemPrompt", "TeamManager",
        "TaskCreateTool", "TeamTaskCreateTool", "TaskStopTool", "TaskStore",
        "recover", "runPrintMode", "RemoteServer", "ComputerUseTool",
      ];
      console.log(JSON.stringify({
        totalExports: Object.keys(m).length,
        version: m.version,
        symbols: Object.fromEntries(symbols.map((k) => [k, typeof m[k]])),
      }));
    `;
    const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, SWIFTY_LIB_ENTRY: pathToFileURL(libEntry).href },
      encoding: "utf-8",
    });

    const LoadedSchema = z.object({
      totalExports: z.number().int().positive(),
      version: z.string().regex(/^\d+\.\d+/),
      symbols: z.record(z.string(), z.string()),
    });
    const parsed = LoadedSchema.safeParse(JSON.parse(stdout));
    expect(parsed.success, stdout).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(parsed.data.totalExports).toBeGreaterThan(100);
    for (const [name, type] of Object.entries(parsed.data.symbols)) {
      expect(type, name).toBe("function");
    }
  });
});
