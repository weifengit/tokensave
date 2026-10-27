"""正向脱敏 / 反向还原的唯一编排入口。

正向流程（与需求逐条对应）：
    明文 → 正则 → 自定义词表 → GLiNER → 会话映射表（复用或新分配）→ 占位符文本
反向流程：
    带占位符的回答 → 查当前会话映射表 → 原文
"""

from __future__ import annotations

import logging
import re
import time
from typing import Iterable, Sequence

from .audit import audit_masked_text
from .cache import DetectionCache
from .config import Config, ConfigLoader
from .detection import (
    Detector,
    DetectorUnavailable,
    GlinerDetector,
    GlossaryDetector,
    RegexDetector,
    filter_ignored,
    resolve_overlaps,
)
from .models import Detection, MaskHit, MaskResult, UnmaskResult
from .placeholder import format_placeholder, iter_placeholders
from .session import EntityRecord, MaskSession, normalize_key

LOGGER = logging.getLogger("docmask")


def _term_pattern(originals: Sequence[str]) -> re.Pattern[str]:
    """把一批实体原文编成一个「长词优先」的替换正则。

    ASCII 词加边界，避免 Acme 命中 AcmeCorp 的内部；CJK 直接匹配。
    """
    parts: list[str] = []
    for term in originals:
        body = re.escape(term)
        if term[:1].isascii() and term[:1].isalnum():
            body = rf"(?<![A-Za-z0-9_]){body}"
        if term[-1:].isascii() and term[-1:].isalnum():
            body = rf"{body}(?![A-Za-z0-9_])"
        parts.append(body)
    return re.compile("|".join(parts), re.IGNORECASE)


def apply_terms(
    text: str,
    records: Iterable[EntityRecord],
    ignore_keys: set[str] | None = None,
) -> tuple[str, list[tuple[EntityRecord, int, int]]]:
    """把映射表里的**所有**实体在文本中一次性替换成占位符。

    为什么不是只替换识别器报出来的片段：GLiNER 可能漏掉第二次出现，
    而映射表已经确定「这个词是敏感的」——所以按映射表全局替换更安全，也更一致。
    """
    ordered = sorted(records, key=lambda record: len(record.original), reverse=True)
    if not ordered:
        return text, []
    ignore = ignore_keys or set()
    by_key: dict[str, EntityRecord] = {}
    for record in ordered:
        by_key.setdefault(normalize_key(record.original), record)

    pattern = _term_pattern([record.original for record in ordered])
    placeholder_ranges = [(start, end) for start, end, _, _ in iter_placeholders(text)]

    pieces: list[str] = []
    used: list[tuple[EntityRecord, int, int]] = []
    cursor = 0
    for match in pattern.finditer(text):
        key = normalize_key(match.group(0))
        record = by_key.get(key)
        if record is None or key in ignore:
            continue
        start, end = match.span()
        if any(left <= start and end <= right for left, right in placeholder_ranges):
            continue
        pieces.append(text[cursor:start])
        pieces.append(record.placeholder)
        cursor = end
        used.append((record, start, end))
    pieces.append(text[cursor:])
    return "".join(pieces), used


