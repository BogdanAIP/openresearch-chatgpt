export interface ProjectRecord {
  id: string;
  name?: string;
  repoPath: string;
  artifactsDir: string;
  runCommand?: string | null;
  [key: string]: unknown;
}

export interface ExperimentRecord {
  id: string;
  projectId: string;
  branchName: string;
  parentExperimentId?: string | null;
  title?: string | null;
  description?: string | null;
  runCommand?: string | null;
  [key: string]: unknown;
}

export type RunStatus = "starting" | "running" | "done" | "failed" | "cancelled";

export interface RunRecord {
  id: string;
  projectId: string;
  experimentId: string;
  status: RunStatus;
  resultMarkdown?: string | null;
  commitSha?: string | null;
  createdAt?: number;
  updatedAt?: number;
  cancelRequested?: boolean;
  [key: string]: unknown;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label} returned by OpenResearch`);
  }
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid ${label}: missing ${key}`);
  }
  return value;
}

export function parseProject(value: unknown): ProjectRecord {
  const record = object(value, "project");
  return {
    ...record,
    id: requiredString(record, "id", "project"),
    repoPath: requiredString(record, "repoPath", "project"),
    artifactsDir: requiredString(record, "artifactsDir", "project"),
    name: typeof record.name === "string" ? record.name : undefined,
    runCommand: typeof record.runCommand === "string" || record.runCommand === null
      ? record.runCommand
      : undefined,
  };
}

export function parseExperiment(value: unknown): ExperimentRecord {
  const record = object(value, "experiment");
  return {
    ...record,
    id: requiredString(record, "id", "experiment"),
    projectId: requiredString(record, "projectId", "experiment"),
    branchName: requiredString(record, "branchName", "experiment"),
    parentExperimentId: typeof record.parentExperimentId === "string" || record.parentExperimentId === null
      ? record.parentExperimentId
      : undefined,
    title: typeof record.title === "string" || record.title === null ? record.title : undefined,
    description: typeof record.description === "string" || record.description === null
      ? record.description
      : undefined,
    runCommand: typeof record.runCommand === "string" || record.runCommand === null
      ? record.runCommand
      : undefined,
  };
}

export function parseRun(value: unknown): RunRecord {
  const record = object(value, "run");
  const status = requiredString(record, "status", "run") as RunStatus;
  if (!["starting", "running", "done", "failed", "cancelled"].includes(status)) {
    throw new Error(`Invalid run status returned by OpenResearch: ${status}`);
  }
  return {
    ...record,
    id: requiredString(record, "id", "run"),
    projectId: requiredString(record, "projectId", "run"),
    experimentId: requiredString(record, "experimentId", "run"),
    status,
    resultMarkdown: typeof record.resultMarkdown === "string" || record.resultMarkdown === null
      ? record.resultMarkdown
      : undefined,
    commitSha: typeof record.commitSha === "string" || record.commitSha === null
      ? record.commitSha
      : undefined,
    createdAt: typeof record.createdAt === "number" ? record.createdAt : undefined,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : undefined,
    cancelRequested: typeof record.cancelRequested === "boolean" ? record.cancelRequested : undefined,
  };
}

export function unwrapRecord(payload: unknown, key: string): unknown {
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload) && key in payload) {
    return (payload as Record<string, unknown>)[key];
  }
  return payload;
}
