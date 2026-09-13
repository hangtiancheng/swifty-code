import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { createAgentWorktree } from "@/worktree/worktree.js";

function initRepo(): string {
  // realpath: on macOS mkdtemp returns /var/... which is a symlink to
  // /private/var/...; git resolves it, so compare against the real path.
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "swifty-wt-")));
  execSync("git init -q -b main", { cwd: repo });
  execSync("git -c user.email=t@test -c user.name=t commit -q --allow-empty -m init", {
    cwd: repo,
  });
  return repo;
}

describe("createAgentWorktree .swifty settings propagation", () => {
  it("copies shared settings into the worktree", async () => {
    const repo = initRepo();
    mkdirSync(join(repo, ".swifty", "skills", "demo"), { recursive: true });
    mkdirSync(join(repo, ".swifty", "memory"), { recursive: true });
    writeFileSync(join(repo, ".swifty", "memory", "notes.md"), "note\n");
    writeFileSync(join(repo, ".swifty", "permissions.yaml"), "rules: []\n");
    writeFileSync(join(repo, ".swifty", "skills", "demo", "SKILL.md"), "demo\n");

    const wt = await createAgentWorktree("copy-test", repo);

    expect(wt.path).toBe(join(repo, ".swifty", "worktrees", "copy-test"));
    expect(existsSync(join(wt.path, ".swifty", "memory", "notes.md"))).toBe(true);
    expect(existsSync(join(wt.path, ".swifty", "permissions.yaml"))).toBe(true);
    expect(existsSync(join(wt.path, ".swifty", "skills", "demo", "SKILL.md"))).toBe(true);
  });

  it("excludes runtime state and the nested worktrees directory", async () => {
    const repo = initRepo();
    mkdirSync(join(repo, ".swifty", "sessions"), { recursive: true });
    mkdirSync(join(repo, ".swifty", "file-history", "sess-1"), { recursive: true });
    writeFileSync(join(repo, ".swifty", "sessions", "s.jsonl"), "{}\n");
    writeFileSync(join(repo, ".swifty", "file-history", "sess-1", "img.png"), "x");
    writeFileSync(join(repo, ".swifty", "permissions.yaml"), "rules: []\n");

    const wt = await createAgentWorktree("exclude-test", repo);

    expect(existsSync(join(wt.path, ".swifty", "permissions.yaml"))).toBe(true);
    expect(existsSync(join(wt.path, ".swifty", "sessions"))).toBe(false);
    expect(existsSync(join(wt.path, ".swifty", "file-history"))).toBe(false);
    expect(existsSync(join(wt.path, ".swifty", "worktrees"))).toBe(false);
  });
});
