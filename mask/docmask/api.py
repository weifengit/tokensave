"""对外门面：业务脚本只需要 import 这个模块。

    from docmask import DocMasker

    masker = DocMasker()                 # 读 config/docmask.json
    sid = masker.new_session()           # 每个对话/文档任务一个会话
    safe = masker.mask_text("张三的电话 13800138000", sid)
    send_to_deepseek_harness(safe.text)  # R1：只发 safe.text，映射表留在本地
    reply = masker.unmask_text(answer, sid)   # 拿到回答后还原给用户

门面之外的东西（识别器、适配器、缓存）都可以替换，但请不要绕过门面去拼占位符。
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Sequence

from .config import Config, ConfigLoader
from .crypto import load_sealed, resolve_password, save_sealed
from .detection.base import Detector
from .documents.service import DocumentMasker
from .models import DocumentMaskResult, MaskResult, UnmaskResult
from .pipeline import Masker
from .session import MaskSession, SessionRegistry
from .session_store import EncryptedSessionStore

LOGGER = logging.getLogger("docmask")

IMPLICIT_SESSION_ID = "default"


class DocMasker:
    """会话管理 + 脱敏/还原 + 文档处理 + 映射表加解密的总入口。"""

    def __init__(
        self,
        config_path: str | Path | None = None,
        *,
        ui_overrides_path: str | Path | None = None,
        password: str | None = None,
        detectors: Sequence[Detector] | None = None,
        extra_detectors: Sequence[Detector] | None = None,
        session_store: EncryptedSessionStore | None = None,
    ):
        self._loader = ConfigLoader(config_path, ui_overrides_path=ui_overrides_path)
        self._config: Config = self._loader.load(force=True)
        self._masker = Masker(self._loader, detectors=detectors, extra_detectors=extra_detectors)
        self._sessions = SessionRegistry()
        self._documents = DocumentMasker(self._masker)
        self._password = password
        self._session_store = session_store or self._auto_store(self._config)
        self._implicit_session_id: str | None = None
        self._store_warned = False

    # —— 配置 ——

    def _auto_store(self, config: Config) -> EncryptedSessionStore | None:
        settings = config.session_settings()
        if not settings.get("auto_persist"):
            return None
        env = str(settings.get("password_env") or "DOCMASK_PASSWORD")
        try:
            resolve_password(self._password, env=env)
        except ValueError:
            LOGGER.warning(
                "已开启会话自动持久化，但没有提供密码（%s），本次只保存在内存里。", env
            )
            return None
        return EncryptedSessionStore(settings["persist_dir"], self._password, password_env=env)

    def reload_config(self) -> Config:
        """热加载：面板开关/词表改完立刻生效，不用重启进程。"""
        self._config = self._masker.reload_config()
        return self._config

    def config_snapshot(self) -> dict[str, Any]:
        return self._loader.load().public_snapshot()

    # —— 会话 ——

    def new_session(self, session_id: str | None = None) -> str:
        return self._sessions.new(session_id).session_id

    def get_session(self, session_id: str) -> MaskSession:
        session = self._sessions.get(session_id)
        if session is not None:
            return session
        if self._session_store is not None:
            loaded = self._session_store.load(session_id)
            if loaded is not None:
                return self._sessions.attach(loaded)
        raise KeyError(
            f"会话不存在：{session_id}。多轮对话要复用同一个 session_id；新任务请先 new_session()。"
        )

    def _session_for(self, session_id: str | None) -> MaskSession:
        if session_id is not None:
            try:
                return self.get_session(session_id)
            except KeyError:
                # 首次使用这个 id（CLI 每次都是新进程）——自动建一个空会话，不报错。
                LOGGER.info("会话 %s 不存在，已自动创建", session_id)
                return self._sessions.get_or_create(session_id)
        if self._implicit_session_id is None:
            self._implicit_session_id = self._sessions.get_or_create(IMPLICIT_SESSION_ID).session_id
            LOGGER.warning(
                "未指定 session_id，使用进程级默认会话 `%s`；多任务并行请各自 new_session()，否则会串号。",
                IMPLICIT_SESSION_ID,
            )
        return self._sessions.get_or_create(self._implicit_session_id)

    def session_ids(self) -> list[str]:
        ids = set(self._sessions.ids())
        if self._session_store is not None:
            ids.update(self._session_store.session_ids())
        return sorted(ids)

    def clear_session(self, session_id: str) -> bool:
        """清空映射（保留会话本身，占位符从 1 重新开始）。"""
        cleared = self._sessions.clear(session_id)
        if self._session_store is not None:
            self._session_store.delete(session_id)
        return cleared

    def drop_session(self, session_id: str) -> bool:
        dropped = self._sessions.drop(session_id)
        if self._session_store is not None:
            dropped = self._session_store.delete(session_id) or dropped
        if session_id == self._implicit_session_id:
            self._implicit_session_id = None
        return dropped

    def mapping_of(self, session_id: str) -> dict[str, Any]:
        """导出当前会话映射（明文；只用于本地查看/落加密文件）。R1：不要上传。"""
        return self.get_session(session_id).to_dict()

    # —— 正向 / 反向 ——

    def mask_text(self, text: str, session_id: str | None = None, *, scope: str = "text") -> MaskResult:
        session = self._session_for(session_id)
        result = self._masker.mask(session, text, scope=scope)
        self._persist(session)
        return result

    def unmask_text(self, text: str, session_id: str | None = None) -> UnmaskResult:
        session = self._session_for(session_id)
        return self._masker.unmask(session, text)

    def mask_document(
        self,
        source: str | Path,
        session_id: str | None = None,
        output: str | Path | None = None,
        *,
        dry_run: bool = False,
    ) -> DocumentMaskResult:
        session = self._session_for(session_id)
        result = self._documents.mask_file(session, source, output, dry_run=dry_run)
        self._persist(session)
        return result

    # —— 映射表加密导出 / 加载 ——

    def export_mapping(self, session_id: str, path: str | Path, password: str | None = None) -> Path:
        session = self.get_session(session_id)
        secret = resolve_password(password or self._password)
        return save_sealed(path, session.to_dict(), secret)

    def load_mapping(
        self,
        path: str | Path,
        session_id: str | None = None,
        password: str | None = None,
    ) -> str:
        secret = resolve_password(password or self._password)
        raw = load_sealed(path, secret)
        sid = session_id or str(raw.get("session_id") or "")
        if not sid:
            raise ValueError("加密映射表里没有 session_id，请显式指定 session_id")
        raw["session_id"] = sid
        if self._sessions.get(sid) is not None:
            raise ValueError(f"会话已存在：{sid}；请先 clear/drop，或换一个 session_id 导入")
        session = self._sessions.attach(MaskSession.from_dict(raw))
        self._persist(session)
        return sid

    # —— 生命周期 ——

    def _persist(self, session: MaskSession) -> None:
        if self._session_store is None:
            return
        try:
            self._session_store.save(session)
        except Exception as error:  # 持久化失败不能吞掉脱敏结果，但必须告警
            if not self._store_warned:
                self._store_warned = True
                LOGGER.warning("会话映射加密落盘失败：%s", error)

    def close(self) -> None:
        self._masker.close()


# —— 模块级默认实例（单进程单配置的便捷入口）——

_default: DocMasker | None = None


def default() -> DocMasker:
    global _default
    if _default is None:
        _default = DocMasker()
    return _default


def new_session(session_id: str | None = None) -> str:
    return default().new_session(session_id)


def mask_text(text: str, session_id: str | None = None) -> MaskResult:
    return default().mask_text(text, session_id)


def unmask_text(text: str, session_id: str | None = None) -> UnmaskResult:
    return default().unmask_text(text, session_id)


def clear_session(session_id: str) -> bool:
    return default().clear_session(session_id)


def export_mapping(session_id: str, path: str | Path, password: str | None = None) -> Path:
    return default().export_mapping(session_id, path, password)


def load_mapping(path: str | Path, session_id: str | None = None, password: str | None = None) -> str:
    return default().load_mapping(path, session_id, password)


def mask_document(
    source: str | Path,
    session_id: str | None = None,
    output: str | Path | None = None,
    *,
    dry_run: bool = False,
) -> DocumentMaskResult:
    return default().mask_document(source, session_id, output, dry_run=dry_run)
