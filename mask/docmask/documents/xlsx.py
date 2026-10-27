"""xlsx：字符串单元格。

只改字符串值，不动公式、样式、合并单元格；数字/日期单元格保持原样。
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Sequence

from .base import ExtractedDocument, TextUnit


class XlsxAdapter:
    kind = "xlsx"
    suffixes = (".xlsx", ".xlsm")

    def extract(self, path: Path) -> ExtractedDocument:
        try:
            import openpyxl
        except ImportError as error:
            raise RuntimeError("处理 xlsx 需要 openpyxl：pip install openpyxl") from error
        workbook = openpyxl.load_workbook(str(path), data_only=False)
        units: list[TextUnit] = []
        for worksheet in workbook.worksheets:
            for row in worksheet.iter_rows():
                for cell in row:
                    if isinstance(cell.value, str) and cell.value.strip():
                        units.append(TextUnit(locator=f"{worksheet.title}!{cell.coordinate}", text=cell.value, ref=cell))
        workbook.close()
        return ExtractedDocument(path=str(path), kind=self.kind, units=units)

    def write(self, source: Path, target: Path, texts: Sequence[str]) -> Path:
        import openpyxl

        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        workbook = openpyxl.load_workbook(str(target), data_only=False)
        cells = []
        for worksheet in workbook.worksheets:
            for row in worksheet.iter_rows():
                for cell in row:
                    if isinstance(cell.value, str) and cell.value.strip():
                        cells.append(cell)
        if len(cells) != len(texts):
            workbook.close()
            raise RuntimeError(f"文本单元格数量与工作簿不一致（{len(texts)} != {len(cells)}），已中止")
        for cell, text in zip(cells, texts):
            cell.value = text
        workbook.save(str(target))
        workbook.close()
        return target