class Masker:
    """识别 + 映射 + 审计的组合体。线程安全依赖各子模块自身的锁。"""

    def __init__(
        self,
        config_loader: ConfigLoader | None = None,
        *,
        detectors: Sequence[Detector] | None = None,
        extra_detectors: Sequence[Detector] | None = None,
    ):
        self._loader = config_loader or ConfigLoader()
        self._config: Config = self._loader.load(force=True)
        self._cache: DetectionCache | None = None
        # detectors = 整体替换内置三件套；extra_detectors = 在内置基础上追加（自定义识别器常用）
        self._custom_detectors = detectors is not None
        self._detectors: list[Detector] = list(detectors) if detectors is not None else []
        self._extra_detectors: list[Detector] = list(extra_detectors or [])
        self._unavailable: set[str] = set()

    # —— 配置 ——

    def config(self, force: bool = False) -> Config:
        self._config = self._loader.load(force=force)
        return self._config

    def reload_config(self) -> Config:
        return self.config(force=True)

    def _ensure_detectors(self, config: Config) -> list[Detector]:
        if self._custom_detectors:
            return [*self._detectors, *self._extra_detectors]
        if not self._detectors:
            self._detectors = [GlossaryDetector(), RegexDetector(), GlinerDetector(self._ensure_cache(config))]
        return [*self._detectors, *self._extra_detectors]

    def _ensure_cache(self, config: Config) -> DetectionCache | None:
        settings = config.cache_settings()
        if not settings.get("enabled", True):
            return None
        if self._cache is None:
            self._cache = DetectionCache(settings["path"], float(settings.get("ttl_hours", 168)))
        return self._cache

    # —— 正向 ——

    def mask(self, session: MaskSession, text: str, *, scope: str = "text") -> MaskResult:
        started = time.perf_counter()
        config = self.config()
        warnings: list[str] = []
        if not text:
            return MaskResult(session_id=session.session_id, text="", warnings=warnings)
        if not config.enabled:
            warnings.append("脱敏总开关处于关闭状态（设置 → 脱敏），本次文本未脱敏。")
            LOGGER.warning(warnings[-1])
            return MaskResult(session_id=session.session_id, text=text, warnings=warnings)

        detections = self._collect(text, config, warnings)
        detections = filter_ignored(resolve_overlaps(detections), config.ignore_terms())

        known_before = {record.placeholder for record in session.entities()}
        for detection in detections:
            session.assign(detection.entity_type, detection.text, detection.detector)

        masked, used = apply_terms(text, session.entities(), config.ignore_terms())

        hits: list[MaskHit] = []
        seen: set[str] = set()
        for record, start, end in used:
            if record.placeholder in seen:
                continue
            seen.add(record.placeholder)
            hits.append(
                MaskHit(
                    placeholder=record.placeholder,
                    entity_type=record.entity_type,
                    original=record.original,
                    detector=record.detector,
                    reused=record.placeholder in known_before,
                    start=start,
                    end=end,
                )
            )

        if config.audit_settings().get("enabled", True):
            warnings.extend(audit_masked_text(masked, config, session))
        for warning in warnings:
            LOGGER.warning("[docmask] %s", warning)

        elapsed = (time.perf_counter() - started) * 1000
        if hits:
            LOGGER.debug("[docmask] scope=%s 命中 %d 个实体，用时 %.1fms", scope, len(hits), elapsed)
        return MaskResult(
            session_id=session.session_id,
            text=masked,
            hits=hits,
            warnings=warnings,
            elapsed_ms=elapsed,
        )

    def _collect(self, text: str, config: Config, warnings: list[str]) -> list[Detection]:
        detections: list[Detection] = []
        for detector in self._ensure_detectors(config):
            name = getattr(detector, "name", detector.__class__.__name__.lower())
            if not config.detector_enabled(name):
                continue
            try:
                detections.extend(detector.detect(text, config))
            except DetectorUnavailable as error:
                required = bool(config.gliner_settings().get("required"))
                if name == "gliner" and required:
                    raise
                if name not in self._unavailable:
                    self._unavailable.add(name)
                    message = f"{error}（已降级为其它识别器，脱敏继续进行）"
                    warnings.append(message)
                    LOGGER.warning("[docmask] %s", message)
            except Exception as error:  # 单个识别器异常不应打断整条链路
                message = f"{name} 识别异常：{error}"
                warnings.append(message)
                LOGGER.warning("[docmask] %s", message)
        return detections

    # —— 反向 ——

    def unmask(self, session: MaskSession, text: str) -> UnmaskResult:
        warnings: list[str] = []
        pieces: list[str] = []
        cursor = 0
        restored = 0
        unknown: list[str] = []
        for start, end, entity_type, index in iter_placeholders(text):
            token = text[start:end]
            canonical = format_placeholder(entity_type, index)
            original = session.original_of(canonical) or session.original_of(token)
            if original is None:
                unknown.append(token)
                continue
            pieces.append(text[cursor:start])
            pieces.append(original)
            cursor = end
            restored += 1
        pieces.append(text[cursor:])
        if unknown:
            warnings.append(
                f"有 {len(unknown)} 个占位符在当前会话映射表中不存在（{', '.join(unknown[:5])}），已原样保留。"
            )
            for warning in warnings:
                LOGGER.warning("[docmask] %s", warning)
        return UnmaskResult(
            session_id=session.session_id,
            text="".join(pieces),
            restored=restored,
            unknown=unknown,
            warnings=warnings,
        )

    def close(self) -> None:
        if self._cache is not None:
            self._cache.close()
            self._cache = None
