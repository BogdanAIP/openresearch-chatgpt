import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ArtifactStore, validateArtifactPath } from "../src/artifacts.js";

test("artifact paths reject traversal", () => {
  assert.equal(validateArtifactPath("reports/result.md"), "reports/result.md");
  assert.throws(() => validateArtifactPath("../outside.txt"), /relative/);
});

test("artifact store writes, lists and reads text inside the artifact root", async () => {
  const root = await mkdtemp(join(tmpdir(), "or-artifacts-"));
  try {
    const store = new ArtifactStore();
    await store.write(root, "report/result.md", "# Result\n");
    assert.deepEqual(await store.read(root, "report/result.md"), {
      path: "report/result.md",
      content: "# Result\n",
      bytes: 9,
    });
    const list = await store.list(root);
    assert.equal(list.length, 1);
    assert.equal(list[0]?.path, "report/result.md");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
