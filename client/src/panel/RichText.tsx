/**
 * 富文本渲染（主对话 / 探索者窗口 / 黑板条目共用）
 *
 * 内容来自各模型，可能是 JSON、Markdown 或纯文本。零依赖自实现，避免为渲染引入打包体积：
 *   1. 整段能 JSON.parse 的 → 语法着色；**数组套扁平对象**再进一步渲染成表格（更易读）
 *   2. JSONL（每行一个 JSON，工具输出的常见形态）→ 逐行着色；结构一致时同样出表格
 *   3. 含 Markdown 特征的 → 块级 + 行内渲染（标题/列表/代码块/引用/表格/链接/删除线/任务列表）
 *   4. 正文里**夹在文字中间**的 JSON 行 → 就地渲染成 JSON 块，不再当普通文字
 *   5. 其余 → 保留换行的纯文本
 *
 * 另导出 stripMarkdown()：给「折叠预览」用，把 ** / ` / ``` / # 等标记去掉，
 * 预览行里不再出现原始标记（用户直接看到的那些 ** 多来自这里）。
 */
import React from 'react'

// —— JSON ——

const JSON_TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g

function highlightJson(code: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  JSON_TOKEN.lastIndex = 0
  let k = 0
  while ((m = JSON_TOKEN.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index))
    const [full, str, colon, literal, num] = m
    if (str !== undefined) {
      out.push(
        <span key={k++} className={colon !== undefined ? 'ts-json-key' : 'ts-json-str'}>
          {str}
        </span>
      )
      if (colon !== undefined) out.push(colon)
    } else if (literal !== undefined) {
      out.push(
        <span key={k++} className={literal === 'null' ? 'ts-json-null' : 'ts-json-bool'}>
          {literal}
        </span>
      )
    } else if (num !== undefined) {
      out.push(
        <span key={k++} className="ts-json-num">
          {num}
        </span>
      )
    }
    last = m.index + full.length
  }
  if (last < code.length) out.push(code.slice(last))
  return out
}

/** 值 → 单元格文本（表格视图用）。 */
function cellText(v: unknown): string {
  if (v === null) return 'null'
  if (v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'boolean' || typeof v === 'number') return String(v)
  return JSON.stringify(v)
}

/**
 * 扁平对象数组 → 表格数据。
 * 只有当每一项都是对象、键集合一致、且值都是标量时才出表格——
 * 否则（嵌套/异构）老实退回着色的 JSON，避免把结构信息压扁丢掉。
 */
function tableOf(v: unknown): { keys: string[]; rows: string[][] } | null {
  if (!Array.isArray(v) || v.length === 0) return null
  const objs = v.filter((x) => x !== null && typeof x === 'object' && !Array.isArray(x))
  if (objs.length !== v.length) return null
  const keys: string[] = []
  for (const o of objs as Record<string, unknown>[]) {
    for (const k of Object.keys(o)) if (!keys.includes(k)) keys.push(k)
  }
  if (keys.length === 0 || keys.length > 8) return null
  for (const o of objs as Record<string, unknown>[]) {
    for (const k of keys) {
      const val = o[k]
      if (val !== null && val !== undefined && typeof val === 'object') return null
    }
  }
  return { keys, rows: (objs as Record<string, unknown>[]).map((o) => keys.map((k) => cellText(o[k]))) }
}

