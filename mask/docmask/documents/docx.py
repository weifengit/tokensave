"""docx：正文段落、表格单元格、页眉页脚。

写回策略：把整段文本放进段落的第一个 run，其余 run 清空。
这样能保住**段落级**结构（样式、编号、表格位置），代价是段内混排样式会被归一
（同一个段落里既有加粗又有关键词的场景比较少见，README 有明确说明）。
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Sequence

from .base import ExtractedDocument, TextUnit


def _iter_paragraphs(document):
    """产出 (locator, paragraph)，与 write 时的遍历顺序严格一致。"""
    for index, paragraph in enumerate(document.paragraphs):
        yield f"p[{index}]", paragraph
    for table_index, table in enumerate(document.tables):
        for row_index, row in enumerate(table.rows):
            for cell_index, cell in enumerate(row.cells):
                for paragraph_index, paragraph in enumerate(cell.paragraphs):
                    yield f"t[{table_index}].r[{row_index}].c[{cell_index}].p[{paragraph_index}]", paragraph
    for section_index, section in enumerate(document.sections):
        for part_name, part in (("header", section.header), ("footer", section.footer)):
            for paragraph_index, paragraph in enumerate(part.paragraphs):
                yield f"s{section_index}.{part_name}.p[{paragraph_index}]", paragraph


def _set_paragraph_text(paragraph, text: str) -> None:
    if paragraph.text == text:
        return
    runs = paragraph.runs
    if not runs:
        paragraph.add_run(text)
        return
    runs[0].text = text
    for run in runs[1:]:
        run.text = ""


class DocxAdapter:
    kind = "docx"
    suffixes = (".docx",)

    def extract(self, path: Path) -> ExtractedDocument:
        try:
            import docx  # python-docx
        except ImportError as error:
            raise RuntimeError("处理 docx 需要 python-docx：pip install python-docx") from error
        document = docx.Document(str(path))
        units: list[TextUnit] = []
        for locator, paragraph in _iter_paragraphs(document):
            text = paragraph.text
            if text.strip():
                units.append(TextUnit(locator=locator, text=text, ref=paragraph))
        return ExtractedDocument(path=str(path), kind=self.kind, units=units)

    def write(self, source: Path, target: Path, texts: Sequence[str]) -> Path:
        import docx

        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        document = docx.Document(str(target))
        paragraphs = [paragraph for _, paragraph in _iter_paragraphs(document) if paragraph.text.strip()]
        if len(paragraphs) != len(texts):
            raise RuntimeError(f"文本单元数量与文档不一致（{len(texts)} != {len(paragraphs)}），为避免写坏文档已中止")
        for paragraph, text in zip(paragraphs, texts):
            _set_paragraph_text(paragraph, text)
        document.save(str(target))
        return target
