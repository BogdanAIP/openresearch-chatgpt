# OpenResearch ChatGPT

A typed MCP interface that lets ChatGPT control the practical research surface of a local **OpenResearch** workspace.

OpenResearch remains the research engine and source of truth. It owns projects, experiment trees, runs, logs, literature retrieval, compute backends, Git history, GitHub synchronization, project files, LaTeX compilation, and artifact storage. This repository exposes those capabilities to ChatGPT as explicit MCP tools instead of mirroring internal HTTP routes or providing arbitrary shell access.

## What ChatGPT can do

### OpenResearch and literature

- `openresearch_status` — verify that the local OpenResearch API and `orx` CLI are reachable.
- `literature_search` — search through `orx discover keyword|embedding|openalex|biorxiv`.
- `paper_read` — read a selected paper through `orx paper`.

### Projects

- `project_list`
- `project_get`
- `project_create` — create and register a project inside the managed project root.
- `project_update` — rename a project and/or change its fixed run command.
- `project_delete` — unregister a project after exact-name confirmation; the repository directory is preserved.
- `project_tree` — list repository files from the main checkout or an experiment branch.
- `project_file_read`
- `project_file_write` — optimistic-concurrency text writes using OpenResearch file versions.
- `project_file_manage` — rename, duplicate, or delete project files; deletion requires exact path confirmation.

New projects are constrained to `ORX_PROJECTS_ROOT`. By default this is:

```text
~/OpenResearch-Projects
```

The caller chooses a project name and optional single folder name, not an arbitrary absolute path.

### Experiments and runs

- `experiment_list`
- `experiment_get`
- `experiment_read_file` — read committed experiment-branch text.
- `experiment_create`
- `experiment_edit` — exact text replacement committed through a detached temporary Git worktree.
- `experiment_diff`
- `experiment_run`
- `run_get`
- `run_logs`
- `run_diff`
- `run_cancel`
- `instance_list` — list runs across all projects, matching OpenResearch's compute/instances view.

`experiment_edit` refuses to rewrite an experiment while it has an active run or after a successful/result-bearing run. In that case create a child experiment instead.

### Git and GitHub

- `project_git_status`
- `project_git_init`
- `project_github_enable`
- `project_github_disable`
- `project_github_push`

These operations use the Git/GitHub identity and credentials already configured in OpenResearch. Tura does not accept GitHub tokens.

### Compute

- `compute_get` — inspect available compute targets and current defaults.
- `compute_set_default` — set or clear a global/project compute default without accepting credentials.
- `local_machine_get` — inspect hardware detected by OpenResearch for local runs.

Experiment launching remains constrained to OpenResearch's typed backend options and each project's fixed run command.

### LaTeX

- `latex_status` — inspect the detected LaTeX engine.
- `latex_compile` — compile a repository-relative `.tex` file through OpenResearch.

### Durable artifacts

- `artifact_list`
- `artifact_read`
- `artifact_write`
- `artifact_manage` — rename, duplicate, or delete artifacts; deletion requires exact path confirmation.

Artifact paths are always relative to the project's OpenResearch artifacts directory. Absolute paths and traversal are rejected.

## Deliberately not exposed

Tura is intended to be a full **research** interface, not remote administration of the Windows machine. It therefore does not expose:

- arbitrary shell execution;
- raw `orx <anything>` passthrough;
- caller-supplied OpenResearch HTTP paths;
- arbitrary absolute-file reads/writes;
- secret/token/environment-variable mutation;
- SSH configuration or credential management;
- OpenResearch application update/restart controls;
- the built-in OpenResearch Codex/Claude/OpenCode chat-session machinery.

ChatGPT is already the conversational agent in this architecture, so exposing another agent-chat layer would add authority without adding a necessary research capability.

The bridge calls `orx`, `git`, and the local OpenResearch HTTP API internally with fixed typed operations. Child processes use `shell: false`.


## Windows one-click controller

On the Windows machine that hosts OpenResearch, double-click:

```text
Tura Control.cmd
```

It opens a small status window with one large button:

- green `ВКЛЮЧЕНО` when OpenResearch, the Tura bridge, and the OpenAI tunnel are all usable;
- red `ВЫКЛЮЧЕНО` when the research stack is unavailable.

Click the green button to stop the OpenAI tunnel first, then the Tura bridge and OpenResearch. A successful red `ВЫКЛЮЧЕНО` state therefore leaves no background process from this Tura/OpenResearch stack running.

Click the red button to start OpenResearch and Tura. If the OpenAI tunnel is also absent (for example after a Windows reboot), the controller starts it too. The first time this is required, the controller asks for the Runtime API key and stores it locally with Windows DPAPI encryption under `%LOCALAPPDATA%\OpenResearchChatGPT`; the key is never written to the repository.

Logs created by the controller live under:

```text
%LOCALAPPDATA%\OpenResearchChatGPT\logs
```

No Windows autorun entry is installed. The controller is always started manually.

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
- managed projects root: `~/OpenResearch-Projects`

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
| `ORX_PROJECTS_ROOT` | `~/OpenResearch-Projects` | Root under which `project_create` may create repositories. |
| `ORX_TIMEOUT_MS` | `30000` | CLI/HTTP/Git timeout. |
| `MCP_ALLOWED_HOSTNAMES` | empty | Optional trusted Host values used by a local secure tunnel. |

The bridge binds only to loopback. It is intended to sit behind OpenAI Secure MCP Tunnel rather than expose OpenResearch or the MCP bridge directly to the public internet.

## Experiment editing model

OpenResearch owns experiment nodes and branch names. For one `experiment_edit` call the bridge:

1. resolves the experiment and its OpenResearch branch;
2. rejects the edit if the node is already measured or running;
3. creates a temporary detached Git worktree at the branch's current commit;
4. replaces exactly one requested text occurrence;
5. commits the change;
6. atomically advances only that experiment branch if it has not changed concurrently;
7. removes the temporary worktree.

This avoids taking ownership of a branch that may already have another OpenResearch worktree and avoids silently overwriting concurrent branch movement.

## Tests

```powershell
npm run check
```

CI covers TypeScript compilation, fixed CLI argument construction, loopback/path guards, managed project paths, typed OpenResearch HTTP mutations, artifact operations, and a real temporary Git repository for experiment editing.
