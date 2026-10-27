"""会话映射表：占位符分配的唯一权威，会话之间严格隔离。

R1（风险点）：映射表 = 明文 ↔ 占位符对照。它**只能留在本地进程/加密文件**里。
任何把 `MaskSession.to_dict()` 拼进 DSH 请求体、日志或 prompt 的写法都会让脱敏失效。
本模块不引入网络能力，也不依赖 DSH，就是为了让这条边界一眼可查。
"""

from __future__ import annotations

import threading
import time
import unicodedata
import uuid
from dataclasses import dataclass, field
from typing import Any, Iterable

from .placeholder import format_placeholder, normalize_type, parse_placeholder


def normalize_key(text: str) -> str:
    """实体比对键：全半角归一 + 折叠空白 + 忽略英文大小写。

    “Ａcme  Inc.” 与 “acme inc.” 视为同一实体，复用同一个占位符。
    """
    folded = unicodedata.normalize("NFKC", str(text)).strip()
    folded = " ".join(folded.split())
    return folded.casefold()


@dataclass
class EntityRecord:
    """一条映射：同一会话内同一 (类型, 归一化文本) 只对应一个占位符。"""

    placeholder: str
    entity_type: str
    original: str
    detector: str
    mentions: int = 1
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "placeholder": self.placeholder,
            "type": self.entity_type,
            "original": self.original,
            "detector": self.detector,
            "mentions": self.mentions,
            "created_at": self.created_at,
        }


class MaskSession:
    """一个对话/文档任务一份映射表；实例之间没有任何共享状态。"""

    def __init__(self, session_id: str, records: Iterable[EntityRecord] = (), counters: dict[str, int] | None = None):
        self.session_id = session_id
        self.created_at = time.time()
        self._lock = threading.RLock()
        self._records: dict[tuple[str, str], EntityRecord] = {}
        self._by_placeholder: dict[str, EntityRecord] = {}
        self._counters: dict[str, int] = dict(counters or {})
        for record in records:
            self._index(record)

    # —— 写入 ——

    def _index(self, record: EntityRecord) -> None:
        parsed = parse_placeholder(record.placeholder)
        if parsed is None or parsed[0] != record.entity_type:
            raise ValueError(f"映射记录与占位符不一致：{record.placeholder} / {record.entity_type}")
        self._records[(record.entity_type, normalize_key(record.original))] = record
        self._by_placeholder[record.placeholder] = record
        self._counters[record.entity_type] = max(self._counters.get(record.entity_type, 0), parsed[1])

    def assign(self, entity_type: str, original: str, detector: str) -> tuple[str, bool]:
        """分配或复用占位符，返回 (占位符, 是否复用)。

        同一实体的每一次出现都走这里，因此「同一会话内固定映射」由类型系统之外的
        这一处保证——不要在别的模块里自己拼 `<<TYPE_ID>>`。
        """
        entity_type = normalize_type(entity_type)
        key = (entity_type, normalize_key(original))
        with self._lock:
            existing = self._records.get(key)
            if existing is not None:
                existing.mentions += 1
                return existing.placeholder, True

            index = self._counters.get(entity_type, 0) + 1
            self._counters[entity_type] = index
            record = EntityRecord(
                placeholder=format_placeholder(entity_type, index),
                entity_type=entity_type,
                original=original,
                detector=detector,
            )
            self._records[key] = record
            self._by_placeholder[record.placeholder] = record
            return record.placeholder, False

    # —— 读取 ——

    def original_of(self, placeholder: str) -> str | None:
        with self._lock:
            record = self._by_placeholder.get(placeholder)
            return record.original if record else None

    def record_of(self, placeholder: str) -> EntityRecord | None:
        with self._lock:
            return self._by_placeholder.get(placeholder)

    def entities(self) -> list[EntityRecord]:
        with self._lock:
            return list(self._by_placeholder.values())

    def originals(self) -> list[str]:
        with self._lock:
            return [r.original for r in self._by_placeholder.values()]

    def placeholder_count(self) -> int:
        with self._lock:
            return len(self._by_placeholder)

    # —— 生命周期 ——

    def clear(self) -> None:
        """清空映射（保留 session_id，后续分配从 1 重新开始）。"""
        with self._lock:
            self._records.clear()
            self._by_placeholder.clear()
            self._counters.clear()

    def to_dict(self) -> dict[str, Any]:
        """导出明文映射。R1：只能写本地加密文件，禁止随请求上传。"""
        with self._lock:
            return {
                "session_id": self.session_id,
                "created_at": self.created_at,
                "counters": dict(self._counters),
                "entities": [r.to_dict() for r in self._by_placeholder.values()],
            }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "MaskSession":
        records = [
            EntityRecord(
                placeholder=str(item["placeholder"]),
                entity_type=str(item["type"]),
                original=str(item["original"]),
                detector=str(item.get("detector", "imported")),
                mentions=int(item.get("mentions", 1)),
                created_at=float(item.get("created_at", time.time())),
            )
            for item in raw.get("entities", [])
        ]
        session = cls(str(raw["session_id"]), records, raw.get("counters") or None)
        if raw.get("created_at"):
            session.created_at = float(raw["created_at"])
        return session


class SessionRegistry:
    """会话容器：新建 / 取用 / 清空 / 丢弃；不同 session_id 之间互不可见。"""

    def __init__(self, default_prefix: str = "sess"):
        self._sessions: dict[str, MaskSession] = {}
        self._lock = threading.RLock()
        self._default_prefix = default_prefix

    def new(self, session_id: str | None = None) -> MaskSession:
        sid = session_id or f"{self._default_prefix}-{uuid.uuid4().hex[:12]}"
        with self._lock:
            if sid in self._sessions:
                raise ValueError(f"会话已存在：{sid}（要重置请先 clear/drop）")
            session = MaskSession(sid)
            self._sessions[sid] = session
            return session

    def get(self, session_id: str) -> MaskSession | None:
        with self._lock:
            return self._sessions.get(session_id)

    def get_or_create(self, session_id: str) -> MaskSession:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                session = MaskSession(session_id)
                self._sessions[session_id] = session
            return session

    def attach(self, session: MaskSession) -> MaskSession:
        with self._lock:
            self._sessions[session.session_id] = session
            return session

    def clear(self, session_id: str) -> bool:
        session = self.get(session_id)
        if session is None:
            return False
        session.clear()
        return True

    def drop(self, session_id: str) -> bool:
        with self._lock:
            return self._sessions.pop(session_id, None) is not None

    def ids(self) -> list[str]:
        with self._lock:
            return list(self._sessions)
