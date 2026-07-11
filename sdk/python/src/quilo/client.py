"""Synchronous Quilo API client."""

from __future__ import annotations

import json
import os
import time
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Iterator, Mapping, Sequence

from ._http import encode_multipart, query_string, request
from .exceptions import QuiloError, QuiloTimeoutError
from .models import Job, JobEvent


class QuiloClient:
    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str | None = None,
        timeout: float = 60.0,
    ) -> None:
        self.api_key = str(api_key or os.getenv("QUILO_ACCESS_TOKEN") or "").strip()
        self.base_url = str(base_url or os.getenv("QUILO_BASE_URL") or "https://quilolab.com").rstrip("/")
        self.timeout = timeout
        if not self.base_url.startswith(("https://", "http://127.0.0.1", "http://localhost")):
            raise ValueError("Quilo base_url must use HTTPS except for localhost development")
        self.jobs = JobsResource(self)
        self.pdf = PdfResource(self)
        self.reports = ReportsResource(self)
        self.conversions = ConversionsResource(self)
        self.studios = StudiosResource(self)
        self.file_chat = FileChatResource(self)
        self.knowledge = KnowledgeResource(self)
        self.community = CommunityResource(self)

    def _headers(self, *, auth: bool = True, idempotency_key: str | None = None) -> dict[str, str]:
        headers = {"Accept": "application/json", "User-Agent": "quilo-python/0.1.0"}
        if auth:
            if not self.api_key:
                raise QuiloError("Quilo API key is required. Set QUILO_ACCESS_TOKEN or pass api_key.")
            headers["Authorization"] = f"Bearer {self.api_key}"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    def _json(self, path: str, *, method: str = "GET", auth: bool = True) -> dict[str, Any]:
        response = request(
            self.base_url + path,
            method=method,
            headers=self._headers(auth=auth),
            timeout=self.timeout,
        )
        return response.json()

    def _json_body(self, path: str, body: Mapping[str, Any] | None = None, *, method: str = "POST") -> dict[str, Any]:
        payload = json.dumps(dict(body or {}), ensure_ascii=False).encode("utf-8")
        headers = self._headers()
        headers["Content-Type"] = "application/json"
        response = request(
            self.base_url + path,
            method=method,
            headers=headers,
            body=payload,
            timeout=self.timeout,
        )
        return response.json()

    def _multipart(
        self,
        path: str,
        *,
        fields: dict[str, Any],
        files: Sequence[tuple[str, str | os.PathLike[str], str | None]],
        idempotency_key: str | None = None,
    ) -> Any:
        body, content_type = encode_multipart(fields, files)
        headers = self._headers(idempotency_key=idempotency_key)
        headers["Content-Type"] = content_type
        response = request(
            self.base_url + path,
            method="POST",
            headers=headers,
            body=body,
            timeout=self.timeout,
        )
        if "application/json" in str(response.headers.get("Content-Type") or ""):
            return response.json()
        return response

    def account(self) -> dict[str, Any]:
        return self._json("/api/v1/account")

    def features(self, query: str | None = None) -> list[dict[str, Any]]:
        suffix = f"?{query_string({'q': query})}" if query else ""
        return list(self._json(f"/api/catalog{suffix}", auth=False).get("features") or [])


