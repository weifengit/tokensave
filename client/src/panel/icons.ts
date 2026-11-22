/**
 * 线条图标集（全局唯一一份）。
 *
 * 为什么独立成模块：工作台（DeskDock）、侧边栏入口（ControlRoomEntry）、
 * 添加项目弹窗（AddProjectDialog）三处各画各的图标，久而久之形状对不上、
 * 描边粗细也不一样。抽到这里后：一处改，全站跟着改。
 *
 * 规格（全站统一，24 视窗 / currentColor / 1.6 描边 / 圆头圆角）：
 *   - **不用 emoji**：emoji 在深浅主题下颜色不可控、大小与基线对不齐、
 *     各系统渲染差异大（用户已明确要求这套风格）。
 *   - 尺寸由调用方给（14~16px 之间），颜色继承 currentColor。
 */

/** 图标名 → SVG 内部路径（不含外层 <svg>）。 */
export const ICON_BODIES: Record<string, string> = {
  /** 文件夹：本地已有目录 / 项目列表 */
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  /** 指南针：工作台（原来的 🧭） */
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.4 8.6l-2 4.8-4.8 2 2-4.8z"/>',
  /** 分支：GitHub 克隆 / 仓库（用 git 的“分支”语义，比商标图形中性且同风格） */
  branch: '<circle cx="7" cy="6" r="2.2"/><circle cx="7" cy="18" r="2.2"/><circle cx="17" cy="10" r="2.2"/><path d="M7 8.2v7.6"/><path d="M17 12.2c0 2.2-2 3.1-4 3.4-1.6.2-3 .3-4 .3"/>',
  /** 放大镜：清单搜索 */
  search: '<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5 20 20"/>',
  /** 锁：私有仓 */
  lock: '<rect x="5" y="10.5" width="14" height="9" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  /** 叉：清空搜索 / 关闭 */
  close: '<path d="M7 7l10 10"/><path d="M17 7 7 17"/>',
  /** 铅笔：重命名 */
  pencil: '<path d="M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L4.5 17.5z"/><path d="M14.5 6.5l3 3"/>',
  /** 归档盒：归档对话 */
  archive: '<rect x="3.5" y="4.5" width="17" height="4.5" rx="1.5"/><path d="M5.5 9v9a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M10 13h4"/>',
  /** 对勾：已读（与归档、继续同一套牌形图标按钮） */
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  /** 右箭头：继续（让对话接着输出） */
  play: '<path d="M8 5.5l11 6.5-11 6.5z"/>',
  /** 双勾：已发送（自动继续已接手，不再是可点按钮） */
  sent: '<path d="M3 12.5l4.2 4.2 7-7.4"/><path d="M11 14.5l2.2 2.2 7.3-8"/>',
  /** 列表：项目中心（原来的 🗂️） */
  list: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M7 9.5h10"/><path d="M7 13.5h6"/>',
  /** 书：项目预览 */
  book: '<path d="M3 5h6a3 3 0 0 1 3 3v11a3 3 0 0 0-3-3H3z"/><path d="M21 5h-6a3 3 0 0 0-3 3v11a3 3 0 0 1 3-3h6z"/>',
  /** 报表：共享黑板 */
  report: '<rect x="4.5" y="3.5" width="15" height="17" rx="2.5"/><path d="M8 8h8"/><path d="M8 12h8"/><path d="M8 16h5"/>',
  /** 对话气泡：DSH 主对话 */
  chat: '<path d="M4 5.5h16v11H9.5L4 20.5z"/><path d="M8 10h8"/><path d="M8 13.5h5"/>',
  /** 对话气泡（另一种轮廓）：协作对话 */
  comment: '<path d="M20 5.5H4v10h7l5 4v-4h4z"/><path d="M8 10h8"/>',
  /** 数据库：协作收益 */
  database: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  /** 机器人：探索者窗口（与主对话必须区分开） */
  explorers: '<rect x="4.5" y="7.5" width="15" height="11" rx="3"/><path d="M12 4.5v3"/><circle cx="12" cy="3.4" r="1.1" fill="currentColor" stroke="none"/><circle cx="9.2" cy="12.2" r="1.2" fill="currentColor" stroke="none"/><circle cx="14.8" cy="12.2" r="1.2" fill="currentColor" stroke="none"/><path d="M9.5 15.2h5"/>',
}

/** 图标名 → SVG 字符串（尺寸可调，颜色继承 currentColor）。 */
export function iconSvg(name: string, size = 14): string {
  const body = ICON_BODIES[name] || ICON_BODIES.folder
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
}
