"""Service configuration, read once from the environment at start-up."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


class ConfigError(ValueError):
    """A setting is missing or invalid; the message says which and how to fix it."""


@dataclass(frozen=True)
class Config:
    token: str
    data_dir: Path
    host: str = "127.0.0.1"
    port: int = 8765
    #: largest PDF accepted, in bytes
    max_bytes: int = 50 * 1024 * 1024
    #: most pages a document may have
    max_pages: int = 500
    #: indexing jobs running at once (each is a child process)
    concurrency: int = 2
    #: a job that runs longer is stopped and fails with TIMEOUT
    job_timeout_s: int = 1800
    #: pages one read may return
    max_pages_per_read: int = 20


def _int(name: str, default: int, lo: int, hi: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer, got {raw!r}") from exc
    if not lo <= value <= hi:
        raise ConfigError(f"{name} must be between {lo} and {hi}, got {value}")
    return value


def load_config() -> Config:
    token = os.environ.get("FLOWAID_PAGEINDEX_TOKEN", "")
    if len(token) < 32:
        raise ConfigError(
            "FLOWAID_PAGEINDEX_TOKEN must be set to a random string of at least 32 characters "
            "(the same value the FlowAId API and worker use), e.g. `openssl rand -hex 32`"
        )
    data_dir = Path(os.environ.get("FLOWAID_PAGEINDEX_DATA_DIR", "./.flowaid/pageindex")).resolve()
    return Config(
        token=token,
        data_dir=data_dir,
        host=os.environ.get("FLOWAID_PAGEINDEX_HOST", "127.0.0.1"),
        port=_int("FLOWAID_PAGEINDEX_PORT", 8765, 1, 65535),
        max_bytes=_int("FLOWAID_PAGEINDEX_MAX_BYTES", 50 * 1024 * 1024, 1024, 512 * 1024 * 1024),
        max_pages=_int("FLOWAID_PAGEINDEX_MAX_PAGES", 500, 1, 5000),
        concurrency=_int("FLOWAID_PAGEINDEX_CONCURRENCY", 2, 1, 16),
        job_timeout_s=_int("FLOWAID_PAGEINDEX_JOB_TIMEOUT_S", 1800, 10, 24 * 3600),
    )
