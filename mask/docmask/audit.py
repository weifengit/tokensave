"""脱敏后的轻量漏检检查。

原则：**只用便宜的手段**（正则 + 固定词表 + 占位符完整性），不为了校验再跑一次 GLiNER。
发现疑似残留时返回告警文本（调用方负责打印/记录），而不是静默放过。
"""

from __future__ import annotations

from typing import Iterable

from .config import Config
from .detection.base import filter_ignored
from .detection.glossary_detector import GlossaryDetector
from .detection.regex_detector import RegexDetector
from .models import Detection
from .placeholder import parse_placeholder
from .session import MaskSession, normalize_key


def _snippet(text: str) -> str:
    """告警里只露头尾，避免把疑似明文整条写进日志。"""
    value = text.strip()
    if len(value) <= 6:
        return value[:2] + "***"
    return f"{value[:3]}***{value[-2:]}"


def _summarize(items: list[Detection]) -> str:
    seen: set[str] = set()
    parts: list[str] = []
    for item in items:
        key = f"{item.entity_type}:{item.text}"
        if key in seen:
            continue
        seen.add(key)
        parts.append(f"{item.entity_type}/{_snippet(item.text)}")
        if len(parts) >= 5:
            break
    return "、".join(parts)


def audit_masked_text(masked: str, config: Config, session: MaskSession | None = None) -> list[str]:
    warnings: list[str] = []
    ignore = config.ignore_terms()

    residual: list[Detection] = []
    if config.detector_enabled("regex"):
        residual.extend(RegexDetector().detect(masked, config))
    if config.detector_enabled("glossary"):
        residual.extend(GlossaryDetector().detect(masked, config))
    residual = filter_ignored(residual, ignore)
    if residual:
        warnings.append(
            f"漏检告警：脱敏文本里仍有 {len(residual)} 处疑似敏感内容（{_summarize(residual)}），"
            "请检查规则/词表或调低 GLiNER 阈值。"
        )

    # 占位符自检：格式合法、且能在当前会话映射表里查到。
    if session is not None:
        unknown: list[str] = []
        for token in _iter_placeholder_tokens(masked):
            parsed = parse_placeholder(token)
            if parsed is None:
                unknown.append(token)
                continue
            if session.original_of(token) is None:
                unknown.append(token)
        if unknown:
            warnings.append(f"占位符告警：{len(unknown)} 个占位符不在当前会话映射表中（{', '.join(unknown[:5])}）。")

        # 已知明文反向检查：映射表里的原文不该再出现在脱敏结果里。
        lowered = normalize_key(masked)
        leaked = [
            _snippet(record.original)
            for record in session.entities()
            if len(record.original.strip()) >= 2 and normalize_key(record.original) in lowered
        ]
        if leaked:
            warnings.append(f"漏检告警：会话映射表里的 {len(leaked)} 个实体仍以明文出现（{'、'.join(leaked[:5])}）。")

    return warnings


def _iter_placeholder_tokens(text: str) -> Iterable[str]:
    import re

    for match in re.finditer(r"<<[^<>]{1,80}>>", text):
        yield match.group(0)
