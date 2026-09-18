export class OpenResearchHttpError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "OpenResearchHttpError";
  }
}

export class OpenResearchHttpClient {
  constructor(
    private readonly baseUrl: URL,
    private readonly timeoutMs: number,
  ) {}

  health(): Promise<unknown> {
    return this.getJson("/api/health");
  }

  async listProjects(): Promise<unknown[]> {
    const payload = await this.getJson<{ projects?: unknown[] }>("/api/projects");
    return payload.projects ?? [];
  }

  getProject(projectId: string): Promise<unknown> {
    return this.getJson(`/api/projects/${encodeURIComponent(projectId)}`);
  }

  async listExperiments(projectId: string): Promise<unknown[]> {
    const payload = await this.getJson<{ experiments?: unknown[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/experiments`,
    );
    return payload.experiments ?? [];
  }

  private async getJson<T = unknown>(path: string): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new OpenResearchHttpError(
          `OpenResearch HTTP ${response.status}${body ? `: ${body}` : ""}`,
          response.status,
        );
      }
      return (await response.json()) as T;
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
