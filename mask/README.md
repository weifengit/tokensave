# docmask —— 本地离线文档 & 对话脱敏

把文档和对话里的敏感信息换成本地会话内的占位符（`<<PER_1>>`、`<<PROJECT_2>>`…），
只把**占位符文本**发给 DeepSeek Harness；拿到回答后在本地还原成明文再展示。

- **识别**：正则（手机号/身份证/邮箱/银行卡/IP/密钥/Token）→ 自定义固定词表 → GLiNER-small 语义识别；
- **全程本地**：不调用任何云端大模型，不做 OCR，不联网（模型权重可提前下载）；
- **会话隔离**：每个对话/文档任务一份映射表，同一实体在同一会话内固定映射；
- **热加载**：配置、词表、DSH 侧边栏开关改完即生效，不用重启。

> 目录：本文档在 `mask/README.md`。DSH 插件侧的改动见仓库根 `README.md` 的「脱敏设置」一节。

---

## 1. 目录结构

```
mask/
├── docmask/
│   ├── api.py              # 对外门面：DocMasker（会话 / 脱敏 / 还原 / 导出）
│   ├── pipeline.py         # 正向脱敏 + 反向还原编排
│   ├── session.py          # 会话映射表（占位符分配的唯一权威）
│   ├── placeholder.py      # <<TYPE_ID>> 编解码
│   ├── config.py           # 配置加载 + 热加载 + 面板覆盖合并
│   ├── detection/          # regex / glossary / gliner 三个识别器 + 重叠消解
│   ├── documents/          # docx / pptx / xlsx / md / txt 解析与写回
│   ├── cache.py            # 识别结果缓存（SQLite）
│   ├── crypto.py           # 映射表加密导出（Fernet + PBKDF2）
│   ├── session_store.py    # 会话映射的本地加密存储（跨进程）
│   ├── audit.py            # 脱敏后漏检轻量检查
│   └── cli.py              # 命令行
├── config/
│   ├── docmask.json        # 示例配置（实体类型 / 词表 / 正则 / 缓存）
│   └── glossary.json       # 外部固定词表（热加载）
├── examples/               # ①单文档 ②多轮对话 ③嵌入 DSH 业务脚本
├── tests/                  # unittest，不依赖 torch/GLiNER
├── requirements.txt        # 全量（含 gliner）
└── requirements-lite.txt   # 只用正则 + 词表
```

---

## 2. 安装

```bash
cd mask
python3 -m venv .venv
source .venv/bin/activate

# 轻量：正则 + 自定义词表（约 30MB 依赖）
pip install -r requirements-lite.txt

# 全量：再加 GLiNER-small 语义识别（会装 torch，CPU/GPU 均可）
pip install -r requirements.txt
```

> **Python 版本**：`gliner` 依赖 `torch`，而 torch 目前没有 3.15/3.14 的轮子。
> 需要语义识别时请用 **Python 3.10 ~ 3.13** 建虚拟环境（例如 `python3.12 -m venv .venv`）。
> 装不上 torch 也不影响使用：程序会自动降级为「正则 + 词表」并打印告警，
> 人名/公司/地址这类需要语义判断的实体会识别不到。

装完自检：

```bash
python -m docmask config          # 打印生效配置（不含任何明文）
python -m unittest discover -s tests -v
```

---

## 3. GLiNER-small 权重：下载位置与断网使用

默认模型：`urchade/gliner_small-v2.1`（约 200MB，CPU 可跑；显存 4G 可 `device: "cuda"`）。

### 3.1 联网首次运行（自动下载）

第一次调用时 `gliner` 会从 HuggingFace 拉权重，落盘在：

```
~/.cache/huggingface/hub/models--urchade--gliner_small-v2.1/
```

下载完成后即本地推理，**之后每次调用都不再联网**。

### 3.2 断网 / 内网部署

1. 在一台能联网的机器上下载整个 `models--urchade--gliner_small-v2.1` 目录
   （或 `huggingface-cli download urchade/gliner_small-v2.1`）；
2. 拷到目标机器，例如 `/opt/models/gliner_small-v2.1`；
3. 配置里把权重指到本地目录：

```json
{
  "detectors": {
    "gliner": {
      "model": "urchade/gliner_small-v2.1",
      "model_path": "/opt/models/gliner_small-v2.1"
    }
  }
}
```

4. 建议同时设置环境变量（彻底禁止任何网络探测）：

