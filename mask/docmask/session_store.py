"""会话映射表的本地加密存储（供 CLI / 跨进程多轮对话使用）。

进程内嵌场景不需要它：直接把 `MaskSession` 放在内存里即可。
一旦要跨进程（每次 CLI 调用都是新进程）就必须落盘，而落盘一律加密。
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .config import expand_path
from .crypto import load_sealed, resolve_password, save_sealed
from .session import MaskSession

_UNSAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


class EncryptedSessionStore:
    def __init__(self, directory: str | Path, password: str | None = None, *, password_env: str = "DOCMASK_PASSWORD"):
        self.directory = expand_path(directory)
        self._password = password
        self._password_env = password_env

    def _secret(self) -> str:
        return resolve_password(self._password, env=self._password_env)

    def path_for(self, session_id: str) -> Path:
        safe = _UNSAFE_NAME.sub("_", session_id)[:64] or "session"
        return self.directory / f"{safe}.session.enc"

    def save(self, session: MaskSession) -> Path:
        return save_sealed(self.path_for(session.session_id), session.to_dict(), self._secret())

    def load(self, session_id: str) -> MaskSession | None:
        path = self.path_for(session_id)
        if not path.is_file():
            return None
        raw: dict[str, Any] = load_sealed(path, self._secret())
        raw.setdefault("session_id", session_id)
        return MaskSession.from_dict(raw)

    def delete(self, session_id: str) -> bool:
        path = self.path_for(session_id)
        if path.is_file():
            path.unlink()
            return True
        return False

    def session_ids(self) -> list[str]:
        if not self.directory.is_dir():
            return []
        return sorted(path.name.removesuffix(".session.enc") for path in self.directory.glob("*.session.enc"))
