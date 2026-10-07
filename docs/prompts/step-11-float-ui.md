# Step 11：浮窗可观测性（客户端）

## 前置
Step 10 完成，dsh-float-window >= 0.2 已安装。

## 目标
每个探索者会话挂一个浮窗，实时显示对话流；简报查看器；上下文注入标记。

## 只看这些
- docs/CONTRACTS.md（浮窗 storageKey 规则、简报标记）
- client/src/index.ts
- client/src/float/mount.tsx
- client/src/components/ExplorerStream.tsx
- client/src/components/BriefViewer.tsx

## 背景：三层可观测性
1. **探索者浮窗（并行可见）**：每个探索者会话挂一个 FloatWindow
2. **黑板看板（状态可见）**：dsh-call-session 自带的 Canvas 标签页，
   拓扑呈现工作区分组列、运行/就绪状态节点、黑板条目及存活倒计时、
   调用连线轨迹。悬停高亮 1-Hop 关联链路，双击节点展开只读详情抽屉。
   **你不需要自己画看板。**
3. **上下文注入检查（采纳可见）**：dsh-llm-call-inspector 在 Chat 和
   Trajectory 旁边新增 LLM Calls 视图，逐条检查 llm/stream 调用。
   搜索 tokensave-brief 标记即可看到 DSH 实际收到的简报内容。

## dsh-float-window 关键特性
- 三态窗口（浮动/贴边竖栏/最小化）
- 四角缩放
- 老板键自动分配（默认 Alt+S，多窗自动分配 Alt+X → Alt+Z → Alt+C → ...）
- 多窗共存
- 内容永不重载
- 多窗识别走 `window.__dshFloatWindows` 全局注册表
- **要求同页所有浮窗都运行 >= 0.2**

## 实现

### client/src/index.ts
```typescript
import type { Context } from '@deepseek-ai/cordis'
import { mountExplorerWindows } from './float/mount'

export const inject = { slots: true }

export function apply(ctx: Context) {
  // 监听 tokensave 工具执行结果，自动挂载浮窗
  ctx.on('tool/result', (event: any) => {
    if (event.toolName !== 'tokensave_delegate') return
    if (event.status !== 'success') return

    const explorers = event.result?.explorers
    if (!Array.isArray(explorers) || explorers.length === 0) return

    mountExplorerWindows(ctx, explorers)
  })
}
```

### client/src/float/mount.tsx
```tsx
import { FloatWindow } from 'dsh-float-window'
import { ExplorerStream } from '../components/ExplorerStream'

interface ExplorerInfo {
  sessionId: string
  label: string
}

export function mountExplorerWindows(ctx: any, explorers: ExplorerInfo[]) {
  explorers.forEach((explorer, index) => {
    ctx.slots.register({
      id: `tokensave-explorer-${explorer.sessionId}`,
      component: () => (
        <FloatWindow
          storageKey={`tokensave:explorer:${explorer.sessionId}`}
          title={`${explorer.label}`}
          accent="#7fc4ff"
          launcherGlyph="🔍"
        >
          {(visible, fwCtx) => (
            <ExplorerStream
              sessionId={explorer.sessionId}
              visible={visible}
              bossKey={fwCtx.bossKey}
            />
          )}
        </FloatWindow>
      ),
    })
  })
}
```

**关键设计点**：每个浮窗用 `storageKey` 隔离持久化，保证不同探索者窗口
的几何/模式互不干扰。FloatWindow 的子组件接收 `visible` 和 `ctx.bossKey`，
后者是自动分配的老板键组合。

### client/src/components/ExplorerStream.tsx
```tsx
import React, { useEffect, useState } from 'react'

interface Props {
  sessionId: string
  visible: boolean
  bossKey: string
}

export function ExplorerStream({ sessionId, visible, bossKey }: Props) {
  const [messages, setMessages] = useState<any[]>([])

  useEffect(() => {
    if (!visible) return
    const sub = subscribeSession(sessionId, (msg) => {
      setMessages(prev => [...prev, msg])
    })
    return () => sub.unsubscribe()
  }, [sessionId, visible])

  return (
    <div className="explorer-stream">
      <div className="stream-header">
        <span>会话 {sessionId.slice(0, 8)}</span>
        <span className="boss-key-hint">按 {bossKey} 最小化</span>
      </div>
      <div className="stream-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`msg msg-${msg.role}`}>
            {msg.content}
          </div>
        ))}
      </div>
    </div>
  )
}
```

**注意**：`subscribeSession` 是占位名，实际 API 名请通过 dsh-plugin-dev-kb
查询 DSH 客户端订阅会话消息的正确方法。

### client/src/components/BriefViewer.tsx
```tsx
import React from 'react'

interface Props {
  brief: string
  explorerCount: number
}

export function BriefViewer({ brief, explorerCount }: Props) {
  return (
    <div className="brief-viewer">
      <div className="brief-header">
        <span>✅ 任务简报</span>
        <span className="brief-meta">
          来自 {explorerCount} 个探索者的交叉验证结果
        </span>
      </div>
      <pre className="brief-content">{brief}</pre>
    </div>
  )
}
```

### 上下文注入标记（已在 Step 10 实现）
搜索 `tokensave-brief` 即可在 LLM Calls 视图找到注入内容。

### 客户端构建配置
客户端半区产物由构建时包装成 web shell 认识的注册协议。在 package.json
中声明 `dsh.client` 指向 `./client/src/index.ts`，宿主的 Node 半区会
扫描并编入 `window.__DSH_BOOT__`，served at `/plugins/<id>/client.js?rev=<sha1-12>`。

## 降级方案
如果浮窗方案出现兼容性问题（例如其他插件的旧版浮窗实例冲突），
可以降级为**侧边栏 Tab 组**方案：使用 dsh-better-sidebar 的
`ctx.betterSidebar.registerTab()` 服务化 API，为每个探索者注册一个 Tab，
通过拖拽拆分把多个 Tab 并排显示。该 API 不依赖全局注册表，更稳健。

## 不要做
- 不要改宿主端 src/ 下的文件
- 不要自己画黑板看板（dsh-call-session 的 Canvas 自动提供）
- 不要自己实现 LLM 调用检查（dsh-llm-call-inspector 提供）

## 验收标准
- [x] 调用 tokensave_delegate 后，同时出现 N 个探索者浮窗（✓ 冒烟实测 N=3 原子挂载+无关会话过滤；浏览器实机目检见 PROGRESS 遗留项）
- [x] 每个浮窗实时显示对应会话的对话流（✓ eventSource=ObservableSnapshot 订阅契约修复，契约测试全过）
- [x] Alt+S / Alt+X / Alt+Z 能独立控制各浮窗（✓ dsh-float-window 0.4.1 BOSS_KEY_POOL 自动分配，源码级确认）
- [x] 关闭再打开，几何位置保持（✓ localStorage[storageKey] 按 CONTRACTS 规则隔离，源码级确认）
- [x] LLM Calls 视图搜索 tokensave-brief 能找到注入内容（✓ 代理证据：会话日志 2 hits + 订阅投影含标记；call-inspector 上游损坏待修，见 PROGRESS 已知问题）

## 完成后
更新 PROGRESS.md：当前阶段改为 Step 12。