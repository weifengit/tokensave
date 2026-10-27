"""docmask：本地离线文档 & 对话脱敏（不调用任何云端大模型）。"""

from __future__ import annotations

from .api import (
    DocMasker,
    clear_session,
    default,
    export_mapping,
    load_mapping,
    mask_document,
    mask_text,
    new_session,
    unmask_text,
)
from .config import ConfigLoader
from .models import DocumentMaskResult, MaskHit, MaskResult, UnmaskResult
from .pipeline import Masker
from .session import MaskSession, SessionRegistry

__version__ = "1.0.0"

__all__ = [
    "ConfigLoader",
    "DocMasker",
    "DocumentMaskResult",
    "MaskHit",
    "MaskResult",
    "MaskSession",
    "Masker",
    "SessionRegistry",
    "UnmaskResult",
    "__version__",
    "clear_session",
    "default",
    "export_mapping",
    "load_mapping",
    "mask_document",
    "mask_text",
    "new_session",
    "unmask_text",
]
