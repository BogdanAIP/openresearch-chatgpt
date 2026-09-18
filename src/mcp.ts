import { createHash } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { ArtifactStore, validateArtifactPath } from "./artifacts.js";
import { GitExperimentEditor, validateRepoRelativePath } from "./git-experiment.js";
import type { OpenResearchHttpClient } from "./openresearch-http.js";
import { resolveManagedProjectPath } from "./project-path.js";
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
  projectsRoot: string,
  artifacts = new ArtifactStore(),
): McpServer {
  const server = new McpServer({ name: "openresearch-chatgpt", version: "0.3.0" });

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


  server.registerTool(
    "project_create",
    {
      description:
        "Create and register a new OpenResearch project inside the managed ORX_PROJECTS_ROOT. Initializes Git and can optionally clone a repository or seed from a paper.",
      inputSchema: z.object({
        name: z.string().min(1).max(200),
        folderName: z.string().min(1).max(120).optional(),
        runCommand: z.string().max(2000).optional(),
        paperId: z.string().min(1).max(1000).optional(),
        cloneUrl: z.string().url().max(2000).optional(),
        githubSyncEnabled: z.boolean().default(false),
        locale: z.string().min(2).max(32).default("en"),
      }),
    },
    async (input) => {
      try {
        const path = resolveManagedProjectPath(projectsRoot, input.name, input.folderName);
        const created = await http.createProject({
          name: input.name.trim(),
          path,
          runCommand: input.runCommand,
          paperId: input.paperId,
          cloneUrl: input.cloneUrl,
          creationMode: input.paperId ? "paper" : "blank",
          createFolder: true,
          requireNewFolder: true,
          initializeGit: true,
          githubSyncEnabled: input.githubSyncEnabled,
          locale: input.locale,
        });
        return ok({ ...created, managedRoot: projectsRoot });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "project_update",
    {
      description: "Rename an OpenResearch project and/or change its fixed default run command.",
      inputSchema: z.object({
        projectId: z.string().min(1).max(256),
        name: z.string().min(1).max(200).optional(),
        runCommand: z.string().max(2000).optional(),
      }),
    },
    async ({ projectId, name, runCommand }) => {
      try {
        if (name === undefined && runCommand === undefined) {
          throw new Error("provide name and/or runCommand");
        }
        return ok(await http.updateProject(projectId, { name, runCommand }));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "project_delete",
    {
      description:
        "Unregister an OpenResearch project. This does not delete the project repository directory, but it removes OpenResearch project state. confirmName must exactly match the current project name.",
      inputSchema: z.object({
        projectId: z.string().min(1).max(256),
        confirmName: z.string().min(1).max(200),
      }),
    },
    async ({ projectId, confirmName }) => {
      try {
        const project = await http.getProject(projectId);
        if (!project.name || confirmName !== project.name) {
          throw new Error("confirmName must exactly match the current project name");
        }
        await http.deleteProject(projectId);
        return ok({ ok: true, projectId, deletedRegistration: true, repositoryPreserved: true });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "project_tree",
    {
      description:
        "List repository-relative files for the main project checkout or for one experiment's committed branch.",
      inputSchema: z.object({
        projectId: z.string().min(1).max(256),
        experimentId: z.string().min(1).max(256).optional(),
      }),
    },
    async ({ projectId, experimentId }) => {
      try {
        const branch = experimentId
          ? (await http.getExperiment(projectId, experimentId)).branchName
          : undefined;
        return ok(await http.getCodeTree(projectId, branch));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "project_file_read",
    {
      description:
        "Read a UTF-8 text file from the project's main checkout. Paths are repository-relative and .git is blocked.",
      inputSchema: z.object({
        projectId: z.string().min(1).max(256),
        path: z.string().min(1).max(1024),
      }),
    },
    async ({ projectId, path }) => {
      try {
        const safePath = validateRepoRelativePath(path);
        const file = await http.getProjectFile(projectId, safePath);
        if (file.notFound) throw new Error(`File not found: ${safePath}`);
        if (file.binary) throw new Error(`File is not text: ${safePath}`);
        return ok({ ...file, contentSha256: sha256(file.content) });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "project_file_write",
    {
      description:
        "Overwrite one text file in the project's main checkout using OpenResearch optimistic concurrency. Read it first and pass the returned version as expectedVersion.",
      inputSchema: z.object({
        projectId: z.string().min(1).max(256),
        path: z.string().min(1).max(1024),
        content: z.string().max(8_000_000),
        expectedVersion: z.string().min(1).max(256),
      }),
    },
    async ({ projectId, path, content, expectedVersion }) => {
      try {
        const safePath = validateRepoRelativePath(path);
        return ok(await http.saveProjectFile(projectId, { path: safePath, content, expectedVersion }));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "project_file_manage",
    {
      description:
        "Rename, duplicate, or delete a repository-relative project file. Delete requires confirmPath to exactly repeat path.",
      inputSchema: z.object({
        projectId: z.string().min(1).max(256),
        path: z.string().min(1).max(1024),
        action: z.enum(["rename", "duplicate", "delete"]),
        newName: z.string().min(1).max(255).optional(),
        confirmPath: z.string().max(1024).optional(),
      }),
    },
    async ({ projectId, path, action, newName, confirmPath }) => {
      try {
        const safePath = validateRepoRelativePath(path);
        if (action === "delete" && confirmPath !== path) {
          throw new Error("confirmPath must exactly match path for deletion");
        }
        if (action === "rename") {
          if (!newName || /[\\/\\\\]/.test(newName) || newName === "." || newName === ".." || newName === ".git") {
            throw new Error("rename requires one safe newName without path separators");
          }
          return ok(await http.manageProjectFile(projectId, safePath, { action, newName }));
        }
        return ok(await http.manageProjectFile(projectId, safePath, { action }));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "experiment_diff",
    {
      description: "Read the Git diff OpenResearch reports for one experiment.",
      inputSchema: z.object({ experimentId: z.string().min(1).max(256) }),
    },
    async ({ experimentId }) => {
      try {
        return ok(await http.getExperimentDiff(experimentId));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "run_diff",
    {
      description: "Read the Git diff captured for one OpenResearch run.",
      inputSchema: z.object({ runId: z.string().min(1).max(256) }),
    },
    async ({ runId }) => {
      try {
        return ok(await http.getRunDiff(runId));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "instance_list",
    { description: "List runs across all OpenResearch projects, matching the compute/instances view." },
    async () => {
      try {
        return ok({ instances: await http.listInstances() });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "project_git_status",
    {
      description: "Read Git initialization, identity, remotes, cleanliness, and GitHub sync status for a project.",
      inputSchema: z.object({ projectId: z.string().min(1).max(256) }),
    },
    async ({ projectId }) => {
      try {
        return ok(await http.getProjectGitStatus(projectId));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "project_git_init",
    {
      description: "Initialize Git for an existing OpenResearch project when it is not already a repository.",
      inputSchema: z.object({ projectId: z.string().min(1).max(256) }),
    },
    async ({ projectId }) => {
      try {
        return ok(await http.initializeProjectGit(projectId));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "project_github_enable",
    {
      description:
        "Enable OpenResearch GitHub synchronization for a project using the GitHub credentials already configured in OpenResearch.",
      inputSchema: z.object({ projectId: z.string().min(1).max(256) }),
    },
    async ({ projectId }) => {
      try {
        return ok(await http.enableProjectGithub(projectId));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "project_github_disable",
    {
      description: "Disable OpenResearch GitHub synchronization for a project without deleting the local repository.",
      inputSchema: z.object({ projectId: z.string().min(1).max(256) }),
    },
    async ({ projectId }) => {
      try {
        return ok(await http.disableProjectGithub(projectId));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "project_github_push",
    {
      description: "Ask OpenResearch to push the project's current Git state to its configured GitHub repository.",
      inputSchema: z.object({ projectId: z.string().min(1).max(256) }),
    },
    async ({ projectId }) => {
      try {
        return ok(await http.pushProjectGithub(projectId));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "compute_get",
    {
      description: "Read available compute targets and the current default, optionally resolved for one project.",
      inputSchema: z.object({ projectId: z.string().min(1).max(256).optional() }),
    },
    async ({ projectId }) => {
      try {
        return ok(await http.getComputeSettings(projectId));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "compute_set_default",
    {
      description:
        "Set or clear the OpenResearch default compute backend globally or for one project. This does not accept credentials or secrets.",
      inputSchema: z.object({
        backend: z.enum(["local", "ssh", "slurm", "ray", "k8s", "modal", "hf", "openresearch", "tinker"]).nullable(),
        flavor: z.string().min(1).max(256).nullable().optional(),
        projectId: z.string().min(1).max(256).optional(),
      }),
    },
    async (input) => {
      try {
        return ok(await http.setComputeDefault(input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "local_machine_get",
    { description: "Read the local machine hardware summary detected by OpenResearch for local compute." },
    async () => {
      try {
        return ok(await http.getLocalMachine());
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "latex_status",
    { description: "Check which LaTeX engine OpenResearch can use on the local machine." },
    async () => {
      try {
        return ok(await http.getLatexEngine());
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "latex_compile",
    {
      description: "Compile one repository-relative .tex file in the project's main checkout through OpenResearch.",
      inputSchema: z.object({
        projectId: z.string().min(1).max(256),
        path: z.string().min(1).max(1024),
      }),
    },
    async ({ projectId, path }) => {
      try {
        const safePath = validateRepoRelativePath(path);
        if (!safePath.toLowerCase().endsWith(".tex")) throw new Error("latex_compile requires a .tex file");
        return ok(await http.compileLatex(projectId, safePath));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "artifact_manage",
    {
      description:
        "Rename, duplicate, or delete a durable artifact. Delete requires confirmPath to exactly repeat path.",
      inputSchema: z.object({
        projectId: z.string().min(1).max(256),
        path: z.string().min(1).max(1024),
        action: z.enum(["rename", "duplicate", "delete"]),
        newName: z.string().min(1).max(255).optional(),
        confirmPath: z.string().max(1024).optional(),
      }),
    },
    async ({ projectId, path, action, newName, confirmPath }) => {
      try {
        const safePath = validateArtifactPath(path);
        if (action === "delete" && confirmPath !== path) {
          throw new Error("confirmPath must exactly match path for deletion");
        }
        if (action === "rename") {
          if (!newName || /[\\/\\\\]/.test(newName) || newName === "." || newName === "..") {
            throw new Error("rename requires one safe newName without path separators");
          }
          return ok(await http.manageArtifactFile(projectId, safePath, { action, newName }));
        }
        return ok(await http.manageArtifactFile(projectId, safePath, { action }));
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}
