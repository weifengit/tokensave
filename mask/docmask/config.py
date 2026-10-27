"""配置加载（含热加载与「面板覆盖」合并）。

配置来源分两层，职责不重叠：

1. **基础配置**：`config/docmask.json`（随工程发布、由用户维护：实体类型、词表、
   正则规则、模型路径等）。可用环境变量 `DOCMASK_CONFIG` 指向别处。
2. **面板覆盖**：`~/.dsh/tokensave/docmask/runtime.json`（由 DSH 左侧边栏「设置 →
   脱敏」的开关写入，只含 `runtime` 段）。基础配置里的词表/类型永远不会被面板改掉。

热加载靠 mtime 比较：基础配置、覆盖文件、外部词表任一变更，下一次调用自动重载。
"""

from __future__ import annotations

import copy
import json
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .placeholder import normalize_type

CONFIG_ENV = "DOCMASK_CONFIG"
UI_OVERRIDES_ENV = "DOCMASK_UI_OVERRIDES"

# 结构化识别器的内置规则名（具体正则见 detection/regex_detector.py）。
BUILTIN_RULE_NAMES = (
    "cn_mobile",
    "cn_id_card",
    "email",
    "bank_card",
    "ipv4",
    "ipv6",
    "api_key",
    "jwt",
    "token_assignment",
)

DEFAULT_CONFIG: dict[str, Any] = {
    "version": 1,
    # 面板开关写的就是这一段（其余字段由用户维护，面板只读不写）。
    "runtime": {
        "enabled": True,
        "regex": True,
        "glossary": True,
        "gliner": True,
        "cache": True,
        "audit": True,
        "hot_reload": True,
        "gliner_threshold": 0.35,
        "auto_persist_sessions": False,
    },
    "detectors": {
        "regex": {
            "enabled": True,
            "rules": {name: {"enabled": True} for name in BUILTIN_RULE_NAMES},
            "custom_rules": [],
        },
        "gliner": {
            "enabled": True,
            "model": "urchade/gliner_small-v2.1",
            "model_path": "",
            "threshold": 0.35,
            "device": "auto",
            "window_chars": 800,
            "window_overlap": 120,
            # required=False：模型缺失/未装 torch 时降级为正则+词表，并给出告警。
            "required": False,
        },
        "glossary": {
            "enabled": True,
            "path": "glossary.json",
            "case_sensitive": False,
        },
    },
    "types": {
        "map": {
            "person": "PER",
            "organization": "ORG",
            "location": "LOC",
            "address": "ADDR",
        },
        "custom": [],
        "ignore": [],
    },
    "cache": {
        "enabled": True,
        "path": "~/.cache/docmask/detections.db",
        "ttl_hours": 168,
    },
    "audit": {"enabled": True, "fail_on_leak": False},
    "session": {
        "persist_dir": "~/.dsh/tokensave/docmask/sessions",
        "auto_persist": False,
        "password_env": "DOCMASK_PASSWORD",
    },
    "ui_overrides": {
        "enabled": True,
        "path": "~/.dsh/tokensave/docmask/runtime.json",
    },
}


def expand_path(value: str | os.PathLike[str]) -> Path:
    return Path(os.path.expandvars(str(value))).expanduser()


def project_config_path() -> Path:
    """随工程发布的默认配置路径。"""
    return Path(__file__).resolve().parents[1] / "config" / "docmask.json"


def resolve_base_config(explicit: str | os.PathLike[str] | None = None) -> Path:
    if explicit:
        return expand_path(explicit)
    env = os.environ.get(CONFIG_ENV)
    if env:
        return expand_path(env)
    local = project_config_path()
    if local.is_file():
        return local
    return Path.cwd() / "config" / "docmask.json"


