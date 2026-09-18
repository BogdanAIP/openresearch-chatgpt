import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import { GitExperimentEditor, replaceExactlyOnce, validateRepoRelativePath } from "../src/git-experiment.js";

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
  });
}

test("replacement must be unambiguous", () => {
  assert.equal(replaceExactlyOnce("x=1\n", "x=1", "x=2"), "x=2\n");
  assert.throws(() => replaceExactlyOnce("x=1\nx=1\n", "x=1", "x=2"), /more than once/);
  assert.throws(() => replaceExactlyOnce("x=1\n", "missing", "x=2"), /not found/);
});

test("repository-relative paths reject traversal and git metadata", () => {
  assert.equal(validateRepoRelativePath("config/model.yaml"), "config/model.yaml");
  assert.throws(() => validateRepoRelativePath("../secret"), /repository-relative/);
  assert.throws(() => validateRepoRelativePath(".git/config"), /not allowed/);
});

test("experiment editor commits through a detached worktree and atomically advances only the experiment branch", async () => {
  const repo = await mkdtemp(join(tmpdir(), "or-git-test-"));
  try {
    await git(repo, ["init"]);
    await git(repo, ["config", "user.email", "test@example.com"]);
    await git(repo, ["config", "user.name", "OpenResearch Test"]);
    await writeFile(join(repo, "config.txt"), "x=1\n", "utf8");
    await git(repo, ["add", "config.txt"]);
    await git(repo, ["commit", "-m", "baseline"]);
    const baseline = (await git(repo, ["rev-parse", "HEAD"])).trim();
    await git(repo, ["branch", "orx/test"]);

    const editor = new GitExperimentEditor("git", 30_000);
    const result = await editor.edit({
      repoPath: repo,
      branchName: "orx/test",
      path: "config.txt",
      oldText: "x=1",
      newText: "x=2",
      commitMessage: "test x=2",
    });

    assert.equal(result.previousCommit, baseline);
    assert.notEqual(result.commit, baseline);
    assert.equal((await git(repo, ["show", "orx/test:config.txt"])).trim(), "x=2");
    assert.equal((await readFile(join(repo, "config.txt"), "utf8")).trim(), "x=1");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
