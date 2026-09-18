import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export interface ExperimentEditInput {
  repoPath: string;
  branchName: string;
  path: string;
  oldText: string;
  newText: string;
  commitMessage: string;
}

export interface ExperimentEditResult {
  previousCommit: string;
  commit: string;
  branchName: string;
  path: string;
}

export class GitCommandError extends Error {
  constructor(message: string, readonly args: readonly string[], readonly stderr = "") {
    super(message);
    this.name = "GitCommandError";
  }
}

export function validateRepoRelativePath(raw: string): string {
  const normalized = raw.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (
    !normalized
    || isAbsolute(raw)
    || normalized.startsWith("/")
    || normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("path must be a normal repository-relative path");
  }
  if (normalized.split("/").some((part) => part.toLowerCase() === ".git")) {
    throw new Error("paths under .git are not allowed");
  }
  return normalized;
}

export function replaceExactlyOnce(content: string, oldText: string, newText: string): string {
  if (!oldText) throw new Error("oldText must not be empty");
  const first = content.indexOf(oldText);
  if (first < 0) throw new Error("oldText was not found in the target file");
  if (content.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error("oldText occurs more than once; provide a more specific replacement");
  }
  return content.slice(0, first) + newText + content.slice(first + oldText.length);
}

export class GitExperimentEditor {
  constructor(
    private readonly gitBinary: string,
    private readonly timeoutMs: number,
  ) {}

  async edit(input: ExperimentEditInput): Promise<ExperimentEditResult> {
    const path = validateRepoRelativePath(input.path);
    if (!input.commitMessage.trim()) throw new Error("commitMessage must not be empty");

    const ref = `refs/heads/${input.branchName}`;
    const previousCommit = (await this.run(input.repoPath, ["rev-parse", "--verify", ref])).stdout.trim();
    if (!previousCommit) throw new Error(`Experiment branch not found: ${input.branchName}`);

    const worktree = await mkdtemp(join(tmpdir(), "openresearch-chatgpt-"));
    let added = false;
    try {
      await this.run(input.repoPath, ["worktree", "add", "--detach", worktree, previousCommit]);
      added = true;

      const fullPath = resolve(worktree, ...path.split("/"));
      const rel = relative(worktree, fullPath);
      if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
        throw new Error("path escapes experiment worktree");
      }

      const current = await readFile(fullPath, "utf8");
      const next = replaceExactlyOnce(current, input.oldText, input.newText);
      if (next === current) throw new Error("replacement does not change the file");

      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, next, "utf8");
      await this.run(worktree, ["add", "--", path]);
      await this.run(worktree, ["commit", "-m", input.commitMessage.trim()]);
      const commit = (await this.run(worktree, ["rev-parse", "HEAD"])).stdout.trim();

      await this.run(input.repoPath, ["update-ref", ref, commit, previousCommit]);
      return { previousCommit, commit, branchName: input.branchName, path };
    } finally {
      if (added) {
        await this.run(input.repoPath, ["worktree", "remove", "--force", worktree]).catch(() => undefined);
      }
      await rm(worktree, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private run(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(this.gitBinary, args, {
        cwd,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new GitCommandError(`git command timed out after ${this.timeoutMs} ms`, args, stderr));
      }, this.timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.on("data", (chunk: string) => { stderr += chunk; });

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new GitCommandError(`Failed to start git: ${error.message}`, args, stderr));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          reject(new GitCommandError(`git command failed with exit code ${code ?? "unknown"}`, args, stderr.trim()));
          return;
        }
        resolvePromise({ stdout, stderr });
      });
    });
  }
}