function JsonTable({ keys, rows }: { keys: string[]; rows: string[][] }) {
  return (
    <div className="ts-rich-table-wrap">
      <table className="ts-rich-table ts-rich-jsontable">
        <thead>
          <tr>{keys.map((k, i) => <th key={i}>{k}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>{r.map((c, ci) => <td key={ci}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function JsonBlock({ pretty }: { pretty: string }) {
  return (
    <pre className="ts-rich-code ts-rich-json">
      <code>{highlightJson(pretty)}</code>
    </pre>
  )
}

/** 一个已解析的 JSON 值 → 最合适的呈现（表格优先，否则着色 JSON）。 */
function JsonValue({ value }: { value: unknown }) {
  const t = tableOf(value)
  if (t) return <JsonTable keys={t.keys} rows={t.rows} />
  return <JsonBlock pretty={JSON.stringify(value, null, 2)} />
}

/** 解析「单块 JSON」：整段文本就是一个 JSON 对象/数组。 */
function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  const t = text.trim()
  if (!(t.startsWith('{') || t.startsWith('['))) return { ok: false }
  try {
    const v = JSON.parse(t)
    if (v === null || typeof v !== 'object') return { ok: false }
    return { ok: true, value: v }
  } catch {
    return { ok: false }
  }
}

/**
 * 解析 JSONL：每一非空行都是一个 JSON（工具输出最常见的样子）。
 * 要求至少 2 行，且全部解析成功——单行由 parseJson 处理。
 */
function parseJsonl(text: string): { ok: true; values: unknown[] } | { ok: false } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return { ok: false }
  const values: unknown[] = []
  for (const l of lines) {
    if (!(l.startsWith('{') || l.startsWith('['))) return { ok: false }
    try {
      values.push(JSON.parse(l))
    } catch {
      return { ok: false }
    }
  }
  return { ok: true, values }
}

/** 该行本身是否是一个完整 JSON 对象/数组（用于「文字中间夹 JSON」）。 */
function isJsonLine(line: string): boolean {
  const t = line.trim()
  if (!(t.startsWith('{') || t.startsWith('['))) return false
  if (!(t.endsWith('}') || t.endsWith(']'))) return false
  try {
    const v = JSON.parse(t)
    return v !== null && typeof v === 'object'
  } catch {
    return false
  }
}

/**
 * 从一行文字里抽出内嵌的 JSON 对象/数组（工具输出常见形态，如 `result: {"ok":true}`）。
 * 用括号配对 + JSON.parse 双重校验，避免把普通文字里的花括号误当 JSON。
 * @returns 命中则给出前后文字与解析值；否则 null
 */
function splitEmbeddedJson(line: string): { before: string; json: unknown; after: string } | null {
  const start = line.search(/[{[]/)
  if (start < 0) return null
  const open = line[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < line.length; i++) {
    const c = line[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; continue }
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) {
        const raw = line.slice(start, i + 1)
        try {
          const v = JSON.parse(raw)
          if (v === null || typeof v !== 'object') return null
          // 太短的（如 `{}`）不值得单独成块
          if (raw.length < 6) return null
          return { before: line.slice(0, start), json: v, after: line.slice(i + 1) }
        } catch {
          return null
        }
      }
    }
  }
  return null
}

// —— Markdown 行内 ——

/**
 * 行内标记。注意几处刻意的取舍：
 * - `**粗**` 允许内部出现单个 `*`（模型常写 `**a*b**`），但要求成对，避免把 `a ** b` 误判；
 * - **不支持** `__粗__` / `_斜_`：标识符里下划线极常见（`__init__`、`my_file_name`），
 *   渲染它们会把代码标识符弄坏，得不偿失；
 * - 支持 `~~删除~~`。
 */
const INLINE =
  /(`[^`\n]+`)|(\*\*(?:[^*\n]|\*(?!\*))+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\s]+\))|(```+)/g

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  INLINE.lastIndex = 0
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyBase}-i${k++}`
    if (tok.startsWith('`')) {
      out.push(
        <code key={key} className="ts-rich-inline-code">
          {tok.slice(1, -1)}
        </code>
      )
    } else if (tok.startsWith('**')) {
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('~~')) {
      out.push(<del key={key}>{tok.slice(2, -2)}</del>)
    } else if (tok.startsWith('*')) {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>)
    } else if (tok.startsWith('```')) {
      // 行内出现的反引号串（如「用 ``` 包围」）——当作行内代码显示，
      // 否则这三个反引号会原样裸露在正文里。
      out.push(<code key={key} className="ts-rich-inline-code">{tok}</code>)
    } else {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)
      if (mm) {
        out.push(
          <a key={key} href={mm[2]} target="_blank" rel="noreferrer noopener">
            {mm[1]}
          </a>
        )
      } else out.push(tok)
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

// —— Markdown 块级 ——

/*
 * 围栏行：``` 后可跟语言标识。
 *
 * 用 [^\s`]* 而不是 \w+：语言标识允许连字符与其他符号，
 * 实测会话里出现 ```dsh-ui / ```c++ —— 旧的 \w+ 不匹配，
 * 导致这类围栏**不被当代码块**，整段连同 ``` 原样裸露（渲染修复没生效的真正原因）。
 */
