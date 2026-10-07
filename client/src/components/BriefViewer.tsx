// 简报查看器（Step 11，doc 原样）：展示带 tokensave-brief 标记的交叉验证简报。
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
        <span className="brief-meta">来自 {explorerCount} 个探索者的交叉验证结果</span>
      </div>
      <pre className="brief-content">{brief}</pre>
    </div>
  )
}
