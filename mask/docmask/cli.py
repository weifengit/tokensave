"""命令行入口：`python -m docmask <子命令>`。

CLI 每次都是新进程，所以多轮对话要么同一条命令里连续调用（示例见 examples/），
要么开启会话自动持久化（`session.auto_persist` + `DOCMASK_PASSWORD`）。
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any

from .api import DocMasker
from .models import DocumentMaskResult, MaskResult, UnmaskResult


def _build_masker(args: argparse.Namespace) -> DocMasker:
    return DocMasker(
        config_path=args.config,
        ui_overrides_path=args.ui_overrides,
        password=getattr(args, "password", None),
    )


def _print_result(result: MaskResult | UnmaskResult, *, as_json: bool) -> None:
    if as_json:
        print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
        return
    print(result.text)
    for warning in result.warnings:
        print(f"[告警] {warning}", file=sys.stderr)


def _print_document_result(result: DocumentMaskResult, *, as_json: bool) -> None:
    if as_json:
        print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
        return
    print(result.masked_text)
    if result.output:
        print(f"[输出] {result.output}", file=sys.stderr)
    print(f"[统计] {result.unit_count} 个文本单元 / {len(result.hits)} 个实体", file=sys.stderr)
    for warning in result.warnings:
        print(f"[告警] {warning}", file=sys.stderr)


def _read_input(text: str | None, file: str | None) -> str:
    if text is not None:
        return text
    if file:
        return Path(file).expanduser().read_text(encoding="utf-8")
    return sys.stdin.read()


def cmd_mask_text(args: argparse.Namespace) -> int:
    masker = _build_masker(args)
    result = masker.mask_text(_read_input(args.text, args.file), args.session)
    _print_result(result, as_json=args.json)
    return 0


def cmd_unmask_text(args: argparse.Namespace) -> int:
    masker = _build_masker(args)
    result = masker.unmask_text(_read_input(args.text, args.file), args.session)
    _print_result(result, as_json=args.json)
    return 0


def cmd_mask_doc(args: argparse.Namespace) -> int:
    masker = _build_masker(args)
    sources = list(args.input)
    if len(sources) > 1 and args.out:
        raise ValueError("多个输入文件时请用 --out-dir（--out 只能配单个文件）")
    outputs = []
    for source in sources:
        target = args.out
        if target is None and args.out_dir:
            path = Path(source)
            target = str(Path(args.out_dir).expanduser() / f"{path.stem}.masked{path.suffix}")
        outputs.append((source, target))

    for source, target in outputs:
        result = masker.mask_document(source, args.session, target, dry_run=args.dry_run)
        _print_document_result(result, as_json=args.json)
        if len(outputs) > 1 and not args.json:
            print(f"[批量] {source} → {result.output or '（仅预览）'}", file=sys.stderr)
    return 0


def cmd_sessions(args: argparse.Namespace) -> int:
    masker = _build_masker(args)
    payload = {"sessions": []}
    for session_id in masker.session_ids():
        try:
            session = masker.get_session(session_id)
        except KeyError:
            continue
        payload["sessions"].append(
            {
                "session_id": session_id,
                "entities": session.placeholder_count(),
                "mapping": [record.to_dict() for record in session.entities()],
            }
        )
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def cmd_session_clear(args: argparse.Namespace) -> int:
    masker = _build_masker(args)
    cleared = masker.clear_session(args.session)
    print(json.dumps({"session": args.session, "cleared": cleared}, ensure_ascii=False))
    return 0


def cmd_session_export(args: argparse.Namespace) -> int:
    masker = _build_masker(args)
    path = masker.export_mapping(args.session, args.out, args.password)
    print(json.dumps({"session": args.session, "exported": str(path)}, ensure_ascii=False))
    return 0


def cmd_session_import(args: argparse.Namespace) -> int:
    masker = _build_masker(args)
    session_id = masker.load_mapping(args.input, args.session, args.password)
    print(json.dumps({"session": session_id, "imported_from": str(Path(args.input).expanduser())}, ensure_ascii=False))
    return 0


def cmd_config(args: argparse.Namespace) -> int:
    masker = _build_masker(args)
    snapshot: dict[str, Any] = masker.config_snapshot()
    print(json.dumps(snapshot, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="docmask",
        description="本地离线文档 & 对话脱敏工具（正则 + 自定义词表 + GLiNER-small，不联网）",
    )
    parser.add_argument("--config", help="基础配置文件路径（默认 config/docmask.json）")
    parser.add_argument("--ui-overrides", help="面板覆盖配置文件路径（默认 ~/.dsh/tokensave/docmask/runtime.json）")
    parser.add_argument("--password", help="映射表加密密码（也可用环境变量 DOCMASK_PASSWORD）")
    parser.add_argument("-v", "--verbose", action="store_true", help="打开调试日志")
    sub = parser.add_subparsers(dest="command", required=True)

    mask_text = sub.add_parser("mask-text", help="脱敏一段文本（走当前会话映射表）")
    mask_text.add_argument("--session", required=True, help="会话 id（同一对话/文档复用同一个）")
    mask_text.add_argument("--text", help="待脱敏文本")
    mask_text.add_argument("--file", help="从文件读取待脱敏文本")
    mask_text.add_argument("--json", action="store_true", help="输出 JSON（含命中明细）")
    mask_text.set_defaults(func=cmd_mask_text)

    unmask_text = sub.add_parser("unmask-text", help="把带占位符的回答还原成明文")
    unmask_text.add_argument("--session", required=True)
    unmask_text.add_argument("--text")
    unmask_text.add_argument("--file")
    unmask_text.add_argument("--json", action="store_true")
    unmask_text.set_defaults(func=cmd_unmask_text)

    mask_doc = sub.add_parser("mask-doc", help="脱敏文档（docx/pptx/xlsx/md/txt）")
    mask_doc.add_argument("input", nargs="+", help="源文件（可多个，批量处理）")
    mask_doc.add_argument("--session", required=True)
    mask_doc.add_argument("--out", help="输出文件（不填则只打印脱敏文本，不写文件）")
    mask_doc.add_argument("--out-dir", help="批量输出目录（每份写 <原名>.masked<扩展名>）")
    mask_doc.add_argument("--dry-run", action="store_true", help="只脱敏不写文件")
    mask_doc.add_argument("--json", action="store_true")
    mask_doc.set_defaults(func=cmd_mask_doc)

    sessions = sub.add_parser("sessions", help="列出本地会话与映射（明文，仅本地查看）")
    sessions.set_defaults(func=cmd_sessions)

    clear = sub.add_parser("session-clear", help="清空某个会话的映射")
    clear.add_argument("--session", required=True)
    clear.set_defaults(func=cmd_session_clear)

    export = sub.add_parser("session-export", help="加密导出会话映射表")
    export.add_argument("--session", required=True)
    export.add_argument("--out", required=True)
    export.set_defaults(func=cmd_session_export)

    imp = sub.add_parser("session-import", help="加载历史映射表（加密文件）")
    imp.add_argument("--input", required=True)
    imp.add_argument("--session", help="恢复成哪个会话 id（默认用文件里的）")
    imp.set_defaults(func=cmd_session_import)

    config = sub.add_parser("config", help="打印当前生效配置（不含明文映射）")
    config.set_defaults(func=cmd_config)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
    )
    try:
        return int(args.func(args))
    except (KeyError, ValueError, FileNotFoundError, RuntimeError) as error:
        print(f"[错误] {error}", file=sys.stderr)
        return 2
