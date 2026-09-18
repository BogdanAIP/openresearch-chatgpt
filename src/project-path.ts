import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const WINDOWS_FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/g;

export function defaultProjectsRoot(): string {
  return resolve(process.env.ORX_PROJECTS_ROOT ?? join(homedir(), "OpenResearch-Projects"));
}

export function sanitizeProjectFolderName(name: string): string {
  const safe = name
    .trim()
    .replace(WINDOWS_FORBIDDEN, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
  if (!safe || safe === "." || safe === "..") return "research-project";
  return safe;
}

export function resolveManagedProjectPath(root: string, name: string, folderName?: string): string {
  const resolvedRoot = resolve(root);
  const rawSegment = (folderName ?? name).trim();
  if (/[\\/]/.test(rawSegment) || rawSegment === "." || rawSegment === "..") {
    throw new Error("project folder name must be a single directory name");
  }
  const segment = sanitizeProjectFolderName(rawSegment);
  const candidate = resolve(resolvedRoot, segment);
  const rel = relative(resolvedRoot, candidate);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("project path must stay inside ORX_PROJECTS_ROOT");
  }
  return candidate;
}
