import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

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

export function buildMcpServer(orx: OrxClient, http: OpenResearchHttpClient): McpServer {
  const server = new McpServer({ name: "openresearch-chatgpt", version: "0.1.0" });

  server.registerTool(
    "openresearch_status",
    {
      description: "Check whether the local OpenResearch dashboard/API and orx CLI are reachable.",
    },
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
    {
      description: "List projects registered in the local OpenResearch workspace.",
    },
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
      description: "Read one OpenResearch project and its current experiment tree.",
      inputSchema: z.object({
        projectId: z.string().min(1).max(256),
      }),
    },
    async ({ projectId }) => {
      try {
        const [project, experiments] = await Promise.all([
          http.getProject(projectId),
          http.listExperiments(projectId),
        ]);
        return ok({ project, experiments });
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
      description: "List experiment nodes for one OpenResearch project without modifying them.",
      inputSchema: z.object({
        projectId: z.string().min(1).max(256),
      }),
    },
    async ({ projectId }) => {
      try {
        return ok({ experiments: await http.listExperiments(projectId) });
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}