const FENCE = /^\s*```([^\s`]*)\s*$/
const HEADING = /^(#{1,6})\s+(.*)$/
const UL = /^\s*[-*+]\s+(.*)$/
const OL = /^\s*(\d+)[.)]\s+(.*)$/
const HR = /^\s*([-*_])\1{2,}\s*$/
const QUOTE = /^\s*>\s?(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const TASK = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/

function splitRow(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|').map((c) => c.trim())
}

/** 折叠预览用：去掉 Markdown 标记，只留可读文字（预览行不再出现 ** / ``` / #）。 */
export function stripMarkdown(text: string): string {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*```.*$/gm, '')          // 围栏行
    .replace(/`([^`\n]+)`/g, '$1')         // 行内代码
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')   // 粗体
    .replace(/~~([^~\n]+)~~/g, '$1')       // 删除线
    .replace(/(^|\s)\*([^*\n]+)\*/g, '$1$2') // 斜体
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')    // 标题
    .replace(/^\s*>\s?/gm, '')             // 引用
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '') // 任务项
    .replace(/^\s*[-*+]\s+/gm, '')         // 无序列表
    .replace(/^\s*\d+[.)]\s+/gm, '')       // 有序列表
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1') // 链接
    .replace(/\s+/g, ' ')
    .trim()
}

