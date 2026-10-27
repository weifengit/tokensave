"""识别器集合（对外只导出这一处，编排层不关心具体实现）。"""

from .base import Detector, DetectorUnavailable, filter_ignored, resolve_overlaps
from .gliner_detector import GlinerDetector
from .glossary_detector import GlossaryDetector
from .regex_detector import RegexDetector

__all__ = [
    "Detector",
    "DetectorUnavailable",
    "GlinerDetector",
    "GlossaryDetector",
    "RegexDetector",
    "filter_ignored",
    "resolve_overlaps",
]
