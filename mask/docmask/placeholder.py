"""占位符的唯一编解码实现：`<<TYPE_ID>>`（如 `<<PER_1>>`、`<<PROJECT_3>>`）。

被会话映射表、正向脱敏、反向还原、漏检审计共同依赖；
格式改这里一处即可，其他模块禁止自己拼字符串。
"""

from __future__ import annotations

import re
from typing import Iterator

# 允许占位符内部有空格（模型有时会写成 `<< PER_1 >>`），还原时一并兼容。
PATTERN = r"<<\s*([A-Z][A-Z0-9_]*)_(\d+)\s*>>"

_PLACEHOLDER_RE = re.compile(PATTERN)
_TYPE_UNSAFE_RE = re.compile(r"[^A-Z0-9_]+")

# 识别器/会话原样保留的占位符片段：脱敏时不能把它当成明文再脱一次。
MAX_TYPE_LEN = 32


def normalize_type(raw: str) -> str:
    """把任意类型名收敛成占位符可用的 TYPE（大写、下划线、字母开头）。"""
    text = _TYPE_UNSAFE_RE.sub("_", str(raw or "").strip().upper()).strip("_")
    if not text:
        return "ENTITY"
    if text[0].isdigit():
        text = f"T_{text}"
    return text[:MAX_TYPE_LEN]


def format_placeholder(entity_type: str, index: int) -> str:
    return f"<<{normalize_type(entity_type)}_{int(index)}>>"


def parse_placeholder(text: str) -> tuple[str, int] | None:
    """整串解析；不是占位符返回 None。"""
    match = _PLACEHOLDER_RE.fullmatch(text)
    if match is None:
        return None
    return match.group(1), int(match.group(2))


def iter_placeholders(text: str) -> Iterator[tuple[int, int, str, int]]:
    """遍历文本中的占位符，产出 (start, end, type, id)。"""
    for match in _PLACEHOLDER_RE.finditer(text):
        yield match.start(), match.end(), match.group(1), int(match.group(2))


def contains_placeholder(text: str) -> bool:
    return _PLACEHOLDER_RE.search(text) is not None
