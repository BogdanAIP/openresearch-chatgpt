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
}

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

  async getProject(projectId: string): Promise<ProjectRecord> {
    const payload = await this.requestJson("GET", `/api/projects/${encodeURIComponent(projectId)}`);
    return parseProject(unwrapRecord(payload, "project"));
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

  async getRun(runId: string): Promise<RunRecord> {
    const payload = await this.requestJson("GET", `/api/runs/${encodeURIComponent(runId)}`);
    return parseRun(unwrapRecord(payload, "run"));
  }

  async cancelRun(runId: string): Promise<void> {
    await this.requestJson("POST", `/api/runs/${encodeURIComponent(runId)}/cancel`);
  }

  async getProjectFile(projectId: string, path: string, branch: string): Promise<ProjectFile> {
    const params = new URLSearchParams({ path, ref: branch });
    return this.requestJson<ProjectFile>(
      "GET",
      `/api/projects/${encodeURIComponent(projectId)}/file?${params.toString()}`,
    );
  }

  private async requestJson<T = unknown>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
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
