import {
  parseExperiment,
  parseProject,
  parseRun,
  type ExperimentRecord,
  type ProjectRecord,
  type RunRecord,
  unwrapRecord,
} from "./types.js";

export class OpenResearchHttpError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "OpenResearchHttpError";
  }
}

export interface ProjectFile {
  path: string;
  content: string;
  truncated: boolean;
  binary: boolean;
  notFound: boolean;
  root: string;
  version?: string | null;
  presentation?: string;
}

export interface CreateProjectInput {
  name: string;
  path: string;
  runCommand?: string;
  paperId?: string;
  cloneUrl?: string;
  creationMode?: "blank" | "paper";
  createFolder?: boolean;
  requireNewFolder?: boolean;
  initializeGit?: boolean;
  githubSyncEnabled?: boolean;
  locale?: string;
}

export interface DiffPayload {
  diff: string;
  truncated: boolean;
  bytesRead: number;
  byteLimit: number;
}

export interface CodeTree {
  root: string;
  branch: string | null;
  entries: string[];
  truncated: boolean;
}

export type FileAction =
  | { action: "rename"; newName: string }
  | { action: "duplicate" | "delete" };

export class OpenResearchHttpClient {
  constructor(
    private readonly baseUrl: URL,
    private readonly timeoutMs: number,
  ) {}

  health(): Promise<unknown> {
    return this.requestJson("GET", "/api/health");
  }

  async listProjects(): Promise<ProjectRecord[]> {
    const payload = await this.requestJson<{ projects?: unknown[] }>("GET", "/api/projects");
    return (payload.projects ?? []).map(parseProject);
  }

  async createProject(input: CreateProjectInput): Promise<{ project: ProjectRecord; githubPublicationError: string | null }> {
    const payload = await this.requestJson<{ project: unknown; githubPublicationError?: string | null }>(
      "POST",
      "/api/projects",
      input,
    );
    return {
      project: parseProject(payload.project),
      githubPublicationError: payload.githubPublicationError ?? null,
    };
  }

  async getProject(projectId: string): Promise<ProjectRecord> {
    const payload = await this.requestJson("GET", `/api/projects/${encodeURIComponent(projectId)}`);
    return parseProject(unwrapRecord(payload, "project"));
  }

  async updateProject(projectId: string, input: { name?: string; runCommand?: string }): Promise<ProjectRecord> {
    const payload = await this.requestJson(
      "PATCH",
      `/api/projects/${encodeURIComponent(projectId)}`,
      input,
    );
    return parseProject(unwrapRecord(payload, "project"));
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.requestJson("DELETE", `/api/projects/${encodeURIComponent(projectId)}`);
  }

  async listExperiments(projectId: string): Promise<ExperimentRecord[]> {
    const payload = await this.requestJson<{ experiments?: unknown[] }>(
      "GET",
      `/api/projects/${encodeURIComponent(projectId)}/experiments`,
    );
    return (payload.experiments ?? []).map(parseExperiment);
  }

  async getExperiment(projectId: string, experimentId: string): Promise<ExperimentRecord> {
    const experiments = await this.listExperiments(projectId);
    const experiment = experiments.find((item) => item.id === experimentId);
    if (!experiment) throw new OpenResearchHttpError(`Experiment not found: ${experimentId}`, 404);
    return experiment;
  }

  async listRuns(projectId: string): Promise<RunRecord[]> {
    const payload = await this.requestJson<{ runs?: unknown[] }>(
      "GET",
      `/api/projects/${encodeURIComponent(projectId)}/runs`,
    );
    return (payload.runs ?? []).map(parseRun);
  }

  async listInstances(): Promise<RunRecord[]> {
    const payload = await this.requestJson<{ instances?: unknown[] }>("GET", "/api/instances");
    return (payload.instances ?? []).map(parseRun);
  }

  async getRun(runId: string): Promise<RunRecord> {
    const payload = await this.requestJson("GET", `/api/runs/${encodeURIComponent(runId)}`);
    return parseRun(unwrapRecord(payload, "run"));
  }

  async cancelRun(runId: string): Promise<void> {
    await this.requestJson("POST", `/api/runs/${encodeURIComponent(runId)}/cancel`);
  }

  getRunDiff(runId: string): Promise<DiffPayload> {
    return this.requestJson("GET", `/api/runs/${encodeURIComponent(runId)}/diff`);
  }

