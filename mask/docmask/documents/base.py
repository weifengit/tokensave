"""文档适配层协议。

一个适配器只做两件事：
1. `extract`：把文档拆成「文本单元」并记录位置（段落 / 幻灯片 / 单元格 / 整文件）；
2. `write`：把**按同样顺序**给出的脱敏文本写回一份新文档，保留原有版式。

位置记录（locator）用于回溯「第几段 / 第几页 / 哪个单元格」，不参与脱敏判断。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol, Sequence


@dataclass
class TextUnit:
    locator: str
    text: str
    ref: Any = None


@dataclass
class ExtractedDocument:
    path: str
    kind: str
    units: list[TextUnit] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n".join(unit.text for unit in self.units)

    def unit_texts(self) -> list[str]:
        return [unit.text for unit in self.units]


class DocumentAdapter(Protocol):
    kind: str
    suffixes: tuple[str, ...]

    def extract(self, path: Path) -> ExtractedDocument: ...

    def write(self, source: Path, target: Path, texts: Sequence[str]) -> Path: ...


class UnsupportedDocument(RuntimeError):
    """不支持的文件类型（本次只处理可编辑文档，不做 OCR）。"""
