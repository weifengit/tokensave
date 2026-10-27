"""映射表的加密落盘（Fernet + PBKDF2）。

R2（风险点）：导出的映射表是**明文映射的密文**，密码不做任何持久化。
密码来源优先级：显式参数 → 环境变量 `DOCMASK_PASSWORD`。
不要把密码写进代码或仓库；也不要把 .enc 文件和密码放在同一个同步目录里。
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Any

MAGIC = b"DOCMASK-ENC-1\n"
DEFAULT_ITERATIONS = 480_000
PASSWORD_ENV = "DOCMASK_PASSWORD"


class CryptoUnavailable(RuntimeError):
    """缺少 cryptography 依赖。"""


def _require_crypto():
    try:
        from cryptography.fernet import Fernet
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    except Exception as error:  # pragma: no cover - 取决于运行环境
        raise CryptoUnavailable(
            f"加密导出需要 cryptography：pip install cryptography（当前：{error}）"
        ) from error
    return Fernet, PBKDF2HMAC, hashes


def resolve_password(password: str | None = None, *, env: str = PASSWORD_ENV) -> str:
    value = password or os.environ.get(env) or ""
    if not value:
        raise ValueError(
            f"缺少映射表密码：请显式传 password，或设置环境变量 {env}。"
            "（密码不会落盘，也不会随请求上传）"
        )
    return value


def _derive_key(password: str, salt: bytes, iterations: int) -> bytes:
    Fernet, PBKDF2HMAC, hashes = _require_crypto()
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations)
    return base64.urlsafe_b64encode(kdf.derive(password.encode("utf-8")))


def seal(payload: dict[str, Any], password: str, *, iterations: int = DEFAULT_ITERATIONS) -> bytes:
    Fernet, _, _ = _require_crypto()
    salt = os.urandom(16)
    key = _derive_key(password, salt, iterations)
    token = Fernet(key).encrypt(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    envelope = {
        "v": 1,
        "kdf": "pbkdf2-sha256",
        "iter": iterations,
        "salt": base64.b64encode(salt).decode("ascii"),
        "token": base64.b64encode(token).decode("ascii"),
    }
    return MAGIC + json.dumps(envelope).encode("utf-8")


def unseal(blob: bytes, password: str) -> dict[str, Any]:
    Fernet, _, _ = _require_crypto()
    if not blob.startswith(MAGIC):
        raise ValueError("不是 docmask 加密映射表（缺少文件头）")
    try:
        envelope = json.loads(blob[len(MAGIC) :].decode("utf-8"))
        salt = base64.b64decode(envelope["salt"])
        token = base64.b64decode(envelope["token"])
        iterations = int(envelope.get("iter", DEFAULT_ITERATIONS))
    except (ValueError, KeyError) as error:
        raise ValueError(f"加密映射表损坏：{error}") from error
    key = _derive_key(password, salt, iterations)
    try:
        plain = Fernet(key).decrypt(token)
    except Exception as error:  # 密码错误或文件被改
        raise ValueError(f"解密失败（密码错误或文件损坏）：{error}") from error
    data = json.loads(plain.decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError("解密后的映射表不是 JSON 对象")
    return data


def save_sealed(path: str | Path, payload: dict[str, Any], password: str) -> Path:
    target = Path(path).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    blob = seal(payload, password)
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_bytes(blob)
    tmp.replace(target)  # 原子替换：中途崩溃不会留下半截映射表
    return target


def load_sealed(path: str | Path, password: str) -> dict[str, Any]:
    source = Path(path).expanduser()
    return unseal(source.read_bytes(), password)
