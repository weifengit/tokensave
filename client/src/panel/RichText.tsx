/**
 * 富文本渲染（黑板条目正文）
 *
 * 黑板里的内容来自各模型：可能是 JSON、Markdown 或纯文本。
 * 这里零依赖自实现三档渲染，避免为渲染引入打包体积：
 *   1. 能 JSON.parse 的 → 语法着色的格式化 JSON
 *   2. 含 Markdown 特征的 → 块级 + 行内渲染（标题/列表/代码块/引用/表格/链接）
 *   3. 其余 → 保留换行的纯文本
 * 代码块标注 ```json 时同样走 JSON 着色。
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

function tryJson(text: string): { ok: true; pretty: string } | { ok: false } {
  const t = text.trim()
  if (!(t.startsWith('{') || t.startsWith('['))) return { ok: false }
  try {
    const v = JSON.parse(t)
    if (v === null || typeof v !== 'object') return { ok: false }
    return { ok: true, pretty: JSON.stringify(v, null, 2) }
  } catch {
    return { ok: false }
  }
}

function JsonBlock({ pretty }: { pretty: string }) {
  return (
    <pre className="ts-rich-code ts-rich-json">
      <code>{highlightJson(pretty)}</code>
    </pre>
  )
}

// —— Markdown 行内 ——

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\s]+\))/g

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
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('*')) {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>)
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

const FENCE = /^\s*```(\w+)?\s*$/
const HEADING = /^(#{1,6})\s+(.*)$/
const UL = /^\s*[-*+]\s+(.*)$/
const OL = /^\s*(\d+)[.)]\s+(.*)$/
const HR = /^\s*([-*_])\1{2,}\s*$/
const QUOTE = /^\s*>\s?(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

function splitRow(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|').map((c) => c.trim())
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
        const j = tryJson(code)
        push(<JsonBlock pretty={j.ok ? j.pretty : code} />)
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

    // 段落（连续非空、且不开启新块）
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !FENCE.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !HR.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !UL.test(lines[i]) &&
      !OL.test(lines[i])
    ) {
      para.push(lines[i++])
    }
    push(<p className="ts-rich-p">{inline(para.join(' '), `p${key}`)}</p>)
  }

  return out
}

// —— 入口 ——

const MD_HINT =
  /^\s{0,3}(#{1,6}\s|```|>\s?|[-*+]\s|\d+[.)]\s|\|)|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)/m

export function RichText({ text }: { text: string }) {
  const json = tryJson(text)
  if (json.ok) return <JsonBlock pretty={json.pretty} />
  if (MD_HINT.test(text)) return <div className="ts-rich">{renderMarkdown(text)}</div>
  return <pre className="ts-rich-plain">{text}</pre>
}
