import assert from "node:assert/strict";
import test from "node:test";

import { assertLoopbackHost, assertLoopbackUrl } from "../src/config.js";
import {
  buildCreateExperimentArgs,
  buildDiscoverArgs,
  buildLogsArgs,
  buildPaperArgs,
  buildRunExperimentArgs,
} from "../src/orx-client.js";

test("literature search maps to an argv array without a shell", () => {
  const args = buildDiscoverArgs({
    query: 'Ni Cu; echo "not a shell"',
    strategy: "openalex",
    publishedAfter: "2020-01-01",
    priority: "recency",
    limit: 12,
  });

  assert.deepEqual(args, [
    "discover",
    "openalex",
    'Ni Cu; echo "not a shell"',
    "--published-after",
    "2020-01-01",
    "--prioritize",
    "recency",
    "--limit",
    "12",
  ]);
});

test("paper arguments are allowlisted", () => {
  assert.deepEqual(
    buildPaperArgs({ id: "10.1234/example", source: "openalex", full: true }),
    ["paper", "10.1234/example", "--source", "openalex", "--full"],
  );
});

test("experiment create arguments preserve title and parent as individual argv values", () => {
  assert.deepEqual(
    buildCreateExperimentArgs({
      projectId: "p1",
      title: "LR 3e-5",
      parentId: "e1",
      description: "Change one thing.",
    }),
    ["create-experiment", "p1", "--title", "LR 3e-5", "--parent", "e1", "--description", "Change one thing."],
  );
});

test("experiment run arguments are typed", () => {
  assert.deepEqual(
    buildRunExperimentArgs({
      experimentId: "e2",
      backend: "local",
      timeout: "30m",
      force: true,
    }),
    ["exp", "run", "e2", "--backend", "local", "--timeout", "30m", "--force"],
  );
});

test("log byte ranges are encoded as one argv value", () => {
  assert.deepEqual(
    buildLogsArgs({ runId: "r1", rangeStart: 4096, rangeEnd: 8192 }),
    ["logs", "r1", "--range", "4096:8192"],
  );
  assert.throws(() => buildLogsArgs({ runId: "r1", rangeStart: 10 }), /provided together/);
});

test("OpenResearch HTTP base is restricted to loopback", () => {
  assert.equal(assertLoopbackUrl("http://127.0.0.1:4791").port, "4791");
  assert.throws(() => assertLoopbackUrl("https://example.com"), /must use http/);
  assert.throws(() => assertLoopbackUrl("http://example.com:4791"), /must point to loopback/);
});

test("MCP bind address is restricted to loopback", () => {
  assert.equal(assertLoopbackHost("127.0.0.1"), "127.0.0.1");
  assert.throws(() => assertLoopbackHost("0.0.0.0"), /must be loopback/);
});
