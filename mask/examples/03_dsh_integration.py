"""示例 ③：嵌入「调用 DeepSeek Harness」的业务脚本。

R1/R3（风险点）在代码里逐条标注：
- 只把 `masked.text` 交给 Harness；
- 映射表、密码、明文都留在本地；
- 还原发生在「拿到回答之后、展示给用户之前」，不进入模型上下文。
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from docmask import DocMasker  # noqa: E402


def ask_harness(masked_prompt: str) -> str:
    """占位：真实实现里换成你的 DSH 调用（HTTP / SDK / CLI 都行）。"""
    # R3：函数签名里根本没有映射表参数——想传也传不出去。
    preview = masked_prompt[:24] + "…" if len(masked_prompt) > 24 else masked_prompt
    return f"已收到你的问题（{preview}），我会按上下文处理。"


def chat_once(masker: DocMasker, session_id: str, user_text: str, sender: Callable[[str], str]) -> str:
    """一轮对话的完整闭环：脱敏 → 发模型 → 还原。"""
    masked = masker.mask_text(user_text, session_id)  # 明文只在本地
    if masked.warnings:
        # 漏检告警必须让人看到，而不是静默发出去
        print("[告警] " + "；".join(masked.warnings))

    answer = sender(masked.text)  # R1：只发占位符文本
    restored = masker.unmask_text(answer, session_id)  # 本地还原，模型看不到明文
    return restored.text


def main() -> int:
    masker = DocMasker()
    session_id = masker.new_session("demo-integration")

    user_text = "我是李四，邮箱 lisi@example.com，在跟进 天枢计划。"
    print("用户输入：", user_text)

    masked = masker.mask_text(user_text, session_id)
    print("发给 Harness：", masked.text)

    answer = ask_harness(masked.text)
    print("Harness 原始回答：", answer)

    print("还原后展示：", masker.unmask_text(answer, session_id).text)
    print("chat_once 演示：", chat_once(masker, session_id, "再补充一个联系方式：13900139000", ask_harness))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