```bash
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
```

`model_path` 存在时程序以 `local_files_only=True` 加载，离线也不会去连 HuggingFace。

### 3.3 换更大的模型

`detectors.gliner.model` 可以换成 `urchade/gliner_multi-v2.1`（多语种，更大更准）。
本次选型固定为 **GLiNER-small**，这里只是保留扩展位，默认不改。

---

## 4. 使用示例

### ① 单文档脱敏

```bash
python examples/01_mask_document.py
```

代码路径（`examples/01_mask_document.py`）：

```python
masker = DocMasker()                      # 读 config/docmask.json
sid = masker.new_session("demo-doc")      # 一份文档一个会话
result = masker.mask_document("周报.docx", sid, "周报.masked.docx")
print(result.masked_text)                 # 这份才可以发给 Harness
masker.export_mapping(sid, "mapping.enc", password="local-only-password")
```

### ② 多轮对话脱敏 + 还原

```bash
python examples/02_chat_multiturn.py
```

```python
sid = masker.new_session("demo-chat")
masked = masker.mask_text("我是张三，手机 13800138000", sid)
# → 你好，我是 <<PER_1>>，手机 <<PHONE_1>>
answer = call_deepseek_harness(masked.text)     # R1：只发占位符
print(masker.unmask_text(answer, sid).text)     # 本地还原给用户
```

同一实体（`张三`）后续再出现仍复用 `<<PER_1>>`；出现新实体才分配 `<<PER_2>>`/`<<ORG_1>>`。
指代理解（「刚才那个人」「该项目」）由模型依据上下文完成，**不需要**额外改造 LLM。

### ③ 嵌入业务脚本

```bash
python examples/03_dsh_integration.py
```

`chat_once()` 就是最小闭环：`mask_text` → 发 Harness → `unmask_text`。

---

## 5. 对外接口（`from docmask import ...`）

| 能力 | 方法 | 说明 |
| --- | --- | --- |
| 新建会话 | `DocMasker.new_session(session_id=None)` | 每个对话/文档任务一个，隔离映射 |
| 脱敏 | `mask_text(text, session_id)` | 返回 `MaskResult(text/hits/warnings)` |
| 还原 | `unmask_text(text, session_id)` | 返回 `UnmaskResult(text/restored/unknown)` |
| 文档脱敏 | `mask_document(src, session_id, out=None, dry_run=False)` | 可选写回 docx/pptx/xlsx/md/txt |
| 清空映射 | `clear_session(session_id)` | 保留会话，占位符编号从 1 重新开始 |
| 丢弃会话 | `drop_session(session_id)` | 连会话一起删 |
| 导出映射（加密） | `export_mapping(session_id, path, password=None)` | Fernet + PBKDF2，密码不落盘 |
| 加载历史映射 | `load_mapping(path, session_id=None, password=None)` | 跨进程恢复多轮上下文 |
| 热加载 | `reload_config()` | 手动强制重载（通常自动） |
| 配置快照 | `config_snapshot()` | 安全摘要，不含明文映射 |

也有模块级便捷函数（`docmask.mask_text(...)` 等），内部用同一个默认实例。

命令行：

```bash
python -m docmask mask-text   --session s1 --text "张三 13800138000" --json
python -m docmask unmask-text --session s1 --text "请联系 <<PER_1>>"
python -m docmask mask-doc    report.docx --session s1 --out report.masked.docx
# 批量：多份文档同一个会话（占位符跨文件一致），每份写 <原名>.masked<扩展名>
python -m docmask mask-doc 周报.docx 方案.pptx 名单.xlsx --session s1 --out-dir out/
python -m docmask session-export --session s1 --out m.enc
python -m docmask session-import --input m.enc
python -m docmask sessions
```

> CLI 每次都是新进程：要跨命令延续多轮对话，请打开 `session.auto_persist`
> 并导出 `DOCMASK_PASSWORD`（映射表以加密文件落在 `session.persist_dir`）。
>
> **批处理与流式输入**：批量就是给 `mask-doc` 多个文件（共用一个会话即可保证同一实体跨文件同一占位符）；
> 流式就是把陆续到达的分片（每行/每段/每个对话气泡）逐片丢给 `mask_text(session, chunk)`——
> 映射表是会话级状态，分片处理与整段处理结果一致。

---

## 6. 配置

`config/docmask.json` 主要区块：