def deep_merge(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    """递归合并：overlay 覆盖 base，字典合并、其它类型整体替换。"""
    result = copy.deepcopy(base)
    for key, value in (overlay or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def _read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"配置必须是 JSON 对象：{path}")
    return data


@dataclass
class Config:
    """一份已合并、只读的配置快照。"""

    raw: dict[str, Any]
    base_path: Path
    runtime_path: Path | None
    generation: int = 0
    mtimes: dict[str, float] = field(default_factory=dict)

    # —— 运行时开关 ——

    @property
    def runtime(self) -> dict[str, Any]:
        merged = dict(DEFAULT_CONFIG["runtime"])
        merged.update(self.raw.get("runtime") or {})
        return merged

    @property
    def enabled(self) -> bool:
        return bool(self.runtime.get("enabled", True))

    def detector_enabled(self, name: str) -> bool:
        if not self.enabled:
            return False
        runtime_flag = self.runtime.get(name)
        if runtime_flag is False:
            return False
        return bool((self.raw.get("detectors", {}).get(name) or {}).get("enabled", True))

    # —— 识别器参数 ——

    def regex_rule_enabled(self, name: str) -> bool:
        rules = (self.raw.get("detectors", {}).get("regex") or {}).get("rules") or {}
        entry = rules.get(name)
        if isinstance(entry, dict):
            return bool(entry.get("enabled", True))
        if isinstance(entry, bool):
            return entry
        return True

    def custom_regex_rules(self) -> list[dict[str, Any]]:
        raw = (self.raw.get("detectors", {}).get("regex") or {}).get("custom_rules") or []
        return [item for item in raw if isinstance(item, dict) and item.get("pattern")]

    def gliner_settings(self) -> dict[str, Any]:
        settings = copy.deepcopy(DEFAULT_CONFIG["detectors"]["gliner"])
        settings.update(self.raw.get("detectors", {}).get("gliner") or {})
        # 面板只调阈值：阈值不进基础配置也能生效。
        if "gliner_threshold" in self.runtime:
            settings["threshold"] = float(self.runtime["gliner_threshold"])
        model_path = str(settings.get("model_path") or "").strip()
        if model_path:
            settings["resolved_model"] = str(expand_path(model_path))
        else:
            settings["resolved_model"] = str(settings.get("model") or "")
        return settings

    def gliner_labels(self) -> list[tuple[str, str]]:
        """[(GLiNER label, 占位符 TYPE)]；默认 person/organization/location。"""
        mapping = self.raw.get("types", {}).get("map") or {}
        pairs: list[tuple[str, str]] = []
        seen: set[str] = set()
        for label, entity_type in mapping.items():
            label_text = str(label).strip()
            if not label_text or label_text in seen:
                continue
            seen.add(label_text)
            pairs.append((label_text, normalize_type(str(entity_type))))
        for item in self.custom_types():
            label_text = str(item.get("label") or "").strip()
            if not label_text or label_text in seen:
                continue
            seen.add(label_text)
            pairs.append((label_text, normalize_type(str(item.get("type") or label_text))))
        return pairs

    def custom_types(self) -> list[dict[str, Any]]:
        raw = self.raw.get("types", {}).get("custom") or []
        return [item for item in raw if isinstance(item, dict) and item.get("type")]

    def type_of_label(self, label: str) -> str | None:
        for candidate, entity_type in self.gliner_labels():
            if candidate == label:
                return entity_type
        return None

    def ignore_terms(self) -> set[str]:
        """白名单：这些词永不被脱敏（避免把产品名/公开品牌误伤）。"""
        from .session import normalize_key

        raw = self.raw.get("types", {}).get("ignore") or []
        return {normalize_key(str(item)) for item in raw if str(item).strip()}

    def glossary_terms(self) -> list[tuple[str, str]]:
        """固定敏感词：配置内联 terms/aliases + 外部词表文件。[(TYPE, 词)]"""
        terms: list[tuple[str, str]] = []
        for item in self.custom_types():
            entity_type = normalize_type(str(item.get("type")))
            for key in ("terms", "aliases", "words"):
                for word in item.get(key) or []:
                    text = str(word).strip()
                    if text:
                        terms.append((entity_type, text))
        for entity_type, word in self._external_glossary():
            terms.append((entity_type, word))
        # 长词优先：避免「天枢」把「天枢计划」截断。
        terms.sort(key=lambda pair: len(pair[1]), reverse=True)
        return terms

    def _external_glossary(self) -> list[tuple[str, str]]:
        settings = self.raw.get("detectors", {}).get("glossary") or {}
        raw_path = str(settings.get("path") or "").strip()
        if not raw_path:
            return []
        path = expand_path(raw_path)
        if not path.is_absolute():
            path = (self.base_path.parent / path).resolve()
        if not path.is_file():
            return []
        try:
            data = _read_json(path)
        except (OSError, ValueError):
            return []
        pairs: list[tuple[str, str]] = []
        for entity_type, words in data.items():
            if not isinstance(words, list):
                continue
            for word in words:
                text = str(word).strip()
                if text:
                    pairs.append((normalize_type(str(entity_type)), text))
        return pairs

    def glossary_case_sensitive(self) -> bool:
        settings = self.raw.get("detectors", {}).get("glossary") or {}
        return bool(settings.get("case_sensitive", False))

    # —— 其它子系统 ——

    def cache_settings(self) -> dict[str, Any]:
        settings = copy.deepcopy(DEFAULT_CONFIG["cache"])
        settings.update(self.raw.get("cache") or {})
        settings["enabled"] = bool(settings.get("enabled", True)) and bool(self.runtime.get("cache", True))
        return settings

    def audit_settings(self) -> dict[str, Any]:
        settings = copy.deepcopy(DEFAULT_CONFIG["audit"])
        settings.update(self.raw.get("audit") or {})
        settings["enabled"] = bool(settings.get("enabled", True)) and bool(self.runtime.get("audit", True))
        return settings

    def session_settings(self) -> dict[str, Any]:
        settings = copy.deepcopy(DEFAULT_CONFIG["session"])
        settings.update(self.raw.get("session") or {})
        settings["auto_persist"] = bool(settings.get("auto_persist")) or bool(
            self.runtime.get("auto_persist_sessions", False)
        )
        return settings

    def ui_overrides_settings(self) -> dict[str, Any]:
        settings = copy.deepcopy(DEFAULT_CONFIG["ui_overrides"])
        settings.update(self.raw.get("ui_overrides") or {})
        return settings

    def watch_files(self) -> list[Path]:
        """热加载需要盯的文件（不存在也返回，后续出现同样能触发重载）。"""
        files = [self.base_path]
        if self.runtime_path is not None:
            files.append(self.runtime_path)
        settings = self.raw.get("detectors", {}).get("glossary") or {}
        raw_path = str(settings.get("path") or "").strip()
        if raw_path:
            glossary = expand_path(raw_path)
            if not glossary.is_absolute():
                glossary = (self.base_path.parent / glossary).resolve()
            files.append(glossary)
        return files

    def public_snapshot(self) -> dict[str, Any]:
        """给 CLI / 面板看的安全摘要（不含任何明文敏感内容）。"""
        gliner = self.gliner_settings()
        return {
            "generation": self.generation,
            "base_path": str(self.base_path),
            "runtime_path": str(self.runtime_path) if self.runtime_path else None,
            "runtime": self.runtime,
            "detectors": {
                "regex": self.detector_enabled("regex"),
                "glossary": self.detector_enabled("glossary"),
                "gliner": self.detector_enabled("gliner"),
            },
            "gliner": {
                "model": gliner.get("model"),
                "resolved_model": gliner.get("resolved_model"),
                "threshold": gliner.get("threshold"),
            },
            "labels": [{"label": label, "type": entity_type} for label, entity_type in self.gliner_labels()],
            "custom_types": [item.get("type") for item in self.custom_types()],
            "custom_term_count": len(self.glossary_terms()),
            "ignore_count": len(self.ignore_terms()),
            "cache": self.cache_settings(),
            "audit": self.audit_settings(),
        }


class ConfigLoader:
    """带热加载的配置加载器：文件 mtime 变了就在下次 load 时重载。"""

    def __init__(
        self,
        path: str | os.PathLike[str] | None = None,
        *,
        ui_overrides_path: str | os.PathLike[str] | None = None,
    ):
        self._explicit = path
        self._explicit_ui = ui_overrides_path
        self._lock = threading.RLock()
        self._generation = 0
        self._mtimes: dict[str, float] = {}
        self._config: Config | None = None

    def _runtime_path(self, base: dict[str, Any]) -> Path | None:
        if self._explicit_ui:
            return expand_path(self._explicit_ui)
        env = os.environ.get(UI_OVERRIDES_ENV)
        if env:
            return expand_path(env)
        settings = base.get("ui_overrides") or {}
        if settings.get("enabled", True) is False:
            return None
        return expand_path(settings.get("path") or DEFAULT_CONFIG["ui_overrides"]["path"])

    def load(self, force: bool = False) -> Config:
        with self._lock:
            if self._config is not None and not force:
                hot = bool(self._config.runtime.get("hot_reload", True))
                if not hot or not self._changed(self._config):
                    return self._config
            return self._reload()

    def _changed(self, config: Config) -> bool:
        for path in config.watch_files():
            key = str(path)
            try:
                mtime = path.stat().st_mtime
            except OSError:
                mtime = 0.0
            if self._mtimes.get(key) != mtime:
                return True
        return False

    def _reload(self) -> Config:
        base_path = resolve_base_config(self._explicit)
        if base_path.is_file():
            base = _read_json(base_path)
        else:
            base = {}
        merged = deep_merge(DEFAULT_CONFIG, base)
        runtime_path = self._runtime_path(merged)
        if runtime_path is not None and runtime_path.is_file():
            try:
                overlay = _read_json(runtime_path)
            except (OSError, ValueError):
                overlay = {}
            runtime = overlay.get("runtime", overlay) if isinstance(overlay, dict) else {}
            if isinstance(runtime, dict):
                merged["runtime"] = deep_merge(merged.get("runtime") or {}, runtime)
        self._generation += 1
        config = Config(
            raw=merged,
            base_path=base_path,
            runtime_path=runtime_path,
            generation=self._generation,
        )
        self._mtimes = {}
        for path in config.watch_files():
            try:
                self._mtimes[str(path)] = path.stat().st_mtime
            except OSError:
                self._mtimes[str(path)] = 0.0
        self._config = config
        return config

    @property
    def generation(self) -> int:
        return self._generation