  getExperimentDiff(experimentId: string): Promise<DiffPayload> {
    return this.requestJson("GET", `/api/experiments/${encodeURIComponent(experimentId)}/diff`);
  }

  async getProjectFile(projectId: string, path: string, branch?: string): Promise<ProjectFile> {
    const params = new URLSearchParams({ path });
    if (branch) params.set("ref", branch);
    return this.requestJson<ProjectFile>(
      "GET",
      `/api/projects/${encodeURIComponent(projectId)}/file?${params.toString()}`,
    );
  }

  saveProjectFile(
    projectId: string,
    input: { path: string; content: string; expectedVersion: string },
  ): Promise<{ ok: boolean; root: string; bytesWritten: number; version: string }> {
    return this.requestJson(
      "PUT",
      `/api/projects/${encodeURIComponent(projectId)}/file`,
      input,
    );
  }

  manageProjectFile(projectId: string, path: string, action: FileAction): Promise<{ ok: boolean; path: string }> {
    return this.requestJson(
      "PATCH",
      `/api/projects/${encodeURIComponent(projectId)}/file`,
      { path, ...action },
    );
  }

  getCodeTree(projectId: string, branch?: string): Promise<CodeTree> {
    const params = new URLSearchParams();
    if (branch) params.set("ref", branch);
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return this.requestJson("GET", `/api/projects/${encodeURIComponent(projectId)}/code-tree${suffix}`);
  }

  getProjectGitStatus(projectId: string): Promise<unknown> {
    return this.requestJson("GET", `/api/projects/${encodeURIComponent(projectId)}/git`);
  }

  initializeProjectGit(projectId: string): Promise<unknown> {
    return this.requestJson("POST", `/api/projects/${encodeURIComponent(projectId)}/git/init`);
  }

  enableProjectGithub(projectId: string): Promise<unknown> {
    return this.requestJson("POST", `/api/projects/${encodeURIComponent(projectId)}/github`);
  }

  disableProjectGithub(projectId: string): Promise<unknown> {
    return this.requestJson("POST", `/api/projects/${encodeURIComponent(projectId)}/github/disable`);
  }

  pushProjectGithub(projectId: string): Promise<unknown> {
    return this.requestJson("POST", `/api/projects/${encodeURIComponent(projectId)}/github/push`);
  }

  getComputeSettings(projectId?: string): Promise<unknown> {
    const suffix = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    return this.requestJson("GET", `/api/settings/compute${suffix}`);
  }

  setComputeDefault(input: { backend: string | null; flavor?: string | null; projectId?: string }): Promise<unknown> {
    return this.requestJson("POST", "/api/settings/compute/default", input);
  }

  getLocalMachine(): Promise<unknown> {
    return this.requestJson("GET", "/api/settings/local");
  }

  getLatexEngine(): Promise<unknown> {
    return this.requestJson("GET", "/api/latex/engine");
  }

  compileLatex(projectId: string, path: string): Promise<unknown> {
    return this.requestJson(
      "POST",
      `/api/projects/${encodeURIComponent(projectId)}/file/latex`,
      { path },
    );
  }

  manageArtifactFile(projectId: string, path: string, action: FileAction): Promise<{ ok: boolean; path?: string }> {
    if (action.action === "delete") {
      return this.requestJson(
        "DELETE",
        `/api/projects/${encodeURIComponent(projectId)}/files?path=${encodeURIComponent(path)}`,
      );
    }
    return this.requestJson(
      "PATCH",
      `/api/projects/${encodeURIComponent(projectId)}/files`,
      { path, ...action },
    );
  }

  private async requestJson<T = unknown>(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new OpenResearchHttpError(
          `OpenResearch HTTP ${response.status}${text ? `: ${text}` : ""}`,
          response.status,
        );
      }
      if (response.status === 204) return undefined as T;
      const text = await response.text();
      if (!text) return undefined as T;
      return JSON.parse(text) as T;
    } catch (error) {
      if (error instanceof OpenResearchHttpError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new OpenResearchHttpError(`OpenResearch HTTP request timed out after ${this.timeoutMs} ms`);
      }
      throw new OpenResearchHttpError(
        `Cannot reach OpenResearch at ${this.baseUrl.origin}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
