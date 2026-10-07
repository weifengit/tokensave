/**
 * 项目中心样式注入（幂等）
 * 半透明中性表面 + inherit 文字色：同时适配宿主深/浅主题
 */
const STYLE_ID = 'tokensave-project-center-css'

const CSS = `
.ts-cr { display:flex; flex-direction:column; height:100%; min-height:0; padding:12px; box-sizing:border-box; gap:10px; color:inherit; font-size:13px; position:relative; }
/* H 台宽度由工作台自己管（按项目独立、默认铺满），不再绑宿主全局变量 */
.ts-hdesk { margin-inline:auto; }
/* 工作台打开时隐藏宿主那套全局宽度把手：其值写在共享父元素上（一处拖动处处生效），
   且为把手预留 176px，导致永远铺不满。工作台用自带的宽度控件（按项目独立）。 */
body.ts-hdesk-open [data-width-handle] { display:none !important; }
.ts-cr a { color:inherit; }

/* —— 通用条/按钮 —— */
.ts-bar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.ts-title { font-size:16px; font-weight:600; }
.ts-sub { opacity:.65; font-size:12px; }
.ts-btn { cursor:pointer; border:1px solid rgba(127,127,127,.35); background:rgba(127,127,127,.12); color:inherit; border-radius:6px; padding:5px 12px; font-size:13px; line-height:1.4; }
.ts-btn:hover { background:rgba(127,127,127,.22); }
.ts-btn:disabled { opacity:.45; cursor:not-allowed; }
.ts-btn-primary { background:rgba(96,165,250,.25); border-color:rgba(96,165,250,.6); }
.ts-btn-primary:hover { background:rgba(96,165,250,.4); }
/* 已选中态：实心 + 勾号 + 描边，与未选中的浅色 primary 明确区分 */
.ts-btn-picked { background:rgba(74,222,128,.35); border-color:rgba(74,222,128,.85); font-weight:600; box-shadow:0 0 0 1px rgba(74,222,128,.35) inset; }
.ts-btn-picked:hover { background:rgba(74,222,128,.5); }
/* 工作台宽度控件（工具栏右侧） */
.ts-width-ctl { display:inline-flex; align-items:center; gap:6px; }
.ts-width-range { width:110px; accent-color:#60a5fa; cursor:pointer; }
.ts-btn-danger { background:rgba(248,113,113,.18); border-color:rgba(248,113,113,.5); }
.ts-icon-btn { cursor:pointer; border:none; background:transparent; color:inherit; opacity:.6; border-radius:4px; padding:2px 7px; font-size:14px; line-height:1.3; }
.ts-icon-btn:hover { opacity:1; background:rgba(127,127,127,.2); }
.ts-input, .ts-select { border:1px solid rgba(127,127,127,.35); background:rgba(127,127,127,.08); color:inherit; border-radius:6px; padding:6px 9px; font-size:13px; box-sizing:border-box; }
.ts-input:focus, .ts-select:focus { outline:1px solid rgba(96,165,250,.7); }

/* —— 项目中心：项目卡片 —— */
.ts-proj-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:12px; overflow:auto; flex:1; min-height:0; align-content:start; }
.ts-proj-card { border:1px solid rgba(127,127,127,.3); background:rgba(127,127,127,.08); border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; gap:8px; }
.ts-proj-name { font-size:15px; font-weight:600; }
.ts-proj-path { font-size:12px; opacity:.7; word-break:break-all; font-family:var(--dsh-font-mono, monospace); }
.ts-proj-meta { display:flex; gap:6px; flex-wrap:wrap; }
.ts-tag { font-size:11px; padding:2px 8px; border-radius:99px; background:rgba(96,165,250,.22); border:1px solid rgba(96,165,250,.45); }
.ts-tag-warn { background:rgba(251,191,36,.2); border-color:rgba(251,191,36,.5); }
.ts-proj-actions { display:flex; gap:8px; margin-top:auto; }
.ts-empty { opacity:.65; text-align:center; padding:48px 16px; }

/* —— 弹层 —— */
.ts-modal-mask { position:fixed; inset:0; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; z-index:45; }
.ts-modal { background:rgba(30,32,38,.98); color:#e8eaed; border:1px solid rgba(127,127,127,.4); border-radius:12px; width:min(680px,92%); max-height:88%; display:flex; flex-direction:column; box-shadow:0 12px 40px rgba(0,0,0,.5); }
.ts-modal-head { padding:14px 18px; font-size:15px; font-weight:600; border-bottom:1px solid rgba(127,127,127,.25); display:flex; justify-content:space-between; align-items:center; }
.ts-modal-body { padding:14px 18px; overflow:auto; display:flex; flex-direction:column; gap:14px; }
.ts-modal-foot { padding:12px 18px; border-top:1px solid rgba(127,127,127,.25); display:flex; justify-content:flex-end; gap:10px; }
.ts-field-label { font-size:13px; font-weight:600; margin-bottom:6px; display:block; }

/* —— 目录浏览器 —— */
.ts-fs { border:1px solid rgba(127,127,127,.3); border-radius:8px; overflow:hidden; }
.ts-fs-crumb { display:flex; align-items:center; gap:6px; padding:7px 10px; background:rgba(127,127,127,.1); font-size:12px; flex-wrap:wrap; font-family:var(--dsh-font-mono, monospace); }
.ts-fs-crumb span { cursor:pointer; opacity:.8; }
.ts-fs-crumb span:hover { opacity:1; text-decoration:underline; }
.ts-fs-list { max-height:240px; overflow:auto; }
.ts-fs-item { display:flex; align-items:center; gap:8px; padding:6px 12px; cursor:pointer; border:none; background:transparent; color:inherit; width:100%; text-align:left; font-size:13px; }
.ts-fs-item:hover { background:rgba(127,127,127,.15); }
.ts-fs-item .ts-tag { margin-left:auto; }

/* —— H 型工作台：全台共享 R 行 1fr 网格（R 由 JSX 按窗口数注入），无中横线 —— */
.ts-desk { display:grid; grid-template-columns:minmax(190px,250px) 1fr minmax(190px,250px); gap:8px; flex:1; min-height:0; position:relative; }
/* 左右两竖跨满全部行（1 / -1）；列内窗口 flex:1 等高均分，行由网格均分 */
.ts-desk-col { grid-row:1 / -1; display:flex; flex-direction:column; gap:8px; min-height:0; overflow:auto; }
.ts-desk-left { grid-column:1; }
.ts-desk-right { grid-column:3; }
/* 中上黑板：跨 1..R-1 行（行号由 JSX 注入），底边即中缝 —— 不加 border，与列缝平齐 */
.ts-desk-board { grid-column:2; min-height:0; display:flex; flex-direction:column; }
/* 中下：DSH 主对话卡片 —— 宿主原生输入条 fixed 停靠其中（按 border+padding 内缩） */
.ts-desk-chat { grid-column:2; min-height:0; display:flex; flex-direction:column; position:relative; border:1px solid rgba(127,127,127,.3); border-radius:9px; background:rgba(127,127,127,.07); padding:8px; box-sizing:border-box; }

/* —— 探索者窗口卡 —— */
.ts-win { border:1px solid rgba(127,127,127,.32); background:rgba(127,127,127,.09); border-radius:9px; display:flex; flex-direction:column; min-height:70px; flex:1; overflow:hidden; position:relative; }
.ts-win-head { display:flex; align-items:center; gap:6px; padding:6px 8px; background:rgba(127,127,127,.14); cursor:default; user-select:none; }
.ts-win-head:hover { background:rgba(127,127,127,.22); }
.ts-win-name { font-size:12.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; }
.ts-win-dot { width:8px; height:8px; border-radius:50%; background:#52c41a; flex:none; }
.ts-win-dot.idle { background:rgba(127,127,127,.7); }
.ts-win-body { flex:1; min-height:0; overflow:auto; padding:8px; display:flex; flex-direction:column; gap:6px; font-size:12px; line-height:1.55; }
.ts-win.collapsed { flex:none; }
.ts-win.collapsed .ts-win-body { display:none; }
.ts-win-overlay { position:absolute; inset:0; z-index:40; flex:none; box-shadow:0 8px 32px rgba(0,0,0,.45); }
.ts-msg-user { align-self:flex-end; background:rgba(96,165,250,.22); border:1px solid rgba(96,165,250,.4); border-radius:8px 8px 2px 8px; padding:5px 9px; max-width:88%; white-space:pre-wrap; word-break:break-word; }
.ts-msg-assistant { align-self:flex-start; background:rgba(127,127,127,.14); border-radius:8px 8px 8px 2px; padding:5px 9px; max-width:94%; white-space:pre-wrap; word-break:break-word; }
.ts-msg-tool, .ts-msg-system { align-self:stretch; opacity:.55; font-size:11px; border-left:2px solid rgba(127,127,127,.5); padding:2px 8px; max-height:72px; overflow:hidden; }
.ts-msg-role { font-size:10px; opacity:.6; margin-bottom:2px; }
.ts-win-hidden-bar { display:flex; gap:6px; flex-wrap:wrap; }
.ts-chip { font-size:11px; padding:3px 9px; border-radius:99px; border:1px dashed rgba(127,127,127,.5); background:transparent; color:inherit; cursor:pointer; }
.ts-chip:hover { background:rgba(127,127,127,.18); }

/* —— 黑板 —— */
.ts-board { display:flex; flex-direction:column; min-height:0; flex:1; border:1px solid rgba(127,127,127,.3); border-radius:9px; background:rgba(127,127,127,.07); overflow:hidden; }
.ts-board-head { display:flex; align-items:center; gap:8px; padding:7px 10px; background:rgba(127,127,127,.13); font-size:13px; font-weight:600; }
.ts-board-tabs { display:flex; gap:5px; margin-left:auto; flex-wrap:wrap; }
.ts-board-tab { font-size:11px; padding:2px 9px; border-radius:99px; border:1px solid rgba(127,127,127,.4); background:transparent; color:inherit; cursor:pointer; }
.ts-board-tab.active { background:rgba(96,165,250,.3); border-color:rgba(96,165,250,.65); }
.ts-board-list { flex:1; min-height:0; overflow:auto; padding:8px; display:flex; flex-direction:column; gap:7px; }
.ts-entry { border:1px solid rgba(127,127,127,.28); border-radius:7px; padding:7px 9px; cursor:pointer; background:rgba(255,255,255,.03); }
.ts-entry:hover { border-color:rgba(96,165,250,.55); }
.ts-entry-head { display:flex; gap:8px; align-items:center; }
.ts-entry-title { font-size:12.5px; font-weight:600; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ts-entry-time { font-size:10.5px; opacity:.55; flex:none; }
.ts-entry-body { font-size:12px; opacity:.85; margin-top:6px; white-space:pre-wrap; word-break:break-word; max-height:180px; overflow:auto; }
.ts-entry.dim { opacity:.55; }
.ts-topic-req { background:rgba(96,165,250,.25); border-color:rgba(96,165,250,.5); }
.ts-topic-pit { background:rgba(248,113,113,.22); border-color:rgba(248,113,113,.5); }
.ts-topic-sol { background:rgba(74,222,128,.2); border-color:rgba(74,222,128,.5); }
.ts-topic-brief { background:rgba(192,132,252,.22); border-color:rgba(192,132,252,.5); }

/* —— 消息流列表（探索者窗口与简报共用） —— */
.ts-chat-msgs { flex:1; min-height:0; overflow:auto; padding:10px; display:flex; flex-direction:column; gap:7px; }
.ts-hint { opacity:.6; font-size:12px; text-align:center; padding:4px; }

/* —— 左栏：协作对话时间轴 —— */
.ts-talk { border:1px solid rgba(127,127,127,.3); border-radius:9px; background:rgba(127,127,127,.07); display:flex; flex-direction:column; min-height:104px; flex:0 0 40%; overflow:hidden; }
.ts-talk-head { display:flex; align-items:center; gap:8px; padding:6px 9px; background:rgba(127,127,127,.13); font-size:12.5px; font-weight:600; flex:none; }
.ts-talk-sub { margin-left:auto; font-size:10.5px; font-weight:400; opacity:.6; }
.ts-talk-list { flex:1; min-height:0; overflow:auto; padding:7px; display:flex; flex-direction:column; gap:6px; }
.ts-talk-line { display:flex; gap:6px; align-items:flex-start; font-size:11.5px; line-height:1.5; }
.ts-talk-glyph { flex:none; font-size:12px; line-height:1.4; }
.ts-talk-body { min-width:0; flex:1; border-radius:7px; padding:4px 8px; background:rgba(127,127,127,.12); }
.ts-talk-line.main .ts-talk-body { background:rgba(96,165,250,.16); }
.ts-talk-line.tone-warn .ts-talk-body { background:rgba(248,113,113,.16); }
.ts-talk-line.tone-done .ts-talk-body { background:rgba(74,222,128,.16); }
.ts-talk-meta { display:flex; gap:6px; align-items:baseline; margin-bottom:1px; }
.ts-talk-who { font-weight:600; font-size:11px; }
.ts-talk-time { font-size:10px; opacity:.5; margin-left:auto; font-family:var(--dsh-font-mono, monospace); }
.ts-talk-text { word-break:break-word; white-space:pre-wrap; }

/* —— 右栏：协作收益报告 —— */
.ts-save { border:1px solid rgba(127,127,127,.3); border-radius:9px; background:rgba(127,127,127,.07); display:flex; flex-direction:column; min-height:104px; flex:0 0 40%; overflow:hidden; }
.ts-save-head { display:flex; align-items:center; gap:8px; padding:6px 9px; background:rgba(127,127,127,.13); font-size:12.5px; font-weight:600; flex:none; }
.ts-save-sub { margin-left:auto; font-size:10.5px; font-weight:400; opacity:.6; }
.ts-save-body { flex:1; min-height:0; overflow:auto; padding:7px; display:flex; flex-direction:column; gap:7px; }
.ts-save-block { border:1px solid rgba(127,127,127,.26); border-radius:8px; padding:7px 9px; display:flex; flex-direction:column; gap:6px; }
.ts-save-block.good { background:rgba(74,222,128,.08); border-color:rgba(74,222,128,.38); }
.ts-save-block.bad { background:rgba(251,191,36,.08); border-color:rgba(251,191,36,.38); }
.ts-save-title { display:flex; align-items:center; gap:6px; font-size:11.5px; font-weight:600; }
.ts-badge { font-size:10px; padding:1px 7px; border-radius:99px; border:1px solid transparent; font-weight:600; }
.ts-badge.good { background:rgba(74,222,128,.25); border-color:rgba(74,222,128,.6); }
.ts-badge.bad { background:rgba(251,191,36,.22); border-color:rgba(251,191,36,.6); }
.ts-save-rows { display:flex; flex-direction:column; gap:5px; }
.ts-kv { display:flex; gap:8px; align-items:flex-start; font-size:11px; }
.ts-kv-k { flex:none; width:82px; opacity:.65; }
.ts-kv-v { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; word-break:break-word; }
.ts-line { display:block; }
.ts-good { color:#4ade80; }
.ts-bad { color:#fbbf24; }
.ts-dim { opacity:.55; font-size:10px; margin-left:3px; }
.ts-bar-track { height:5px; border-radius:99px; background:rgba(127,127,127,.22); overflow:hidden; }
.ts-bar-fill { height:100%; border-radius:99px; transition:width .3s ease; }
.ts-bar-fill.good { background:linear-gradient(90deg, rgba(74,222,128,.7), #4ade80); }
.ts-bar-fill.bad { background:linear-gradient(90deg, rgba(251,191,36,.7), #fbbf24); }
.ts-save-foot { font-size:10px; opacity:.5; line-height:1.45; }

/* —— 黑板正文富文本（JSON / Markdown / 纯文本） —— */
.ts-rich { display:flex; flex-direction:column; gap:6px; }
.ts-rich-plain { margin:0; white-space:pre-wrap; word-break:break-word; font:inherit; }
.ts-rich-code { margin:0; padding:8px 10px; border-radius:7px; background:rgba(0,0,0,.22); border:1px solid rgba(127,127,127,.28); overflow:auto; font-family:var(--dsh-font-mono, monospace); font-size:11.5px; line-height:1.5; white-space:pre; }
.ts-rich-h { margin:2px 0 0; font-weight:600; line-height:1.35; }
.ts-rich-h1 { font-size:15px; }
.ts-rich-h2 { font-size:14px; }
.ts-rich-h3 { font-size:13px; }
.ts-rich-h4, .ts-rich-h5, .ts-rich-h6 { font-size:12.5px; opacity:.9; }
.ts-rich-p { margin:0; line-height:1.6; }
.ts-rich-ul, .ts-rich-ol { margin:0; padding-left:20px; display:flex; flex-direction:column; gap:3px; line-height:1.55; }
.ts-rich-quote { margin:0; padding:4px 10px; border-left:3px solid rgba(127,127,127,.55); opacity:.85; display:flex; flex-direction:column; gap:3px; }
.ts-rich-quote p { margin:0; }
.ts-rich-hr { margin:4px 0; border:none; border-top:1px solid rgba(127,127,127,.35); }
.ts-rich-inline-code { padding:1px 5px; border-radius:4px; background:rgba(127,127,127,.22); font-family:var(--dsh-font-mono, monospace); font-size:11px; }
.ts-rich a { color:#60a5fa; text-decoration:underline; }
.ts-rich-table-wrap { overflow:auto; }
.ts-rich-table { border-collapse:collapse; font-size:11.5px; width:100%; }
.ts-rich-table th, .ts-rich-table td { border:1px solid rgba(127,127,127,.3); padding:3px 7px; text-align:left; vertical-align:top; }
.ts-rich-table th { background:rgba(127,127,127,.16); font-weight:600; }
.ts-json-key { color:#7dd3fc; }
.ts-json-str { color:#a5d6a7; }
.ts-json-num { color:#fbbf24; }
.ts-json-bool { color:#c084fc; }
.ts-json-null { color:#f87171; }
`

export function injectProjectCenterStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}
