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

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, afterEach } from "vitest";

import { record, recordError, recordExit } from "../src/recover.js";

// The crash log is always written under cwd; tests chdir into a temp directory and restore afterward
const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

describe("crash log", () => {
  it("appends records with a timestamp", () => {
    const dir = mkdtempSync(join(tmpdir(), "swifty-crash-"));
    process.chdir(dir);

    record("start pid=1");
    try {
      throw new Error("boom");
    } catch (err) {
      recordError("uncaughtException", err);
    }

    const log = readFileSync(join(dir, ".swifty", "crash.log"), "utf8");
    expect(log).toContain("start pid=1");
    expect(log).toContain("crash [uncaughtException] Error: boom");
    expect(log).toContain("recover.test.ts");
    // Append semantics: a later entry must not overwrite an earlier one
    expect(log.indexOf("start pid=1")).toBeLessThan(log.indexOf("crash ["));

    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  // The idempotency flag is module-level; this is the only call site for recordExit in this file
  it("writes the exit marker only once", () => {
    const dir = mkdtempSync(join(tmpdir(), "swifty-crash-"));
    process.chdir(dir);

    recordExit(0);
    recordExit(1);

    const log = readFileSync(join(dir, ".swifty", "crash.log"), "utf8");
    const marks = log.split("\n").filter((line) => line.includes("exit pid="));
    expect(marks).toHaveLength(1);
    expect(marks[0]).toContain("code=0");

    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it("records non-Error rejection values", () => {
    const dir = mkdtempSync(join(tmpdir(), "swifty-crash-"));
    process.chdir(dir);

    recordError("unhandledRejection", "plain string reason");

    const log = readFileSync(join(dir, ".swifty", "crash.log"), "utf8");
    expect(log).toContain("crash [unhandledRejection] plain string reason");

    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });
});
