// 接口类型汇总（契约单一来源；原 docs/CONTRACTS.md 已删，冻结规则见 docs/MAINTENANCE.md）。
// 规则：接口改动先改本文档（types.ts 即契约本身），再改实现；冻结口径见 docs/MAINTENANCE.md。

// —— 已在各自契约模块中定义的类型，此处仅 re-export 汇总 ——
// 场景类型（实现在 src/scenario/detector.ts）
export type { Scenario } from './scenario/detector'
// 黑板契约（实现在 src/tools/blackboard-ops.ts）
export type { BoardTopic, BlackboardEntry } from './tools/blackboard-ops'

// —— 工具：tokensave_delegate 输入 schema ——
export interface DelegateInput {
  task_description: string   // required
  file_path?: string         // 可选，目标文件路径
  explorer_count?: number    // 默认 3
}

// —— 工具：tokensave_delegate 输出 schema ——
export interface DelegateOutput {
  brief: string              // required，最终任务简报（含 tokensave-brief 标记）
  scenario: string           // required，'from_scratch' | 'edit_existing'
}

// —— PROJECT_MARKERS（用于场景识别） ——
export const PROJECT_MARKERS = [
  'package.json', 'Cargo.toml', 'pyproject.toml',
  'go.mod', 'pom.xml', 'build.gradle', '.git'
]

// —— 编辑意图关键词 ——
export const editKeywords = ['修改', '修复', '改一下', '优化', '重构', '更新', '替换', '删除']

// —— 探索者预设（src/orchestration/parallel-explorer.ts） ——
export interface ExplorerConfig {
  model: string
  label: string
  focus: string
}

export const EXPLORER_PRESETS: ExplorerConfig[] = [
  { model: 'our-free-model/mimo-v2.6-flash-free', label: 'MiMo探索者', focus: '边界条件与异常处理' },
  { model: 'our-free-model/nemotron-3-ultra-free', label: 'Nemotron探索者', focus: '性能与实现复杂度' },
]
