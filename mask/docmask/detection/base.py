"""识别器协议 + 重叠消解。

三个识别器（regex / glossary / gliner）都只做一件事：给定文本，产出 Detection 列表。
谁先谁后、同一片段冲突时听谁的，统一由本模块的优先级表决定（与需求一致：
先正则、再词表、最后 GLiNER）。
"""

from __future__ import annotations

from typing import Iterable, Protocol, Sequence

from ..config import Config
from ..models import Detection

# 数值越大越优先；正则与自定义固定词都优先于语义识别。
PRIORITY: dict[str, int] = {
    "glossary": 30,
    "regex": 20,
    "gliner": 10,
    "cache": 10,
    "session-memory": 0,
}


class Detector(Protocol):
    """识别器最小接口。实现方只需保证 detect 不改动入参。"""

    name: str

    def detect(self, text: str, config: Config, session: object | None = None) -> list[Detection]: ...


class DetectorUnavailable(RuntimeError):
    """识别器不可用（例如 GLiNER 依赖缺失/模型文件不存在）。"""

    def __init__(self, detector: str, reason: str):
        super().__init__(f"{detector} 不可用：{reason}")
        self.detector = detector
        self.reason = reason


def resolve_overlaps(detections: Iterable[Detection]) -> list[Detection]:
    """同一段文本只保留一个识别结果：先按开始位置，再按优先级、再按长度。"""
    ordered = sorted(
        detections,
        key=lambda item: (item.start, -PRIORITY.get(item.detector, 0), -(item.end - item.start)),
    )
    kept: list[Detection] = []
    last_end = -1
    for detection in ordered:
        if detection.start < last_end:
            continue
        kept.append(detection)
        last_end = detection.end
    return kept


def filter_ignored(detections: Sequence[Detection], ignore: set[str]) -> list[Detection]:
    """白名单过滤：命中白名单的片段原样保留。"""
    if not ignore:
        return list(detections)
    from ..session import normalize_key

    return [item for item in detections if normalize_key(item.text) not in ignore]