| 区块 | 作用 |
| --- | --- |
| `runtime` | 运行时开关（总开关、各识别器、缓存、审计、阈值、热加载、会话持久化）；**DSH 设置面板写的就是这一段** |
| `detectors.regex.rules` | 内置正则逐条开关 |
| `detectors.regex.custom_rules` | 自定义正则（`name/type/pattern/group/enabled`） |
| `detectors.gliner` | 模型 id、本地权重路径、阈值、设备、窗口大小、是否必需 |
| `detectors.glossary.path` | 外部固定词表文件（相对配置文件目录） |
| `types.map` | GLiNER 标签 → 占位符类型（默认 `person→PER`、`organization→ORG`、`location→LOC`） |
| `types.custom` | 自定义实体类型：`{"label","type","terms","aliases"}` |
| `types.ignore` | 白名单：这些词永不被脱敏（如产品名） |

### 6.1 自定义实体类型

```json
{
  "types": {
    "custom": [
      { "label": "project name", "type": "PROJECT", "terms": ["天枢计划"], "aliases": ["天枢"] },
      { "label": "client name",  "type": "CLIENT",  "terms": ["某某商业银行"] },
      { "label": "internal code", "type": "INTERNAL_CODE", "terms": ["TS-2026-001"] }
    ]
  }
}
```

- `terms`/`aliases`：**固定词表**，命中即脱敏（不依赖模型）；
- `label`：交给 GLiNER 的语义标签，让它找出「同类的其它写法」；
- 占位符类型就是 `type`：`<<PROJECT_1>>`、`<<CLIENT_2>>`、`<<INTERNAL_CODE_3>>`。

### 6.2 热加载

基础配置、`~/.dsh/tokensave/docmask/runtime.json`（面板覆盖）、外部词表文件
任一 mtime 变化，**下一次调用**自动重载。想强制立即生效：`masker.reload_config()`。

---

## 7. 风险控制（代码里以 R1/R2/R3 标注）

- **R1 映射表禁止上传**：映射表只存在于本地内存/加密文件；`mask_text` 返回值里只有
  `text`（占位符文本）可以进请求体，`hits` 是本地审计字段，**不要**一起序列化发给 Harness。
- **R2 加密与密码**：导出映射表用 Fernet + PBKDF2（48 万次迭代），密码来自显式参数或
  `DOCMASK_PASSWORD`，不落盘、不进仓库、不随请求走。
- **R3 接口形状**：`ask_harness(masked_prompt)` 这类函数签名里根本没有映射表参数，
  从源头杜绝「顺手把 mapping 也传过去」。
- 日志只打印告警摘要（`138***00` 这种打码形式），不打印整条明文。

---

## 8. 缓存与漏检

- **识别缓存**：GLiNER 结果按「模型 + 阈值 + 标签 + 文本」落到
  `~/.cache/docmask/detections.db`，同一份文档重复处理不再跑模型。
  文档级不缓存「脱敏后的文本」——它依赖会话映射，缓存会串会话。
- **解析缓存**：同一进程内按 `(路径, mtime, size)` 记住解析结果。
- **漏检检查**：脱敏后再跑一遍**便宜**的规则（正则 + 词表 + 占位符完整性），
  有残留就把告警放进 `MaskResult.warnings` 并写日志；`audit.enabled=false` 可关闭。
- **白名单**：`types.ignore` 里的词不会被脱敏，避免误伤公开品牌名。

---

## 9. 测试

```bash
cd mask && python -m unittest discover -s tests -v
```

27 个用例，覆盖占位符、会话隔离、多轮复用、正则规则、重叠消解、白名单、
漏检告警、配置热加载、加密导出、五种文档读写。测试用注入的假识别器，
**不需要 torch/GLiNER**。

---

## 10. 已知限制

- **GLiNER-small 对中文效果一般**：它主要在英文语料上训练。中文场景建议
  ① 把关键实体写进 `types.custom` 固定词表；② 需要更强语义识别时换 `gliner_multi-v2.1`。
- **docx/pptx 段内样式会被归一**：同一段落里既加粗又含敏感词时，写回后整段用第一个
  run 的样式；段落级结构（标题层级、表格、编号）保留。
- **xlsx 只处理字符串单元格**，数字/公式不动。
- **不做 OCR**：图片、扫描件不处理，先转成可编辑文档。
- 页眉页脚、文本框、表格都覆盖了；批注、脚注、SmartArt 暂不处理。
