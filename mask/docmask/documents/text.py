"""纯文本类：markdown 与 txt（整文件一个文本单元）。

编码处理：读取依次尝试 utf-8 / gb18030 / latin-1，写回统一 utf-8（避免静默乱码）。
"""

from __future__ import annotations

from pathlib import Path
from typing import Sequence

from .base import ExtractedDocument, TextUnit

_ENCODINGS = ("utf-8", "gb18030", "latin-1")


def read_text(path: Path) -> str:
    for encoding in _ENCODINGS:
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return path.read_text(encoding="utf-8", errors="replace")


class _PlainTextAdapter:
    kind = "text"
    suffixes: tuple[str, ...] = (".txt",)

    def extract(self, path: Path) -> ExtractedDocument:
        text = read_text(path)
        units = [TextUnit(locator="whole", text=text)] if text else []
        return ExtractedDocument(path=str(path), kind=self.kind, units=units)

    def write(self, source: Path, target: Path, texts: Sequence[str]) -> Path:
        target.parent.mkdir(parents=True, exist_ok=True)
        content = texts[0] if texts else ""
        target.write_text(content, encoding="utf-8")
        return target


class MarkdownAdapter(_PlainTextAdapter):
    kind = "markdown"
    suffixes = (".md", ".markdown")


class TextAdapter(_PlainTextAdapter):
    kind = "text"
    suffixes = (".txt", ".text", ".log")
