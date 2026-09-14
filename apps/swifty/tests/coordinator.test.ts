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

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { coordinatorReminder } from "../src/prompt/coordinator.js";
import {
  isCoordinatorTool,
  coordinatorToolFilter,
  coordinatorActive,
} from "../src/teams/coordinator.js";
import { TaskStopTool } from "../src/teams/task-stop.js";
import { TeamManager } from "../src/teams/team.js";
import { SyntheticOutputTool } from "../src/tools/synthetic-output.js";

import { asString } from "@/utils/index.js";

// The teams directory lives at <home>/.swifty/teams, so the tests redirect the
// entire home directory to a temp dir to avoid leaving residue in the real
// ~/.swifty/teams. os.homedir() reads USERPROFILE on Windows and HOME on other
// platforms, so set both.
let realHome: string | undefined;
let realUserProfile: string | undefined;
beforeEach(() => {
  realHome = process.env.HOME;
  realUserProfile = process.env.USERPROFILE;
  const tmp = mkdtempSync(join(tmpdir(), "swifty-home-"));
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
});
afterEach(() => {
  if (realHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = realHome;
  }
  if (realUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = realUserProfile;
  }
});

const workDir = () => mkdtempSync(join(tmpdir(), "swifty-coord-"));
const ctx = { workDir: process.cwd() };

describe("coordinator tool set", () => {
  it("blocks tools that would flood the Lead's context with code", () => {
    for (const name of ["ReadFile", "WriteFile", "EditFile", "Glob", "Grep", "Bash"]) {
      expect(isCoordinatorTool(name)).toBe(false);
    }
  });

  it("blocks the shared task board, which belongs to teammates", () => {
    for (const name of ["TaskCreate", "TaskGet", "TaskList", "TaskUpdate"]) {
      expect(isCoordinatorTool(name)).toBe(false);
    }
  });

  it("allows the scheduling tools the Lead actually needs", () => {
    for (const name of ["Agent", "SendMessage", "TaskStop", "SyntheticOutput"]) {
      expect(isCoordinatorTool(name)).toBe(true);
    }
  });

  // TeamDelete is the only entry point for tearing down a Team, and coordinator
  // mode is triggered by "whether a Team exists". Blocking it would leave the
  // Lead unable to exit coordinator mode once a Team has been created.
  it("keeps TeamDelete so the Lead can leave coordinator mode", () => {
    expect(isCoordinatorTool("TeamDelete")).toBe(true);
  });

  it("narrows tools from the first turn once enabled", () => {
    const filter = coordinatorToolFilter(true);
    // Decides based on config alone, without waiting for a team to be created
    expect(filter("Bash")).toBe(false);
    expect(filter("ReadFile")).toBe(false);
    expect(filter("TeamCreate")).toBe(false);
    expect(filter("Agent")).toBe(true);
  });

  it("drops MCP tools too — their output is just as heavy", () => {
    expect(coordinatorToolFilter(true)("mcp__github__create_issue")).toBe(false);
  });

  // The scheduling guidance and the tool narrowing must take effect together:
  // narrowing tools without providing guidance would leave the Lead only
  // discovering they cannot read files, with no idea to dispatch a teammate to read them.
  it("keeps the guidance flag in step with the tool filter", () => {
    const filter = coordinatorToolFilter(true);
    expect(coordinatorActive(true)).toBe(true);
    expect(coordinatorActive(true)).toBe(!filter("Bash"));
  });

  it("stays off when the feature is disabled", () => {
    expect(coordinatorToolFilter(false)("Bash")).toBe(true);
    expect(coordinatorActive(false)).toBe(false);
  });

  // In coordinator mode TeamCreate is not on the whitelist; the Agent tool creates the team itself
  it("does not need TeamCreate, but keeps TeamDelete for teardown", () => {
    expect(isCoordinatorTool("TeamCreate")).toBe(false);
    expect(isCoordinatorTool("TeamDelete")).toBe(true);
  });
});

