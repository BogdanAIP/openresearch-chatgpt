import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";

import { resolveManagedProjectPath, sanitizeProjectFolderName } from "../src/project-path.js";

test("project folder names are safe and keep useful unicode", () => {
  assert.equal(sanitizeProjectFolderName("  Каталитический пиролиз: Ni/Cu  "), "Каталитический пиролиз- Ni-Cu");
  assert.equal(sanitizeProjectFolderName(".."), "research-project");
});

test("managed project paths stay under the configured root", () => {
  const root = resolve(join("tmp", "openresearch-projects"));
  assert.equal(
    resolveManagedProjectPath(root, "Demo", "demo"),
    resolve(root, "demo"),
  );
  assert.throws(
    () => resolveManagedProjectPath(root, "Demo", "../escape"),
    /single directory name|stay inside/,
  );
});
