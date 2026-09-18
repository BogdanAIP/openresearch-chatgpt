# OpenResearch ChatGPT

A narrow MCP bridge that exposes selected **OpenResearch** research capabilities to ChatGPT without exposing the full local OpenResearch HTTP API or an arbitrary shell.

## v0.1 scope

This first version is deliberately read-only. It exposes six MCP tools:

- `openresearch_status` — verify the `orx` CLI and local OpenResearch API are reachable.
- `project_list` — list local OpenResearch projects.
- `project_get` — read one project together with its experiment tree.
- `literature_search` — use `orx discover keyword|embedding|openalex|biorxiv`.
- `paper_read` — use `orx paper` for a selected paper.
- `experiment_list` — list experiment nodes for a project.

There is **no raw shell**, no arbitrary `orx` command, no absolute-path file access, no settings mutation, and no write access to experiment branches in v0.1.

## Requirements

- Windows, macOS, or Linux with OpenResearch installed.
- `orx` available on `PATH`, or `ORX_BIN` set to the full executable path.
- `orx up` running locally (default `http://127.0.0.1:4791`).
- Node.js 20+; Node.js 24 is recommended.

The MCP implementation uses the stable MCP TypeScript SDK v2 and the 2026-07-28 protocol surface.

## Install

```powershell
npm install
npm run check
```

## Run on Windows

If `orx.exe` is already on `PATH`:

```powershell
npm run build
npm start
```

If it is not on `PATH`:

```powershell
$env:ORX_BIN = "C:\\path\\to\\orx.exe"
npm run build
npm start
```

Defaults:

- MCP endpoint: `http://127.0.0.1:8787/mcp`
- Bridge health: `http://127.0.0.1:8787/health`
- OpenResearch API: `http://127.0.0.1:4791`

Check the bridge:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `MCP_HOST` | `127.0.0.1` | Bridge bind address. Keep loopback for the local+tunnel deployment. |
| `MCP_PORT` | `8787` | Bridge port. |
| `ORX_BIN` | `orx` | Path/name of the OpenResearch CLI. |
| `ORX_BASE_URL` | `http://127.0.0.1:4791` | Local OpenResearch dashboard/API. v0.1 rejects non-loopback URLs. |
| `ORX_TIMEOUT_MS` | `30000` | CLI/HTTP timeout. |
| `MCP_ALLOWED_HOSTNAMES` | empty | Optional comma-separated hostnames accepted from a trusted tunnel. Empty means localhost-only Host validation. |

The server binds locally and applies MCP SDK Host/Origin validation. If the secure tunnel preserves an external `Host` header, put only that trusted hostname in `MCP_ALLOWED_HOSTNAMES`; do not bind the bridge directly to the public internet.

## Architecture

```text
ChatGPT
   │
   │ MCP through a secure tunnel
   ▼
openresearch-chatgpt :8787
   │
   ├── allowlisted orx argv calls
   │     ├── discover
   │     └── paper
   │
   └── allowlisted OpenResearch HTTP reads
         ├── /api/health
         └── /api/projects/...
                │
                ▼
        OpenResearch :4791
```

The bridge never forwards a caller-supplied command or caller-supplied HTTP path. Tool handlers translate typed inputs into fixed OpenResearch operations.

## Next stage

After the read-only transport is proven end-to-end, the next version can add guarded write operations (`experiment_create`, `experiment_run`, `run_get`, `run_logs`) and only then controlled experiment-branch editing with frozen-node protection.
