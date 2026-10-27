"""自定义固定词表识别：把「已知一定敏感」的词一次性钉死。

两条来源（都在本地 JSON 里，改完下一次调用即生效）：
- 基础配置 `types.custom[].terms / aliases / words`
- 外部词表文件（默认 `config/glossary.json`，形如 {"PROJECT": ["天枢计划", ...]}）
"""

from __future__ import annotations

import re

from ..config import Config
from ..models import Detection
from ..placeholder import normalize_type
from ..session import normalize_key


def _boundary_pattern(term: str, case_sensitive: bool) -> re.Pattern[str]:
    pattern = re.escape(term)
    # ASCII 词加边界，避免 "Acme" 命中 "AcmeCorp" 的内部；CJK 没有词边界概念，直接匹配。
    if term[:1].isascii() and term[:1].isalnum():
        pattern = rf"(?<![A-Za-z0-9_]){pattern}"
    if term[-1:].isascii() and term[-1:].isalnum():
        pattern = rf"{pattern}(?![A-Za-z0-9_])"
    return re.compile(pattern, 0 if case_sensitive else re.IGNORECASE)


class GlossaryDetector:
    name = "glossary"

    def detect(self, text: str, config: Config, session: object | None = None) -> list[Detection]:
        if not text:
            return []
        case_sensitive = config.glossary_case_sensitive()
        detections: list[Detection] = []
        seen: set[str] = set()
        for entity_type, term in config.glossary_terms():
            # 同一实体只保留一次（内联词表与外部词表可能重复）。
            key = f"{entity_type}|{normalize_key(term)}"
            if key in seen:
                continue
            seen.add(key)
            for match in _boundary_pattern(term, case_sensitive).finditer(text):
                detections.append(
                    Detection(
                        start=match.start(),
                        end=match.end(),
                        text=match.group(0),
                        entity_type=normalize_type(entity_type),
                        detector="glossary",
                        score=1.0,
                    )
                )
        return detections