describe("TaskStop", () => {
  it("stops a running teammate", async () => {
    const mgr = new TeamManager(workDir());
    const team = mgr.create("squad");
    let cancelled = false;
    const member = team.addMember("scout");
    member.active = true;
    member.cancel = () => {
      cancelled = true;
    };

    const res = await new TaskStopTool(mgr).execute(ctx, { teammate: "scout" });
    expect(res.isError).toBe(false);
    expect(cancelled).toBe(true);
    expect(member.active).toBe(false);
  });

  it("errors on an unknown teammate", async () => {
    const mgr = new TeamManager(workDir());
    mgr.create("squad");
    const res = await new TaskStopTool(mgr).execute(ctx, { teammate: "ghost" });
    expect(res.isError).toBe(true);
  });

  // Stopping an already-stopped teammate again should not raise an error, to avoid the model retrying repeatedly on the error
  it("is not an error to stop an idle teammate", async () => {
    const mgr = new TeamManager(workDir());
    const team = mgr.create("squad");
    team.addMember("scout");
    const res = await new TaskStopTool(mgr).execute(ctx, { teammate: "scout" });
    expect(res.isError).toBe(false);
    expect(res.output).toContain("nothing to stop");
  });
});

describe("SyntheticOutput", () => {
  it("returns plain strings untouched", async () => {
    const res = await new SyntheticOutputTool().execute(ctx, {
      output: "done",
    });
    expect(res.output).toBe("done");
    expect(res.isError).toBe(false);
  });

  it("serializes objects as JSON", async () => {
    const res = await new SyntheticOutputTool().execute(ctx, {
      output: { status: "ok", count: 2 },
    });
    expect(JSON.parse(asString(res.output))).toEqual({ status: "ok", count: 2 });
  });

  it("rejects output whose shape does not match the schema", async () => {
    const tool = new SyntheticOutputTool({
      type: "object",
      required: ["status"],
    });
    const res = await tool.execute(ctx, { output: { other: 1 } });
    expect(res.isError).toBe(true);
    expect(res.output).toContain("status");
  });

  it("rejects a wrong top-level type", async () => {
    const tool = new SyntheticOutputTool({ type: "array" });
    const res = await tool.execute(ctx, { output: { a: 1 } });
    expect(res.isError).toBe(true);
  });
});

describe("coordinator prompt", () => {
  // The reply format described in the guidance must match what drainLeads
  // actually delivers, otherwise the Lead would look up teammate names against a field that doesn't exist.
  it("matches the notification format the system actually sends", () => {
    const p = coordinatorReminder(1);
    expect(p).toContain("<team-notification");
    expect(p).toContain("from=");
    expect(p).not.toContain("<task_id>");
  });

  // Reminders are appended per turn; sparse turns keep their recurring cost bounded.
  it("goes sparse after the first turn", () => {
    const full = coordinatorReminder(1);
    const second = coordinatorReminder(2);
    expect(second.length).toBeLessThan(full.length);
    for (const must of ["cannot read files", "TaskStop", "from="]) {
      expect(second).toContain(must);
    }
    // In long sessions the full text must be restated periodically to avoid complete drift
    const repeats = [...Array(11).keys()].map((i) => coordinatorReminder(i + 2));
    expect(repeats.some((r) => r === full)).toBe(true);
  });

  // Swifty's built-in types are general-purpose / plan / explore; there is no worker
  it("does not reference a subagent_type that doesn't exist", () => {
    const p = coordinatorReminder(1);
    expect(p).not.toContain('subagent_type: "worker"');
    expect(p).not.toContain("subagent_type `worker`");
  });

  // The tools listed in the prompt must be exactly the ones the whitelist allows
  it("lists exactly the whitelisted tools", () => {
    const p = coordinatorReminder(1);
    const section = p.slice(p.indexOf("## Tools"), p.indexOf("## Delegation"));
    for (const name of ["Agent", "SendMessage", "TaskStop", "SyntheticOutput", "TeamDelete"]) {
      expect(section).toContain(`**${name}**`);
    }
    for (const name of ["ReadFile", "Bash", "Grep", "TaskCreate", "TeamCreate"]) {
      expect(section).not.toContain(`**${name}**`);
    }
  });
});
