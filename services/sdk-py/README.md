# acp — Python SDK (stub)

A minimal, dependency-free Python client for the **agent-chat-platform** public API (#86).
Standard library only (`urllib.request`). Mirrors a subset of the TypeScript SDK
([`@acp/sdk-ts`](../sdk-ts)).

## Install

This is a source stub — copy the `acp/` package into your project, or add this
directory to your `PYTHONPATH`. (No PyPI release yet.)

## Auth

Pass a bearer **token** — either a user session token (from `POST /auth/login`)
or an `acp_`-prefixed API key (#83). It is sent as `Authorization: Bearer <token>`
on every request.

## Usage

```python
from acp import AcpClient, AcpError

acp = AcpClient("https://api.reload.chat", token="acp_...")

# chat
channels = acp.list_channels()
msgs = acp.list_messages("thread-id", limit=50)
acp.post_message("thread-id", "hello @iris")

# tasks
acp.create_tasks_bulk("thread-id", [{"title": "Ship it", "priority": "high"}])
task = acp.get_task("task-id")

# runs
files = acp.run_diff("run-id")
acp.approve_run("run-id")

# memory
hits = acp.memory_recall("deploy policy", limit=5)

# integrations
acp.import_linear("thread-id")
acp.import_github("thread-id")

# billing
acp.get_billing()
```

Errors surface as `AcpError` carrying `.status` and the parsed `.body`:

```python
try:
    acp.list_messages("missing")
except AcpError as e:
    print(e.status, e)  # 404 thread not found
```

## Smoke test

```bash
ACP_BASE_URL=http://localhost:8080 ACP_TOKEN=acp_... python -m acp
```

This calls `list_channels()` against a live server. It is a documented smoke,
not a test harness.

## API reference

The full machine-readable contract is served at `GET /openapi.json`, with an
interactive Swagger UI at `GET /docs`. See also [`docs/api.md`](../../docs/api.md)
for the agent tool catalogue.
