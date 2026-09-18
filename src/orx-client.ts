import { spawn } from "node:child_process";

export type DiscoveryStrategy = "keyword" | "embedding" | "openalex" | "biorxiv";
export type DiscoveryPriority = "default" | "recency" | "historical" | "popular";
export type LiteratureSource = "alphaxiv" | "openalex" | "biorxiv";

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
    const result = await this.run(buildDiscoverArgs(input));
    try {
      return JSON.parse(result.stdout);
    } catch (error) {
      throw new OrxCommandError(
        `OpenResearch returned invalid JSON for literature search: ${error instanceof Error ? error.message : String(error)}`,
        buildDiscoverArgs(input),
        result.stderr,
      );
    }
  }

  async readPaper(input: PaperReadInput): Promise<string> {
    const result = await this.run(buildPaperArgs(input));
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
