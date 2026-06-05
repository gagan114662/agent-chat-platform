"""acp — a minimal Python client for the agent-chat-platform public API (#86).

Standard library only (``urllib.request``); no third-party deps. Mirrors a subset
of the TypeScript SDK (``@acp/sdk-ts``).

Auth: pass a bearer ``token`` — either a user session token (from
``POST /auth/login``) or an ``acp_``-prefixed API key (#83). It rides on every
request as ``Authorization: Bearer <token>``.

Example::

    from acp import AcpClient

    acp = AcpClient("https://api.reload.chat", token="acp_...")
    channels = acp.list_channels()
    acp.post_message("thread-id", "hello @iris")
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

__all__ = ["AcpClient", "AcpError"]


class AcpError(Exception):
    """Raised on a non-2xx response. Carries the HTTP ``status`` and parsed ``body``."""

    def __init__(self, status: int, message: str, body: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.body = body


class AcpClient:
    """A thin client over the agent-chat-platform REST API."""

    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token

    # -- internal --------------------------------------------------------
    def _request(self, method: str, path: str, body: Optional[dict] = None) -> Any:
        url = f"{self.base_url}{path}"
        data = None
        headers = {"Authorization": f"Bearer {self.token}"}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:  # noqa: S310 (trusted base_url)
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8") if exc.fp else ""
            parsed = json.loads(raw) if raw else None
            message = (
                parsed["error"]
                if isinstance(parsed, dict) and "error" in parsed
                else f"request failed: {exc.code}"
            )
            raise AcpError(exc.code, message, parsed) from exc

    # -- chat ------------------------------------------------------------
    def list_channels(self, include_archived: bool = False) -> Any:
        q = "?includeArchived=1" if include_archived else ""
        return self._request("GET", f"/channels{q}")

    def list_messages(self, thread_id: str, limit: Optional[int] = None) -> Any:
        q = f"?limit={limit}" if limit is not None else ""
        return self._request("GET", f"/threads/{urllib.parse.quote(thread_id)}/messages{q}")

    def post_message(self, thread_id: str, body: str) -> Any:
        return self._request(
            "POST", f"/threads/{urllib.parse.quote(thread_id)}/messages", {"body": body}
        )

    # -- tasks -----------------------------------------------------------
    def get_task(self, task_id: str) -> Any:
        return self._request("GET", f"/tasks/{urllib.parse.quote(task_id)}")

    def create_tasks_bulk(self, thread_id: str, items: list) -> Any:
        return self._request("POST", "/tasks/bulk", {"threadId": thread_id, "items": items})

    # -- runs ------------------------------------------------------------
    def run_diff(self, run_id: str) -> Any:
        return self._request("GET", f"/runs/{urllib.parse.quote(run_id)}/diff")

    def approve_run(self, run_id: str) -> Any:
        return self._request("POST", f"/runs/{urllib.parse.quote(run_id)}/approve")

    # -- memory ----------------------------------------------------------
    def memory_recall(self, q: str, limit: Optional[int] = None) -> Any:
        params = {"q": q}
        if limit is not None:
            params["limit"] = str(limit)
        return self._request("GET", f"/memory/recall?{urllib.parse.urlencode(params)}")

    # -- integrations ----------------------------------------------------
    def import_linear(self, thread_id: str) -> Any:
        return self._request("POST", "/integrations/linear/import", {"threadId": thread_id})

    def import_github(self, thread_id: str) -> Any:
        return self._request("POST", "/integrations/github/import", {"threadId": thread_id})

    # -- billing ---------------------------------------------------------
    def get_billing(self) -> Any:
        return self._request("GET", "/billing")


if __name__ == "__main__":  # pragma: no cover
    # Documented smoke: requires a live server + token via env. Not a test harness.
    import os

    base = os.environ.get("ACP_BASE_URL", "http://localhost:8080")
    token = os.environ.get("ACP_TOKEN", "")
    acp = AcpClient(base, token=token)
    print(acp.list_channels())
