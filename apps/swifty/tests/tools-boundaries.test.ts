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

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BashTool } from "../src/tools/bash.js";
import { EditFileTool } from "../src/tools/edit-file.js";
import { withFileMutationQueue } from "../src/tools/file-mutation-queue.js";
import { FileStateCache } from "../src/tools/file-state-cache.js";
import { PowerShellTool } from "../src/tools/powershell.js";
import { ReadFileTool } from "../src/tools/read-file.js";
import { formatShellOutput, takeUtf8Prefix, utf8ByteLength } from "../src/tools/shell-output.js";
import type { ToolContext } from "../src/tools/types.js";
import { WriteFileTool } from "../src/tools/write-file.js";

function makeContext(): ToolContext {
  return {
    workDir: mkdtempSync(join(tmpdir(), "swifty-tools-")),
    fileStateCache: new FileStateCache(),
  };
}

describe("file tool boundaries", () => {
  it("bounds large reads and rejects offsets past EOF", async () => {
    const context = makeContext();
    const path = join(context.workDir, "large.txt");
    writeFileSync(
      path,
      Array.from({ length: 1_000 }, (_, i) => `${String(i)} ${"界".repeat(30)}`).join("\n"),
    );

    const result = await new ReadFileTool().execute(context, { file_path: path });
    expect(result.isError).toBe(false);
    expect(result.output).toContain("more lines in file");
    expect(result.output).toContain("Use offset=");
    const returnedContent = result.output.split("\n[")[0] ?? result.output;
    expect(utf8ByteLength(returnedContent)).toBeLessThanOrEqual(50 * 1024);

    const beyond = await new ReadFileTool().execute(context, { file_path: path, offset: 1_000 });
    expect(beyond.isError).toBe(true);
    expect(beyond.output).toContain("is beyond end of file");
  });

  it("rejects missing write content and missing edit replacement", async () => {
    const context = makeContext();
    const path = join(context.workDir, "file.txt");
    const write = await new WriteFileTool().execute(context, { file_path: path });
    expect(write).toEqual({ output: "Error: content is required", isError: true });

    writeFileSync(path, "before");
    await new ReadFileTool().execute(context, { file_path: path });
    const edit = await new EditFileTool().execute(context, {
      file_path: path,
      old_string: "before",
    });
    expect(edit).toEqual({ output: "Error: new_string is required", isError: true });
    expect(readFileSync(path, "utf-8")).toBe("before");
  });

  it("serializes concurrent edits to the same file", async () => {
    const context = makeContext();
    const path = join(context.workDir, "concurrent.txt");
    writeFileSync(path, "first\nsecond");
    await new ReadFileTool().execute(context, { file_path: path });

    const [first, second] = await Promise.all([
      new EditFileTool().execute(context, {
        file_path: path,
        old_string: "first",
        new_string: "FIRST",
      }),
      new EditFileTool().execute(context, {
        file_path: path,
        old_string: "second",
        new_string: "SECOND",
      }),
    ]);
    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    expect(readFileSync(path, "utf-8")).toBe("FIRST\nSECOND");
  });

  it("serializes edits through symlink aliases", async () => {
    const context = { workDir: mkdtempSync(join(tmpdir(), "swifty-tools-")) };
    const realDir = join(context.workDir, "real");
    const aliasDir = join(context.workDir, "alias");
    mkdirSync(realDir);
    symlinkSync(realDir, aliasDir, "dir");
    writeFileSync(join(realDir, "file.txt"), "first\nsecond");

    const [first, second] = await Promise.all([
      new EditFileTool().execute(context, {
        file_path: "real/file.txt",
        old_string: "first",
        new_string: "FIRST",
      }),
      new EditFileTool().execute(context, {
        file_path: "alias/file.txt",
        old_string: "second",
        new_string: "SECOND",
      }),
    ]);
    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    expect(readFileSync(join(realDir, "file.txt"), "utf-8")).toBe("FIRST\nSECOND");
  });

  it("checks cancellation after waiting for a mutation lock", async () => {
    const context = makeContext();
    const path = join(context.workDir, "locked.txt");
    writeFileSync(path, "before");
    let release: () => void = () => {};
    const blocker = withFileMutationQueue(
      path,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const controller = new AbortController();
    const pending = new WriteFileTool().execute(
      { ...context, abortSignal: controller.signal },
      { file_path: path, content: "after" },
    );
    controller.abort();
    release();
    await blocker;
    const result = await pending;
    expect(result).toEqual({ output: "Error: operation interrupted", isError: true });
    expect(readFileSync(path, "utf-8")).toBe("before");
  });

  it("rejects an externally changed file whose mtime moved backwards", () => {
    const context = makeContext();
    const path = join(context.workDir, "stale.txt");
    writeFileSync(path, "content");
    const original = statSync(path).mtimeMs;
    context.fileStateCache?.record(path, original);
    const earlier = new Date(Math.max(0, original - 10_000));
    utimesSync(path, earlier, earlier);
    expect(context.fileStateCache?.check(path)).toEqual({
      ok: false,
      error: "Error: file has been modified since last read, read it again before editing.",
    });
  });
});

describe("shell tool boundaries", () => {
  it("keeps UTF-8 output limits on character boundaries", () => {
    const prefix = takeUtf8Prefix("界界界", 7);
    expect(prefix).toBe("界界");
    expect(utf8ByteLength(prefix)).toBeLessThanOrEqual(7);
    expect(formatShellOutput("$ ", "printf", prefix, "", true)).toContain(
      "[Output truncated after 10 MB]",
    );
  });

  it("reports non-zero Bash exits as tool errors", async () => {
    const result = await new BashTool().execute(makeContext(), { command: "exit 7" });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Exit code 7");
  });

  it("marks output that crosses the shell byte boundary", async () => {
    const result = await new BashTool().execute(makeContext(), {
      command: "node -e 'process.stdout.write(\"界\".repeat(4000000))'",
      timeout: 10,
    });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("[Output truncated after 10 MB]");
  }, 15_000);

  it("preserves captured Bash output when cancellation interrupts a command", async () => {
    const context = makeContext();
    const controller = new AbortController();
    const pending = new BashTool().execute(
      { ...context, abortSignal: controller.signal },
      { command: "printf before; sleep 10" },
    );
    setTimeout(() => controller.abort(), 50);
    const result = await pending;
    expect(result.isError).toBe(true);
    expect(result.output).toContain("before");
    expect(result.output).toContain("command interrupted");
  }, 5_000);

  it("cancels Bash after the shell exits with inherited pipes still open", async () => {
    const context = makeContext();
    const controller = new AbortController();
    const pending = new BashTool().execute(
      { ...context, abortSignal: controller.signal },
      { command: "printf before; sleep 2 &" },
    );
    setTimeout(() => controller.abort(), 100);
    const result = await pending;
    expect(result.isError).toBe(true);
    expect(result.output).toContain("before");
    expect(result.output).toContain("command interrupted");
  }, 1_000);

  it("times out Bash after the shell exits with inherited pipes still open", async () => {
    const result = await new BashTool().execute(makeContext(), {
      command: "sleep 2 &",
      timeout: 1,
    });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("command timed out after 1s");
  }, 2_500);

  it("rejects non-positive timeouts before starting either shell", async () => {
    const context = makeContext();
    const expected = {
      output: "Error: timeout must be a finite number greater than 0 seconds",
      isError: true,
    };
    await expect(new BashTool().execute(context, { command: "true", timeout: 0 })).resolves.toEqual(
      expected,
    );
    await expect(
      new PowerShellTool().execute(context, { command: "Write-Output ok", timeout: -1 }),
    ).resolves.toEqual(expected);
  });
});