function renderMarkdown(src: string): React.ReactNode[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: React.ReactNode[] = []
  let i = 0
  let key = 0
  const push = (n: React.ReactNode) => out.push(<React.Fragment key={`b${key++}`}>{n}</React.Fragment>)

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i++
      continue
    }

    // 代码块
    const fence = FENCE.exec(line)
    if (fence) {
      const lang = (fence[1] || '').toLowerCase()
      const buf: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i])) buf.push(lines[i++])
      i++ // 跳过收尾围栏
      const code = buf.join('\n')
      if (lang === 'json') {
        const j = parseJson(code)
        push(j.ok ? <JsonValue value={j.value} /> : <JsonBlock pretty={code} />)
      } else {
        push(
          <pre className="ts-rich-code">
            <code>{code}</code>
          </pre>
        )
      }
      continue
    }

    // 分隔线
    if (HR.test(line)) {
      push(<hr className="ts-rich-hr" />)
      i++
      continue
    }

    // 标题
    const h = HEADING.exec(line)
    if (h) {
      const level = h[1].length
      const Tag = `h${level}`
      push(React.createElement(Tag, { className: `ts-rich-h ts-rich-h${level}` }, inline(h[2], `h${key}`)))
      i++
      continue
    }

    // 表格：当前行含 | 且下一行是分隔行
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const head = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i++]))
      }
      push(
        <div className="ts-rich-table-wrap">
          <table className="ts-rich-table">
            <thead>
              <tr>
                {head.map((c, ci) => (
                  <th key={ci}>{inline(c, `th${key}-${ci}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci}>{inline(c, `td${key}-${ri}-${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    // 引用
    if (QUOTE.test(line)) {
      const buf: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        buf.push(QUOTE.exec(lines[i])![1])
        i++
      }
      push(
        <blockquote className="ts-rich-quote">
          {buf.map((b, bi) => (
            <p key={bi}>{inline(b, `q${key}-${bi}`)}</p>
          ))}
        </blockquote>
      )
      continue
    }

    // 任务列表（- [ ] / - [x]）—— 必须排在普通无序列表之前
    if (TASK.test(line)) {
      const items: { done: boolean; text: string }[] = []
      while (i < lines.length && TASK.test(lines[i])) {
        const t = TASK.exec(lines[i])!
        items.push({ done: t[1].toLowerCase() === 'x', text: t[2] })
        i++
      }
      push(
        <ul className="ts-rich-ul ts-rich-tasks">
          {items.map((it, ii) => (
            <li key={ii} className={it.done ? 'done' : ''}>
              <span className="ts-rich-check">{it.done ? '☑' : '☐'}</span>
              {inline(it.text, `task${key}-${ii}`)}
            </li>
          ))}
        </ul>
      )
      continue
    }

    // 无序列表
    if (UL.test(line)) {
      const items: string[] = []
      while (i < lines.length && UL.test(lines[i])) {
        items.push(UL.exec(lines[i])![1])
        i++
      }
      push(
        <ul className="ts-rich-ul">
          {items.map((it, ii) => (
            <li key={ii}>{inline(it, `ul${key}-${ii}`)}</li>
          ))}
        </ul>
      )
      continue
    }

    // 有序列表
    if (OL.test(line)) {
      const items: string[] = []
      while (i < lines.length && OL.test(lines[i])) {
        items.push(OL.exec(lines[i])![2])
        i++
      }
      push(
        <ol className="ts-rich-ol">
          {items.map((it, ii) => (
            <li key={ii}>{inline(it, `ol${key}-${ii}`)}</li>
          ))}
        </ol>
      )
      continue
    }

    // 独立成行的 JSON（工具输出常夹在文字中间）
    if (isJsonLine(line)) {
      try {
        push(<JsonValue value={JSON.parse(line.trim())} />)
      } catch {
        push(<p className="ts-rich-p">{inline(line, `p${key}`)}</p>)
      }
      i++
      continue
    }
    // 段落：把连续的非块级行**合并成一段**再渲染。
    // 为什么合并：跨行的 `**加粗**`（模型常把一段话折行）需要先拼起来才能配对；
    // 但行内夹带的 JSON（`result: {"ok":true}`）要单独抽出来渲染，所以先分组。
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !FENCE.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !HR.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !TASK.test(lines[i]) &&
      !UL.test(lines[i]) &&
      !OL.test(lines[i]) &&
      !isJsonLine(lines[i])
    ) {
      para.push(lines[i++])
    }
    let buf: string[] = []
    const flush = () => {
      if (buf.length > 0) {
        push(<p className="ts-rich-p">{inline(buf.join(' '), `p${key}`)}</p>)
        buf = []
      }
    }
    for (const pl of para) {
      const seg = splitEmbeddedJson(pl)
      if (seg) {
        flush()
        push(
          <div className="ts-rich-mixed">
            {seg.before.trim() && <p className="ts-rich-p">{inline(seg.before, `p${key}`)}</p>}
            <JsonValue value={seg.json} />
            {seg.after.trim() && <p className="ts-rich-p">{inline(seg.after, `p${key}`)}</p>}
          </div>
        )
      } else {
        buf.push(pl)
      }
    }
    flush()
  }

  return out
}

// —— 入口 ——

/*
 * “要不要走 Markdown 渲染”的判据。
 *
 * 这里必须与 renderMarkdown / inline 实际支持的语法**保持一致**：
 * 只要正文里出现任一个我们真能渲染的标记就进渲染分支。
 * 早先版本漏了几类，导致整段退化为纯文本、标记原样显示：
 *   - `**a*b**`（粗体内部含单个星号）——旧正则 `\*\*[^*]+\*\*` 要求内部无星号；
 *   - 句中夹 JSON（`result: {"ok":true}`）——旧正则只认行首的 `{`；
 *   - 行内三个反引号（``` 写在文字中间）——旧正则只认成对的单反引号；
 *   - `~~删除~~`、任务列表、行内任意位置的链接。
 */
const MD_HINT = /^\s{0,3}(?:#{1,6}\s|```|>\s?|[-*+]\s|\d+[.)]\s|\|)|\*\*(?:[^*]|\*(?!\*))+\*\*|~~[^~]+~~|`[^`\n]+`|```|\[[^\]\n]+\]\([^)\s]+\)|\{[^{}\n]*"[^"\n]+"\s*:/m

export function RichText({ text }: { text: string }) {
  // 整段 JSON
  const j = parseJson(text)
  if (j.ok) return <JsonValue value={j.value} />
  // JSONL（每行一个 JSON）
  const jl = parseJsonl(text)
  if (jl.ok) {
    // 结构一致时出表格；否则逐行着色
    const t = tableOf(jl.values)
    if (t) return <JsonTable keys={t.keys} rows={t.rows} />
    return (
      <div className="ts-rich-jsonl">
        {jl.values.map((v, i) => <JsonBlock key={i} pretty={JSON.stringify(v, null, 2)} />)}
      </div>
    )
  }
  // 判据跑在**折叠换行后**的文本上：跨行的 `**加粗**` 只有拼成一段才能配对，
  // 而 renderMarkdown 里的段落也会做同样的拼接（两者口径必须一致）。
  if (MD_HINT.test(text) || MD_HINT.test(text.replace(/\s*\n\s*/g, ' '))) {
    return <div className="ts-rich">{renderMarkdown(text)}</div>
  }
  return <pre className="ts-rich-plain">{text}</pre>
}
