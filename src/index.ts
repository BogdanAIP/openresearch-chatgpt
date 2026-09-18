import { createServer } from "node:http";

import {
  hostHeaderValidation,
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { config } from "./config.js";
import { GitExperimentEditor } from "./git-experiment.js";
import { buildMcpServer } from "./mcp.js";
import { OpenResearchHttpClient } from "./openresearch-http.js";
import { OrxClient } from "./orx-client.js";

const orx = new OrxClient(config.orxBin, config.timeoutMs);
const http = new OpenResearchHttpClient(config.orxBaseUrl, config.timeoutMs);
const git = new GitExperimentEditor(config.gitBin, config.timeoutMs);
const handler = createMcpHandler(() => buildMcpServer(orx, http, git, config.projectsRoot), { responseMode: "json" });
const nodeHandler = toNodeHandler(handler);
const validateHost = config.allowedHostnames.length > 0
  ? hostHeaderValidation(config.allowedHostnames)
  : localhostHostValidation();
const validateOrigin = localhostOriginValidation();

const server = createServer((req, res) => {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (requestUrl.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, service: "openresearch-chatgpt", version: "0.3.0" }));
    return;
  }

  if (requestUrl.pathname !== "/mcp") {
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  if (!validateHost(req, res) || !validateOrigin(req, res)) return;
  void nodeHandler(req, res);
});

server.listen(config.port, config.host, () => {
  console.error(`[openresearch-chatgpt] MCP: http://${config.host}:${config.port}/mcp`);
  console.error(`[openresearch-chatgpt] health: http://${config.host}:${config.port}/health`);
  console.error(`[openresearch-chatgpt] OpenResearch: ${config.orxBaseUrl.origin}`);
  console.error(`[openresearch-chatgpt] managed projects: ${config.projectsRoot}`);
});

async function shutdown(signal: string): Promise<void> {
  console.error(`[openresearch-chatgpt] ${signal}, shutting down`);
  server.close();
  await handler.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
