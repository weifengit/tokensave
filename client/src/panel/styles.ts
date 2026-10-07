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
/* 让工作台/项目中心自己控高：宿主的视图链路默认是「随内容长高」的。
   实测宿主的规则：
     .scrollBody { flex:1; min-height:0; overflow-y:auto }
     root[data-phase=active] .viewArea { flex:1 0 auto; min-height:auto }  ← 元凶
   即激活相下 viewArea 会跟着内容长高，外层 scrollBody 出现长滚动条——
   我们卡片的 overflow:hidden 根本轮不到生效。这里把链路每一层都改成可收缩。 */
body.ts-hdesk-open [data-conversation-scroll],
body.ts-center-open [data-conversation-scroll] { overflow:hidden; }
/* scrollBody 的直接子元素：会话 slot 包裹层（保留输入条座位不动） */
body.ts-hdesk-open [data-conversation-scroll] > :not([data-conversation-region="composer"]),
body.ts-center-open [data-conversation-scroll] > :not([data-conversation-region="composer"]) {
  flex:1 1 0; min-height:0; overflow:hidden; display:flex; flex-direction:column;
}
/* viewArea（宿主类名带哈希前缀，用属性子串匹配；!important 压过宿主的 flex:1 0 auto） */
body.ts-hdesk-open [data-conversation-scroll] [class*="viewArea"],
body.ts-center-open [data-conversation-scroll] [class*="viewArea"] {
  flex:1 1 0 !important; min-height:0 !important; overflow:hidden;
}
/* viewArea 内的 slot 包裹层 + 我们的根节点：填满且不外溢。
   用 :has(.ts-cr) 而不是固定层级——宿主 slot 包裹层数可能变（宿主自己也在用 :has），
   只要“里面装着我们的根节点”就统一压成可收缩的竖向 flex 容器。 */
body.ts-hdesk-open [data-conversation-scroll] [class*="viewArea"] > *,
body.ts-center-open [data-conversation-scroll] [class*="viewArea"] > * {
  flex:1 1 0; min-height:0; overflow:hidden; display:flex; flex-direction:column;
}
/* 从 scrollBody 到 .ts-cr 之间的**每一层**都压成可收缩的竖向 flex 容器：
   :has(.ts-cr) 匹配「所有 .ts-cr 的祖先」，不依赖具体包裹层数
   （宿主 slot 可能有多层包裹，写死层级会漏）。 */
body.ts-hdesk-open [data-conversation-scroll] :has(.ts-cr),
body.ts-center-open [data-conversation-scroll] :has(.ts-cr) {
  flex:1 1 0; min-height:0; overflow:hidden; display:flex; flex-direction:column;
}

.ts-cr { display:flex; flex-direction:column; flex:1 1 0; min-height:0; overflow:hidden; padding:12px; box-sizing:border-box; gap:10px; color:inherit; font-size:13px; position:relative; }
.ts-cr a { color:inherit; }
.ts-hdesk { width:100%; min-height:0; }
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

/* —— 侧边栏「项目中心」入口（sidebar.footer.action 槽）——
   宿主侧边栏有 56px rail / 宽栏两态，这里两态都要可用：
   wide → 图标 + 文字一行；rail → 只有图标且居中。 */
/*
 * 位置：用户要求放在 worktable 的【工作台 / 控制室 / 子项目】**上方**，而不是左侧。
 *
 * 宿主的 footerActions 是横向 flex（display:flex），而 dsh-worktable 与我们都注册在
 * sidebar.footer.action 里——所以默认会并排。这里在该容器**包含我们的入口时**改成纵向，
 * 我们的入口（order 10，先渲染）就自然落在 worktable 那一组之上。
 * 用 :has() 而不是改宿主类名（宿主自己也在用 :has）。
 */
