"""识别结果缓存（SQLite，本地文件）。

为什么要缓存：GLiNER 在 CPU 上跑一份长文档要几秒到几十秒，
而「同一份文档 + 同一套配置」的识别结果是确定的。
缓存键 = 模型/阈值/标签/文本的哈希，因此改了配置自然失效，不会串结果。
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from .config import expand_path


def fingerprint(*parts: Any) -> str:
    digest = hashlib.sha256()
    for part in parts:
        digest.update(str(part).encode("utf-8"))
        digest.update(b"\x00")
    return digest.hexdigest()


class DetectionCache:
    def __init__(self, path: str | Path, ttl_hours: float = 168.0):
        self.path = expand_path(path)
        self._ttl_seconds = max(0.0, float(ttl_hours)) * 3600.0
        self._lock = threading.RLock()
        self._conn: sqlite3.Connection | None = None

    def _connect(self) -> sqlite3.Connection:
        if self._conn is None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(str(self.path), timeout=10, check_same_thread=False)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute(
                "CREATE TABLE IF NOT EXISTS detections ("
                " key TEXT PRIMARY KEY,"
                " payload TEXT NOT NULL,"
                " created REAL NOT NULL"
                ")"
            )
            conn.commit()
            self._conn = conn
        return self._conn

    def get(self, key: str) -> list[dict[str, Any]] | None:
        with self._lock:
            try:
                conn = self._connect()
                row = conn.execute("SELECT payload, created FROM detections WHERE key = ?", (key,)).fetchone()
            except sqlite3.Error:
                return None
            if row is None:
                return None
            payload, created = row
            if self._ttl_seconds and time.time() - float(created) > self._ttl_seconds:
                return None
            try:
                data = json.loads(payload)
            except ValueError:
                return None
            return data if isinstance(data, list) else None

    def put(self, key: str, items: list[dict[str, Any]]) -> None:
        with self._lock:
            try:
                conn = self._connect()
                conn.execute(
                    "INSERT OR REPLACE INTO detections(key, payload, created) VALUES (?, ?, ?)",
                    (key, json.dumps(items, ensure_ascii=False), time.time()),
                )
                conn.commit()
            except sqlite3.Error:
                # 缓存失败不能影响主流程
                return

    def clear(self) -> None:
        with self._lock:
            try:
                conn = self._connect()
                conn.execute("DELETE FROM detections")
                conn.commit()
            except sqlite3.Error:
                return

    def close(self) -> None:
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None
