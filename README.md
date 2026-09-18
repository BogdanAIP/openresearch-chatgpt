# OpenResearch ChatGPT

A narrow MCP bridge that lets ChatGPT use a local **OpenResearch** workspace directly.

The bridge does not reimplement OpenResearch. OpenResearch remains responsible for projects, experiment trees, runs, logs, literature retrieval, compute backends, Git history, and the artifacts directory. This repository only translates typed MCP calls into those existing capabilities.

## What ChatGPT can do

### Research and literature

- `openresearch_status` — verify that `orx` and the local OpenResearch API are reachable.
- `project_list` — list local OpenResearch projects.
- `project_get` — read one project, experiment tree, and current runs.
- `literature_search` — use `orx discover keyword|embedding|openalex|biorxiv`.
- `paper_read` — use `orx paper` for a selected paper.

### Experiments

- `experiment_list`
- `experiment_get`
- `experiment_read_file` — read committed experiment-branch text.
- `experiment_create` — create a child/baseline through `orx create-experiment`.
- `experiment_edit` — exact text replacement on the experiment branch, committed through a temporary detached Git worktree.
- `experiment_run` — launch with the experiment's already configured fixed run command.
- `run_get`
- `run_logs`
- `run_cancel`

`experiment_edit` refuses to rewrite an experiment while it has an active run or after a successful/result-bearing run. In that case create a child experiment instead.

### Durable outputs

- `artifact_list`
- `artifact_read`
- `artifact_write`

Artifact paths are always relative to the project's OpenResearch artifacts directory. Absolute paths and traversal are rejected.

## What is deliberately not exposed

There is no:

- arbitrary shell tool;
- raw `orx <anything>` passthrough;
- caller-supplied OpenResearch HTTP path;
- arbitrary absolute-file access;
- environment/settings mutation;
- direct access to OpenResearch's built-in Codex/Claude/OpenCode chat sessions.

The bridge calls `orx`, `git`, and OpenResearch HTTP internally with fixed typed operations and `shell: false`.

## Requirements

- OpenResearch installed.
- `orx` available on `PATH`, or `ORX_BIN` set to the full path to `orx.exe`.
- `orx up` running locally (default `http://127.0.0.1:4791`).
- Git installed and available on `PATH`, or `GIT_BIN` set.
- Node.js 20+; Node.js 24 is recommended.

## Install

```powershell
npm install
npm run check
```

## Run on Windows

With `orx.exe` and Git already on `PATH`:

```powershell
npm run build
npm start
```

If `orx.exe` is not on `PATH`:

```powershell
$env:ORX_BIN = "C:\path\to\orx.exe"
npm run build
npm start
```

Defaults:

- MCP endpoint: `http://127.0.0.1:8787/mcp`
- bridge health: `http://127.0.0.1:8787/health`
- OpenResearch API: `http://127.0.0.1:4791`

Check the bridge:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `MCP_HOST` | `127.0.0.1` | Bridge bind address. Must remain loopback. |
| `MCP_PORT` | `8787` | Bridge port. |
| `ORX_BIN` | `orx` | OpenResearch CLI path/name. |
| `GIT_BIN` | `git` | Git executable path/name. |
| `ORX_BASE_URL` | `http://127.0.0.1:4791` | Local OpenResearch dashboard/API. Must be loopback. |
| `ORX_TIMEOUT_MS` | `30000` | CLI/HTTP/Git timeout. |
| `MCP_ALLOWED_HOSTNAMES` | empty | Optional trusted Host values used by a local secure tunnel. |

The bridge itself binds only to loopback. It is intended to sit behind a separate secure MCP tunnel rather than be exposed directly to the public internet.

## How experiment editing works

OpenResearch owns the experiment tree and branch names. For one `experiment_edit` call the bridge:

1. resolves the experiment and its OpenResearch branch;
2. rejects the edit if the node is already measured or running;
3. creates a temporary **detached** Git worktree at the branch's current commit;
4. replaces exactly one requested text occurrence;
5. commits the change;
6. atomically advances only that experiment branch if it has not changed concurrently;
7. removes the temporary worktree.

This avoids taking ownership of a branch that may already have another OpenResearch worktree and avoids silently overwriting concurrent branch movement.

## Tests

```powershell
npm run check
```

CI covers TypeScript compilation, command argument construction, loopback/path guards, artifact operations, and a real temporary Git repository for experiment editing.