class JobsResource:
    def __init__(self, client: QuiloClient) -> None:
        self._client = client

    def list(self) -> list[Job]:
        body = self._client._json("/api/v1/jobs")
        return [Job.from_dict(item) for item in body.get("jobs") or []]

    def retrieve(self, job_id: str) -> Job:
        body = self._client._json(f"/api/v1/jobs/{job_id}")
        return Job.from_dict(body.get("job") or body)

    def abort(self, job_id: str) -> dict[str, Any]:
        return self._client._json(f"/api/v1/jobs/{job_id}/abort", method="POST")

    def wait(self, job_id: str, *, timeout: float = 600.0, poll_interval: float = 2.0) -> Job:
        deadline = time.monotonic() + timeout
        while True:
            job = self.retrieve(job_id)
            if job.terminal:
                if job.status == "failed":
                    raise QuiloError(job.error or f"Quilo job {job.id} failed")
                return job
            if time.monotonic() >= deadline:
                raise QuiloTimeoutError(f"Timed out waiting for Quilo job {job_id}")
            time.sleep(max(0.1, poll_interval))

    def events(self, job_id: str) -> Iterator[JobEvent]:
        req = urllib.request.Request(
            self._client.base_url + f"/api/v1/jobs/{job_id}/events",
            headers={**self._client._headers(), "Accept": "text/event-stream"},
        )
        with urllib.request.urlopen(req, timeout=self._client.timeout) as response:
            event = "message"
            data: list[str] = []
            for raw_line in response:
                line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
                if not line:
                    if data:
                        value = "\n".join(data)
                        try:
                            parsed: Any = json.loads(value)
                        except json.JSONDecodeError:
                            parsed = value
                        yield JobEvent(event=event, data=parsed)
                    event, data = "message", []
                elif line.startswith("event:"):
                    event = line[6:].strip()
                elif line.startswith("data:"):
                    data.append(line[5:].strip())

    def download(self, job_id: str, destination: str | os.PathLike[str], *, file_index: int | None = None) -> Path:
        suffix = f"?file={file_index}" if file_index is not None else ""
        response = request(
            self._client.base_url + f"/api/v1/jobs/{job_id}/download{suffix}",
            headers=self._client._headers(),
            timeout=self._client.timeout,
        )
        output = Path(destination).expanduser()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(response.body)
        return output.resolve()


class PdfResource:
    def __init__(self, client: QuiloClient) -> None:
        self._client = client

    def estimate(self, file: str | os.PathLike[str], *, mode: str = "auto", model: str = "claude-sonnet-5") -> dict[str, Any]:
        return self._client._multipart(
            "/api/v1/pdf-translations/estimate",
            fields={"mode": mode, "model": model},
            files=[("pdf", file, "application/pdf")],
        )

    def translate(
        self,
        files: str | os.PathLike[str] | Sequence[str | os.PathLike[str]],
        *,
        mode: str = "auto",
        model: str = "claude-sonnet-5",
        restore_only: bool = False,
        chart_redraw: bool = False,
        background: bool = False,
        notify_email: bool = False,
        idempotency_key: str | None = None,
    ) -> Job:
        paths = [files] if isinstance(files, (str, os.PathLike)) else list(files)
        body = self._client._multipart(
            "/api/v1/pdf-translations",
            fields={
                "mode": mode,
                "model": model,
                "restoreOnly": restore_only,
                "chartRedraw": chart_redraw,
                "backgroundMode": background,
                "notifyEmail": notify_email,
            },
            files=[("pdf", path, "application/pdf") for path in paths],
            idempotency_key=idempotency_key or str(uuid.uuid4()),
        )
        return Job.from_dict(body)


class ReportsResource:
    def __init__(self, client: QuiloClient) -> None:
        self._client = client

    def create(
        self,
        *,
        type: str,
        format: str = "docx",
        model: str | None = None,
        fields: Mapping[str, Any] | None = None,
        files: Mapping[str, str | os.PathLike[str] | Sequence[str | os.PathLike[str]]] | None = None,
        idempotency_key: str | None = None,
    ) -> Job:
        form = {"type": type, "format": format, **dict(fields or {})}
        if model:
            form["model"] = model
        uploads: list[tuple[str, str | os.PathLike[str], str | None]] = []
        for field, value in (files or {}).items():
            paths = [value] if isinstance(value, (str, os.PathLike)) else list(value)
            uploads.extend((field, path, None) for path in paths)
        body = self._client._multipart(
            "/api/v1/reports",
            fields=form,
            files=uploads,
            idempotency_key=idempotency_key or str(uuid.uuid4()),
        )
        return Job.from_dict(body)


