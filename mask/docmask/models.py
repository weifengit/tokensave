"""跨模块共享的数据结构。

只放「数据」，不放流程：识别器、会话、编排层都依赖这里，反向依赖禁止。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Detection:
    """识别器输出的一个敏感片段（偏移相对**当次输入文本**）。"""

    start: int
    end: int
    text: str
    entity_type: str
    detector: str
    score: float = 1.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "start": self.start,
            "end": self.end,
            "text": self.text,
            "type": self.entity_type,
            "detector": self.detector,
            "score": round(float(self.score), 4),
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "Detection":
        return cls(
            start=int(raw["start"]),
            end=int(raw["end"]),
            text=str(raw["text"]),
            entity_type=str(raw["type"]),
            detector=str(raw.get("detector", "cache")),
            score=float(raw.get("score", 1.0)),
        )


@dataclass
class MaskHit:
    """一次脱敏命中：明文 → 占位符的对应关系（可回传给业务脚本做审计）。"""

    placeholder: str
    entity_type: str
    original: str
    detector: str
    reused: bool = False
    start: int = -1
    end: int = -1

    def to_dict(self) -> dict[str, Any]:
        return {
            "placeholder": self.placeholder,
            "type": self.entity_type,
            "original": self.original,
            "detector": self.detector,
            "reused": self.reused,
            "start": self.start,
            "end": self.end,
        }


@dataclass
class MaskResult:
    """正向脱敏结果。`text` 才是允许发给 DeepSeek Harness 的文本。"""

    session_id: str
    text: str
    hits: list[MaskHit] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    elapsed_ms: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "text": self.text,
            "hits": [h.to_dict() for h in self.hits],
            "warnings": list(self.warnings),
            "elapsed_ms": round(self.elapsed_ms, 2),
        }


@dataclass
class UnmaskResult:
    """反向还原结果。`unknown` 是映射表里查不到的占位符（保持原样）。"""

    session_id: str
    text: str
    restored: int = 0
    unknown: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "text": self.text,
            "restored": self.restored,
            "unknown": list(self.unknown),
            "warnings": list(self.warnings),
        }


@dataclass
class DocumentMaskResult:
    """文档脱敏结果。`masked_text` 是所有文本单元的拼接（供核对/送给模型）。"""

    source: str
    output: str | None
    kind: str
    unit_count: int
    masked_text: str
    hits: list[MaskHit] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    dry_run: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "output": self.output,
            "kind": self.kind,
            "unit_count": self.unit_count,
            "masked_text": self.masked_text,
            "hits": [h.to_dict() for h in self.hits],
            "warnings": list(self.warnings),
            "dry_run": self.dry_run,
        }
