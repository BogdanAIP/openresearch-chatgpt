import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const READ_LIMIT = 1_000_000;
const LIST_LIMIT = 5_000;
const WRITE_LIMIT = 8_000_000;

export interface ArtifactEntry {
  path: string;
  bytes: number;
}

export function validateArtifactPath(raw: string): string {
  const normalized = raw.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (
    !normalized
    || isAbsolute(raw)
    || normalized.startsWith("/")
    || normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("artifact path must be relative");
  }
  return normalized;
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

async function ensureNoSymlinkComponents(root: string, relativePath: string): Promise<void> {
  let current = root;
  for (const part of relativePath.split("/").slice(0, -1)) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error("artifact path crosses a symbolic link");
      if (!info.isDirectory()) throw new Error("artifact parent is not a directory");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") break;
      throw error;
    }
  }
}

export class ArtifactStore {
  async list(rootPath: string): Promise<ArtifactEntry[]> {
    await mkdir(rootPath, { recursive: true });
    const root = await realpath(rootPath);
    const output: ArtifactEntry[] = [];

    const walk = async (dir: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (output.length >= LIST_LIMIT) return;
        const full = join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          await walk(full, rel);
        } else if (entry.isFile()) {
          const info = await stat(full);
          output.push({ path: rel.replaceAll("\\", "/"), bytes: info.size });
        }
      }
    };

    await walk(root, "");
    return output;
  }

  async read(rootPath: string, rawPath: string): Promise<{ path: string; content: string; bytes: number }> {
    const path = validateArtifactPath(rawPath);
    await mkdir(rootPath, { recursive: true });
    const root = await realpath(rootPath);
    const target = await realpath(resolve(root, ...path.split("/")));
    if (!inside(root, target)) throw new Error("artifact path escapes the artifacts directory");
    const info = await stat(target);
    if (!info.isFile()) throw new Error("artifact path is not a file");
    if (info.size > READ_LIMIT) throw new Error(`artifact is too large to read as text (${info.size} bytes)`);
    const content = await readFile(target, "utf8");
    return { path, content, bytes: info.size };
  }

  async write(rootPath: string, rawPath: string, content: string): Promise<{ path: string; bytesWritten: number }> {
    const path = validateArtifactPath(rawPath);
    if (Buffer.byteLength(content, "utf8") > WRITE_LIMIT) {
      throw new Error(`artifact is too large to write (limit ${WRITE_LIMIT} bytes)`);
    }

    await mkdir(rootPath, { recursive: true });
    const root = await realpath(rootPath);
    await ensureNoSymlinkComponents(root, path);
    const target = resolve(root, ...path.split("/"));
    if (!inside(root, target)) throw new Error("artifact path escapes the artifacts directory");

    try {
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new Error("cannot overwrite a symbolic link");
      if (info.isDirectory()) throw new Error("artifact path is a directory");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
    return { path, bytesWritten: Buffer.byteLength(content, "utf8") };
  }
}
