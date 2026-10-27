"""示例 ②：多轮对话脱敏 + 还原（不联网，用一个假的「模型回答」演示）。

要点：
- 同一个 session_id 贯穿整段对话 → 同一实体永远同一个占位符；
- 后续轮次再出现明文敏感词，自动复用已有映射；出现新实体才新增；
- 模型只看到占位符，所以「刚才那个人/该项目」这类指代它照样能靠上下文理解。
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from docmask import DocMasker  # noqa: E402


def fake_llm_reply(masked_text: str, hits) -> str:
    """假模型：用占位符复述（真实场景这里换成调用 DeepSeek Harness）。"""
    placeholders = [hit.placeholder for hit in hits]
    if not placeholders:
        return "好的，我记下了。"
    subject = placeholders[0]
    others = "、".join(placeholders[1:]) if len(placeholders) > 1 else "相关方"
    return (
        f"收到，关于 {subject}：我已记录你和 {others} 的约定，"
        f"下一步建议先确认时间窗口，再同步给 {subject} 的对接人。"
    )


def main() -> int:
    masker = DocMasker()
    session_id = masker.new_session("demo-chat")

    turns = [
        "你好，我是张三，手机 13800138000，负责天枢计划。",
        "这次是和某某商业银行对接，内部编号 TS-2026-001。",
        "刚才那个项目，张三这边还想再确认一下时间。",
    ]

    for index, user_text in enumerate(turns, start=1):
        masked = masker.mask_text(user_text, session_id)
        print(f"—— 第 {index} 轮 ——")
        print(f"用户（明文，仅本地）  : {user_text}")
        print(f"发给 Harness（占位符）: {masked.text}")
        if masked.warnings:
            for warning in masked.warnings:
                print(f"  告警：{warning}")

        reply = fake_llm_reply(masked.text, masked.hits)
        print(f"Harness 回答（占位符）: {reply}")
        restored = masker.unmask_text(reply, session_id)
        print(f"展示给用户（已还原）  : {restored.text}")
        print()

    mapping = masker.get_session(session_id).to_dict()
    print("=== 本地映射表（绝不上传）===")
    for entity in mapping["entities"]:
        print(f"  {entity['placeholder']:>16}  ←  {entity['original']}  ({entity['type']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
