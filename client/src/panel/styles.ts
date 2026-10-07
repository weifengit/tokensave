/**
 * 项目中心 / H 型工作台样式注入（幂等）
 *
 * 视觉基调参照 dsh-worktable 的「控制室」：
 *   玻璃卡片（半透明渐变 + 内高光 + 圆锥渐变描边）+ 30px 网格底 +
 *   缓慢漂移的模糊彩光光晕。
 * 配色只用半透明中性色 + 少量主题蓝/绿/黄点缀，因此深浅主题都自适应，
 * 不依赖宿主主题探测（宿主未暴露稳定主题标记）。
 */
const STYLE_ID = 'tokensave-project-center-css'

const CSS = `
/* —— 基础 —— */
.ts-cr { display:flex; flex-direction:column; height:100%; min-height:0; overflow:hidden; padding:12px; box-sizing:border-box; gap:10px; color:inherit; font-size:13px; position:relative; }
.ts-cr a { color:inherit; }
.ts-hdesk { width:100%; }
/* 工作台打开时隐藏宿主那套全局宽度把手（值写在共享父元素上、一处拖动处处生效，
   且给把手预留 176px 永远铺不满）。工作台默认铺满。 */
body.ts-hdesk-open [data-width-handle] { display:none !important; }

/* —— 项目中心（列表态）：背景覆盖到输入框及其下方区域 ——
   输入条座位 [data-conversation-region="composer"] 与本视图是**兄弟节点**
   （同在 [data-conversation-scroll] 内），且它自带不透明渐变底。
   因此把网格与光晕铺到共享容器上，并把输入条座位改透明。 */
body.ts-center-open [data-conversation-scroll] {
  background-image:
    radial-gradient(circle at 12% 8%, rgba(122,92,255,.28), transparent 44%),
    radial-gradient(circle at 80% 94%, rgba(0,194,255,.24), transparent 48%),
    radial-gradient(circle at 90% 10%, rgba(255,95,158,.20), transparent 46%),
    linear-gradient(rgba(127,127,127,.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(127,127,127,.055) 1px, transparent 1px);
  background-size: auto, auto, auto, 30px 30px, 30px 30px;
}
/* 输入条座位原本自带「透明 → 不透明宿主底色」渐变，用来遮住从下方滚过的内容；
   但项目中心的滚动发生在卡片内部（.ts-center-inner / 各卡片），并没有内容会从
   输入框下方滚过，因此这里可以直接置透明，让容器背景完整连续地铺到输入框及其下方。 */
body.ts-center-open [data-conversation-region="composer"] {
  background: transparent !important;
}

/* —— 通用条/按钮 —— */
.ts-bar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.ts-bar-right { margin-left:auto; flex:none; }
/* 顶部路径可截断，但不把右侧会话操作挤换行（#8） */
.ts-bar-path { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* 会话操作固定单行，不换行 */
.ts-bar-sessions { flex:none; flex-wrap:nowrap; }
.ts-title { font-size:16px; font-weight:600; }
.ts-sub { opacity:.65; font-size:12px; }
.ts-btn { cursor:pointer; border:1px solid rgba(127,127,127,.35); background:rgba(127,127,127,.12); color:inherit; border-radius:8px; padding:5px 12px; font-size:13px; line-height:1.4; transition:background .15s ease, border-color .15s ease, box-shadow .15s ease; }
.ts-btn:hover { background:rgba(127,127,127,.22); }
.ts-btn:disabled { opacity:.45; cursor:not-allowed; }
.ts-btn-primary { background:rgba(96,165,250,.25); border-color:rgba(96,165,250,.6); }
.ts-btn-primary:hover { background:rgba(96,165,250,.4); box-shadow:0 0 12px rgba(96,165,250,.25); }
.ts-btn-picked { background:rgba(74,222,128,.35); border-color:rgba(74,222,128,.85); font-weight:600; box-shadow:0 0 0 1px rgba(74,222,128,.35) inset; }
.ts-btn-picked:hover { background:rgba(74,222,128,.5); }
.ts-btn-danger { background:rgba(248,113,113,.18); border-color:rgba(248,113,113,.5); }
.ts-icon-btn { cursor:pointer; border:none; background:transparent; color:inherit; opacity:.6; border-radius:6px; padding:2px 7px; font-size:14px; line-height:1.3; }
.ts-icon-btn:hover { opacity:1; background:rgba(127,127,127,.22); }
.ts-input, .ts-select { border:1px solid rgba(127,127,127,.35); background:rgba(127,127,127,.08); color:inherit; border-radius:6px; padding:6px 9px; font-size:13px; box-sizing:border-box; }
.ts-input:focus, .ts-select:focus { outline:1px solid rgba(96,165,250,.7); }
.ts-tag { font-size:11px; padding:2px 8px; border-radius:99px; background:rgba(96,165,250,.22); border:1px solid rgba(96,165,250,.45); }
.ts-tag-warn { background:rgba(251,191,36,.2); border-color:rgba(251,191,36,.5); }
.ts-hint { opacity:.6; font-size:12px; text-align:center; padding:4px; }
.ts-hint-warn { opacity:1; color:#fbbf24; background:rgba(251,191,36,.12); border:1px solid rgba(251,191,36,.4); border-radius:8px; padding:6px 10px; }

/* —— 会话选择条（工作台顶部第二行） —— */
.ts-bar-sessions { gap:8px; }
.ts-sess { position:relative; display:inline-flex; align-items:center; gap:8px; }
.ts-sess-btn { display:inline-flex; align-items:center; gap:8px; max-width:min(560px, 60vw); }
.ts-sess-btn.active { border-color:rgba(96,165,250,.7); background:rgba(96,165,250,.18); }
.ts-sess-cur { opacity:.7; font-size:12px; max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ts-sess-caret { opacity:.6; font-size:11px; }
.ts-sess-pop { position:absolute; top:calc(100% + 6px); left:0; z-index:44; width:min(520px, 76vw); max-height:60vh; display:flex; flex-direction:column; border-radius:12px; border:1px solid rgba(127,127,127,.35); background:rgba(24,27,33,.97); color:#e6e8eb; box-shadow:0 14px 40px rgba(0,0,0,.5); backdrop-filter:blur(12px) saturate(1.2); overflow:hidden; }
.ts-sess-pop-head { flex:none; padding:9px 12px; font-size:11.5px; font-weight:600; opacity:.7; border-bottom:1px solid rgba(127,127,127,.25); letter-spacing:.03em; }
.ts-sess-list { flex:1; min-height:0; overflow:auto; padding:5px; display:flex; flex-direction:column; gap:2px; }
.ts-sess-item { display:flex; align-items:center; gap:8px; width:100%; text-align:left; padding:7px 9px; border:none; border-radius:8px; background:transparent; color:inherit; font:inherit; font-size:12.5px; cursor:pointer; }
.ts-sess-item:hover { background:rgba(127,127,127,.18); }
.ts-sess-item.active { background:rgba(96,165,250,.24); box-shadow:inset 0 0 0 1px rgba(96,165,250,.5); }
.ts-sess-item-title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ts-sess-item-time { flex:none; font-size:10.5px; opacity:.5; font-variant-numeric:tabular-nums; }
.ts-sess-tag { flex:none; font-size:10px; padding:1px 6px; border-radius:99px; background:rgba(127,127,127,.25); }
.ts-sess-empty { padding:14px 12px; font-size:12px; opacity:.65; line-height:1.6; }

/* —— 项目中心：流光玻璃背景 —— */
.ts-center { padding:0; gap:0; overflow:hidden; }
.ts-center-bg { position:absolute; inset:0; overflow:hidden; pointer-events:none; z-index:0; }
/* 网格已上提到共享容器（[data-conversation-scroll]），这里只留流动光晕，避免双重网格出现摩尔纹 */
.ts-center-blob { position:absolute; width:52vmax; height:52vmax; border-radius:50%; filter:blur(70px); opacity:.30; mix-blend-mode:screen; }
.ts-center-blob1 { background:radial-gradient(circle,#7a5cff,transparent 66%); top:-20%; left:-16%; animation:tsBlob1 17s ease-in-out infinite alternate; }
.ts-center-blob2 { background:radial-gradient(circle,#00c2ff,transparent 66%); bottom:-24%; left:22%; animation:tsBlob2 13s ease-in-out infinite alternate; }
.ts-center-blob3 { background:radial-gradient(circle,#ff5f9e,transparent 66%); top:-8%; right:-18%; animation:tsBlob3 19s ease-in-out infinite alternate; }
@keyframes tsBlob1 { from{transform:translate(0,0) scale(1)} to{transform:translate(12vw,9vh) scale(1.12)} }
@keyframes tsBlob2 { from{transform:translate(0,0) scale(1)} to{transform:translate(-11vw,-8vh) scale(1.14)} }
@keyframes tsBlob3 { from{transform:translate(0,0) scale(1)} to{transform:translate(-9vw,10vh) scale(1.1)} }
.ts-center-inner { position:relative; z-index:1; flex:1; min-height:0; display:flex; flex-direction:column; gap:16px; padding:22px; overflow:auto; }
.ts-center-head { flex:none; display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
.ts-center-headtext { flex:1; min-width:0; display:flex; flex-direction:column; gap:4px; }
.ts-center-title { font-size:20px; font-weight:700; line-height:28px; letter-spacing:.01em; }
.ts-center-sub { font-size:12.5px; opacity:.62; line-height:1.6; }
/* 头部不再放“添加项目”按钮（与网格末尾的新建卡重复，已删）*/

/* —— 项目中心：卡片网格（玻璃卡 + 圆锥渐变描边） —— */
.ts-center-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(248px,1fr)); gap:16px; align-content:start; }
.ts-center-emptywrap { flex:1; display:flex; align-items:center; justify-content:center; padding:24px; }
.ts-center-card { position:relative; box-sizing:border-box; min-height:186px; display:flex; flex-direction:column; gap:10px; padding:18px; border:1px solid transparent; border-radius:16px; background:linear-gradient(135deg,rgba(255,255,255,.14) 0%,rgba(255,255,255,.05) 32%,rgba(255,255,255,.01) 62%,rgba(0,0,0,.06) 100%),rgba(127,127,127,.09); box-shadow:0 10px 26px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.10); backdrop-filter:blur(6px) saturate(1.15); transition:transform .14s ease, box-shadow .14s ease; }
.ts-center-card::after { content:""; position:absolute; inset:0; border-radius:inherit; padding:1px; background:conic-gradient(from 45deg,rgba(0,0,0,.28) 0deg,rgba(255,255,255,.5) 90deg,rgba(0,0,0,.28) 180deg,rgba(255,255,255,.5) 270deg,rgba(0,0,0,.28) 360deg); -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0); -webkit-mask-composite:xor; mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0); mask-composite:exclude; pointer-events:none; opacity:.45; }
.ts-center-card:hover { transform:translateY(-2px); box-shadow:0 16px 34px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.14); }
.ts-center-cardhead { display:flex; align-items:center; gap:11px; min-width:0; }
.ts-center-icon { flex:none; font-size:22px; line-height:1; }
.ts-center-name { flex:1; min-width:0; font-size:16px; font-weight:700; line-height:22px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ts-center-path { flex:none; display:flex; flex-direction:column; gap:1px; min-width:0; }
.ts-center-basedir { font-size:12px; font-weight:600; opacity:.85; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ts-center-fullpath { font-size:10.5px; opacity:.45; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:var(--dsh-font-mono, monospace); }
.ts-center-meta { flex:none; display:flex; gap:6px; flex-wrap:wrap; }
.ts-center-actions { display:flex; gap:8px; margin-top:auto; padding-top:6px; }
.ts-center-enter { flex:1; }
/* 新建卡：虚线玻璃底 + 居中加号 */
.ts-center-addcard { justify-content:center; align-items:center; gap:8px; cursor:pointer; color:inherit; font:inherit; background:radial-gradient(circle at 50% 42%,rgba(255,255,255,.08),rgba(255,255,255,0) 65%),rgba(127,127,127,.06); border:1.5px dashed rgba(127,127,127,.5); box-shadow:none; }
.ts-center-addcard::after { display:none; }
.ts-center-addcard:hover { border-color:rgba(96,165,250,.75); background:rgba(127,127,127,.12); }
.ts-center-addplus { font-size:32px; line-height:1; opacity:.6; }
.ts-center-addcard:hover .ts-center-addplus { opacity:1; color:#60a5fa; }
.ts-center-addlabel { font-size:15px; font-weight:600; opacity:.75; }
.ts-center-addhint { font-size:11.5px; opacity:.5; }
.ts-center-emptywrap .ts-center-addcard { width:min(320px,80%); min-height:200px; display:flex; flex-direction:column; }

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
.ts-desk-col { grid-row:1 / -1; display:flex; flex-direction:column; gap:8px; min-height:0; overflow:hidden; }
.ts-desk-left { grid-column:1; }
.ts-desk-right { grid-column:3; }
.ts-desk-board { grid-column:2; min-height:0; display:flex; flex-direction:column; }
.ts-desk-chat { grid-column:2; min-height:0; display:flex; flex-direction:column; position:relative; border:1px solid rgba(127,127,127,.3); border-radius:9px; background:rgba(127,127,127,.07); padding:8px; box-sizing:border-box; }

/* —— 卡片外壳（黑板 / 主对话 / 协作对话 / 协作收益 共用）——
   卡片的占位（高度/宽度）由外壳承担，内层组件一律 flex:1 填满外壳。 */
.ts-card { display:flex; flex-direction:column; min-height:0; }
.ts-card > * { flex:1; min-height:0; }
/* 卡片自身绝不溢出：内容只能在卡片内部滚（#3） */
.ts-card { overflow:hidden; }
/* 卡片内部各自滚动：工作台整体不产生长滚动条 */
.ts-card > * > .ts-chat-msgs, .ts-card > * > .ts-board-list, .ts-card > * > .ts-talk-list, .ts-card > * > .ts-save-body { min-height:0; overflow:auto; }
.ts-card-fill { flex:1; min-height:0; }
/* 左右两竖顶部两栏：与探索者窗口按 40% / 剩余均分 */
.ts-card-talk, .ts-card-save { flex:0 0 40%; min-height:104px; }
.ts-card-collapsed { flex:0 0 auto !important; min-height:0 !important; }
.ts-card-collapsed > * > .ts-board-list,
.ts-card-collapsed > * > .ts-chat-msgs,
.ts-card-collapsed > * > .ts-talk-list,
.ts-card-collapsed > * > .ts-save-body { display:none; }
.ts-card-overlay-inner > * { flex:1; min-height:0; }
/* 主对话铺满时承载输入条停靠（含内缩边框，与中下格同款） */
.ts-card-overlay-chat { display:flex; flex-direction:column; min-height:0; border:1px solid rgba(127,127,127,.3); border-radius:9px; background:rgba(127,127,127,.07); padding:8px; box-sizing:border-box; }
/* 卡片右上角三键：固定在标题条最右侧，其它内容一律排在其左侧（#3） */
.ts-card-actions { flex:none; display:inline-flex; align-items:center; gap:1px; margin-left:auto; }
/* 黑板标题条里有 tabs：让 tabs 吃掉弹性空隙，三键就落最右 */
.ts-board-head .ts-board-tabs { margin-left:auto; }
.ts-board-head .ts-card-actions { margin-left:8px; }
/* 标题条一律不换行（#4）：计数移入正文 .ts-card-count */
.ts-talk-head, .ts-save-head, .ts-board-head, .ts-mainchat-head { flex-wrap:nowrap; }
.ts-talk-head > span:first-child, .ts-save-head > span:first-child, .ts-board-head > span:first-child, .ts-mainchat-head > span:first-child { flex:none; white-space:nowrap; }
.ts-card-count { flex:none; font-size:10.5px; opacity:.55; padding:0 2px 4px; }
.ts-card-overlay { position:absolute; inset:0; z-index:40; background:rgba(12,14,18,.92); backdrop-filter:blur(8px) saturate(1.2); border-radius:10px; display:flex; flex-direction:column; padding:10px; box-sizing:border-box; }
.ts-card-overlay-inner { flex:1; min-height:0; display:flex; flex-direction:column; }
.ts-closed-bar { flex:none; display:flex; align-items:center; gap:6px; flex-wrap:wrap; padding:5px 8px; border:1px dashed rgba(127,127,127,.45); border-radius:9px; }
.ts-closed-label { font-size:11.5px; opacity:.6; }

/* —— 主对话卡（中下） —— */
/* 中下卡片的外框由 .ts-desk-chat 提供（含 border/padding，供输入条内缩定位），
   所以这里保持无框；仅在铺满浮层里补一层边框。 */
.ts-mainchat { display:flex; flex-direction:column; min-height:0; flex:1; overflow:hidden; }
.ts-card-overlay-inner .ts-mainchat { border:1px solid rgba(127,127,127,.3); border-radius:9px; background:rgba(127,127,127,.07); }
.ts-mainchat-head { flex:none; display:flex; align-items:center; gap:8px; padding:6px 9px; background:rgba(127,127,127,.13); font-size:12.5px; font-weight:600; }
/* 底部留出宿主输入条的位置（输入条 fixed 停靠在卡片底部） */
.ts-mainchat .ts-chat-msgs { padding-bottom:72px; }
.ts-mainchat-sub { margin-left:auto; font-size:10.5px; font-weight:400; opacity:.6; }

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
.ts-msg-tool, .ts-msg-system { align-self:stretch; opacity:.62; font-size:11px; border-left:2px solid rgba(127,127,127,.5); padding:2px 8px; }
.ts-msg-tool .ts-msg-role, .ts-msg-system .ts-msg-role { display:flex; align-items:center; gap:4px; }
.ts-msg-toggle { padding:0 4px; font-size:11px; opacity:.7; }
.ts-msg-preview { opacity:.85; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ts-msg-full { white-space:pre-wrap; word-break:break-word; max-height:220px; overflow:auto; margin-top:2px; }
.ts-msg-role { font-size:10px; opacity:.6; margin-bottom:2px; }
.ts-win-hidden-bar { display:flex; gap:6px; flex-wrap:wrap; }
.ts-chip { font-size:11px; padding:3px 9px; border-radius:99px; border:1px dashed rgba(127,127,127,.5); background:transparent; color:inherit; cursor:pointer; }
.ts-chip:hover { background:rgba(127,127,127,.18); }

/* —— 黑板 —— */
.ts-board { display:flex; flex-direction:column; min-height:0; flex:1; border:1px solid rgba(127,127,127,.3); border-radius:9px; background:rgba(127,127,127,.07); overflow:hidden; }
.ts-board-head { flex:none; display:flex; align-items:center; gap:8px; padding:7px 10px; background:rgba(127,127,127,.13); font-size:13px; font-weight:600; }
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

/* —— 消息流列表（探索者窗口 / 主对话 / 简报共用） —— */
.ts-chat-msgs { flex:1; min-height:0; overflow:auto; padding:10px; display:flex; flex-direction:column; gap:7px; }

/* —— 左栏：协作对话时间轴 —— */
.ts-talk { border:1px solid rgba(127,127,127,.3); border-radius:9px; background:rgba(127,127,127,.07); display:flex; flex-direction:column; min-height:104px; overflow:hidden; }
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

/* —— 右栏：协作收益报告（优势/劣势两卡铺满整卡，底部不留白） —— */
.ts-save { border:1px solid rgba(127,127,127,.3); border-radius:9px; background:rgba(127,127,127,.07); display:flex; flex-direction:column; min-height:104px; overflow:hidden; }
.ts-save-head { display:flex; align-items:center; gap:8px; padding:6px 9px; background:rgba(127,127,127,.13); font-size:12.5px; font-weight:600; flex:none; }
.ts-save-sub { margin-left:auto; font-size:10.5px; font-weight:400; opacity:.6; }
.ts-save-body { flex:1; min-height:0; overflow:auto; padding:7px; display:flex; flex-direction:column; gap:7px; }
.ts-save-block { border:1px solid rgba(127,127,127,.26); border-radius:8px; padding:7px 9px; display:flex; flex-direction:column; gap:6px; flex:1 1 0; min-height:0; }
.ts-save-block.good { background:rgba(74,222,128,.08); border-color:rgba(74,222,128,.38); }
.ts-save-block.bad { background:rgba(251,191,36,.08); border-color:rgba(251,191,36,.38); }
.ts-save-title { display:flex; align-items:center; gap:6px; font-size:11.5px; font-weight:600; flex:none; }
.ts-badge { font-size:10px; padding:1px 7px; border-radius:99px; border:1px solid transparent; font-weight:600; }
.ts-badge.good { background:rgba(74,222,128,.25); border-color:rgba(74,222,128,.6); }
.ts-badge.bad { background:rgba(251,191,36,.22); border-color:rgba(251,191,36,.6); }
.ts-save-rows { display:flex; flex-direction:column; gap:5px; flex:1; min-height:0; justify-content:center; }
.ts-kv { display:flex; gap:8px; align-items:flex-start; font-size:11px; }
.ts-kv-k { flex:none; width:82px; opacity:.65; }
.ts-kv-v { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; word-break:break-word; }
.ts-line { display:block; }
.ts-good { color:#4ade80; }
.ts-bad { color:#fbbf24; }
.ts-dim { opacity:.55; font-size:10px; margin-left:3px; }
.ts-bar-track { flex:none; height:5px; border-radius:99px; background:rgba(127,127,127,.22); overflow:hidden; }
.ts-bar-fill { height:100%; border-radius:99px; transition:width .3s ease; }
.ts-bar-fill.good { background:linear-gradient(90deg, rgba(74,222,128,.7), #4ade80); }
.ts-bar-fill.bad { background:linear-gradient(90deg, rgba(251,191,36,.7), #fbbf24); }

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
