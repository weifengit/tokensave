"""GLiNER-small 语义识别（本地 CPU/GPU，不联网、不调用云端大模型）。

工程约定：
- 依赖 `gliner`（含 torch）**只在首次用到时**导入，没装也不影响正则/词表跑通；
- 权重可以是 HuggingFace 仓库 id（首次自动下载到 `~/.cache/huggingface`），
  也可以是本地目录（断网部署，见 README）；
- 结果按「文本 + 模型 + 阈值 + 标签」缓存，同一份文档重复处理不再跑模型。
"""

from __future__ import annotations

import threading
from typing import Any

from ..cache import DetectionCache, fingerprint
from ..config import Config
from ..models import Detection
from ..placeholder import normalize_type
from .base import DetectorUnavailable

# GLiNER 的上下文长度有限，长文档按窗口切片，窗口之间留重叠避免切断实体。
DEFAULT_WINDOW = 800
DEFAULT_OVERLAP = 120


def _windows(text: str, size: int, overlap: int) -> list[tuple[int, str]]:
    if len(text) <= size:
        return [(0, text)]
    step = max(1, size - overlap)
    slices: list[tuple[int, str]] = []
    for start in range(0, len(text), step):
        chunk = text[start : start + size]
        if not chunk:
            break
        slices.append((start, chunk))
        if start + size >= len(text):
            break
    return slices


class GlinerDetector:
    name = "gliner"

    def __init__(self, cache: DetectionCache | None = None):
        self._cache = cache
        self._model: Any = None
        self._model_key: str | None = None
        self._lock = threading.Lock()

    # —— 模型加载 ——

    def _load_model(self, model_id: str, device: str, local_only: bool) -> Any:
        with self._lock:
            if self._model is not None and self._model_key == model_id:
                return self._model
            try:
                from gliner import GLiNER  # 延迟导入：没装 torch 的用户也能用正则+词表
            except Exception as error:  # pragma: no cover - 取决于运行环境
                raise DetectorUnavailable(
                    "gliner",
                    f"未安装 gliner/torch（{error}）。安装：pip install gliner；"
                    "或关闭「语义识别」开关只用正则+词表。",
                ) from error
            try:
                try:
                    model = GLiNER.from_pretrained(model_id, local_files_only=local_only)
                except TypeError:
                    # 旧版 gliner 没有 local_files_only 参数
                    model = GLiNER.from_pretrained(model_id)
            except Exception as error:  # pragma: no cover - 取决于运行环境
                raise DetectorUnavailable(
                    "gliner",
                    f"加载权重失败（{model_id}）：{error}。断网时请把 config 里的 "
                    "detectors.gliner.model_path 指向本地模型目录。",
                ) from error
            if device and device != "auto":
                try:
                    model.to(device)
                except Exception:  # pragma: no cover - 设备不支持时不阻塞主流程
                    pass
            self._model = model
            self._model_key = model_id
            return model

    # —— 识别 ——

    def detect(self, text: str, config: Config, session: object | None = None) -> list[Detection]:
        if not text.strip():
            return []
        settings = config.gliner_settings()
        model_id = str(settings["resolved_model"])
        threshold = float(settings.get("threshold", 0.35))
        labels = [label for label, _ in config.gliner_labels()]
        if not labels:
            return []

        cache_key = fingerprint("gliner", model_id, f"{threshold:.3f}", "|".join(labels), text)
        if self._cache is not None and config.cache_settings().get("enabled", True):
            cached = self._cache.get(cache_key)
            if cached is not None:
                return [Detection.from_dict(item) for item in cached]

        local_only = bool(settings.get("model_path")) and model_id != str(settings.get("model"))
        model = self._load_model(model_id, str(settings.get("device") or "auto"), local_only)

        size = int(settings.get("window_chars") or DEFAULT_WINDOW)
        overlap = int(settings.get("window_overlap") or DEFAULT_OVERLAP)
        overlap = min(overlap, max(0, size - 1))

        detections: list[Detection] = []
        for offset, chunk in _windows(text, size, overlap):
            try:
                entities = model.predict_entities(chunk, labels, threshold=threshold)
            except Exception as error:  # pragma: no cover - 模型推理异常
                raise DetectorUnavailable("gliner", f"推理失败：{error}") from error
            for entity in entities:
                label = str(entity.get("label") or "")
                entity_type = config.type_of_label(label)
                if entity_type is None:
                    continue
                start = int(entity.get("start", -1)) + offset
                end = int(entity.get("end", -1)) + offset
                value = str(entity.get("text") or "")
                if start < 0 or end <= start or not value.strip():
                    continue
                detections.append(
                    Detection(
                        start=start,
                        end=end,
                        text=text[start:end] if end <= len(text) else value,
                        entity_type=normalize_type(entity_type),
                        detector="gliner",
                        score=float(entity.get("score", 1.0)),
                    )
                )

        if self._cache is not None and config.cache_settings().get("enabled", True):
            self._cache.put(cache_key, [item.to_dict() for item in detections])
        return detections
