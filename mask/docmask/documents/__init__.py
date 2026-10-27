"""文档适配器注册表：按扩展名选实现，新增格式只改这里。"""

from __future__ import annotations

from pathlib import Path

from .base import DocumentAdapter, ExtractedDocument, TextUnit, UnsupportedDocument
from .docx import DocxAdapter
from .pptx import PptxAdapter
from .text import MarkdownAdapter, TextAdapter, read_text
from .xlsx import XlsxAdapter

_ADAPTERS: tuple[DocumentAdapter, ...] = (
    DocxAdapter(),
    PptxAdapter(),
    XlsxAdapter(),
    MarkdownAdapter(),
    TextAdapter(),
)


def supported_suffixes() -> tuple[str, ...]:
    suffixes: list[str] = []
    for adapter in _ADAPTERS:
        suffixes.extend(adapter.suffixes)
    return tuple(sorted(set(suffixes)))


def adapter_for(path: str | Path) -> DocumentAdapter:
    suffix = Path(path).suffix.lower()
    for adapter in _ADAPTERS:
        if suffix in adapter.suffixes:
            return adapter
    raise UnsupportedDocument(
        f"不支持的文件类型：{suffix or '（无扩展名）'}；可处理：{', '.join(supported_suffixes())}"
        "（本次不做 OCR，图片/扫描件请先转成可编辑文档）"
    )


__all__ = [
    "DocumentAdapter",
    "ExtractedDocument",
    "TextUnit",
    "UnsupportedDocument",
    "adapter_for",
    "read_text",
    "supported_suffixes",
]