class ConversionsResource:
    def __init__(self, client: QuiloClient) -> None:
        self._client = client

    def docx_to_hwpx(self, file: str | os.PathLike[str], destination: str | os.PathLike[str]) -> Path:
        response = self._client._multipart(
            "/api/v1/conversions/docx-to-hwpx",
            fields={},
            files=[("docx", file, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")],
        )
        if not hasattr(response, "body"):
            raise QuiloError("Quilo conversion returned JSON instead of an HWPX file")
        output = Path(destination).expanduser()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(response.body)
        return output.resolve()


class StudiosResource:
    def __init__(self, client: QuiloClient) -> None:
        self._client = client

    def vibe_config(self) -> dict[str, Any]:
        return self._client._json("/api/v1/studios/vibe/config")

    def generate_vibe(self, idea: str, **options: Any) -> dict[str, Any]:
        return self._client._json_body("/api/v1/studios/vibe/generate", {"idea": idea, **options})

    def refine_vibe(self, message: str, result: Mapping[str, Any], *, history: Sequence[Mapping[str, Any]] | None = None, model: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"message": message, "result": dict(result), "history": list(history or [])}
        if model:
            body["model"] = model
        return self._client._json_body("/api/v1/studios/vibe/refine", body)

    def generate_physics(self, topic: str, **options: Any) -> dict[str, Any]:
        return self._client._json_body("/api/v1/studios/physics/generate", {"topic": topic, **options})


class FileChatResource:
    def __init__(self, client: QuiloClient) -> None:
        self._client = client

    def access(self) -> dict[str, Any]:
        return self._client._json("/api/v1/file-chat/access")

    def message(
        self,
        message: str,
        *,
        files: Sequence[str | os.PathLike[str]] | None = None,
        history: Sequence[Mapping[str, Any]] | None = None,
        model: str | None = None,
    ) -> str:
        fields: dict[str, Any] = {"message": message, "messages": list(history or [])}
        if model:
            fields["model"] = model
        body, content_type = encode_multipart(
            fields,
            [("files", file, None) for file in files or []],
        )
        headers = self._client._headers()
        headers["Content-Type"] = content_type
        headers["Accept"] = "text/plain"
        response = request(
            self._client.base_url + "/api/v1/file-chat/messages",
            method="POST",
            headers=headers,
            body=body,
            timeout=self._client.timeout,
        )
        return response.body.decode("utf-8", errors="replace")


class KnowledgeResource:
    def __init__(self, client: QuiloClient) -> None:
        self._client = client

    def lab(self) -> list[dict[str, Any]]:
        return list(self._client._json("/api/v1/knowledge/lab").get("entries") or [])

    def lab_entry(self, entry_id: str) -> dict[str, Any]:
        return self._client._json(f"/api/v1/knowledge/lab/{entry_id}")


class CommunityResource:
    def __init__(self, client: QuiloClient) -> None:
        self._client = client

    def posts(self, *, category: str | None = None) -> list[dict[str, Any]]:
        suffix = f"?{query_string({'category': category})}" if category else ""
        return list(self._client._json(f"/api/v1/community/posts{suffix}").get("posts") or [])

    def create_post(self, title: str, body: str, *, category: str = "suggestion") -> dict[str, Any]:
        return self._client._json_body("/api/v1/community/posts", {"title": title, "body": body, "category": category})

    def comments(self, post_id: str) -> list[dict[str, Any]]:
        return list(self._client._json(f"/api/v1/community/posts/{post_id}/comments").get("comments") or [])

    def create_comment(self, post_id: str, body: str) -> dict[str, Any]:
        return self._client._json_body(f"/api/v1/community/posts/{post_id}/comments", {"body": body})

    def vote(self, post_id: str) -> dict[str, Any]:
        return self._client._json_body(f"/api/v1/community/posts/{post_id}/vote")
