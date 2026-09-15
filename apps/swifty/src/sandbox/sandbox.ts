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

import os from "node:os";

/**
 * Sandbox configuration: controls file write permissions and network access.
 */
export interface SandboxConfig {
  /** Paths where write operations are permitted. */
  allowWrite: string[];
  /** Paths that are always read-only (takes precedence over allowWrite). */
  denyWrite: string[];
  /** Whether network access is allowed. */
  networkEnabled: boolean;
}

/**
 * Unified sandbox interface with platform-specific implementations for macOS and Linux.
 */
export interface Sandbox {
  /** Wraps a raw command into a sandboxed command string. */
  wrap(command: string, config: SandboxConfig): string;
  /** Checks whether the platform sandbox tooling is available. */
  available(): boolean;
}

/**
 * Creates a platform-appropriate sandbox instance.
 * macOS: seatbelt (sandbox-exec)
 * Linux: bubblewrap (bwrap)
 * Other platforms: null (sandbox not supported)
 */
export async function createSandbox(): Promise<Sandbox | null> {
  const platform = os.platform();
  if (platform === "darwin") {
    const { SeatbeltSandbox } = await import("./seatbelt.js");
    return new SeatbeltSandbox();
  }
  if (platform === "linux") {
    const { BwrapSandbox } = await import("./bwrap.js");
    return new BwrapSandbox();
  }
  return null;
}
