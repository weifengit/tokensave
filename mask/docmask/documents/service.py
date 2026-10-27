"""文档级脱敏编排：解析 → 逐单元脱敏 → 可选写回。

缓存分层（避免重复跑 GLiNER）：
- **解析结果**：本进程内按 (路径, mtime, size) 记忆，同一份文件不重复解析；
- **识别结果**：GLiNER 层按 (模型, 阈值, 标签, 文本) 落到 SQLite（见 cache.py）。
文档级不缓存「脱敏后的文本」——它依赖当前会话映射表，缓存会串会话。
"""

from __future__ import annotations


from pathlib import Path
from typing import Any

from ..models import DocumentMaskResult, MaskHit
from ..pipeline import Masker
from ..session import MaskSession
from . import adapter_for, supported_suffixes
from .base import ExtractedDocument

_PARSE_CACHE_MAX = 8


class DocumentMasker:
    def __init__(self, masker: Masker):
        self._masker = masker
        self._parse_cache: dict[tuple[str, int, int], ExtractedDocument] = {}

    def parse(self, source: str | Path) -> ExtractedDocument:
        path = Path(source).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"文件不存在：{path}")
        adapter = adapter_for(path)
        stat = path.stat()
        key = (str(path), stat.st_mtime_ns, stat.st_size)
        cached = self._parse_cache.get(key)
        if cached is not None:
            return cached
        document = adapter.extract(path)
        if len(self._parse_cache) >= _PARSE_CACHE_MAX:
            self._parse_cache.pop(next(iter(self._parse_cache)))
        self._parse_cache[key] = document
        return document

    def mask_file(
        self,
        session: MaskSession,
        source: str | Path,
        output: str | Path | None = None,
        *,
        dry_run: bool = False,
    ) -> DocumentMaskResult:
        path = Path(source).expanduser().resolve()
        document = self.parse(path)

        masked_texts: list[str] = []
        hits: list[MaskHit] = []
        warnings: list[str] = []
        for unit in document.units:
            result = self._masker.mask(session, unit.text, scope=f"doc:{unit.locator}")
            masked_texts.append(result.text)
            hits.extend(result.hits)
            warnings.extend(result.warnings)

        output_path: Path | None = None
        if not dry_run and output is not None:
            target = Path(output).expanduser().resolve()
            if target == path:
                raise ValueError("输出路径不能与源文件相同（避免覆盖原始文档）")
            adapter_for(path).write(path, target, masked_texts)
            output_path = target

        return DocumentMaskResult(
            source=str(path),
            output=str(output_path) if output_path else None,
            kind=document.kind,
            unit_count=len(document.units),
            masked_text="\n".join(masked_texts),
            hits=hits,
            warnings=warnings,
            dry_run=dry_run,
        )

    def describe(self, source: str | Path) -> dict[str, Any]:
        """不脱敏，只看文档会被切成哪些文本单元（排查用）。"""
        document = self.parse(source)
        return {
            "path": document.path,
            "kind": document.kind,
            "unit_count": len(document.units),
            "units": [{"locator": unit.locator, "chars": len(unit.text)} for unit in document.units],
            "supported": list(supported_suffixes()),
        }
