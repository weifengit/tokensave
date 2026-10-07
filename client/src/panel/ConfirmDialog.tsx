/**
 * 确认弹窗（用于「移除项目」等破坏性操作）
 *
 * 为什么要自己做：宿主的 window.confirm 又丑又阻塞，且无法带项目名等上下文。
 * 这个弹窗沿用项目中心同一套玻璃视觉（.ts-modal-*），
 * 并用 danger 配色明确「这是破坏性操作」，默认焦点在「取消」上。
 */
import React, { useEffect, useRef } from 'react'

export interface ConfirmDialogProps {
  title: string
  /** 正文：可给字符串或富文本节点 */
  message: React.ReactNode
  /** 确认按钮文案（默认「确认」） */
  confirmText?: string
  cancelText?: string
  /** 是否用危险样式（红色） */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  // 默认聚焦「取消」——破坏性操作不该让回车直接生效
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  // Esc 取消
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="ts-modal-mask"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className={`ts-modal ts-confirm${danger ? ' ts-confirm-danger' : ''}`} role="alertdialog" aria-modal="true">
        <div className="ts-modal-head">
          <span>{danger ? '⚠️ ' : ''}{title}</span>
          <button className="ts-icon-btn" onClick={onCancel} title="关闭">✕</button>
        </div>
        <div className="ts-modal-body">
          <div className="ts-confirm-msg">{message}</div>
        </div>
        <div className="ts-modal-foot">
          <button ref={cancelRef} className="ts-btn" onClick={onCancel}>{cancelText}</button>
          <button
            className={`ts-btn ${danger ? 'ts-btn-danger-solid' : 'ts-btn-primary'}`}
            onClick={onConfirm}
          >{confirmText}</button>
        </div>
      </div>
    </div>
  )
}