[class*="footerActions"]:has(.ts-side-entry) { flex-direction:column; align-items:stretch; gap:6px; }
/* rail（收起）时宿主居中排列，纵向同样成立 */
[class*="collapsed"] [class*="footerActions"]:has(.ts-side-entry) { align-items:center; }
.ts-side-entry { display:flex; align-items:center; gap:8px; width:100%; padding:7px 10px; border:1px solid rgba(127,127,127,.32); border-radius:8px; background:rgba(127,127,127,.1); color:inherit; cursor:pointer; font:inherit; font-size:12.5px; text-align:left; transition:background .15s ease, border-color .15s ease; }
.ts-side-entry:hover { background:rgba(127,127,127,.2); border-color:rgba(127,127,127,.5); }
.ts-side-entry:active { transform:translateY(1px); }
.ts-side-entry.rail { justify-content:center; padding:7px 0; }
.ts-side-icon { flex:none; font-size:14px; line-height:1; }
.ts-side-label { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ts-btn-primary:hover { background:rgba(96,165,250,.4); box-shadow:0 0 12px rgba(96,165,250,.25); }
.ts-btn-picked { background:rgba(74,222,128,.35); border-color:rgba(74,222,128,.85); font-weight:600; box-shadow:0 0 0 1px rgba(74,222,128,.35) inset; }
.ts-btn-picked:hover { background:rgba(74,222,128,.5); }
.ts-btn-danger { background:rgba(248,113,113,.18); border-color:rgba(248,113,113,.5); }
.ts-icon-btn { cursor:pointer; border:none; background:transparent; color:inherit; opacity:.6; border-radius:6px; padding:2px 7px; font-size:14px; line-height:1.3; }
.ts-icon-btn:hover { opacity:1; background:rgba(127,127,127,.22); }
.ts-input, .ts-select { border:1px solid rgba(127,127,127,.35); background:rgba(127,127,127,.08); color:inherit; border-radius:6px; padding:6px 9px; font-size:13px; box-sizing:border-box; }
/* 弹窗里的表单控件一律撑满整行（否则 textarea 会退回 cols 默认宽度，
   比同行的 input 窄——用户反馈两者宽度不一致）。 */
.ts-modal-body .ts-input, .ts-modal-body .ts-select, .ts-modal-body .ts-textarea { width:100%; }
/* 多行文本框：允许纵向拖拽、继承字体、行高放松 */
.ts-textarea { min-height:74px; resize:vertical; font:inherit; font-size:13px; line-height:1.55; }
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
.ts-sess-pop { position:absolute; top:calc(100% + 6px); right:0; left:auto; z-index:44; width:min(520px, calc(100vw - 32px)); max-height:60vh; display:flex; flex-direction:column; border-radius:12px; border:1px solid rgba(127,127,127,.35); background:rgba(24,27,33,.97); color:#e6e8eb; box-shadow:0 14px 40px rgba(0,0,0,.5); backdrop-filter:blur(12px) saturate(1.2); overflow:hidden; }
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
/* 卡片可点击：整卡进工作台（不再有「进入工作台」按钮） */
.ts-center-card-click { cursor:pointer; }
.ts-center-card-click:focus-visible { outline:2px solid rgba(96,165,250,.8); outline-offset:2px; }
.ts-center-card-click.disabled { cursor:not-allowed; opacity:.55; }
/* 卡片右上角“进入 →”提示：只在悬停时明显，不抢标题 */
.ts-center-enterhint { flex:none; font-size:11.5px; opacity:0; transform:translateX(-3px); transition:opacity .14s ease, transform .14s ease; color:#60a5fa; white-space:nowrap; }
.ts-center-card-click:hover .ts-center-enterhint { opacity:1; transform:translateX(0); }
/* 项目介绍：两行截断，保持卡片等高 */
.ts-center-desc { flex:1 1 auto; min-height:0; font-size:12px; line-height:1.55; opacity:.72; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; word-break:break-word; }
.ts-btn-sm { padding:3px 11px; font-size:12px; }

/* —— 工具条：展示方式 / 排序方式 ——
   用户反馈：原来“挤在左边一点点”很难看，希望“一行控制”。
   所以做成**撑满一行的玻璃条**：左侧两组分段控件，右侧项目数；
   窄屏自动换行。 */
.ts-center-toolbar { flex:none; display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding:8px 12px; border:1px solid rgba(127,127,127,.26); border-radius:12px; background:linear-gradient(135deg,rgba(255,255,255,.07),rgba(255,255,255,.02)),rgba(127,127,127,.06); box-shadow:0 4px 14px rgba(0,0,0,.14); }
.ts-seg { display:inline-flex; align-items:center; gap:2px; padding:3px; border:1px solid rgba(127,127,127,.3); border-radius:10px; background:rgba(0,0,0,.14); }
.ts-seg-label { font-size:11.5px; opacity:.55; padding:0 8px 0 9px; white-space:nowrap; }
.ts-seg-btn { border:none; background:transparent; color:inherit; font:inherit; font-size:12.5px; padding:5px 13px; border-radius:8px; cursor:pointer; opacity:.75; white-space:nowrap; transition:background .13s ease, opacity .13s ease, color .13s ease; }
.ts-seg-btn:hover { background:rgba(127,127,127,.22); opacity:1; }
.ts-seg-btn.active { background:linear-gradient(180deg,rgba(96,165,250,.38),rgba(96,165,250,.22)); opacity:1; font-weight:600; box-shadow:inset 0 0 0 1px rgba(96,165,250,.5), 0 2px 8px rgba(96,165,250,.18); }
.ts-center-count { margin-left:auto; font-size:12px; opacity:.55; white-space:nowrap; padding-left:8px; }

/* —— 列表模式：表格（宽裕、不拥挤）—— */
.ts-plist-wrap { flex:1; min-height:0; overflow:auto; border:1px solid rgba(127,127,127,.26); border-radius:14px; background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.01)),rgba(127,127,127,.05); box-shadow:0 6px 20px rgba(0,0,0,.16); }
.ts-plist { width:100%; border-collapse:separate; border-spacing:0; font-size:13px; }
.ts-plist th { position:sticky; top:0; z-index:1; text-align:left; font-weight:600; font-size:11.5px; letter-spacing:.04em; padding:12px 16px; background:rgba(20,23,29,.94); color:inherit; border-bottom:1px solid rgba(127,127,127,.32); backdrop-filter:blur(10px); white-space:nowrap; }
.ts-plist td { padding:12px 16px; border-bottom:1px solid rgba(127,127,127,.14); vertical-align:middle; text-align:left; }
.ts-plist tbody tr { transition:background .12s ease; }
.ts-plist tbody tr:hover { background:rgba(127,127,127,.11); }
.ts-plist tbody tr:last-child td { border-bottom:none; }
.ts-plist-idx { width:64px; text-align:left; opacity:.45; font-variant-numeric:tabular-nums; }
.ts-plist-time { width:150px; white-space:nowrap; opacity:.82; font-variant-numeric:tabular-nums; }
.ts-plist-ops { width:150px; white-space:nowrap; text-align:left; }
.ts-plist-ops .ts-btn + .ts-btn { margin-left:8px; }
.ts-plist-name { font-weight:600; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ts-plist-path { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:.55; font-family:var(--dsh-font-mono, monospace); font-size:11.5px; }
.ts-plist-desc { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:.75; }
/* 列宽分配：名称/路径/介绍给足空间，时间与操作固定 */
.ts-plist th:nth-child(2), .ts-plist td:nth-child(2) { min-width:150px; }
.ts-plist th:nth-child(3), .ts-plist td:nth-child(3) { min-width:220px; }
.ts-plist th:nth-child(6), .ts-plist td:nth-child(6) { min-width:200px; }
/* 活跃对话列：序号点固定窄列（没有活跃对话时整格为空） */
.ts-plist th:nth-child(7), .ts-plist td:nth-child(7) { width:120px; }
/* 列表记录行可点：整行进工作台（与卡片模式同效） */
.ts-plist-row-click { cursor:pointer; }
.ts-plist-row-click:focus-visible { outline:2px solid rgba(96,165,250,.8); outline-offset:-2px; }
/* 项目介绍行内编辑：平时看上去像可点的文本，悬停提示可改 */
.ts-desc-editable { cursor:text; border-bottom:1px dashed rgba(127,127,127,.45); }
.ts-desc-editable:hover { opacity:1; border-bottom-color:rgba(96,165,250,.75); }
.ts-desc-input { width:100%; font-size:12.5px; padding:4px 6px; }
/* 活跃序号点：绿=活跃，黄=待用户确认；点一下直达那条对话的工作台 */
.ts-dots { display:inline-flex; align-items:center; gap:2px; flex:none; }
.ts-dot { border:0; background:0 0; cursor:pointer; font-size:14px; line-height:1; padding:0 1px; font-family:inherit; }
.ts-dot:hover { transform:scale(1.15); }
.ts-dot:focus-visible { outline:2px solid rgba(96,165,250,.8); outline-offset:1px; border-radius:4px; }
.ts-dot-active { color:#4ade80; }
/* 卡片标题行里序号点靠右（名字之后、进入提示之前） */
.ts-center-cardhead .ts-dots { margin-left:auto; }
.ts-dot-pending { color:#fbbf24; }

/* 已启动徒标（卡片上） */
.ts-tag-live { background:rgba(74,222,128,.22); border-color:rgba(74,222,128,.55); color:#86efac; }

/* 工作台顶部预览面板：在标题行之下、其它窗口之上；iframe 高度封顶不挤网格 */
.ts-preview-panel { flex:none; display:flex; flex-direction:column; gap:8px; }
.ts-preview-panel .ts-preview-bar > .ts-preview-url { flex:1 1 auto; }
.ts-preview-panel .ts-preview-frame { flex:0 0 auto; height:clamp(180px, 34vh, 420px); max-height:42vh; }
/* 工作台未选项目 / 项目中心空态 */
.ts-center-empty { display:flex; flex-direction:column; align-items:center; gap:12px; text-align:center; padding:28px 20px; max-width:560px; }
.ts-center-empty-title { font-size:20px; font-weight:700; }
.ts-center-empty-sub { opacity:.78; font-size:13px; line-height:1.65; }

/* —— 确认弹窗 —— */
.ts-confirm { max-width:520px; }
.ts-confirm-danger .ts-modal-head { color:#fca5a5; }
.ts-confirm-msg { font-size:13px; line-height:1.7; }
.ts-confirm-lead { margin-bottom:10px; }
.ts-confirm-target { display:flex; flex-direction:column; gap:3px; padding:10px 12px; margin-bottom:10px; border-radius:10px; border:1px solid rgba(127,127,127,.3); background:rgba(0,0,0,.16); }
.ts-confirm-name { font-weight:600; }
.ts-confirm-path { font-size:11.5px; opacity:.6; word-break:break-all; font-family:var(--dsh-font-mono, monospace); }
.ts-confirm-note { font-size:12px; opacity:.7; line-height:1.65; }
.ts-btn-danger-solid { background:rgba(248,113,113,.9); border-color:rgba(248,113,113,1); color:#fff; font-weight:600; }
.ts-btn-danger-solid:hover { background:rgba(248,113,113,1); box-shadow:0 0 14px rgba(248,113,113,.4); }
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
/* 中列必须用 minmax(0, 1fr)：裸 1fr 的自动最小值是 min-content，
   一旦卡片里有长不可断内容（工具输出、长代码、长标题），中列就会被撑到
   内容宽度，整个网格超出容器；而 .ts-cr 是 overflow:hidden，
   右侧列（250px）连同部分中列就被**裁掉**——这就是“右边少了 40%”。
   空项目没有长内容，所以看起来正常。 */
.ts-desk { display:grid; grid-template-columns:minmax(190px,250px) minmax(0,1fr) minmax(190px,250px); gap:8px; flex:1; min-height:0; min-width:0; overflow:hidden; position:relative; }
/* 网格项自身也要 min-width:0，否则仍会被内容顶宽（min-width:auto 的默认行为） */
.ts-desk > * { min-width:0; }
.ts-desk-col { grid-row:1 / -1; display:flex; flex-direction:column; gap:8px; min-height:0; overflow:hidden; }
.ts-desk-left { grid-column:1; }
.ts-desk-right { grid-column:3; }
.ts-desk-board { grid-column:2; min-height:0; min-width:0; display:flex; flex-direction:column; }
.ts-desk-chat { grid-column:2; min-height:0; min-width:0; display:flex; flex-direction:column; position:relative; border:1px solid rgba(127,127,127,.3); border-radius:9px; background:rgba(127,127,127,.07); padding:8px; box-sizing:border-box; }

/* —— 卡片外壳（黑板 / 主对话 / 协作对话 / 协作收益 共用）——
   卡片的占位（高度/宽度）由外壳承担，内层组件一律 flex:1 填满外壳。 */
.ts-card { display:flex; flex-direction:column; min-height:0; min-width:0; }
.ts-card > * { flex:1; min-height:0; min-width:0; }
/* 卡片自身绝不溢出：内容只能在卡片内部滚（#3） */
.ts-card { overflow:hidden; }
/* 卡片内部各自滚动：工作台整体不产生长滚动条 */
.ts-card > * > .ts-chat-msgs, .ts-card > * > .ts-board-list, .ts-card > * > .ts-talk-list, .ts-card > * > .ts-save-body { min-height:0; min-width:0; overflow:auto; overflow-x:hidden; }
/* 所有可能装长内容的容器都设 min-width:0：
   它们的子元素有 white-space:pre 的代码块 / 长 URL / 长 token，
   默认 min-width:auto 会被内容顶宽，从而把整条 flex/grid 链撑出容器。 */
.ts-mainchat, .ts-board, .ts-talk, .ts-save, .ts-win, .ts-chat-msgs, .ts-win-body, .ts-board-list, .ts-talk-list, .ts-save-body { min-width:0; }
.ts-turn, .ts-msg-assistant, .ts-msg-user, .ts-proc, .ts-proc-item, .ts-inject, .ts-rich { min-width:0; }
/* 代码块/表格/预览是 flex 项，min-width:auto 会让最长一行顶宽父级（即使有 overflow:auto） */
.ts-rich-code, .ts-rich-plain, .ts-rich-table-wrap, .ts-rich-p, .ts-msg-full, .ts-msg-preview, .ts-entry-body, .ts-entry-title { min-width:0; }
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
/* #3 卡片右上角三键：固定最右，其它信息（标题/中间信息）排其左侧。
   标题条统一用 [标题][中间信息][三键] 三段式；actions 永远最后一个 →
   这里用 order 确保三键在最右（不依赖 DOM 顺序）。 */
.ts-card-actions { flex:none; display:inline-flex; align-items:center; gap:1px; margin-left:auto; order:9; }
/* 标题条三段式：标题靠左、中间信息居中、三键靠右。
   .ts-head-mid 用 margin:auto 居中——两侧 auto 让它在剩余空间里居中。 */
.ts-head-title { flex:none; white-space:nowrap; }
.ts-head-mid { flex:0 1 auto; min-width:0; margin:0 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10.5px; font-weight:400; opacity:.62; text-align:center; }
/* 黑板标题条里有 tabs：让 tabs 吃掉弹性空隙，三键就落最右 */
/* 黑板标题条里有 tabs：tabs 吃掉弹性空隙，三键仍在最右（order:9） */
.ts-board-head .ts-board-tabs { margin-left:auto; margin-right:auto; flex-wrap:nowrap; overflow-x:auto; min-width:0; }
.ts-board-head .ts-card-actions { margin-left:8px; }
/* 标题条一律不换行（#4）：计数移入正文 .ts-card-count */
.ts-talk-head, .ts-save-head, .ts-board-head, .ts-mainchat-head { flex-wrap:nowrap; }
.ts-talk-head > span:first-child, .ts-save-head > span:first-child, .ts-board-head > span:first-child, .ts-mainchat-head > span:first-child { flex:none; white-space:nowrap; }
.ts-card-count { flex:none; font-size:10.5px; opacity:.55; padding:0 2px 4px; }
/* 计数现在位于标题条中间（.ts-head-mid）：去掉旧正文态的底部内边距，避免标题条被撑高 */
.ts-head-mid.ts-card-count { padding:0; opacity:.62; flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
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
/* #4 输入条 fixed 停在卡片底部，会盖住消息末尾几行：
   底部留白 = 输入条实测高度（--ts-composer-h，由 HDesk 停靠时写入）+ 余量。
   以前写死 72px，输入条多行/换行时就不够，末尾几行被遮住。 */
.ts-mainchat .ts-chat-msgs { padding-bottom:calc(var(--ts-composer-h, 72px) + 14px); }
/* 主对话内容跟随宿主横向拖拽的宽度（--ts-chat-content-w 由 HDesk 停靠逻辑写入）：
   与停靠的输入条同宽并居中；变量未写入时铺满卡片。
   修复「拖拽只改输入框、对话内容纹丝不动」的不一致。 */
.ts-mainchat .ts-chat-msgs { width:100%; max-width:var(--ts-chat-content-w, none); margin-inline:auto; }
.ts-mainchat-sub { font-size:10.5px; font-weight:400; opacity:.6; }
/* 探索者窗口标题条中间信息 */
.ts-win-mid { flex:0 1 auto; margin:0 auto; }

/* —— 探索者窗口卡 —— */
.ts-win { border:1px solid rgba(127,127,127,.32); background:rgba(127,127,127,.09); border-radius:9px; display:flex; flex-direction:column; min-height:70px; flex:1; overflow:hidden; position:relative; }
.ts-win-head { display:flex; align-items:center; gap:6px; padding:6px 8px; background:rgba(127,127,127,.14); cursor:default; user-select:none; flex-wrap:nowrap; overflow:hidden; }
.ts-win-head:hover { background:rgba(127,127,127,.22); }
/* 按钮组永不压缩：否则窄列里按钮会被压到换行、标题条变高溢出 */
.ts-win-head > span:last-child { flex:none; display:inline-flex; align-items:center; gap:1px; }
.ts-win-name { font-size:12.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:0 1 auto; min-width:0; }
.ts-win-dot { width:8px; height:8px; border-radius:50%; background:#52c41a; flex:none; }
.ts-win-dot.idle { background:rgba(127,127,127,.7); }
.ts-win-body { flex:1; min-height:0; overflow:auto; padding:8px; display:flex; flex-direction:column; gap:6px; font-size:12px; line-height:1.55; }
.ts-win.collapsed { flex:none; }
.ts-win.collapsed .ts-win-body { display:none; }
/* 最大化：补不透明底（原仅 shadow，父级 .ts-win 底色 9% 透度，全屏后看不清） */
.ts-win-overlay { position:absolute; inset:0; z-index:40; flex:none; background:rgba(14,16,21,.97); color:#e6e8eb; border:1px solid rgba(127,127,127,.35); box-shadow:0 8px 32px rgba(0,0,0,.45); backdrop-filter:blur(8px) saturate(1.1); }
.ts-win-overlay .ts-win-head { background:rgba(255,255,255,.07); }
.ts-win-overlay .ts-win-head:hover { background:rgba(255,255,255,.13); }
.ts-msg-user { align-self:flex-end; background:rgba(96,165,250,.22); border:1px solid rgba(96,165,250,.4); border-radius:8px 8px 2px 8px; padding:5px 9px; max-width:88%; white-space:pre-wrap; word-break:break-word; }
.ts-msg-assistant { align-self:flex-start; background:rgba(127,127,127,.14); border-radius:8px 8px 8px 2px; padding:5px 9px; max-width:94%; white-space:pre-wrap; word-break:break-word; }
.ts-msg-tool, .ts-msg-system { align-self:stretch; opacity:.62; font-size:11px; border-left:2px solid rgba(127,127,127,.5); padding:2px 8px; }
.ts-msg-tool .ts-msg-role, .ts-msg-system .ts-msg-role { display:flex; align-items:center; gap:4px; }
.ts-msg-toggle { padding:0 4px; font-size:11px; opacity:.7; }
.ts-msg-preview { opacity:.85; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ts-msg-full { white-space:pre-wrap; word-break:break-word; max-height:220px; overflow:auto; margin-top:2px; }
.ts-msg-role { font-size:10px; opacity:.6; margin-bottom:2px; }

/* —— #5 按「轮」呈现（对齐宿主「对话」）：过程默认折叠，最终回答展开 —— */
.ts-turn { display:flex; flex-direction:column; gap:6px; }
.ts-turn + .ts-turn { margin-top:10px; padding-top:9px; border-top:1px dashed rgba(127,127,127,.22); }
/* 过程折叠条：一行，不抢眼 */
.ts-proc { align-self:stretch; }
/* 窄列不换行：子项 nowrap + 省略号截断（文字换行发生在 flex 子项内部，不是 flex 层） */
.ts-proc-head { display:flex; align-items:center; gap:7px; width:100%; text-align:left; font:inherit; font-size:11px; opacity:.66; padding:3px 8px; border:0; border-left:2px solid rgba(127,127,127,.45); background:rgba(127,127,127,.07); color:inherit; cursor:pointer; border-radius:0 6px 6px 0; flex-wrap:nowrap; overflow:hidden; white-space:nowrap; }
.ts-proc-head > span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* 「过程 N 步」优先保留，先缩「思考/工具」两段（用户：不想看到换行，允许省略） */
.ts-proc-head .ts-proc-lead { flex:none; }
.ts-proc-head .ts-dim { flex:0 1 auto; }
.ts-proc-head .ts-proc-caret { flex:none; width:10px; }
.ts-proc-head:hover { opacity:.9; background:rgba(127,127,127,.14); }
.ts-dim { opacity:.6; }
.ts-proc-body { display:flex; flex-direction:column; gap:5px; margin-top:5px; padding-left:8px; }
.ts-proc-item { border-left:2px solid rgba(127,127,127,.3); padding:2px 8px; font-size:11px; opacity:.75; }
.ts-proc-item-head { display:flex; align-items:center; gap:6px; }
.ts-proc-role { flex:none; font-size:10px; opacity:.7; }
.ts-proc-item .ts-msg-preview { flex:1; min-width:0; }
.ts-proc-item .ts-msg-full { max-height:180px; overflow:auto; }
/* 最终回答：按正常对话正文展开（Markdown 渲染，根节点是 .ts-rich） */
.ts-msg-assistant .ts-rich, .ts-msg-assistant .ts-rich-plain { white-space:normal; }
/* 过程展开后的富文本：字号更小、紧凑，但同样完整渲染（不出现原始标记） */
.ts-msg-full .ts-rich { font-size:11.5px; gap:4px; }
.ts-msg-full .ts-rich-code { max-height:200px; }
/* 思考（reasoning）：与工具同款收纳，但用紫色左边条 + 斜体区分，弱化不抢眼 */
.ts-proc-think { border-left-color:rgba(192,132,252,.65) !important; font-style:italic; }
.ts-proc-think .ts-proc-role { color:rgba(192,132,252,.95); font-style:normal; opacity:.95; }
/* 上下文注入（宿主自动带入的运行时快照/技能目录）：与「过程」同款单行折叠，
   用绿色左边条区分——它不是用户发的，也不是模型过程，点开才看正文 */
.ts-inject { align-self:stretch; }
.ts-inject .ts-proc-head { border-left-color:rgba(52,211,153,.55); background:rgba(52,211,153,.08); }
.ts-inject .ts-proc-head:hover { background:rgba(52,211,153,.16); }
.ts-inject-item { border-left-color:rgba(52,211,153,.45); }
.ts-inject-item .ts-proc-role { color:rgba(52,211,153,.95); opacity:.9; }
/* “回到最新”：粘性跟随被用户滚离底部后出现（不自动抢滚动） */
.ts-jump-latest { position:sticky; bottom:6px; align-self:center; margin-top:-28px; z-index:2; padding:4px 12px; border-radius:99px; border:1px solid rgba(96,165,250,.6); background:rgba(24,27,33,.92); color:#e6e8eb; font:inherit; font-size:11.5px; cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.4); backdrop-filter:blur(8px); }
.ts-jump-latest:hover { background:rgba(96,165,250,.35); }
/* 任务列表 */
.ts-rich-tasks { list-style:none; padding-left:2px; }
.ts-rich-tasks .ts-rich-check { margin-right:5px; opacity:.8; }
.ts-rich-tasks li.done { opacity:.6; }
.ts-rich-tasks li.done > :not(.ts-rich-check) { text-decoration:line-through; }
/* JSONL：逐行着色，行间小间距 */
.ts-rich-jsonl { display:flex; flex-direction:column; gap:5px; }
.ts-rich-jsonl .ts-rich-code { margin:0; }
/* JSON 表格：表头突出、等宽数字 */
.ts-rich-jsontable td, .ts-rich-jsontable th { font-variant-numeric:tabular-nums; white-space:pre-wrap; word-break:break-word; }
/* 行内删除线 */
.ts-rich del { opacity:.65; }
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
/* —— GenUI 围栏槽位（交 @changfenhuang/dsh-genui 渲染）——
   标签仅用于插件的**结构识别**（叶子元素文本恰为 dsh-ui + 同级 <pre>），
   必须不可见；接管后插件会把整个槽位 display:none，并在其后插入自己的 React 根。 */
.ts-genui-lang { display:none; }
/* 接管后紧随的插件容器：与消息体保持同一列宽，不溢出 */
.genui-dom-fence { max-width:100%; min-width:0; }
.ts-rich-table-wrap { overflow:auto; }
.ts-rich-table { border-collapse:collapse; font-size:11.5px; width:100%; }
.ts-rich-table th, .ts-rich-table td { border:1px solid rgba(127,127,127,.3); padding:3px 7px; text-align:left; vertical-align:top; }
.ts-rich-table th { background:rgba(127,127,127,.16); font-weight:600; }
.ts-json-key { color:#7dd3fc; }
.ts-json-str { color:#a5d6a7; }
.ts-json-num { color:#fbbf24; }
.ts-json-bool { color:#c084fc; }
.ts-json-null { color:#f87171; }

/* —— 项目中心：「展示」内嵌视图（项目 UI 直接在 DSH 内渲染） ——
   根节点复用 .ts-cr：宿主那条「从 scrollBody 一路压成可收缩 flex」的链路
   用 :has(.ts-cr) 选中，带这个类才不会被宿主的「随内容长高」规则撑破。 */
.ts-preview { gap:8px; }
.ts-preview-bar { display:flex; align-items:center; gap:10px; padding:7px 10px; border:1px solid rgba(127,127,127,.3); border-radius:10px; background:rgba(127,127,127,.1); flex:none; }
.ts-preview-title { font-weight:600; font-size:13px; white-space:nowrap; }
.ts-preview-url { flex:1 1 auto; min-width:0; font-size:11px; opacity:.65; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ts-preview-ops { display:flex; gap:6px; flex:none; }
.ts-preview-frame { flex:1 1 0; min-height:0; width:100%; border:1px solid rgba(127,127,127,.3); border-radius:10px; background:#fff; }
`

export function injectProjectCenterStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}
