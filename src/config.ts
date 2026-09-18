const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer: ${value}`);
  }
  return parsed;
}

export function assertLoopbackUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:") {
    throw new Error(`ORX_BASE_URL must use http:// in v0.1, got ${url.protocol}`);
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`ORX_BASE_URL must point to loopback, got ${url.hostname}`);
  }
  return url;
}

export function assertLoopbackHost(host: string): string {
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`MCP_HOST must be loopback in v0.1, got ${host}`);
  }
  return host;
}

export const config = {
  host: assertLoopbackHost(process.env.MCP_HOST ?? "127.0.0.1"),
  port: parsePort(process.env.MCP_PORT, 8787),
  orxBin: process.env.ORX_BIN ?? "orx",
  orxBaseUrl: assertLoopbackUrl(process.env.ORX_BASE_URL ?? "http://127.0.0.1:4791"),
  timeoutMs: parsePositiveInt(process.env.ORX_TIMEOUT_MS, 30_000),
  allowedHostnames: (process.env.MCP_ALLOWED_HOSTNAMES ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
};
