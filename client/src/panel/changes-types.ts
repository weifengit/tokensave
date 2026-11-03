/**
 * 宿主「本轮变更档案」的数据形状（与 `/api/changes.summary`、`/api/changes.diff`
 * 的 JSON 对齐，见 dsh-client-ui-deliverables 的 isChangesSummary / isChangesDiff）。
 *
 * 单独成文件而不是塞进 changes-api.ts：类型是契约、会被 UI 层与自检脚本共用，
 * 放在这里任何一层都能不引入 fetch 逻辑地引用它。
 */

/** 一个被改动的文件（display 是宿主算好的相对路径，path 是工作区内原样路径）。 */
export interface ChangedFile {
  path: string
  display: string
  added: number
  deleted: number
  /** 二进制文件（宿主明说算不出行数） */
  binary?: true
  /** 超过 maxFileBytes，宿主拒绝算行数 */
  oversized?: true
}

/** 一轮的变更清单：files 与 total 可能不等（total 是宿主侧总数，files 可能被 maxFiles 截断）。 */
export interface ChangesSummary {
  turn: number
  files: ChangedFile[]
  total: number
  added: number
  deleted: number
}

/** diff 里的一行：首字符是 '+' / '-' / ' '（与 unified diff 同口径）。 */
export type DiffLine = string

/** diff 的一个 hunk（老/新起始行与行数 + 行文本）。 */
export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

/** 一种可渲染的对比结果：文本（带 hunks）、二进制、超大文件。 */
export type ChangesDiff =
  | {
    kind: 'text'
    path: string
    display: string
    /** 该文件在轮开始/结束时是否存在（新建 / 删除据此判定） */
    before: boolean
    after: boolean
    hunks: DiffHunk[]
    /** 对比超时，宿主降级给了粗粒度结果 */
    coarse: boolean
  }
  // 拆成两个独立成员（而非 `kind: 'binary' | 'oversized'`）：分支判别符本身是联合时，
  // `state.kind === 'binary' || state.kind === 'oversized'` 无法把这个成员整体排除，
  // 后面的 `state.hunks` 就拿不到 text 分支的窄化（TS 实测会报 TS2339）。
  | { kind: 'binary'; path: string; display: string }
  | { kind: 'oversized'; path: string; display: string }

/** 预览读取状态机（与宿主 HostReadStore 的 loading/failed 语义对齐）。 */
export type ChangesDiffState = ChangesDiff | 'loading' | 'error' | 'missing'
