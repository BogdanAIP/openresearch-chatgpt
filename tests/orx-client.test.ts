import assert from "node:assert/strict";
import test from "node:test";

import { assertLoopbackHost, assertLoopbackUrl } from "../src/config.js";
import { buildDiscoverArgs, buildPaperArgs } from "../src/orx-client.js";

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

test("OpenResearch HTTP base is restricted to loopback", () => {
  assert.equal(assertLoopbackUrl("http://127.0.0.1:4791").port, "4791");
  assert.throws(() => assertLoopbackUrl("https://example.com"), /must use http/);
  assert.throws(() => assertLoopbackUrl("http://example.com:4791"), /must point to loopback/);
});


test("MCP bind address is restricted to loopback", () => {
  assert.equal(assertLoopbackHost("127.0.0.1"), "127.0.0.1");
  assert.throws(() => assertLoopbackHost("0.0.0.0"), /must be loopback/);
});
