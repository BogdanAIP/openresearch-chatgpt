import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { OpenResearchHttpClient } from "../src/openresearch-http.js";

function listen(): Promise<{
  baseUrl: URL;
  requests: Array<{ method: string; url: string; body: unknown }>;
  close: () => Promise<void>;
}> {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      requests.push({ method: req.method ?? "", url: req.url ?? "", body });
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/projects" && req.method === "POST") {
        res.end(JSON.stringify({
          project: { id: "p1", name: "Demo", repoPath: "C:/demo", artifactsDir: "C:/artifacts" },
          githubPublicationError: null,
        }));
        return;
      }
      if (req.url === "/api/projects/p1" && req.method === "PATCH") {
        res.end(JSON.stringify({
          project: { id: "p1", name: body.name, repoPath: "C:/demo", artifactsDir: "C:/artifacts" },
        }));
        return;
      }
      if (req.url === "/api/projects/p1/file" && req.method === "PUT") {
        res.end(JSON.stringify({ ok: true, root: "clone", bytesWritten: 3, version: "v2" }));
        return;
      }
      if (req.url === "/api/settings/compute/default" && req.method === "POST") {
        res.end(JSON.stringify({ defaultBackend: body.backend, targets: [] }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not found" }));
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("missing address"));
      resolve({
        baseUrl: new URL(`http://127.0.0.1:${address.port}`),
        requests,
        close: () => new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done())),
      });
    });
  });
}

test("typed OpenResearch HTTP mutations use fixed endpoints and verbs", async () => {
  const fixture = await listen();
  try {
    const client = new OpenResearchHttpClient(fixture.baseUrl, 5_000);
    const created = await client.createProject({
      name: "Demo",
      path: "C:/demo",
      createFolder: true,
      requireNewFolder: true,
      initializeGit: true,
    });
    assert.equal(created.project.id, "p1");

    const updated = await client.updateProject("p1", { name: "Renamed" });
    assert.equal(updated.name, "Renamed");

    const saved = await client.saveProjectFile("p1", {
      path: "README.md",
      content: "new",
      expectedVersion: "v1",
    });
    assert.equal(saved.version, "v2");

    await client.setComputeDefault({ backend: "local", projectId: "p1" });

    assert.deepEqual(
      fixture.requests.map(({ method, url }) => [method, url]),
      [
        ["POST", "/api/projects"],
        ["PATCH", "/api/projects/p1"],
        ["PUT", "/api/projects/p1/file"],
        ["POST", "/api/settings/compute/default"],
      ],
    );
  } finally {
    await fixture.close();
  }
});
