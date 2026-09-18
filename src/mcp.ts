import { createHash } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { ArtifactStore } from "./artifacts.js";
import type { GitExperimentEditor } from "./git-experiment.js";
import type { OpenResearchHttpClient } from "./openresearch-http.js";
import type { OrxClient } from "./orx-client.js";

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function ok(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : jsonText(value) }] };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function buildMcpServer(
  orx: OrxClient,
  http: OpenResearchHttpClient,
  git: GitExperimentEditor,
  artifacts = new ArtifactStore(),
): McpServer {
  const server = new McpServer({ name: "openresearch-chatgpt", version: "0.2.0" });

  server.registerTool(
    "openresearch_status",
    { description: "Check whether the local OpenResearch dashboard/API and orx CLI are reachable." },
    async () => {
      try {
        const [health, cliVersion] = await Promise.all([http.health(), orx.version()]);
        return ok({ reachable: true, cliVersion, health });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "project_list",
    { description: "List projects registered in the local OpenResearch workspace." },
    async () => {
      try {
        return ok({ projects: await http.listProjects() });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "project_get",
    {
      description: "Read one OpenResearch project together with its experiment tree and runs.",
      inputSchema: z.object({ projectId: z.string().min(1).max(256) }),
    },
    async ({ projectId }) => {
      try {
        const [project, experiments, runs] = await Promise.all([
          http.getProject(projectId),
          http.listExperiments(projectId),
          http.listRuns(projectId),
        ]);
        return ok({ project, experiments, runs });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "literature_search",
    {
      description:
        "Search scholarly literature through OpenResearch discovery primitives. Returns discovery candidates; read key papers with paper_read before making claim-level conclusions.",
      inputSchema: z.object({
        query: z.string().min(1).max(2000),
        strategy: z.enum(["keyword", "embedding", "openalex", "biorxiv"]).default("embedding"),
        publishedAfter: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        publishedBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        priority: z.enum(["default", "recency", "historical", "popular"]).default("default"),
        limit: z.number().int().min(1).max(50).default(15),
      }),
    },
    async (input) => {
      try {
        return ok({ results: await orx.searchLiterature(input) });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "paper_read",
    {
      description:
        "Read a selected scholarly paper through OpenResearch. Accepts arXiv IDs/URLs, DOIs, bioRxiv DOIs, or OpenAlex W IDs.",
      inputSchema: z.object({
        id: z.string().min(1).max(1000),
        source: z.enum(["alphaxiv", "openalex", "biorxiv"]).optional(),
        full: z.boolean().default(false),
      }),
    },
    async (input) => {
      try {
        return ok(await orx.readPaper(input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "experiment_list",
    {
      description: "List experiment nodes for one OpenResearch project.",
      inputSchema: z.object({ projectId: z.string().min(1).max(256) }),
    },
    async ({ projectId }) => {
      try {
        return ok({ experiments: await http.listExperiments(projectId) });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "experiment_get",
    {
      description: "Read one experiment and the runs that belong to it.",
      inputSchema: z.object({
        projectId: z.string().min(1).max(256),
        experimentId: z.string().min(1).max(256),
      }),
    },
    async ({ projectId, experimentId }) => {
      try {
        const [experiment, runs] = await Promise.all([
          http.getExperiment(projectId, experimentId),
          http.listRuns(projectId),
        ]);
        return ok({ experiment, runs: runs.filter((run) => run.experimentId === experimentId) });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "experiment_read_file",
    {
      description: "Read a text file from the committed Git branch of one experiment.",
      inputSchema: z.object({
        projectId: z.string().min(1).max(256),
        experimentId: z.string().min(1).max(256),
        path: z.string().min(1).max(1024),
      }),
    },
    async ({ projectId, experimentId, path }) => {
      try {
        const experiment = await http.getExperiment(projectId, experimentId);
        const file = await http.getProjectFile(projectId, path, experiment.branchName);
        if (file.notFound) throw new Error(`File not found in experiment branch: ${path}`);
        if (file.binary) throw new Error(`File is not text: ${path}`);
        return ok({
          ...file,
          experimentId,
          branchName: experiment.branchName,
          contentSha256: sha256(file.content),
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "experiment_create",
    {
      description:
        "Create a new OpenResearch experiment node. A child inherits its parent's fixed run command; use baseline=true only for an intentional additional root.",
      inputSchema: z.object({
        projectId: z.string().min(1).max(256),
        title: z.string().min(1).max(500),
        parentId: z.string().min(1).max(256).optional(),
        description: z.string().max(5000).optional(),
        baseline: z.boolean().default(false),
      }),
    },
    async (input) => {
      try {
        if (input.baseline && input.parentId) throw new Error("baseline and parentId are mutually exclusive");
        const before = new Set((await http.listExperiments(input.projectId)).map((item) => item.id));
        const command = await orx.createExperiment(input);
        const experiments = await http.listExperiments(input.projectId);
        const created = experiments.find((item) => !before.has(item.id));
        return ok({ created: created ?? null, commandOutput: command.stdout.trim() });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "experiment_edit",
    {
      description:
        "Replace one exact text occurrence on an experiment branch and commit it. Refuses edits while a run is active or after the experiment has a successful/result-bearing run; create a child instead.",
      inputSchema: z.object({
        projectId: z.string().min(1).max(256),
        experimentId: z.string().min(1).max(256),
        path: z.string().min(1).max(1024),
        oldText: z.string().min(1).max(500_000),
        newText: z.string().max(500_000),
        commitMessage: z.string().min(1).max(500),
      }),
    },
    async ({ projectId, experimentId, path, oldText, newText, commitMessage }) => {
      try {
        const [project, experiment, runs] = await Promise.all([
          http.getProject(projectId),
          http.getExperiment(projectId, experimentId),
          http.listRuns(projectId),
        ]);
        const experimentRuns = runs.filter((run) => run.experimentId === experimentId);
        if (experimentRuns.some((run) => run.status === "starting" || run.status === "running")) {
          throw new Error("experiment has an active run; wait or cancel it before editing");
        }
        if (experimentRuns.some((run) => run.status === "done" || Boolean(run.resultMarkdown?.trim()))) {
          throw new Error("experiment already has a measured result; create a child experiment instead of editing it");
        }

        const result = await git.edit({
          repoPath: project.repoPath,
          branchName: experiment.branchName,
          path,
          oldText,
          newText,
          commitMessage,
        });
        return ok(result);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "experiment_run",
    {
      description:
        "Launch an OpenResearch experiment using its already configured fixed run command. Omit backend to use the project's configured default compute target.",
      inputSchema: z.object({
        projectId: z.string().min(1).max(256),
        experimentId: z.string().min(1).max(256),
        backend: z.enum(["local", "ssh", "slurm", "ray", "k8s", "modal", "hf", "openresearch", "tinker"]).optional(),
        flavor: z.string().min(1).max(256).optional(),
        host: z.string().min(1).max(512).optional(),
        manifest: z.string().min(1).max(1024).optional(),
        provider: z.string().min(1).max(256).optional(),
        org: z.string().min(1).max(256).optional(),
        image: z.string().min(1).max(1024).optional(),
        timeout: z.string().min(1).max(64).optional(),
        force: z.boolean().default(false),
      }),
    },
    async ({ projectId, experimentId, ...runInput }) => {
      try {
        const [project, experiment, beforeRuns] = await Promise.all([
          http.getProject(projectId),
          http.getExperiment(projectId, experimentId),
          http.listRuns(projectId),
        ]);
        if (!experiment.runCommand?.trim() && !project.runCommand?.trim()) {
          throw new Error("no fixed run command is configured for this experiment/project");
        }
        const before = new Set(beforeRuns.map((run) => run.id));
        const command = await orx.runExperiment({ experimentId, ...runInput });
        const afterRuns = await http.listRuns(projectId);
        const created = afterRuns
          .filter((run) => run.experimentId === experimentId && !before.has(run.id))
          .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0] ?? null;
        return ok({ run: created, commandOutput: command.stdout.trim() });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "run_get",
    {
      description: "Read current status and metadata for one OpenResearch run.",
      inputSchema: z.object({ runId: z.string().min(1).max(256) }),
    },
    async ({ runId }) => {
      try {
        return ok(await http.getRun(runId));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "run_logs",
    {
      description:
        "Read persisted terminal evidence for a run. Tail is the default; use head=true for the beginning or rangeStart/rangeEnd for an exact byte window.",
      inputSchema: z.object({
        runId: z.string().min(1).max(256),
        head: z.boolean().default(false),
        bytes: z.number().int().min(1).max(1_000_000).optional(),
        rangeStart: z.number().int().min(0).optional(),
        rangeEnd: z.number().int().min(1).optional(),
      }),
    },
    async (input) => {
      try {
        if ((input.rangeStart === undefined) !== (input.rangeEnd === undefined)) {
          throw new Error("rangeStart and rangeEnd must be provided together");
        }
        if (input.rangeStart !== undefined && input.rangeEnd !== undefined && input.rangeEnd <= input.rangeStart) {
          throw new Error("rangeEnd must be greater than rangeStart");
        }
        return ok(await orx.readLogs(input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "run_cancel",
    {
      description: "Request cancellation of one OpenResearch run.",
      inputSchema: z.object({ runId: z.string().min(1).max(256) }),
    },
    async ({ runId }) => {
      try {
        await http.cancelRun(runId);
        return ok({ ok: true, runId });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "artifact_list",
    {
      description: "List durable project artifact files.",
      inputSchema: z.object({ projectId: z.string().min(1).max(256) }),
    },
    async ({ projectId }) => {
      try {
        const project = await http.getProject(projectId);
        return ok({ artifacts: await artifacts.list(project.artifactsDir) });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "artifact_read",
    {
      description: "Read one UTF-8 text artifact from the project's artifacts directory.",
      inputSchema: z.object({
        projectId: z.string().min(1).max(256),
        path: z.string().min(1).max(1024),
      }),
    },
    async ({ projectId, path }) => {
      try {
        const project = await http.getProject(projectId);
        return ok(await artifacts.read(project.artifactsDir, path));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "artifact_write",
    {
      description: "Create or overwrite one UTF-8 text artifact inside the project's artifacts directory.",
      inputSchema: z.object({
        projectId: z.string().min(1).max(256),
        path: z.string().min(1).max(1024),
        content: z.string().max(8_000_000),
      }),
    },
    async ({ projectId, path, content }) => {
      try {
        const project = await http.getProject(projectId);
        return ok(await artifacts.write(project.artifactsDir, path, content));
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}
