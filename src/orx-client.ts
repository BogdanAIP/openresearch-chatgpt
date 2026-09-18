import { spawn } from "node:child_process";

export type DiscoveryStrategy = "keyword" | "embedding" | "openalex" | "biorxiv";
export type DiscoveryPriority = "default" | "recency" | "historical" | "popular";
export type LiteratureSource = "alphaxiv" | "openalex" | "biorxiv";
export type ComputeBackend =
  | "local"
  | "ssh"
  | "slurm"
  | "ray"
  | "k8s"
  | "modal"
  | "hf"
  | "openresearch"
  | "tinker";

export interface LiteratureSearchInput {
  query: string;
  strategy: DiscoveryStrategy;
  publishedAfter?: string;
  publishedBefore?: string;
  priority?: DiscoveryPriority;
  limit?: number;
}

export interface PaperReadInput {
  id: string;
  source?: LiteratureSource;
  full?: boolean;
}

export interface CreateExperimentInput {
  projectId: string;
  title: string;
  parentId?: string;
  description?: string;
  baseline?: boolean;
}

export interface RunExperimentInput {
  experimentId: string;
  backend?: ComputeBackend;
  flavor?: string;
  host?: string;
  manifest?: string;
  provider?: string;
  org?: string;
  image?: string;
  timeout?: string;
  force?: boolean;
}

export interface ReadLogsInput {
  runId: string;
  head?: boolean;
  bytes?: number;
  rangeStart?: number;
  rangeEnd?: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export class OrxCommandError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly stderr = "",
  ) {
    super(message);
    this.name = "OrxCommandError";
  }
}

export function buildDiscoverArgs(input: LiteratureSearchInput): string[] {
  const args = ["discover", input.strategy, input.query];
  if (input.publishedAfter) args.push("--published-after", input.publishedAfter);
  if (input.publishedBefore) args.push("--published-before", input.publishedBefore);
  if (input.priority && input.priority !== "default") args.push("--prioritize", input.priority);
  if (input.limit !== undefined) args.push("--limit", String(input.limit));
  return args;
}

export function buildPaperArgs(input: PaperReadInput): string[] {
  const args = ["paper", input.id];
  if (input.source) args.push("--source", input.source);
  if (input.full) args.push("--full");
  return args;
}

export function buildCreateExperimentArgs(input: CreateExperimentInput): string[] {
  const args = ["create-experiment", input.projectId, "--title", input.title];
  if (input.parentId) args.push("--parent", input.parentId);
  if (input.description) args.push("--description", input.description);
  if (input.baseline) args.push("--baseline");
  return args;
}

export function buildRunExperimentArgs(input: RunExperimentInput): string[] {
  const args = ["exp", "run", input.experimentId];
  if (input.backend) args.push("--backend", input.backend);
  if (input.flavor) args.push("--flavor", input.flavor);
  if (input.host) args.push("--host", input.host);
  if (input.manifest) args.push("--manifest", input.manifest);
  if (input.provider) args.push("--provider", input.provider);
  if (input.org) args.push("--org", input.org);
  if (input.image) args.push("--image", input.image);
  if (input.timeout) args.push("--timeout", input.timeout);
  if (input.force) args.push("--force");
  return args;
}

export function buildLogsArgs(input: ReadLogsInput): string[] {
  const args = ["logs", input.runId];
  if (input.head) args.push("--head");
  if (input.bytes !== undefined) args.push("--bytes", String(input.bytes));
  const hasStart = input.rangeStart !== undefined;
  const hasEnd = input.rangeEnd !== undefined;
  if (hasStart !== hasEnd) {
    throw new Error("rangeStart and rangeEnd must be provided together");
  }
  if (hasStart && hasEnd) args.push("--range", `${input.rangeStart}:${input.rangeEnd}`);
  return args;
}

export class OrxClient {
  constructor(
    private readonly binary: string,
    private readonly timeoutMs: number,
  ) {}

  async version(): Promise<string> {
    const result = await this.run(["--version"]);
    return result.stdout.trim();
  }

  async searchLiterature(input: LiteratureSearchInput): Promise<unknown> {
    const args = buildDiscoverArgs(input);
    const result = await this.run(args);
    try {
      return JSON.parse(result.stdout);
    } catch (error) {
      throw new OrxCommandError(
        `OpenResearch returned invalid JSON for literature search: ${error instanceof Error ? error.message : String(error)}`,
        args,
        result.stderr,
      );
    }
  }

  async readPaper(input: PaperReadInput): Promise<string> {
    const result = await this.run(buildPaperArgs(input));
    return result.stdout;
  }

  createExperiment(input: CreateExperimentInput): Promise<CommandResult> {
    return this.run(buildCreateExperimentArgs(input));
  }

  runExperiment(input: RunExperimentInput): Promise<CommandResult> {
    return this.run(buildRunExperimentArgs(input));
  }

  async readLogs(input: ReadLogsInput): Promise<string> {
    const result = await this.run(buildLogsArgs(input));
    return result.stdout;
  }

  private run(args: string[]): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, args, {
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
        reject(new OrxCommandError(`OpenResearch command timed out after ${this.timeoutMs} ms`, args, stderr));
      }, this.timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const hint = (error as NodeJS.ErrnoException).code === "ENOENT"
          ? `OpenResearch CLI not found: ${this.binary}. Set ORX_BIN to the full path to orx.exe.`
          : `Failed to start OpenResearch CLI: ${error.message}`;
        reject(new OrxCommandError(hint, args, stderr));
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          reject(new OrxCommandError(`OpenResearch command failed with exit code ${code ?? "unknown"}`, args, stderr.trim()));
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  }
}
