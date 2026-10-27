"""示例 ①：单文档脱敏（docx → 脱敏后的新 docx）。

运行：
    cd mask && python examples/01_mask_document.py
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from docmask import DocMasker  # noqa: E402


def build_sample_docx(path: Path) -> Path:
    """造一份带敏感信息的样例文档（真实使用时换成你的文件）。"""
    import docx

    document = docx.Document()
    document.add_heading("项目周报（内部）", level=1)
    document.add_paragraph("项目：天枢计划；客户：某某商业银行。")
    document.add_paragraph("负责人：张三，手机 13800138000，邮箱 zhangsan@example.com。")
    document.add_paragraph("服务器 10.20.30.40，部署 token: sk-abcdef0123456789abcdef。")
    table = document.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "内部编号"
    table.cell(0, 1).text = "TS-2026-001"
    table.cell(1, 0).text = "对接人"
    table.cell(1, 1).text = "李四（工号 EMP-000123）"
    document.save(str(path))
    return path


def main() -> int:
    workdir = Path(tempfile.mkdtemp(prefix="docmask-demo-"))
    source = build_sample_docx(workdir / "周报.docx")
    target = workdir / "周报.masked.docx"

    masker = DocMasker()
    session_id = masker.new_session("demo-doc")

    result = masker.mask_document(source, session_id, target)

    print("=== 脱敏后的文本（这份才可以发给 DeepSeek Harness）===")
    print(result.masked_text)
    print()
    print(f"=== 输出文档：{result.output}")
    print(f"=== 命中 {len(result.hits)} 个实体 / {result.unit_count} 个文本单元")
    for hit in result.hits:
        print(f"  {hit.placeholder:>16}  ←  {hit.entity_type}  ({hit.detector}, 复用={hit.reused})")
    if result.warnings:
        print("=== 告警 ===")
        for warning in result.warnings:
            print(f"  ! {warning}")

    # 映射表只在本地：加密导出（密码来自 DOCMASK_PASSWORD 或显式传入）
    mapping_file = workdir / "demo-doc.mapping.enc"
    masker.export_mapping(session_id, mapping_file, password="local-only-password")
    print(f"\n=== 映射表已加密导出：{mapping_file}")
    print("=== 提醒：映射表绝不随请求上传；解码它需要上面的本地密码")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
