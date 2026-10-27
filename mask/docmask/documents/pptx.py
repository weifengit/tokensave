"""pptx：每页的文本框段落与表格单元格段落。

写回策略与 docx 相同：整段文本放进第一个 run，保住段落结构（占位符、层级、版式）。
母版/备注页不处理——它们通常不含业务敏感信息，且改动风险大于收益。
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Sequence

from .base import ExtractedDocument, TextUnit


def _iter_paragraphs(presentation):
    for slide_index, slide in enumerate(presentation.slides, start=1):
        for shape_index, shape in enumerate(slide.shapes):
            if getattr(shape, "has_text_frame", False):
                for paragraph_index, paragraph in enumerate(shape.text_frame.paragraphs):
                    yield f"slide[{slide_index}].shape[{shape_index}].p[{paragraph_index}]", paragraph
            if getattr(shape, "has_table", False):
                table = shape.table
                for row_index, row in enumerate(table.rows):
                    for cell_index, cell in enumerate(row.cells):
                        for paragraph_index, paragraph in enumerate(cell.text_frame.paragraphs):
                            yield (
                                f"slide[{slide_index}].table[{shape_index}].r[{row_index}]"
                                f".c[{cell_index}].p[{paragraph_index}]",
                                paragraph,
                            )


def _set_paragraph_text(paragraph, text: str) -> None:
    if paragraph.text == text:
        return
    runs = paragraph.runs
    if not runs:
        paragraph.add_run().text = text
        return
    runs[0].text = text
    for run in runs[1:]:
        run.text = ""


class PptxAdapter:
    kind = "pptx"
    suffixes = (".pptx",)

    def extract(self, path: Path) -> ExtractedDocument:
        try:
            from pptx import Presentation
        except ImportError as error:
            raise RuntimeError("处理 pptx 需要 python-pptx：pip install python-pptx") from error
        presentation = Presentation(str(path))
        units: list[TextUnit] = []
        for locator, paragraph in _iter_paragraphs(presentation):
            text = paragraph.text
            if text.strip():
                units.append(TextUnit(locator=locator, text=text, ref=paragraph))
        return ExtractedDocument(path=str(path), kind=self.kind, units=units)

    def write(self, source: Path, target: Path, texts: Sequence[str]) -> Path:
        from pptx import Presentation

        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        presentation = Presentation(str(target))
        paragraphs = [paragraph for _, paragraph in _iter_paragraphs(presentation) if paragraph.text.strip()]
        if len(paragraphs) != len(texts):
            raise RuntimeError(f"文本单元数量与演示文稿不一致（{len(texts)} != {len(paragraphs)}），已中止")
        for paragraph, text in zip(paragraphs, texts):
            _set_paragraph_text(paragraph, text)
        presentation.save(str(target))
        return target
