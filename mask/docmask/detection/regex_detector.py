"""结构化敏感内容的正则识别（**优先于 GLiNER**，成本最低）。

每条规则都能在配置里单独开关：`detectors.regex.rules.<name>.enabled`；
也可以在 `detectors.regex.custom_rules` 里追加自己的规则。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Iterable

from ..config import Config
from ..models import Detection
from ..placeholder import normalize_type

Validator = Callable[[str], bool]


def luhn_ok(digits: str) -> bool:
    """银行卡/信用卡的 Luhn 校验：滤掉大量「一串数字」误报。"""
    numbers = [int(ch) for ch in digits if ch.isdigit()]
    if len(numbers) < 12:
        return False
    checksum = 0
    for index, value in enumerate(reversed(numbers)):
        if index % 2 == 1:
            value *= 2
            if value > 9:
                value -= 9
        checksum += value
    return checksum % 10 == 0


def ipv4_ok(text: str) -> bool:
    parts = text.split(".")
    return len(parts) == 4 and all(part.isdigit() and 0 <= int(part) <= 255 for part in parts)


def ipv6_ok(text: str) -> bool:
    # 过滤 `12:30:45` 这类时间：至少 3 个冒号，且必须出现 a-f 或 `::`。
    if text.count(":") < 2:
        return False
    return "::" in text or any(ch in "abcdefABCDEF" for ch in text)


@dataclass(frozen=True)
class Rule:
    name: str
    entity_type: str
    pattern: re.Pattern[str]
    group: int = 0
    validator: Validator | None = None

    def find(self, text: str) -> Iterable[Detection]:
        for match in self.pattern.finditer(text):
            start, end = match.span(self.group)
            if start < 0 or end <= start:
                continue
            value = text[start:end]
            if self.validator is not None and not self.validator(value):
                continue
            yield Detection(
                start=start,
                end=end,
                text=value,
                entity_type=normalize_type(self.entity_type),
                detector="regex",
                score=1.0,
            )


# 顺序即优先级（同起点同长度时前面的胜出）：身份证要排在银行卡之前。
BUILTIN_RULES: tuple[Rule, ...] = (
    Rule("cn_mobile", "PHONE", re.compile(r"(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)")),
    Rule("cn_id_card", "ID_CARD", re.compile(r"(?<![0-9A-Za-z])\d{17}[\dXx](?![0-9A-Za-z])")),
    Rule("email", "EMAIL", re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")),
    Rule("bank_card", "BANK_CARD", re.compile(r"(?<!\d)(?:\d[ \-]?){15,18}\d(?!\d)"), validator=luhn_ok),
    Rule("ipv4", "IP", re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])"), validator=ipv4_ok),
    Rule(
        "ipv6",
        "IP",
        re.compile(r"(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{1,4}:){2,7}[0-9A-Fa-f]{1,4}(?![0-9A-Fa-f:])"),
        validator=ipv6_ok,
    ),
    Rule(
        "api_key",
        "API_KEY",
        re.compile(
            r"(?:sk-[A-Za-z0-9_\-]{16,}"
            r"|AKIA[0-9A-Z]{16}"
            r"|gh[pousr]_[A-Za-z0-9]{20,}"
            r"|xox[baprs]-[A-Za-z0-9\-]{10,}"
            r"|AIza[0-9A-Za-z_\-]{35})"
        ),
    ),
    Rule("jwt", "TOKEN", re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{4,}\b")),
    Rule(
        "token_assignment",
        "SECRET",
        re.compile(
            r"(?i)\b(?:token|secret|passwd|password|api[_-]?key|access[_-]?key)\s*[:=]\s*[\"']?([A-Za-z0-9_\-./+=]{8,})"
        ),
        group=1,
    ),
)

_BUILTIN_BY_NAME = {rule.name: rule for rule in BUILTIN_RULES}


def _compile_custom(entry: dict) -> Rule | None:
    try:
        pattern = re.compile(str(entry["pattern"]))
    except (re.error, KeyError):
        return None
    name = str(entry.get("name") or entry.get("type") or "custom")
    return Rule(
        name=name,
        entity_type=str(entry.get("type") or "CUSTOM"),
        pattern=pattern,
        group=int(entry.get("group", 0) or 0),
    )


class RegexDetector:
    name = "regex"

    def detect(self, text: str, config: Config, session: object | None = None) -> list[Detection]:
        if not text:
            return []
        detections: list[Detection] = []
        for rule in BUILTIN_RULES:
            if config.regex_rule_enabled(rule.name):
                detections.extend(rule.find(text))
        for entry in config.custom_regex_rules():
            if entry.get("enabled", True) is False:
                continue
            rule = _compile_custom(entry)
            if rule is not None:
                detections.extend(rule.find(text))
        return detections
