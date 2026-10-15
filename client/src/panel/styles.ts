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
     root[data-phase=active] .viewArea { flex:1 0 auto; min-height:auto }
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

/* font-family 走 --ts-font（设置面板的「字族」项；未设时 inherit，跟宿主一致）。 */
.ts-cr { display:flex; flex-direction:column; flex:1 1 0; min-height:0; overflow:hidden; padding:12px; box-sizing:border-box; gap:10px; color:inherit; font-size:calc(var(--ts-fs, 12.5px) * 1.04); font-family:var(--ts-font, inherit); position:relative; }
.ts-cr a { color:inherit; }
/* 工作台打开时隐藏宿主那套全局宽度把手（值写在共享父元素上、一处拖动处处生效，
   且给把手预留 176px 永远铺不满）。工作台默认铺满。 */
body.ts-hdesk-open [data-width-handle] { display:none !important; }
/* dockview 版工作台没有再加 ts-hdesk-open 类（那是旧 HDesk 的写法），
   导致宿主那对 10px 宽、整屏高的宽度把手仍浮在工作台面板上 —— 用户看到的
   「蓝色条块」一半来自它。用 :has 把「工作台在场」这个条件补上。 */
body:has(.ts-dock) [data-width-handle] { display:none !important; }

/* —— 项目中心（列表态）：背景覆盖到输入框及其下方区域 ——
   输入条座位 [data-conversation-region="composer"] 与本视图是**兄弟节点**
   （同在 [data-conversation-scroll] 内），且它自带不透明渐变底。
   因此把网格与光晕铺到共享容器上，并把输入条座位改透明。 */
body.ts-center-open [data-conversation-scroll] {
  /* 皮肤（--ts-skin-bg / --ts-skin-color，见 skins.ts）垫在最底层：
     用户要求「项目中心页面也能自由换皮肤」，换皮肤时工作台与这里同时变。
     无皮肤时 --ts-skin-bg = none、--ts-skin-color = transparent，就是原来的中性底。 */
  background-color: var(--ts-skin-color, transparent);
  background-image:
    var(--ts-skin-bg, none),
    /* 用户反馈：原来那层紫/粉/青彩光太跳，跟工作台不一个调子 → 改成极淡的中性冷光，
       让「项目中心」看着还是同一个界面的一个页，而不是另一个产品。 */
    radial-gradient(circle at 12% 6%, rgba(96,165,250,.10), transparent 46%),
    radial-gradient(circle at 84% 96%, rgba(96,165,250,.07), transparent 50%),
    linear-gradient(rgba(127,127,127,.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(127,127,127,.055) 1px, transparent 1px);
  background-size: auto, auto, auto, 30px 30px, 30px 30px;
  background-repeat: no-repeat, no-repeat, no-repeat, repeat, repeat;
}
/* —— 项目中心（列表态）：**整条隐藏**宿主输入条 ——
   用户要求：项目中心页不该出现聊天输入框及其状态信息（模型名 · 费用 · 上下文占比 ·
   步数 · token 缓存…）。这条座位（[data-conversation-region="composer"]）与本视图
   是**兄弟节点**（同在 [data-conversation-scroll] 内），所以从共享容器上就能藏。

   用 display:none 而非 unmount：宿主不会因为节点消失而重排/丢状态，
   切回工作台时（ts-center-open 移除）输入条原样回来，无需重新挂载。 */
body.ts-center-open [data-conversation-region="composer"] {
  display: none !important;
}
/* —— 工作台停靠宿主输入条时：去掉“黑色背景板” ——
   宿主对座位（[data-conversation-region="composer"]）写了一条
     background: linear-gradient(180deg, 透明 0px, var(--dsw-alias-bg-base) 36px)
   即底部 36px 完全是不透明的宿主底色，用来遮住“从输入框下方滚过”的内容。
   工作台把整条座位停靠进卡片后，这层不透明底就在输入框下面压出一块深色板，
   与台面割裂。台面里的滚动发生在卡片内部，没有内容会从输入框下方经过，
   因此直接置透明（类名由 HDesk 在停靠期间加到 body 上）。 */
body.ts-hdesk-dock [data-conversation-region="composer"] {
  background: transparent !important;
}

/* —— 工作台「DSH 主对话卡未呈现」时：**整条隐藏**宿主输入条 ——
   主对话卡被关闭/收起后输入条不再停靠；若放它回宿主原位，就会独自悬在预览/台面
   下方（连同模型名 · 费用 · 上下文占比 · 步数 · token 缓存等状态行）。用户要求此时
   界面里不出现任何对话框（像「项目中心」页那样）。
   用 display:none 而非 unmount：恢复主对话卡（标题行「＋ DSH 主对话」chip / 一键切换）
   即原样回来，宿主状态不丢。类名由 HDesk 在主对话卡未停靠期间加到 body。 */
/* dockview 时代同理（类名由 DeskDock 在「主对话卡不可见」时加）：
   面板被关、或它被同组的其它窗口（如预览）挡在后面时，都把输入条整条藏掉。 */
body.ts-hdesk-nochat [data-conversation-region="composer"],
body.ts-desk-nochat [data-conversation-region="composer"] {
  display: none !important;
}

/* —— 通用条/按钮 —— */
.ts-bar { display:flex; align-items:center; gap:10px; flex-wrap:nowrap; height:40px; box-sizing:border-box; }
.ts-bar-right { margin-left:auto; flex:0 1 auto; min-width:0; }
/* 右侧工具簇：已关闭列表 + 一键切换 + 历史/新建会话；项多时允许换行，整体右对齐 */
.ts-bar-tools { display:flex; align-items:center; justify-content:flex-end; gap:8px; flex-wrap:nowrap; min-width:0; }
/* 会话操作固定单行，不换行 */
.ts-bar-sessions { flex:none; flex-wrap:nowrap; }
.ts-title { font-size:calc(var(--ts-fs, 12.5px) * 1.28); font-weight:600; }
/* 标题行左侧：只留项目名本身（用户要求去掉「workbench」后缀与那圈外框徽标） */
/* 标题行左侧：项目名本身（去掉了「workbench」后缀与那圈外框徽标，但**字号回到原来的醒目大小**） */
.ts-title-proj { flex:none; display:inline-flex; align-items:center; gap:8px; max-width:min(420px,42vw); font-size:calc(var(--ts-fs, 12.5px) * 1.52); font-weight:700; letter-spacing:.01em; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ts-title-proj-icon { flex:none; font-size:calc(var(--ts-fs, 12.5px) * 1.28); opacity:.9; }
.ts-title-proj-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* 旧版「锁定/未锁定胶囊配色」随徽标一起删除（锁定状态现在只在状态栏显示）。 */
/* 布局锁按钮（紧贴项目名右侧）：与胶囊同色系，一瞥即知开关状态 */
.ts-lock-btn { flex:none; white-space:nowrap; }
.ts-lock-btn.ts-lock-on { background:rgba(45,212,191,.2); border-color:rgba(45,212,191,.55); }
.ts-lock-btn.ts-lock-on:hover { background:rgba(45,212,191,.3); }
.ts-lock-btn.ts-lock-off { background:rgba(251,191,36,.2); border-color:rgba(251,191,36,.55); }
.ts-lock-btn.ts-lock-off:hover { background:rgba(251,191,36,.3); }
/* 一键切换按钮：显示全部窗口 ↔ 仅显示预览（无预览时为 DSH 主对话） */
.ts-btn-mode { flex:none; white-space:nowrap; }
.ts-sub { opacity:.65; font-size:calc(var(--ts-fs, 12.5px) * 0.96); }
.ts-btn { cursor:pointer; border:1px solid rgba(127,127,127,.35); background:rgba(127,127,127,.12); color:inherit; border-radius:8px; padding:5px 12px; font-size:calc(var(--ts-fs, 12.5px) * 1.04); line-height:1.4; transition:background .15s ease, border-color .15s ease, box-shadow .15s ease; }
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
.ts-side-entry { display:flex; align-items:center; gap:8px; width:100%; padding:7px 10px; border:1px solid rgba(127,127,127,.32); border-radius:8px; background:rgba(127,127,127,.1); color:inherit; cursor:pointer; font:inherit; font-size:var(--ts-fs, 12.5px); text-align:left; transition:background .15s ease, border-color .15s ease; }
.ts-side-entry:hover { background:rgba(127,127,127,.2); border-color:rgba(127,127,127,.5); }
.ts-side-entry:active { transform:translateY(1px); }
/* rail（侧边栏收起）：与宿主的图标按钮**完全同款** —— 无边框、无底色、36×36、圆角 12、图标居中。
   （用户反馈：收起后这个按钮还带着外框，和「设置 / 搜索」等按钮风格不一致。）
   实测宿主 rail 图标按钮：border 0 / background transparent / 36×36 / radius 12px / padding 0。 */
.ts-side-entry.rail { justify-content:center; padding:0; width:36px; height:36px; border:0; background:transparent; border-radius:12px; }
.ts-side-entry.rail .ts-side-icon { font-size:calc(var(--ts-fs, 12.5px) * 1.28); }
/* 悬停也只给底色（不再出现边框）；按压不做位移（图标按钮不位移） */
.ts-side-entry.rail:hover { background:rgba(127,127,127,.18); border:0; }
.ts-side-entry.rail:active { transform:none; background:rgba(127,127,127,.24); }
.ts-side-icon { flex:none; font-size:calc(var(--ts-fs, 12.5px) * 1.12); line-height:1; }
.ts-side-label { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

/* 右侧簇（角标 + 呼吸灯圆点）：wide 右对齐，rail 跟随居中。
   padding + 对应负 margin = 悬停热区向四周扩大（跑马灯悬浮面板要“一碰到这片区域就弹”），
   视觉尺寸不变，只变可触达范围（圆点本身只有 6px，直接命中太难）。 */
.ts-side-right { flex:none; margin-left:auto; display:inline-flex; align-items:center; gap:5px; padding:8px 7px; margin-top:-8px; margin-bottom:-8px; margin-right:-7px; }
.ts-side-right .ts-pulse { margin-left:0; }
.ts-side-entry.rail .ts-side-right { margin-left:0; gap:3px; }

/* —— 计数角标（同款两种色）：黄 = 需要处理的对话；蓝 = 未读的正常结束，点它弹各自清单 —— */
.ts-side-badge { flex:none; display:inline-flex; align-items:center; justify-content:center; min-width:15px; height:15px; padding:0 4px; border-radius:999px; font-size:calc(var(--ts-fs, 12.5px) * 0.8); font-weight:700; line-height:1; cursor:pointer; animation:ts-pulse-breathe 1.6s ease-in-out infinite; }
.ts-side-badge.is-warn { background:#f59e0b; color:#1b1305; box-shadow:0 0 6px rgba(245,158,11,.85); }
.ts-side-badge.is-done { background:#38bdf8; color:#052a3d; box-shadow:0 0 6px rgba(56,189,248,.9); }
.ts-side-badge:hover { filter:brightness(1.12); }
.ts-side-badge.is-warn:hover { box-shadow:0 0 9px rgba(245,158,11,1); }
.ts-side-badge.is-done:hover { box-shadow:0 0 9px rgba(56,189,248,1); }
.ts-side-badge:focus-visible { outline:2px solid rgba(96,165,250,.85); outline-offset:2px; }
/* rail（36px）里角标与圆点同排：固定 15px 宽（border-box 口径），保证不横向溢出按钮；
   两枚角标同现时圆点让位（JSX 侧按角标数递减呼吸点） */
.ts-side-entry.rail .ts-side-badge { box-sizing:border-box; width:15px; min-width:15px; height:14px; padding:0; font-size:calc(var(--ts-fs, 12.5px) * 0.76); }

/* 清单浮层：portal 到 body + position:fixed（top/left 由 JSX 按按钮矩形给），
   所以 rail（56px 收起）与展开态都从按钮右缘飞出，不被侧边栏 overflow 裁剪 */
.ts-warn-pop { position:fixed; z-index:60; max-width:calc(100vw - 24px); max-height:80vh; display:flex; flex-direction:column; border-radius:12px; border:1px solid var(--ts-pop-line); background:var(--ts-pop-bg); color:var(--ts-pop-fg); box-shadow:var(--ts-pop-shadow); backdrop-filter:blur(12px) saturate(1.2); overflow:hidden; }
/* 跑马灯悬浮面板：**宽度由 JS 固定给**（见 ControlRoomEntry 的 panelWidth）。
   这里只保证它是个全宽容器 —— 设置区 / 清单区都是 width:100%，
   整块面板只有一种宽度，不再出现“清单被长标题撐宽、设置区停在原宽”的割裂感。 */
.ts-hover-pop { width:100%; }
/* 一个区域 = 标题行 + 内容，区域之间用一条分隔线（不再是各块各自一条 border-bottom，
   那样最后一个区域会多出一条悬空的线） */
.ts-sec { flex:none; width:100%; box-sizing:border-box; }
/* 第三个区域（对话清单）是唯一「会长高」的一块：条目一多它得能压缩自己，
   把超出部分交给清单内部滚动。若也写 flex:none，整块面板会被 max-height
   一刀裁掉，末尾几条直接看不见（用户反馈：消息多时清单显示不全）。 */
.ts-sec-list { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; }
.ts-sec + .ts-sec { border-top:1px solid rgba(127,127,127,.22); }
/* 区域标题行：与「对话清单」原头部同款排版，但中性色（不再是某一区的专属样式） */
.ts-sec-head { display:flex; align-items:center; gap:8px; padding:9px 22px 8px 12px; font-size:calc(var(--ts-fs, 12.5px) * 0.88); font-weight:600; opacity:.62; letter-spacing:.04em; }
.ts-sec-title { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* 标题右侧的浅色计数（如「对话清单 3」里的 3） */
.ts-sec-note { flex:none; font-weight:500; opacity:.75; }
/* 标题行右侧的操作推到最右（「全部已读」按钮、主开关都靠这个定位） */
.ts-sec-head > .ts-mark-all-read-btn,
.ts-sec-head > .ts-cont-sw { margin-left:auto; }
/*
 * 外框（box）：把一组子控件包起来（提示音的四行、自动继续的两行、清单的条目列表）。
 * 用底色 + 描边区分于面板背景，一眼看出“这是某个区域的子内容”。
 * 不画自身分隔线 —— 区域之间的分隔由 .ts-sec + .ts-sec 负责。
 *
 * 类名刻意叫 ts-box 而不是 ts-card：ts-card 已被 HDesk 的桌面布局占用
 * （.ts-card { display:flex; overflow:hidden } 加子元素 flex:1），
 * 复用会让面板里的外框继承那套行为。
 */
.ts-box { box-sizing:border-box; width:100%; border:1px solid rgba(127,127,127,.2); background:rgba(127,127,127,.07); border-radius:9px; }
/* 外框里的一行 */
.ts-box-row { display:flex; align-items:center; gap:6px; min-width:0; padding:6px 9px; }
.ts-box-row > label { flex:none; font-size:calc(var(--ts-fs, 12.5px) * 0.84); opacity:.62; letter-spacing:.02em; cursor:help; }
/* 清单外框：装 .ts-warn-pop-list（它自己管滚动与行间距） */
.ts-box-list { flex:1 1 auto; display:flex; flex-direction:column; min-height:0; overflow:hidden; padding:3px; }
/* 清单区内容容器：与提示音 / 自动继续同款外距（0 12px 10px），保证三个外框左右对齐、内距一致 */
.ts-list-body { flex:1 1 auto; min-height:0; width:100%; box-sizing:border-box; padding:0 12px 10px; }
/* —— 提示音设置区（内嵌在悬浮面板顶部，与「对话清单」同面板同现）——
   宽度 100%（不再写死 272px）：与自动继续区、清单区严格同宽、同边距。 */
.ts-sound-body { flex:none; width:100%; box-sizing:border-box; display:flex; flex-direction:column; gap:6px; padding:0 12px 10px; }
.ts-box-row .ts-select,
.ts-box-row .ts-sound-min { height:22px; box-sizing:border-box; border:1px solid rgba(127,127,127,.35); border-radius:6px; background:rgba(127,127,127,.1); color:inherit; font-family:inherit; font-size:calc(var(--ts-fs, 12.5px) * 0.84); line-height:1; padding:0 5px; }
.ts-box-row .ts-select { flex:1; min-width:0; }
.ts-box-row .ts-sound-min { flex:none; width:46px; text-align:center; -moz-appearance:textfield; appearance:textfield; }
/* 数字输入框去掉原生上下箭头（它才是“跟别的控件不一样”的元凶） */
.ts-box-row .ts-sound-min::-webkit-outer-spin-button,
.ts-box-row .ts-sound-min::-webkit-inner-spin-button { -webkit-appearance:none; appearance:none; margin:0; }
/* 统一开关（提示音区 / 自动继续区共用同一颗滑块）：极简，不写「开/关」二字，
   状态由颜色 + 滑块位置表达；具体含义全走 title 悬浮提示。 */
.ts-cont-sw { flex:none; position:relative; width:28px; height:16px; box-sizing:border-box; padding:0; border:1px solid rgba(127,127,127,.45); background:rgba(127,127,127,.18); border-radius:999px; cursor:pointer; transition:background .15s, border-color .15s; }
.ts-cont-sw > i { position:absolute; top:1px; left:1px; width:12px; height:12px; border-radius:50%; background:rgba(180,186,196,.95); transition:transform .15s, background .15s; }
.ts-cont-sw.on { border-color:rgba(74,222,128,.6); background:rgba(74,222,128,.28); }
.ts-cont-sw.on > i { transform:translateX(12px); background:#86efac; }
.ts-cont-sw:focus-visible { outline:2px solid rgba(96,165,250,.85); outline-offset:1px; }
.ts-sound-range { flex:1; min-width:0; height:14px; accent-color:#38bdf8; cursor:pointer; }
.ts-sound-mini { flex:none; width:22px; height:22px; box-sizing:border-box; border:1px solid rgba(127,127,127,.4); background:rgba(127,127,127,.14); color:inherit; font-size:calc(var(--ts-fs, 12.5px) * 0.8); line-height:1; padding:0; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; }
.ts-sound-mini:hover { background:rgba(127,127,127,.3); }
.ts-sound-mini.is-playing { border-color:rgba(245,158,11,.65); background:rgba(245,158,11,.16); color:#fbbf24; }
.ts-sound-unit { flex:none; font-size:calc(var(--ts-fs, 12.5px) * 0.8); opacity:.55; }
/* —— 自动继续设置块（嵌在悬浮面板里，与声音设置同款紧凑排版）—— */
.ts-cont-block { flex:none; width:100%; box-sizing:border-box; display:flex; flex-direction:column; gap:6px; padding:0 12px 10px; }
.ts-cont-gap { flex:1 1 auto; min-width:8px; }
/* 自动继续三个子开关：等距分布（首项左缘对齐下一行「发送上限」，末项右缘对齐「秒」）。
   用 space-between 而不是 flex:1 居中 —— 居中会让首项左缩、末项右缩，与上下两行对不齐。 */
.ts-cont-sw-row { justify-content:space-between; }
.ts-box-row > .ts-cont-sw-item { flex:0 0 auto; display:flex; align-items:center; gap:6px; min-width:0; }
.ts-cont-sw-item > label { flex:none; font-size:calc(var(--ts-fs, 12.5px) * 0.84); opacity:.62; letter-spacing:.02em; cursor:help; }
.ts-cont-sw-item > .ts-cont-sw { flex:none; }
.ts-cont-num { flex:none; width:46px; height:22px; box-sizing:border-box; border:1px solid rgba(127,127,127,.35); border-radius:6px; background:rgba(127,127,127,.1); color:inherit; font-family:inherit; font-size:calc(var(--ts-fs, 12.5px) * 0.84); line-height:1; padding:0 5px; text-align:center; -moz-appearance:textfield; appearance:textfield; }
.ts-cont-num::-webkit-outer-spin-button, .ts-cont-num::-webkit-inner-spin-button { -webkit-appearance:none; appearance:none; margin:0; }
.ts-cont-unit { flex:none; font-size:calc(var(--ts-fs, 12.5px) * 0.8); opacity:.5; }
/* 头部「全部已读」：牌形按钮，与行内「已读」同一套视觉语言（不再是一个孤零零的黄胖按钮） */
.ts-mark-all-read-btn { flex:none; display:inline-flex; align-items:center; gap:3px; border:1px solid rgba(127,127,127,.36); background:rgba(127,127,127,.12); color:inherit; font-size:calc(var(--ts-fs, 12.5px) * 0.84); font-weight:500; line-height:1; padding:4px 9px; border-radius:999px; cursor:pointer; opacity:.82; transition:background .12s, opacity .12s; }
.ts-mark-all-read-btn:hover { opacity:1; background:rgba(127,127,127,.26); }
.ts-mark-all-read-btn:focus-visible { outline:2px solid rgba(96,165,250,.85); outline-offset:1px; }
.ts-mark-all-read-btn:disabled { opacity:.4; cursor:not-allowed; pointer-events:none; }
.ts-warn-pop-list { flex:1 1 auto; overflow:auto; overflow-x:hidden; padding:5px; display:flex; flex-direction:column; gap:2px; min-height:32px; }
/* 一行 = 条目（点它跳转）+ 右侧操作区。align-items:center 让操作按钮与两行文本居中对齐，
   不再像以前那样贴顶显得歪。 */
.ts-warn-row { display:flex; align-items:center; gap:6px; box-sizing:border-box; padding-right:1px; border-radius:9px; }
.ts-warn-item { flex:1; min-width:0; display:flex; align-items:flex-start; gap:8px; padding:7px 8px; border:0; border-radius:9px; background:transparent; color:inherit; font:inherit; text-align:left; cursor:pointer; }
.ts-warn-actions { flex:none; display:flex; align-items:center; gap:5px; }
.ts-warn-row:not(.is-active) .ts-warn-item:hover { background:rgba(245,158,11,.14); }
.ts-warn-row.is-active .ts-warn-item:hover { background:rgba(34,197,94,.12); }
.ts-warn-item:focus-visible { outline:1px solid rgba(96,165,250,.8); }
.ts-warn-icon { flex:none; font-size:calc(var(--ts-fs, 12.5px) * 0.88); line-height:1.7; opacity:.9; }
/* min-width:0 是防撐宽的关键：这两层只要有一层没写，长标题就会把整个面板顶宽 */
.ts-warn-body { min-width:0; flex:1; display:flex; flex-direction:column; gap:3px; }
.ts-warn-title { min-width:0; font-size:var(--ts-fs, 12.5px); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
/* 第二行：项目胶囊 + 中断原因短标签（如「截断」「余额」）并排；负空间时才省略 */
.ts-warn-tags { display:flex; align-items:center; gap:4px; min-width:0; max-width:100%; }
.ts-warn-sub { flex:0 1 auto; min-width:0; box-sizing:border-box; font-size:calc(var(--ts-fs, 12.5px) * 0.84); line-height:1.5; padding:0 7px; border-radius:999px; background:rgba(127,127,127,.15); border:1px solid rgba(127,127,127,.26); opacity:.9; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
/* 中断原因：与项目胶囊同形但用警告色，一眼区分「归属」与「毛病」 */
.ts-warn-reason { flex:none; box-sizing:border-box; font-size:calc(var(--ts-fs, 12.5px) * 0.8); line-height:1.5; padding:0 6px; border-radius:999px; background:rgba(245,158,11,.16); border:1px solid rgba(245,158,11,.42); color:#fbbf24; white-space:nowrap; }
/* 计时器：距上次正常发言的耗时（仅活跃对话显示） */
.ts-warn-timer { flex:none; font-size:calc(var(--ts-fs, 12.5px) * 0.8); opacity:.55; font-variant-numeric:tabular-nums; white-space:nowrap; margin-left:0; }
/* 行内「已读」：轻牌按钮 + 对勾图标（以前那个裸「✓」太小、难看出是按钮） */
.ts-warn-read { flex:none; display:inline-flex; align-items:center; gap:3px; border:1px solid rgba(127,127,127,.34); background:rgba(127,127,127,.12); color:inherit; font-size:calc(var(--ts-fs, 12.5px) * 0.84); line-height:1; padding:4px 8px; border-radius:999px; cursor:pointer; opacity:.68; transition:background .12s, opacity .12s, border-color .12s; }
.ts-warn-read:hover { opacity:1; background:rgba(74,222,128,.18); border-color:rgba(74,222,128,.5); color:#86efac; }
.ts-warn-read:focus-visible { outline:2px solid rgba(96,165,250,.85); outline-offset:1px; }
/* 行内「继续」：不能自动时的唯一手动入口，做成主色调强调 */
.ts-warn-continue-btn { flex:none; border:1px solid rgba(96,165,250,.6); background:rgba(96,165,250,.18); color:#93c5fd; font-size:calc(var(--ts-fs, 12.5px) * 0.84); font-weight:600; line-height:1; padding:5px 9px; border-radius:999px; cursor:pointer; transition:background .12s; }
.ts-warn-continue-btn:hover:not(:disabled) { background:rgba(96,165,250,.34); }
.ts-warn-continue-btn:disabled { opacity:.6; cursor:default; }
.ts-warn-continue-btn.is-error { border-color:rgba(248,113,113,.6); background:rgba(248,113,113,.18); color:#fca5a5; }
.ts-warn-continue-btn:focus-visible { outline:2px solid rgba(96,165,250,.85); outline-offset:1px; }
/* 已发送：不是按钮，只是告诉用户「机器已经接手了，不用管」 */
.ts-warn-done { flex:none; display:inline-flex; align-items:center; gap:3px; font-size:calc(var(--ts-fs, 12.5px) * 0.84); line-height:1; padding:4px 8px; border-radius:999px; border:1px solid rgba(74,222,128,.45); background:rgba(74,222,128,.14); color:#86efac; white-space:nowrap; }
.ts-warn-done.is-busy { border-color:rgba(96,165,250,.45); background:rgba(96,165,250,.14); color:#93c5fd; }
.ts-warn-empty { display:flex; align-items:center; justify-content:center; gap:6px; padding:18px 8px; font-size:calc(var(--ts-fs, 12.5px) * 0.92); opacity:.45; }
@media (prefers-reduced-motion: reduce) { .ts-side-badge { animation:none; opacity:1; } }

/* 呼吸灯：侧边栏「项目中心」入口的存活指示（3 个小圆点，wide 时右对齐）。
   绿 = 正常使用；黄 = 弹选择框 / 被故障中断；有对话在跑时依次闪烁（跑马灯）。 */
.ts-pulse { flex:none; margin-left:auto; display:inline-flex; align-items:center; gap:4px; }
/* 收起态：圆点居中（顶替图标），不要被 margin-left:auto 推到右边 */
.ts-side-entry.rail .ts-pulse { margin-left:0; }
.ts-pulse-dot { display:block; width:6px; height:6px; border-radius:50%; background:#22c55e; box-shadow:0 0 6px rgba(34,197,94,.7); animation:ts-pulse-breathe 1.6s ease-in-out infinite; }
.ts-pulse-warn .ts-pulse-dot { background:#f59e0b; box-shadow:0 0 6px rgba(245,158,11,.8); }
/* 有对话正在跑：依次闪烁（跑马灯）——animationDelay 由 JSX 按序号给出 */
.ts-pulse-run .ts-pulse-dot { animation:ts-pulse-chase 1.05s ease-in-out infinite; }
@keyframes ts-pulse-chase { 0%,100% { opacity:.22; transform:scale(.8) } 30% { opacity:1; transform:scale(1.15) } }
@keyframes ts-pulse-breathe { 0%,100% { opacity:.45 } 50% { opacity:1 } }
@media (prefers-reduced-motion: reduce) { .ts-pulse-dot { animation:none; opacity:1 } }
.ts-btn-primary:hover { background:rgba(96,165,250,.4); box-shadow:0 0 12px rgba(96,165,250,.25); }
.ts-btn-picked { background:rgba(74,222,128,.35); border-color:rgba(74,222,128,.85); font-weight:600; box-shadow:0 0 0 1px rgba(74,222,128,.35) inset; }
.ts-btn-picked:hover { background:rgba(74,222,128,.5); }
.ts-btn-danger { background:rgba(248,113,113,.18); border-color:rgba(248,113,113,.5); }
.ts-icon-btn { cursor:pointer; border:none; background:transparent; color:inherit; opacity:.6; border-radius:6px; padding:2px 7px; font-size:calc(var(--ts-fs, 12.5px) * 1.12); line-height:1.3; }
.ts-icon-btn:hover { opacity:1; background:rgba(127,127,127,.22); }
.ts-input, .ts-select { border:1px solid rgba(127,127,127,.35); background:rgba(127,127,127,.08); color:inherit; border-radius:6px; padding:6px 9px; font-size:calc(var(--ts-fs, 12.5px) * 1.04); box-sizing:border-box; }
/* 弹窗里的表单控件一律撑满整行（否则 textarea 会退回 cols 默认宽度，
   比同行的 input 窄——用户反馈两者宽度不一致）。 */
.ts-modal-body .ts-input, .ts-modal-body .ts-select, .ts-modal-body .ts-textarea { width:100%; }
/* 多行文本框：允许纵向拖拽、继承字体、行高放松 */
.ts-textarea { min-height:74px; resize:vertical; font:inherit; font-size:calc(var(--ts-fs, 12.5px) * 1.04); line-height:1.55; }
.ts-input:focus, .ts-select:focus { outline:1px solid rgba(96,165,250,.7); }
.ts-tag { font-size:calc(var(--ts-fs, 12.5px) * 0.88); padding:2px 8px; border-radius:99px; background:rgba(96,165,250,.22); border:1px solid rgba(96,165,250,.45); }
.ts-tag-warn { background:rgba(251,191,36,.2); border-color:rgba(251,191,36,.5); }
.ts-hint { opacity:.6; font-size:calc(var(--ts-fs, 12.5px) * 0.96); text-align:center; padding:4px; }
.ts-hint-warn { opacity:1; color:#fbbf24; background:rgba(251,191,36,.12); border:1px solid rgba(251,191,36,.4); border-radius:8px; padding:6px 10px; }

/* —— 一轮异常结束的提示（工作台里「中断」必须一眼可辨）——
   宿主原生「对话」tab 有 turn-error / turn-max-tokens 节点；工作台的消息流
   以前把 turn/end 丢掉了，导致中止的一轮与正常结束外观一致（用户反馈）。
   这里用琥珀色警示块（fatal 时转红）把它摆到轮末，与普通消息明显区分。 */
.ts-turn-notice { display:flex; flex-direction:column; gap:4px; align-self:stretch; border:1px solid rgba(251,191,36,.5); background:rgba(251,191,36,.12); border-radius:8px; padding:6px 9px; }
.ts-turn-notice-fatal { border-color:rgba(248,113,113,.55); background:rgba(248,113,113,.13); }
.ts-turn-notice-head { display:flex; align-items:center; gap:6px; min-width:0; }
.ts-turn-notice-icon { flex:none; font-size:var(--ts-fs, 12.5px); }
.ts-turn-notice-label { flex:none; font-weight:600; font-size:var(--ts-fs, 12.5px); color:#fbbf24; }
.ts-turn-notice-fatal .ts-turn-notice-label { color:#f87171; }
.ts-turn-notice-code { flex:none; font-size:calc(var(--ts-fs, 12.5px) * 0.88); padding:1px 6px; border-radius:99px; background:rgba(127,127,127,.22); border:1px solid rgba(127,127,127,.4); opacity:.9; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
/* 展开按钮推到最右，与标题条三段式一致 */
.ts-turn-notice-head .ts-msg-toggle { margin-left:auto; }
.ts-turn-notice-preview { font-size:calc(var(--ts-fs, 12.5px) * 0.96); opacity:.85; word-break:break-word; }
.ts-turn-notice-body { font-size:var(--ts-fs, 12.5px); }

/* —— 会话选择条（工作台顶部第二行） —— */
.ts-bar-sessions { gap:8px; }
.ts-sess { position:relative; display:inline-flex; align-items:center; gap:8px; }
.ts-sess-btn { display:inline-flex; align-items:center; gap:8px; max-width:min(560px, 60vw); }
.ts-sess-btn.active { border-color:rgba(96,165,250,.7); background:rgba(96,165,250,.18); }
.ts-sess-cur { opacity:.7; font-size:calc(var(--ts-fs, 12.5px) * 0.96); max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ts-sess-caret { opacity:.6; font-size:calc(var(--ts-fs, 12.5px) * 0.88); }
/* 浮动面板宽度：**跟随内容**（主要是标题宽度）动态决定，而不是写死 520px；
   min/max 只兜底（太窄不好看、太宽超出视口）。 */
.ts-sess-pop { position:absolute; top:calc(100% + 6px); right:0; left:auto; z-index:44; width:max-content; min-width:240px; max-width:min(560px, calc(100vw - 32px)); max-height:60vh; display:flex; flex-direction:column; border-radius:12px; border:1px solid var(--ts-pop-line); background:var(--ts-pop-bg); color:var(--ts-pop-fg); box-shadow:var(--ts-pop-shadow); backdrop-filter:blur(12px) saturate(1.2); overflow:hidden; }
/* 表头：max-width 封顶 + 允许换行，否则它的长文案会把动态宽度撑开 */
.ts-sess-pop-head { flex:none; max-width:320px; padding:9px 12px; font-size:calc(var(--ts-fs, 12.5px) * 0.92); font-weight:600; opacity:.7; border-bottom:1px solid rgba(127,127,127,.25); letter-spacing:.03em; white-space:normal; }
.ts-sess-list { flex:1; min-height:0; overflow:auto; padding:5px; display:flex; flex-direction:column; gap:2px; }
/* 行：点任意处选会话（整行可点）；内部从左到右紧凑排列，右侧不留空白 */
.ts-sess-row { display:flex; flex-direction:column; }
.ts-sess-item { display:flex; align-items:center; gap:6px; width:100%; padding:7px 9px; border-radius:8px; color:inherit; font:inherit; font-size:var(--ts-fs, 12.5px); cursor:pointer; box-sizing:border-box; }
.ts-sess-item:hover { background:rgba(127,127,127,.18); }
.ts-sess-item.active { background:rgba(96,165,250,.24); box-shadow:inset 0 0 0 1px rgba(96,165,250,.5); }
.ts-sess-item:focus-visible { outline:2px solid rgba(96,165,250,.8); outline-offset:-2px; }
/* 右侧插槽：固定在行尾（margin-left:auto）。空闲时显示时间（右对齐），
   悬浮时换成两个按钮。
   **高度恒定 24px**（关键修复）：时间文字约 13px、按钮（13px + 上下 padding 5px）约 23px，
   若不锁高，鼠标扫过每一行都会在「文字 ↔ 按钮」互换时把该行撑高约 8~10px，
   下方所有行被逐行顶动——正是「鼠标上下移动时对话清单抖动」的根因。
   锁高后两种状态都居中容纳，行高恒为 7+24+7=38px，悬浮零回流。 */
.ts-sess-slot { flex:none; margin-left:auto; display:inline-flex; align-items:center; justify-content:flex-end; min-width:64px; height:24px; }
.ts-sess-time { font-size:calc(var(--ts-fs, 12.5px) * 0.84); opacity:.5; font-variant-numeric:tabular-nums; white-space:nowrap; }
/* 时间已右对齐、独立成列（不需要跟在标题后的分隔符） */
.ts-sess-rowops { display:none; align-items:center; gap:2px; }
.ts-sess-item:hover .ts-sess-rowops, .ts-sess-item-open .ts-sess-rowops { display:inline-flex; }
.ts-sess-item:hover .ts-sess-time, .ts-sess-item-open .ts-sess-time { display:none; }
.ts-sess-op { flex:none; border:0; background:transparent; color:inherit; cursor:pointer; font:inherit; font-size:calc(var(--ts-fs, 12.5px) * 1.04); line-height:1; padding:5px 6px; border-radius:6px; opacity:.6; }
.ts-sess-op:hover, .ts-sess-op.active { opacity:1; background:rgba(127,127,127,.25); }
.ts-sess-op:disabled { cursor:default; opacity:.3; }
/* 行内重命名：就地渲染在行下方 */
.ts-sess-rename { display:flex; align-items:center; gap:6px; margin:2px 6px 6px 24px; }
.ts-sess-rename-input { flex:1; min-width:0; padding:4px 8px; font-size:var(--ts-fs, 12.5px); }
/* 展开的菜单：就地渲染在行下方（在 pop 的滚动区内，不会被裁） */
.ts-sess-menu { display:flex; flex-direction:column; gap:2px; margin:2px 6px 6px 24px; padding:4px; border:1px solid rgba(127,127,127,.3); border-radius:8px; background:rgba(30,34,42,.92); }
.ts-sess-menu-item { text-align:left; border:0; background:transparent; color:inherit; font:inherit; font-size:calc(var(--ts-fs, 12.5px) * 0.96); padding:6px 8px; border-radius:6px; cursor:pointer; }
.ts-sess-menu-item:hover { background:rgba(127,127,127,.22); }
.ts-sess-menu-item:disabled { cursor:default; opacity:.5; }
/* 归档失败等短提示（自动消失） */
.ts-sess-notice { flex:none; max-width:260px; font-size:calc(var(--ts-fs, 12.5px) * 0.92); opacity:.8; color:#fca5a5; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* 标题：占满剩余空间（把右侧插槽顶到行尾），超长时省略号/跑马灯 */
.ts-sess-item-title { flex:1 1 auto; min-width:0; max-width:340px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* 跑马灯：悬浮且内容超宽时左右来回滚动；位移量由 JS 实测写进 --ts-marquee-shift */
.ts-marquee { display:inline-block; white-space:nowrap; }
.ts-sess-item:hover .ts-marquee-move { animation: tsSessMarquee 5s ease-in-out infinite alternate; }
@keyframes tsSessMarquee { from { transform:translateX(0); } to { transform:translateX(calc(-1 * var(--ts-marquee-shift, 0px))); } }
.ts-sess-tag { flex:none; font-size:calc(var(--ts-fs, 12.5px) * 0.8); padding:1px 6px; border-radius:99px; background:rgba(127,127,127,.25); }
.ts-sess-empty { padding:14px 12px; font-size:calc(var(--ts-fs, 12.5px) * 0.96); opacity:.65; line-height:1.6; }

/* —— 项目中心：流光玻璃背景 —— */
.ts-center { padding:0; gap:0; overflow:hidden; }
.ts-center-bg { position:absolute; inset:0; overflow:hidden; pointer-events:none; z-index:0; }
/* 网格已上提到共享容器（[data-conversation-scroll]），这里只留流动光晕，避免双重网格出现摩尔纹 */
.ts-center-blob { position:absolute; width:52vmax; height:52vmax; border-radius:50%; filter:blur(70px); opacity:.30; mix-blend-mode:screen; }
/* 漂移光晕也改成极淡的中性蓝（原来紫/青/粉三色太跳，跟工作台不一个调子） */
.ts-center-blob1 { background:radial-gradient(circle,rgba(96,165,250,.20),transparent 66%); top:-20%; left:-16%; animation:tsBlob1 17s ease-in-out infinite alternate; }
.ts-center-blob2 { background:radial-gradient(circle,rgba(96,165,250,.14),transparent 66%); bottom:-24%; left:22%; animation:tsBlob2 13s ease-in-out infinite alternate; }
.ts-center-blob3 { background:radial-gradient(circle,rgba(96,165,250,.10),transparent 66%); top:-8%; right:-18%; animation:tsBlob3 19s ease-in-out infinite alternate; }
@keyframes tsBlob1 { from{transform:translate(0,0) scale(1)} to{transform:translate(12vw,9vh) scale(1.12)} }
@keyframes tsBlob2 { from{transform:translate(0,0) scale(1)} to{transform:translate(-11vw,-8vh) scale(1.14)} }
@keyframes tsBlob3 { from{transform:translate(0,0) scale(1)} to{transform:translate(-9vw,10vh) scale(1.1)} }
.ts-center-inner { position:relative; z-index:1; flex:1; min-height:0; display:flex; flex-direction:column; gap:16px; padding:22px; overflow:auto; }
.ts-center-head { flex:none; display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
.ts-center-headtext { flex:1; min-width:0; display:flex; flex-direction:column; gap:4px; }
.ts-center-title { font-size:calc(var(--ts-fs, 12.5px) * 1.6); font-weight:700; line-height:28px; letter-spacing:.01em; }
.ts-center-sub { font-size:var(--ts-fs, 12.5px); opacity:.62; line-height:1.6; }
/* 头部不再放“添加项目”按钮（与网格末尾的新建卡重复，已删）*/

/* —— 项目中心：卡片网格（玻璃卡 + 圆锥渐变描边） —— */
/* 主题变量兜底：皮肤/主题变量由 DeskDock 的 DOCK_CSS 定义（:root + html[data-ts-theme]）。
   这里给项目中心页一个同名的兜底，保证即使工作台还没挂载也不会取到空值。 */
/* 只给「工作台还没挂载」时兜个底：真正的主题/皮肤分支由 DOCK_CSS 定
   （写 :root 权重最低，不会盖掉 html[data-ts-*] 那几条 —— 之前在这里重复了一份
   浅色覆盖，结果把「深色皮强制浅字」那条盖掉了，宿主浅色 + 深色皮时字又看不见）。 */
:root { --ts-fg: #e6e8eb; --ts-fg-dim: #9aa4b2; --ts-fg-mute: #6b7280; }
.ts-cr, .ts-center { color: var(--ts-fg); }

/* 项目中心的皮肤面板（挂在工具条里的「🎨 皮肤」上） */
.ts-skin-wrap { position:relative; }
.ts-skin-pop { position:absolute; right:0; top:calc(100% + 6px); z-index:40; width:min(92vw, 360px); max-height:60vh; overflow:auto;
  display:flex; flex-direction:column; gap:8px; padding:10px 12px; border-radius:12px;
  border:1px solid var(--ts-pop-line); background:var(--ts-pop-bg); color:var(--ts-pop-fg);
  box-shadow:0 14px 40px rgba(0,0,0,.5); backdrop-filter:blur(12px) saturate(1.2); }
.ts-skin-pop-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.ts-skin-pop-hint { font-size:calc(var(--ts-fs, 12.5px) * 0.84); color:#6b7280; }
.ts-skin-pop-grid { display:flex; flex-wrap:wrap; gap:6px; }
.ts-skin-pop .ts-skin-cell { flex:1 1 46%; min-width:88px; height:38px; border:1px solid rgba(127,127,127,.32); border-radius:7px; background:rgba(127,127,127,.08); color:var(--ts-fg, #e6e8eb); font:inherit; font-size:calc(var(--ts-fs, 12.5px) * 0.9); cursor:pointer; }
.ts-skin-pop .ts-skin-cell[data-on] { border-color:#4f8ef7; box-shadow:inset 0 0 0 1px rgba(79,142,247,.5); }
.ts-skin-pop .ts-skin-none { flex:1 1 100%; }
.ts-skin-pop .ts-skin-group { display:flex; flex-direction:column; gap:5px; }
.ts-skin-pop .ts-skin-glabel { font-size:calc(var(--ts-fs, 12.5px) * 0.8); color:#6b7280; letter-spacing:.04em; }
.ts-center-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(248px,1fr)); gap:16px; align-content:start; }
.ts-center-emptywrap { flex:1; display:flex; align-items:center; justify-content:center; padding:24px; }
.ts-center-card { position:relative; box-sizing:border-box; min-height:186px; display:flex; flex-direction:column; gap:10px; padding:18px; border:1px solid transparent; border-radius:16px; background:linear-gradient(135deg,rgba(255,255,255,.14) 0%,rgba(255,255,255,.05) 32%,rgba(255,255,255,.01) 62%,rgba(0,0,0,.06) 100%),rgba(127,127,127,.09); box-shadow:0 10px 26px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.10); backdrop-filter:blur(6px) saturate(1.15); transition:transform .14s ease, box-shadow .14s ease; }
.ts-center-card::after { content:""; position:absolute; inset:0; border-radius:inherit; padding:1px; background:conic-gradient(from 45deg,rgba(0,0,0,.28) 0deg,rgba(255,255,255,.5) 90deg,rgba(0,0,0,.28) 180deg,rgba(255,255,255,.5) 270deg,rgba(0,0,0,.28) 360deg); -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0); -webkit-mask-composite:xor; mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0); mask-composite:exclude; pointer-events:none; opacity:.45; }
.ts-center-card:hover { transform:translateY(-2px); box-shadow:0 16px 34px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.14); }
.ts-center-cardhead { display:flex; align-items:center; gap:11px; min-width:0; }
.ts-center-icon { flex:none; font-size:calc(var(--ts-fs, 12.5px) * 1.76); line-height:1; }
.ts-center-name { flex:1; min-width:0; font-size:calc(var(--ts-fs, 12.5px) * 1.28); font-weight:700; line-height:22px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ts-center-path { flex:none; display:flex; flex-direction:column; gap:1px; min-width:0; }
.ts-center-basedir { font-size:calc(var(--ts-fs, 12.5px) * 0.96); font-weight:600; opacity:.85; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ts-center-fullpath { font-size:calc(var(--ts-fs, 12.5px) * 0.84); opacity:.45; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:var(--dsh-font-mono, monospace); }
.ts-center-meta { flex:none; display:flex; gap:6px; flex-wrap:wrap; }
.ts-center-actions { display:flex; gap:8px; margin-top:auto; padding-top:6px; }
.ts-center-enter { flex:1; }
/* 卡片可点击：整卡进工作台（不再有「进入工作台」按钮） */
.ts-center-card-click { cursor:pointer; }
.ts-center-card-click:focus-visible { outline:2px solid rgba(96,165,250,.8); outline-offset:2px; }
.ts-center-card-click.disabled { cursor:not-allowed; opacity:.55; }
/* 卡片右上角“进入 →”提示：只在悬停时明显，不抢标题 */
.ts-center-enterhint { flex:none; font-size:calc(var(--ts-fs, 12.5px) * 0.92); opacity:0; transform:translateX(-3px); transition:opacity .14s ease, transform .14s ease; color:#60a5fa; white-space:nowrap; }
.ts-center-card-click:hover .ts-center-enterhint { opacity:1; transform:translateX(0); }
/* 项目介绍：两行截断，保持卡片等高 */
.ts-center-desc { flex:1 1 auto; min-height:0; font-size:calc(var(--ts-fs, 12.5px) * 0.96); line-height:1.55; opacity:.72; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; word-break:break-word; }
.ts-btn-sm { padding:3px 11px; font-size:calc(var(--ts-fs, 12.5px) * 0.96); }

/* —— 工具条：展示方式 / 排序方式 ——
   用户反馈：原来“挤在左边一点点”很难看，希望“一行控制”。
   所以做成**撑满一行的玻璃条**：左侧两组分段控件，右侧项目数；
   窄屏自动换行。 */
.ts-center-toolbar { flex:none; display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding:8px 12px; border:1px solid rgba(127,127,127,.26); border-radius:12px; background:linear-gradient(135deg,rgba(255,255,255,.07),rgba(255,255,255,.02)),rgba(127,127,127,.06); box-shadow:0 4px 14px rgba(0,0,0,.14); }
.ts-seg { display:inline-flex; align-items:center; gap:2px; padding:3px; border:1px solid rgba(127,127,127,.3); border-radius:10px; background:rgba(0,0,0,.14); }
.ts-seg-label { font-size:calc(var(--ts-fs, 12.5px) * 0.92); opacity:.55; padding:0 8px 0 9px; white-space:nowrap; }
.ts-seg-btn { border:none; background:transparent; color:inherit; font:inherit; font-size:var(--ts-fs, 12.5px); padding:5px 13px; border-radius:8px; cursor:pointer; opacity:.75; white-space:nowrap; transition:background .13s ease, opacity .13s ease, color .13s ease; }
.ts-seg-btn:hover { background:rgba(127,127,127,.22); opacity:1; }
.ts-seg-btn.active { background:linear-gradient(180deg,rgba(96,165,250,.38),rgba(96,165,250,.22)); opacity:1; font-weight:600; box-shadow:inset 0 0 0 1px rgba(96,165,250,.5), 0 2px 8px rgba(96,165,250,.18); }
.ts-center-count { margin-left:auto; font-size:calc(var(--ts-fs, 12.5px) * 0.96); opacity:.55; white-space:nowrap; padding-left:8px; }

/* —— 列表模式：表格（宽裕、不拥挤）—— */
.ts-plist-wrap { flex:1; min-height:0; overflow:auto; border:1px solid rgba(127,127,127,.26); border-radius:14px; background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.01)),rgba(127,127,127,.05); box-shadow:0 6px 20px rgba(0,0,0,.16); }
.ts-plist { width:100%; border-collapse:separate; border-spacing:0; font-size:calc(var(--ts-fs, 12.5px) * 1.04); }
.ts-plist th { position:sticky; top:0; z-index:1; text-align:left; font-weight:600; font-size:calc(var(--ts-fs, 12.5px) * 0.92); letter-spacing:.04em; padding:12px 16px; background:var(--ts-pop-bg-solid); color:var(--ts-pop-fg); border-bottom:1px solid rgba(127,127,127,.32); backdrop-filter:blur(10px); white-space:nowrap; }
.ts-plist td { padding:12px 16px; border-bottom:1px solid rgba(127,127,127,.14); vertical-align:middle; text-align:left; }
.ts-plist tbody tr { transition:background .12s ease; }
.ts-plist tbody tr:hover { background:rgba(127,127,127,.11); }
.ts-plist tbody tr:last-child td { border-bottom:none; }
.ts-plist-idx { width:64px; text-align:left; opacity:.45; font-variant-numeric:tabular-nums; }
.ts-plist-time { width:150px; white-space:nowrap; opacity:.82; font-variant-numeric:tabular-nums; }
.ts-plist-ops { width:150px; white-space:nowrap; text-align:left; }
.ts-plist-ops .ts-btn + .ts-btn { margin-left:8px; }
.ts-plist-name { font-weight:600; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ts-plist-path { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:.55; font-family:var(--dsh-font-mono, monospace); font-size:calc(var(--ts-fs, 12.5px) * 0.92); }
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
.ts-desc-input { width:100%; font-size:var(--ts-fs, 12.5px); padding:4px 6px; }
/* 活跃序号点：绿=活跃，黄=待用户确认；点一下直达那条对话的工作台 */
.ts-dots { display:inline-flex; align-items:center; gap:2px; flex:none; }
.ts-dot { border:0; background:0 0; cursor:pointer; font-size:calc(var(--ts-fs, 12.5px) * 1.12); line-height:1; padding:0 1px; font-family:inherit; }
.ts-dot:hover { transform:scale(1.15); }
.ts-dot:focus-visible { outline:2px solid rgba(96,165,250,.8); outline-offset:1px; border-radius:4px; }
.ts-dot-active { color:#4ade80; }
/* 卡片标题行里序号点靠右（名字之后、进入提示之前） */
.ts-center-cardhead .ts-dots { margin-left:auto; }
.ts-dot-pending { color:#fbbf24; }

/* 已启动徒标（卡片上） */
.ts-tag-live { background:rgba(74,222,128,.22); border-color:rgba(74,222,128,.55); color:#86efac; }

/* 工作台顶部预览面板：在标题行之下、其它窗口之上；高度由预览条（可能被拖动）决定 */
.ts-preview-panel { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; gap:8px; }
.ts-preview-panel .ts-preview-bar > .ts-preview-url { flex:1 1 auto; }
/* iframe 填满卡片剩余高度（不再写死 vh；条高由拖动分隔条控制） */
.ts-preview-panel .ts-preview-frame { flex:1 1 0; min-height:0; }
/* 预览条本体：flex:none，高度由内联 style 的 previewH 控制 */
/* 预览条本体：flex:none，高度由内联 style 的 previewH 控制；
   自身必须是竖向 flex 容器，否则内部卡片会塔成 0 高（iframe 也跟着消失） */
.ts-preview-strip { flex:none; min-height:0; display:flex; flex-direction:column; }
/* 折叠（最小化）时只留标题条，iframe 不进布局 */
.ts-card-collapsed > * > .ts-preview-frame { display:none; }
/* —— 预览 ↔ 工作台 的上下分隔条 ——
   默认隐形，悬停/拖动时显示一条水平握柄（与宿主左右把手的视觉同款：
   2px 粗、约 72px 长、两端渐隐）。命中区 10px 高，用负外边距不占版面。 */
.ts-vsplit { position:relative; flex:none; height:10px; margin:-5px 0; cursor:ns-resize; z-index:6; }
.ts-vsplit-grip { position:absolute; left:50%; top:50%; width:72px; height:2px; border-radius:2px; transform:translate(-50%,-50%); background:var(--dsw-alias-scrollbar-bg-l1, rgba(127,127,127,.5)); opacity:0; transition:opacity .12s ease; pointer-events:none; }
.ts-vsplit:hover .ts-vsplit-grip, .ts-vsplit:active .ts-vsplit-grip { opacity:1; }
/* 拖动中指针会离开分隔条（甚至落在 iframe 上），握柄必须继续可见：
   否则拖到一半“把手消失”，观感上就像闪没了 */
body.ts-vsplit-dragging .ts-vsplit-grip { opacity:1; transition:none; }
/* —— 拖动中（body.ts-vsplit-dragging）——
   1) iframe 屏蔽指针事件：否则拖得快时指针会滑进 iframe，命中区丢事件、
      拖拽一跳一跳（跨源 iframe 还会抢焦点）；
   2) 禁选中 + 全程 ns-resize 光标：避免拖过文字时选出一片高亮（也是观感上的“闪”）。 */
body.ts-vsplit-dragging { cursor:ns-resize; user-select:none; -webkit-user-select:none; }
body.ts-vsplit-dragging iframe,
body.ts-vsplit-dragging .ts-preview-frame { pointer-events:none !important; }
/* 拖动期间不做任何过渡动画：握着拖时过渡会和指针竞争，看起来就是拖不动/抽动 */
body.ts-vsplit-dragging .ts-preview-strip,
body.ts-vsplit-dragging .ts-preview-frame,
body.ts-vsplit-dragging .ts-card { transition:none !important; animation:none !important; }
/* 工作台未选项目 / 项目中心空态 */
.ts-center-empty { display:flex; flex-direction:column; align-items:center; gap:12px; text-align:center; padding:28px 20px; max-width:560px; }
.ts-center-empty-title { font-size:calc(var(--ts-fs, 12.5px) * 1.6); font-weight:700; }
.ts-center-empty-sub { opacity:.78; font-size:calc(var(--ts-fs, 12.5px) * 1.04); line-height:1.65; }

/* —— 确认弹窗 —— */
.ts-confirm { max-width:520px; }
.ts-confirm-danger .ts-modal-head { color:#fca5a5; }
.ts-confirm-msg { font-size:calc(var(--ts-fs, 12.5px) * 1.04); line-height:1.7; }
.ts-confirm-lead { margin-bottom:10px; }
.ts-confirm-target { display:flex; flex-direction:column; gap:3px; padding:10px 12px; margin-bottom:10px; border-radius:10px; border:1px solid rgba(127,127,127,.3); background:rgba(0,0,0,.16); }
.ts-confirm-name { font-weight:600; }
.ts-confirm-path { font-size:calc(var(--ts-fs, 12.5px) * 0.92); opacity:.6; word-break:break-all; font-family:var(--dsh-font-mono, monospace); }
.ts-confirm-note { font-size:calc(var(--ts-fs, 12.5px) * 0.96); opacity:.7; line-height:1.65; }
.ts-btn-danger-solid { background:rgba(248,113,113,.9); border-color:rgba(248,113,113,1); color:#fff; font-weight:600; }
.ts-btn-danger-solid:hover { background:rgba(248,113,113,1); box-shadow:0 0 14px rgba(248,113,113,.4); }
/* 新建卡：虚线玻璃底 + 居中加号 */
.ts-center-addcard { justify-content:center; align-items:center; gap:8px; cursor:pointer; color:inherit; font:inherit; background:radial-gradient(circle at 50% 42%,rgba(255,255,255,.08),rgba(255,255,255,0) 65%),rgba(127,127,127,.06); border:1.5px dashed rgba(127,127,127,.5); box-shadow:none; }
.ts-center-addcard::after { display:none; }
.ts-center-addcard:hover { border-color:rgba(96,165,250,.75); background:rgba(127,127,127,.12); }
.ts-center-addplus { font-size:calc(var(--ts-fs, 12.5px) * 2.56); line-height:1; opacity:.6; }
.ts-center-addcard:hover .ts-center-addplus { opacity:1; color:#60a5fa; }
.ts-center-addlabel { font-size:calc(var(--ts-fs, 12.5px) * 1.2); font-weight:600; opacity:.75; }
.ts-center-addhint { font-size:calc(var(--ts-fs, 12.5px) * 0.92); opacity:.5; }
.ts-center-emptywrap .ts-center-addcard { width:min(320px,80%); min-height:200px; display:flex; flex-direction:column; }

/* —— 弹层 —— */
.ts-modal-mask { position:fixed; inset:0; background:var(--ts-pop-mask, rgba(0,0,0,.45)); display:flex; align-items:center; justify-content:center; z-index:45; }
/* 弹窗（添加项目 / 确认框）：同弹层调色板（浅色主题下不再是深卡片） */
.ts-modal { background:var(--ts-pop-bg); color:var(--ts-pop-fg); border:1px solid var(--ts-pop-line); border-radius:12px; width:min(680px,92%); max-height:88%; display:flex; flex-direction:column; box-shadow:var(--ts-pop-shadow); }
.ts-modal-head { padding:14px 18px; font-size:calc(var(--ts-fs, 12.5px) * 1.2); font-weight:600; border-bottom:1px solid rgba(127,127,127,.25); display:flex; justify-content:space-between; align-items:center; }
.ts-modal-body { padding:14px 18px; overflow:auto; display:flex; flex-direction:column; gap:14px; }
.ts-modal-foot { padding:12px 18px; border-top:1px solid rgba(127,127,127,.25); display:flex; justify-content:flex-end; gap:10px; }
.ts-field-label { font-size:calc(var(--ts-fs, 12.5px) * 1.04); font-weight:600; margin-bottom:6px; display:block; }
/* 「添加项目」弹窗：固定尺寸（切换目录 / 点「上级」时面板不缩放、位置不动），
   内容超出走内部滚动，内容少也撑住这么大。 */
.ts-modal-addproj { width:min(680px,92%); height:min(680px,90vh); max-height:90vh; }
.ts-modal-addproj .ts-modal-body { flex:1 1 auto; min-height:0; overflow:auto; }

/* —— 目录浏览器 —— */
.ts-fs { border:1px solid rgba(127,127,127,.3); border-radius:8px; overflow:hidden; }
.ts-fs-crumb { display:flex; align-items:center; gap:6px; padding:7px 10px; background:rgba(127,127,127,.1); font-size:calc(var(--ts-fs, 12.5px) * 0.96); flex-wrap:nowrap; font-family:var(--dsh-font-mono, monospace); }
/* 面包屑本体：单行不换行（换行会让目录栏高度随路径长短变化、连带面板跳动），过长横向滚动 */
.ts-fs-crumbs { display:flex; align-items:center; gap:6px; flex:1 1 auto; min-width:0; overflow-x:auto; white-space:nowrap; }
.ts-fs-rooticon { opacity:.6; cursor:pointer; }
.ts-fs-sep { opacity:.4; cursor:default; }
/* 多盘符时的根切换芯片（Windows） */
.ts-fs-drive { padding:1px 7px; border-radius:99px; border:1px solid rgba(127,127,127,.35); opacity:.75; cursor:pointer; }
.ts-fs-drive:hover { opacity:1; }
.ts-fs-drive-on { opacity:1; border-color:rgba(96,165,250,.7); background:rgba(96,165,250,.16); }
.ts-fs-crumb span { cursor:pointer; opacity:.8; }
.ts-fs-crumb span:hover { opacity:1; text-decoration:underline; }
/* 固定高度：目录内容多少都一个高度（少内容也不塔），多出的在框内滚动 */
.ts-fs-list { height:260px; overflow:auto; }
.ts-fs-item { display:flex; align-items:center; gap:8px; padding:6px 12px; cursor:pointer; border:none; background:transparent; color:inherit; width:100%; text-align:left; font-size:calc(var(--ts-fs, 12.5px) * 1.04); }
.ts-fs-item:hover { background:rgba(127,127,127,.15); }
.ts-fs-item .ts-tag { margin-left:auto; }
/* 「添加项目」里的新建 / 重命名文件夹行（目录浏览器下方） */
.ts-newfolder { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:8px; }
.ts-newfolder-input { max-width:240px; padding:4px 8px; font-size:var(--ts-fs, 12.5px); }
.ts-newfolder-hint { font-size:calc(var(--ts-fs, 12.5px) * 0.88); opacity:.55; max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ts-newfolder-err { font-size:calc(var(--ts-fs, 12.5px) * 0.92); color:#fca5a5; }
/* —— H 型工作台：左 / 中 / 右三列（固定 1.5 : 7 : 1.5），无中横线 —— */
/* 轨道一律用 minmax(0, …fr)：裸 fr 的自动最小值是 min-content，一旦卡片里有长不可断
   内容（工具输出、长代码、长标题），列就会被撑到内容宽度，整个网格超出容器；
   而 .ts-cr 是 overflow:hidden，右侧列连同部分中列就被**裁掉**（“右边少了 40%”）。
   列轨道由 HDesk 按「哪几列还有可见窗口」注入（缺失补位，见 DESK_COLUMNS）：
   下面这套是三列俱全时的默认值，同时兜住「JS 还没接管」的那一帧。 */
/* 网格项自身也要 min-width:0，否则仍会被内容顶宽（min-width:auto 的默认行为） */
/* 三列（左 / 中 / 右）共用同一套列容器：竖向 flex，列内卡片的占位由它承担 */
/* 整列一个可见窗口都不剩（全被关掉/铺满浮层占走）→ 该列移出网格，份额按列模板
   并给邻列。用 display:none 而不是「不渲染」：列内组件的实例与订阅原样保留，
   恢复任一窗口即当场回来（不丢滚动位置/展开态）。 */
/* 中列：上（共享黑板）/ 分隔条 / 下（DSH 主对话）共用列高，两格靠 flex-grow 按比例
   分——所以「关掉或收起其中一格，另一格自动铺满整列」与「拖分隔条换高」是同一套
   机制（见 HDesk 的 onMidSplitDown），不需要各写一条补位分支。 */
/* 中下格自带 border/padding：宿主原生输入条按这个内缩量停靠进卡片边框内部 */
/* 中列某一格收起（最小化）时它只占标题条高度，剩下的空间全给另一格 */

/* —— 中列「共享黑板 ↔ DSH 主对话」的上下分隔条 ——
   与预览条那条 .ts-vsplit 同源：默认隐形，悬停/拖动时显示握柄；
   命中区 10px 高，用负外边距吃掉自身占位（不压缩两格的高度，
   即两格之间的 16px 缝里 [上格底 → 分隔条盒 → 下格顶] 正好居中）。 */
/* 握柄是**水平**的横条（72×2）：这条分隔条调的是上下高度，光标/提示都必须是横向语义；
   写成竖向 2×36 会让人以为是左右拖。与 .ts-vsplit-grip 的度量保持完全一致。 */
/* 拖动中指针会离开分隔条（甚至落在 iframe 上），握柄必须继续可见 */
/* 拖动中：禁选中 + 全程 ns-resize 光标；iframe 屏蔽指针事件（否则拖快了命中区丢事件） */

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
/* 该列没有探索者窗口时：两张卡铺满整列可用高度（不再固定 40% 留空档） */
.ts-card-talk-solo, .ts-card-save-solo { flex:1 1 0; }
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
.ts-head-mid { flex:0 1 auto; min-width:0; margin:0 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:calc(var(--ts-fs, 12.5px) * 0.84); font-weight:400; opacity:.62; text-align:center; }
/* 黑板标题条里有 tabs：让 tabs 吃掉弹性空隙，三键就落最右 */
/* 黑板标题条里有 tabs：tabs 吃掉弹性空隙，三键仍在最右（order:9） */
.ts-board-head .ts-board-tabs { margin-left:auto; margin-right:auto; flex-wrap:nowrap; overflow-x:auto; min-width:0; }
.ts-board-head .ts-card-actions { margin-left:8px; }
/* 标题条一律不换行（#4）：计数移入正文 .ts-card-count */
.ts-talk-head, .ts-save-head, .ts-board-head, .ts-mainchat-head { flex-wrap:nowrap; }
.ts-talk-head > span:first-child, .ts-save-head > span:first-child, .ts-board-head > span:first-child, .ts-mainchat-head > span:first-child { flex:none; white-space:nowrap; }
.ts-card-count { flex:none; font-size:calc(var(--ts-fs, 12.5px) * 0.84); opacity:.55; padding:0 2px 4px; }
/* 计数现在位于标题条中间（.ts-head-mid）：去掉旧正文态的底部内边距，避免标题条被撑高 */
.ts-head-mid.ts-card-count { padding:0; opacity:.62; flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ts-card-overlay { position:absolute; inset:0; z-index:40; background:rgba(12,14,18,.92); backdrop-filter:blur(8px) saturate(1.2); border-radius:10px; display:flex; flex-direction:column; padding:10px; box-sizing:border-box; }
.ts-card-overlay-inner { flex:1; min-height:0; display:flex; flex-direction:column; }
/* 已关闭列表（标题行内）：卡片与探索者窗口的恢复 chip 统一收口 */
.ts-closed-label { flex:none; white-space:nowrap; font-size:calc(var(--ts-fs, 12.5px) * 0.92); opacity:.6; }

/* —— 主对话卡（中下） —— */
/* 中下卡片的外框由 .ts-desk-chat 提供（含 border/padding，供输入条内缩定位），
   所以这里保持无框；仅在铺满浮层里补一层边框。 */
.ts-mainchat { display:flex; flex-direction:column; min-height:0; flex:1; overflow:hidden; }
.ts-card-overlay-inner .ts-mainchat { border:1px solid rgba(127,127,127,.3); border-radius:9px; background:rgba(127,127,127,.07); }
/* 一体化：主对话标题行也**不要底色**（用户反馈「还是有背景色」），与黑板/协作两块一致：
   只留一条很淡的下边线分标题与内容。 */
.ts-mainchat-head { flex:none; display:flex; align-items:center; gap:8px; padding:6px 8px; border-bottom:1px solid rgba(127,127,127,.16); font-size:var(--ts-fs, 12.5px); font-weight:600; }
/* 底部留出宿主输入条的位置（输入条 fixed 停靠在卡片底部） */
/* #4 输入条 fixed 停在卡片底部，会盖住消息末尾几行：
   底部留白 = 输入条实测高度（--ts-composer-h，由 HDesk 停靠时写入）+ 余量。
   以前写死 72px，输入条多行/换行时就不够，末尾几行被遮住。 */
.ts-mainchat .ts-chat-msgs { padding-bottom:calc(var(--ts-composer-h, 72px) + 14px); }
/* 主对话消息宽度：**跟自己的面板宽度自适应**，不再吃宿主那套全局宽度。
   历史：原先跟 --ts-chat-content-w（由输入条停靠逻辑写，取自宿主的
   --dsh-chat-user-width，带 680px 下限）并居中——面板变窄时它仍按 680px 算，
   内容右侧就被截掉（用户反馈）。
   现在只受本面板约束：宽度铺满，用 border-box 把 padding 算进宽度内。
   没有 border-box 时会溢出：width 铺满 + 左右 padding 10px 就比面板宽 20px
   （实测 clientWidth 632 > 面板 612，右侧内容被裁）。 */
.ts-mainchat .ts-chat-msgs { box-sizing:border-box; width:100%; max-width:100%; margin-inline:0; }
/* 消息统计：三段式 [标题][统计][三键]。用 grid 的 1fr/auto/1fr 让中间那段
   在**整条标题条**里真正居中（之前用 flex + margin:auto，是在“标题与三键之间”的
   剩余空间里居中，三键比标题宽时就会偏左——用户反馈的“不居中”就是这个）。 */
.ts-mainchat-head { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; }
.ts-mainchat-head > * { min-width:0; }
.ts-mainchat-head > .ts-head-title { justify-self:start; }
.ts-mainchat-head > .ts-head-mid { justify-self:center; margin:0; }
.ts-mainchat-head > .ts-card-actions { justify-self:end; margin-left:0; order:0; }
/* 中间段 = 计数 + 视图开关（同格内两件）。窄卡片下允许横向滚动而不是把三键挤出去：
   网格给它的上限就是 auto 列，overflow-x:auto 让 chip 可滑，不参与换行。 */
.ts-mainchat-mid { font-size:calc(var(--ts-fs, 12.5px) * 0.84); font-weight:400; opacity:.6; display:inline-flex; align-items:center; gap:7px; max-width:100%; overflow-x:auto; overflow-y:hidden; text-overflow:clip; white-space:nowrap; scrollbar-width:none; }
.ts-mainchat-mid::-webkit-scrollbar { height:0; }
.ts-msgstat { display:inline-flex; align-items:baseline; gap:3px; font-variant-numeric:tabular-nums; flex:none; }
.ts-msgstat-k { font-size:calc(var(--ts-fs, 12.5px) * 0.76); font-weight:400; opacity:.78; letter-spacing:.02em; }
/* —— 视图开关（全部 / 我的 / 回复）——
   与统计同一格：统计是「有多少」，开关是「看哪一档」。分段控件形态（共一个底槽、
   当前档亮起），比三个独立按钮更能读出「互斥三选一」。 */
.ts-view-tabs { flex:none; display:inline-flex; align-items:center; gap:1px; padding:1px; border-radius:7px; background:rgba(127,127,127,.16); border:1px solid rgba(127,127,127,.22); }
.ts-view-tab { cursor:pointer; border:0; background:transparent; color:inherit; font:inherit; font-size:calc(var(--ts-fs, 12.5px) * 0.84); line-height:1.5; padding:1px 7px; border-radius:5px; opacity:.6; white-space:nowrap; transition:background .15s ease, opacity .15s ease, color .15s ease; }
.ts-view-tab:hover { opacity:.9; background:rgba(127,127,127,.2); }
.ts-view-tab.is-on { opacity:1; font-weight:600; background:rgba(96,165,250,.28); box-shadow:0 0 0 1px rgba(96,165,250,.45) inset; }
.ts-view-tab.is-on:hover { background:rgba(96,165,250,.38); }
.ts-view-tab:focus-visible { outline:2px solid rgba(96,165,250,.85); outline-offset:1px; }
/* 探索者窗口标题条中间信息 */
.ts-win-mid { flex:0 1 auto; margin:0 auto; }

/* —— 探索者窗口卡 —— */
/* 一体化：探索者窗口不再画圆角边框与底色（用户反馈「整个窗口使用的圆角边框」要调整） */
.ts-win { border:0; border-radius:0; background:transparent; display:flex; flex-direction:column; min-height:70px; flex:1; overflow:hidden; position:relative; }
.ts-win-head { display:flex; align-items:center; gap:6px; padding:6px 8px; border-bottom:1px solid rgba(127,127,127,.16); cursor:default; user-select:none; flex-wrap:nowrap; overflow:hidden; }
.ts-win-head:hover { background:rgba(127,127,127,.08); }
/* 按钮组永不压缩：否则窄列里按钮会被压到换行、标题条变高溢出 */
.ts-win-head > span:last-child { flex:none; display:inline-flex; align-items:center; gap:1px; }
.ts-win-name { font-size:var(--ts-fs, 12.5px); font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:0 1 auto; min-width:0; }
.ts-win-dot { width:8px; height:8px; border-radius:50%; background:#52c41a; flex:none; }
.ts-win-dot.idle { background:rgba(127,127,127,.7); }
.ts-win-body { flex:1; min-height:0; overflow:auto; padding:8px; display:flex; flex-direction:column; gap:6px; font-size:calc(var(--ts-fs, 12.5px) * 0.96); line-height:1.55; }
.ts-win.collapsed { flex:none; }
.ts-win.collapsed .ts-win-body { display:none; }
/* 最大化：补不透明底（原仅 shadow，父级 .ts-win 底色 9% 透度，全屏后看不清） */
.ts-win-overlay { position:absolute; inset:0; z-index:40; flex:none; background:var(--ts-pop-bg-solid); color:var(--ts-pop-fg); border:1px solid var(--ts-pop-line); box-shadow:var(--ts-pop-shadow); backdrop-filter:blur(8px) saturate(1.1); }
.ts-win-overlay .ts-win-head { background:rgba(255,255,255,.07); }
.ts-win-overlay .ts-win-head:hover { background:rgba(255,255,255,.13); }
.ts-msg-user { align-self:flex-end; background:rgba(96,165,250,.22); border:1px solid rgba(96,165,250,.4); border-radius:8px 8px 2px 8px; padding:5px 9px; max-width:88%; white-space:pre-wrap; word-break:break-word; }
/* 回复区块：右边缘与用户气泡的右边缘对齐（用户气泡靠右、右边缘贴容器右端，
   因此回复块改为拉伸满宽，不再留右侧那一小块空白） */
.ts-msg-assistant { align-self:stretch; background:rgba(127,127,127,.14); border-radius:8px 8px 8px 2px; padding:5px 9px; max-width:none; white-space:pre-wrap; word-break:break-word; }
.ts-msg-tool, .ts-msg-system { align-self:stretch; opacity:.62; font-size:calc(var(--ts-fs, 12.5px) * 0.88); border-left:2px solid rgba(127,127,127,.5); padding:2px 8px; }
/* —— 每条消息的发出时间（用户气泡 / 助手回答 / 过程项 / 注入项）——
   块容器：气泡与时间的 column flex；user 块整体右对齐、assistant 块拉伸满宽。 */
.ts-msg-block { display:flex; flex-direction:column; gap:3px; min-width:0; }
.ts-msg-block-user { align-self:flex-end; align-items:flex-end; }
.ts-msg-block-assistant { align-self:stretch; }
.ts-msg-time { font-size:calc(var(--ts-fs, 12.5px) * 0.84); opacity:.5; font-variant-numeric:tabular-nums; white-space:nowrap; color:inherit; line-height:1.4; }
.ts-msg-block-user .ts-msg-time { text-align:right; }
.ts-proc-time { margin-left:auto; font-size:calc(var(--ts-fs, 12.5px) * 0.8); opacity:.5; font-variant-numeric:tabular-nums; white-space:nowrap; flex:none; }
.ts-msg-tool .ts-msg-role, .ts-msg-system .ts-msg-role { display:flex; align-items:center; gap:4px; }
.ts-msg-toggle { padding:0 4px; font-size:calc(var(--ts-fs, 12.5px) * 0.88); opacity:.7; }
.ts-msg-preview { opacity:.85; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ts-msg-full { white-space:pre-wrap; word-break:break-word; max-height:220px; overflow:auto; margin-top:2px; }
.ts-msg-role { font-size:calc(var(--ts-fs, 12.5px) * 0.8); opacity:.6; margin-bottom:2px; }

/* —— #5 按「轮」呈现（对齐宿主「对话」）：过程默认折叠，最终回答展开 —— */
.ts-turn { display:flex; flex-direction:column; gap:6px; }
.ts-turn + .ts-turn { margin-top:10px; padding-top:9px; border-top:1px dashed rgba(127,127,127,.22); }
/* 过程折叠条：一行，不抢眼 */
.ts-proc { align-self:stretch; }
/* 窄列不换行：子项 nowrap + 省略号截断（文字换行发生在 flex 子项内部，不是 flex 层） */
.ts-proc-head { display:flex; align-items:center; gap:7px; width:100%; text-align:left; font:inherit; font-size:calc(var(--ts-fs, 12.5px) * 0.88); opacity:.66; padding:3px 8px; border:0; border-left:2px solid rgba(127,127,127,.45); background:rgba(127,127,127,.07); color:inherit; cursor:pointer; border-radius:0 6px 6px 0; flex-wrap:nowrap; overflow:hidden; white-space:nowrap; }
.ts-proc-head > span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* 「过程 N 步」优先保留，先缩「思考/工具」两段（用户：不想看到换行，允许省略） */
.ts-proc-head .ts-proc-lead { flex:none; }
.ts-proc-head .ts-dim { flex:0 1 auto; }
.ts-proc-head .ts-proc-caret { flex:none; width:10px; }
.ts-proc-head:hover { opacity:.9; background:rgba(127,127,127,.14); }
.ts-dim { opacity:.6; }
.ts-proc-body { display:flex; flex-direction:column; gap:5px; margin-top:5px; padding-left:8px; }
.ts-proc-item { border-left:2px solid rgba(127,127,127,.3); padding:2px 8px; font-size:calc(var(--ts-fs, 12.5px) * 0.88); opacity:.75; }
.ts-proc-item-head { display:flex; align-items:center; gap:6px; }
.ts-proc-role { flex:none; font-size:calc(var(--ts-fs, 12.5px) * 0.8); opacity:.7; }
.ts-proc-item .ts-msg-preview { flex:1; min-width:0; }
.ts-proc-item .ts-msg-full { max-height:180px; overflow:auto; }
/* 最终回答：按正常对话正文展开（Markdown 渲染，根节点是 .ts-rich） */
.ts-msg-assistant .ts-rich, .ts-msg-assistant .ts-rich-plain { white-space:normal; }
/* 过程展开后的富文本：字号更小、紧凑，但同样完整渲染（不出现原始标记） */
.ts-msg-full .ts-rich { font-size:calc(var(--ts-fs, 12.5px) * 0.92); gap:4px; }
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
/* “回到最新”：粘性跟随被用户滚离底部后出现（不自动抢滚动）。
   常驻 DOM（由 [data-visible] 控制可见性），不因 pinned 翻转而增删。
   它带 margin-top:-28px，如果跟着 pinned 反复挂/卸，会反复改变滚动内容高度，
   而高度又反过来影响「是否在底部」的判定——自激成底部附近的微抖 / 重影。
   用 visibility 而非 display：仍占位，scrollHeight 恒定。 */
/* 注：此处**不能用** backdrop-filter。
   它是个 sticky 元素且位于滚动容器**内部**：滚动时浏览器每帧都要为它重新
   模糊身后的内容，在 WebKit 上会留下未及时清除的旧帧——同样表现为「重影」。 */
.ts-jump-latest { position:sticky; bottom:6px; align-self:center; margin-top:-28px; z-index:2; padding:4px 12px; border-radius:99px; border:1px solid rgba(96,165,250,.6); background:var(--ts-pop-bg); color:var(--ts-pop-fg); font:inherit; font-size:calc(var(--ts-fs, 12.5px) * 0.92); cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.4); visibility:hidden; }
.ts-jump-latest[data-visible] { visibility:visible; }
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

/* —— 黑板 —— */
/* 三块面板卡一律**透明无边框**（用户要求一体化：不要背景填充与明显分界），
   只保留一条很淡的表头下边线区分标题与内容。 */
.ts-board { display:flex; flex-direction:column; min-height:0; flex:1; overflow:hidden; }
.ts-board-head { flex:none; display:flex; align-items:center; gap:8px; padding:6px 8px; border-bottom:1px solid rgba(127,127,127,.16); font-size:calc(var(--ts-fs, 12.5px) * 1.04); font-weight:600; }
.ts-board-tabs { display:flex; gap:5px; margin-left:auto; flex-wrap:wrap; }
.ts-board-tab { font-size:calc(var(--ts-fs, 12.5px) * 0.88); padding:2px 9px; border-radius:99px; border:1px solid rgba(127,127,127,.4); background:transparent; color:inherit; cursor:pointer; }
.ts-board-tab.active { background:rgba(96,165,250,.3); border-color:rgba(96,165,250,.65); }
.ts-board-list { flex:1; min-height:0; overflow:auto; padding:8px; display:flex; flex-direction:column; gap:7px; }
.ts-entry { border:1px solid rgba(127,127,127,.28); border-radius:7px; padding:7px 9px; cursor:pointer; background:rgba(255,255,255,.03); }
.ts-entry:hover { border-color:rgba(96,165,250,.55); }
.ts-entry-head { display:flex; gap:8px; align-items:center; }
.ts-entry-title { font-size:var(--ts-fs, 12.5px); font-weight:600; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ts-entry-time { font-size:calc(var(--ts-fs, 12.5px) * 0.84); opacity:.55; flex:none; }
.ts-entry-body { font-size:calc(var(--ts-fs, 12.5px) * 0.96); opacity:.85; margin-top:6px; white-space:pre-wrap; word-break:break-word; max-height:180px; overflow:auto; }
.ts-entry.dim { opacity:.55; }
.ts-topic-req { background:rgba(96,165,250,.25); border-color:rgba(96,165,250,.5); }
.ts-topic-pit { background:rgba(248,113,113,.22); border-color:rgba(248,113,113,.5); }
.ts-topic-sol { background:rgba(74,222,128,.2); border-color:rgba(74,222,128,.5); }
.ts-topic-brief { background:rgba(192,132,252,.22); border-color:rgba(192,132,252,.5); }

/* —— 消息流列表（探索者窗口 / 主对话 / 简报共用） —— */
/* overflow-anchor:none —— 关键。
   本容器里的 scrollTop 由我们自己的贴底循环（forceBottom）主动写入；
   而浏览器的滚动锚定（scroll anchoring）也会在内容长高时自行修正 scrollTop。
   两个写者来回拉扯 → 底部附近高频微抖，视觉上就是「重影」。
   宿主的对话 scrollport 在跟随尾部时也是这么关的
   （.EvIC1a_root[data-chat-following-tail] .EvIC1a_scroll{overflow-anchor:none}）。 */
/* 消息与面板边线的左右间距（用户两次反馈「和边框之间太挤」）：10 → 18 → 22px。
   同时限制**阅读宽度**：正文最宽 920px、超出部分两侧平分留白（居中）——
   面板很宽时（例如只看一个 DSH 主对话）不会把每行拉太长（用户反馈「宽度太长阅读疲劳」）。
   为什么不给消息加 max-width：那会带着 margin:auto 把「我发的」气泡从右对齐变成居中。 */
.ts-chat-msgs { flex:1; min-height:0; overflow:auto; overflow-anchor:none; padding:16px max(22px, calc((100% - var(--ts-chat-w, 920px)) / 2)); display:flex; flex-direction:column; gap:7px; }
/* 正文宽度把手（同宿主 [data-width-handle] 的手感：贴边细条、悬停高亮、左右对称收放）。
   位置跟着正文列的两条边：left/right = 那半边留白的一半。 */
/* 宽度把手：命中区 9px，但**只画一条 2px 细线**（不要整块色块）；
   平时完全透明，鼠标进面板才隐约出现，按上去才亮成主题蓝。 */
.ts-chat-w { position:absolute; top:34px; bottom:0; width:9px; cursor:col-resize; z-index:3; }
.ts-chat-w::after {
  content:''; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
  width:2px; height:34px; border-radius:2px; background:transparent;
  transition:background .12s, height .12s;
}
.ts-chat-w--left { left:calc(max(22px, calc((100% - var(--ts-chat-w, 920px)) / 2)) - 5px); }
.ts-chat-w--right { right:calc(max(22px, calc((100% - var(--ts-chat-w, 920px)) / 2)) - 5px); }
/* 与侧栏把手同一套语言：细短杠、悬停才显形、按住略加长；**不用蓝色色块**
   （用户反馈「出现的蓝色条块太丑了」）。 */
.ts-mainchat:hover .ts-chat-w::after { background:var(--ts-line); }
.ts-chat-w:hover::after { background:var(--ts-fg-mute); height:52px; }
.ts-chat-w:active::after { background:var(--ts-fg-dim); height:64px; }

/* —— 左栏：协作对话时间轴 —— */
.ts-talk { display:flex; flex-direction:column; min-height:104px; overflow:hidden; }
.ts-talk-head { display:flex; align-items:center; gap:8px; padding:6px 8px; border-bottom:1px solid rgba(127,127,127,.16); font-size:var(--ts-fs, 12.5px); font-weight:600; flex:none; }
.ts-talk-sub { margin-left:auto; font-size:calc(var(--ts-fs, 12.5px) * 0.84); font-weight:400; opacity:.6; }
.ts-talk-list { flex:1; min-height:0; overflow:auto; padding:7px; display:flex; flex-direction:column; gap:6px; }
.ts-talk-line { display:flex; gap:6px; align-items:flex-start; font-size:calc(var(--ts-fs, 12.5px) * 0.92); line-height:1.5; }
.ts-talk-glyph { flex:none; font-size:calc(var(--ts-fs, 12.5px) * 0.96); line-height:1.4; }
.ts-talk-body { min-width:0; flex:1; border-radius:7px; padding:4px 8px; background:rgba(127,127,127,.12); }
.ts-talk-line.main .ts-talk-body { background:rgba(96,165,250,.16); }
.ts-talk-line.tone-warn .ts-talk-body { background:rgba(248,113,113,.16); }
.ts-talk-line.tone-done .ts-talk-body { background:rgba(74,222,128,.16); }
.ts-talk-meta { display:flex; gap:6px; align-items:baseline; margin-bottom:1px; }
.ts-talk-who { font-weight:600; font-size:calc(var(--ts-fs, 12.5px) * 0.88); }
.ts-talk-time { font-size:calc(var(--ts-fs, 12.5px) * 0.8); opacity:.5; margin-left:auto; font-family:var(--dsh-font-mono, monospace); }
.ts-talk-text { word-break:break-word; white-space:pre-wrap; }

/* —— 右栏：协作收益报告（优势/劣势两卡铺满整卡，底部不留白） —— */
.ts-save { display:flex; flex-direction:column; min-height:104px; overflow:hidden; }
.ts-save-head { display:flex; align-items:center; gap:8px; padding:6px 8px; border-bottom:1px solid rgba(127,127,127,.16); font-size:var(--ts-fs, 12.5px); font-weight:600; flex:none; }
.ts-save-sub { margin-left:auto; font-size:calc(var(--ts-fs, 12.5px) * 0.84); font-weight:400; opacity:.6; }
.ts-save-body { flex:1; min-height:0; overflow:auto; padding:7px; display:flex; flex-direction:column; gap:7px; }
.ts-save-block { border:1px solid rgba(127,127,127,.26); border-radius:8px; padding:7px 9px; display:flex; flex-direction:column; gap:6px; flex:0 0 auto; }
.ts-save-block.good { background:rgba(74,222,128,.08); border-color:rgba(74,222,128,.38); }
.ts-save-block.bad { background:rgba(251,191,36,.08); border-color:rgba(251,191,36,.38); }
.ts-save-title { display:flex; align-items:center; gap:6px; font-size:calc(var(--ts-fs, 12.5px) * 0.92); font-weight:600; flex:none; }
.ts-badge { font-size:calc(var(--ts-fs, 12.5px) * 0.8); padding:1px 7px; border-radius:99px; border:1px solid transparent; font-weight:600; }
.ts-badge.good { background:rgba(74,222,128,.25); border-color:rgba(74,222,128,.6); }
.ts-badge.bad { background:rgba(251,191,36,.22); border-color:rgba(251,191,36,.6); }
.ts-save-rows { display:flex; flex-direction:column; gap:5px; flex:0 0 auto; }
.ts-kv { display:flex; gap:8px; align-items:flex-start; font-size:calc(var(--ts-fs, 12.5px) * 0.88); }
.ts-kv-k { flex:none; width:82px; opacity:.65; }
.ts-kv-v { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; word-break:break-word; }
.ts-line { display:block; }
.ts-good { color:#4ade80; }
.ts-bad { color:#fbbf24; }
.ts-dim { opacity:.55; font-size:calc(var(--ts-fs, 12.5px) * 0.8); margin-left:3px; }
.ts-bar-track { flex:none; height:5px; border-radius:99px; background:rgba(127,127,127,.22); overflow:hidden; }
.ts-bar-fill { height:100%; border-radius:99px; transition:width .3s ease; }
.ts-bar-fill.good { background:linear-gradient(90deg, rgba(74,222,128,.7), #4ade80); }
.ts-bar-fill.bad { background:linear-gradient(90deg, rgba(251,191,36,.7), #fbbf24); }

/* —— 黑板正文富文本（JSON / Markdown / 纯文本） —— */
.ts-rich { display:flex; flex-direction:column; gap:6px; }
.ts-rich-plain { margin:0; white-space:pre-wrap; word-break:break-word; font:inherit; }
.ts-rich-code { margin:0; padding:8px 10px; border-radius:7px; background:rgba(0,0,0,.22); border:1px solid rgba(127,127,127,.28); overflow:auto; font-family:var(--dsh-font-mono, monospace); font-size:calc(var(--ts-fs, 12.5px) * 0.92); line-height:1.5; white-space:pre; }
.ts-rich-h { margin:2px 0 0; font-weight:600; line-height:1.35; }
.ts-rich-h1 { font-size:calc(var(--ts-fs, 12.5px) * 1.2); }
.ts-rich-h2 { font-size:calc(var(--ts-fs, 12.5px) * 1.12); }
.ts-rich-h3 { font-size:calc(var(--ts-fs, 12.5px) * 1.04); }
.ts-rich-h4, .ts-rich-h5, .ts-rich-h6 { font-size:var(--ts-fs, 12.5px); opacity:.9; }
.ts-rich-p { margin:0; line-height:1.6; }
.ts-rich-ul, .ts-rich-ol { margin:0; padding-left:20px; display:flex; flex-direction:column; gap:3px; line-height:1.55; }
.ts-rich-quote { margin:0; padding:4px 10px; border-left:3px solid rgba(127,127,127,.55); opacity:.85; display:flex; flex-direction:column; gap:3px; }
.ts-rich-quote p { margin:0; }
.ts-rich-hr { margin:4px 0; border:none; border-top:1px solid rgba(127,127,127,.35); }
.ts-rich-inline-code { padding:1px 5px; border-radius:4px; background:rgba(127,127,127,.22); font-family:var(--dsh-font-mono, monospace); font-size:calc(var(--ts-fs, 12.5px) * 0.88); }
.ts-rich a { color:#60a5fa; text-decoration:underline; }
/* —— GenUI 围栏槽位（交 @changfenhuang/dsh-genui 渲染）——
   标签仅用于插件的**结构识别**（叶子元素文本恰为 dsh-ui + 同级 <pre>），
   必须不可见；接管后插件会把整个槽位 display:none，并在其后插入自己的 React 根。 */
.ts-genui-lang { display:none; }
/* 接管后紧随的插件容器：与消息体保持同一列宽，不溢出 */
.genui-dom-fence { max-width:100%; min-width:0; }
.ts-rich-table-wrap { overflow:auto; }
.ts-rich-table { border-collapse:collapse; font-size:calc(var(--ts-fs, 12.5px) * 0.92); width:100%; }
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
/* 预览条同样去掉底色与描边框（一体化），只留下边线 */
.ts-preview-bar { display:flex; align-items:center; gap:10px; padding:6px 8px; border-bottom:1px solid rgba(127,127,127,.16); flex:none; }
.ts-preview-title { font-weight:600; font-size:calc(var(--ts-fs, 12.5px) * 1.04); white-space:nowrap; }
.ts-preview-url { flex:1 1 auto; min-width:0; font-size:calc(var(--ts-fs, 12.5px) * 0.88); opacity:.65; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ts-preview-ops { display:flex; gap:6px; flex:none; }
/* 预览 iframe：不加自己的边框与底色（原先的 1px 边框 + 白底在部分项目上会显出白边，
   与其它窗口不一致）；留白由外层卡片/标题条负责 */
/* 项目预览是**内嵌 iframe**：它自己的文档没声明 color-scheme 时会继承宿主页面的。
   宿主切浅色主题后，内嵌项目（例如 info_report 这种深色底 + 透明面的 UI）会拿到浅色画布，
   整块看着「一片发白」。这里给 iframe 固定深色画布，让内嵌项目按它自己的深色设计渲染；
   项目自己声明了 color-scheme 的话以项目为准（iframe 内文档优先）。 */
.ts-preview-frame { color-scheme: dark; }
.ts-preview-frame { flex:1 1 0; min-height:0; width:100%; display:block; border:0; background:transparent; }
/* 主对话顶部的「加载更早」行（瀑布式回翻的入口与忙碌提示） */
.ts-msgs-topbar { flex:none; display:flex; align-items:center; justify-content:center; gap:8px; padding:2px 0 6px; }
/* 卡片：启动情况 + 按钮同排不跨行；创建于/更新于也永远一行 */
.ts-center-actions { flex-wrap:nowrap; }
.ts-center-meta { flex-wrap:nowrap; }
.ts-center-meta .ts-tag, .ts-dev-chip { white-space:nowrap; flex:none; }
/* 启动情况小标：已启动=绿，未启动=灰（放在「进入工作台」之前） */
.ts-dev-chip { font-size:calc(var(--ts-fs, 12.5px) * 0.88); padding:2px 8px; border-radius:99px; border:1px solid rgba(127,127,127,.45); background:rgba(127,127,127,.12); opacity:.72; }
.ts-dev-chip.on { border-color:rgba(74,222,128,.55); background:rgba(74,222,128,.18); color:#86efac; opacity:1; }

/* 已启动那枚小标的「超链接」形态：平时就是原样的绿标，悬停/键盘聚焦才变成可点的
   「去调试 →」——两段文字叠在同一个格子里（宽度取较大者），所以悬停时不挤动旁边的按钮。
   注意 .ts-center-card-click 整卡也是 role=button（进工作台），这里要把它自己的默认光标改回指针链。 */
.ts-dev-chip-link { position:relative; display:inline-flex; align-items:center; text-decoration:none; cursor:pointer; transition:border-color .14s ease, background .14s ease, box-shadow .14s ease; }
.ts-dev-chip-link .ts-dev-chip-go { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity .14s ease; color:#93c5fd; }
.ts-dev-chip-link .ts-dev-chip-state { transition:opacity .14s ease; }
.ts-dev-chip-link:hover, .ts-dev-chip-link:focus-visible { border-color:rgba(96,165,250,.85); background:rgba(96,165,250,.22); box-shadow:0 0 0 1px rgba(96,165,250,.35); outline:none; }
.ts-dev-chip-link:hover .ts-dev-chip-state, .ts-dev-chip-link:focus-visible .ts-dev-chip-state { opacity:0; }
.ts-dev-chip-link:hover .ts-dev-chip-go, .ts-dev-chip-link:focus-visible .ts-dev-chip-go { opacity:1; }

/* —— 标题行「探索者设置」：按钮 + 浮动面板（默认 / 免费 / 收费 三组开关） —— */
.ts-expset { flex:none; display:inline-flex; align-items:center; }
.ts-expset-btn { display:inline-flex; align-items:center; gap:6px; white-space:nowrap; }
.ts-expset-btn.active { border-color:rgba(96,165,250,.7); background:rgba(96,165,250,.18); }
/* 面板：portal 挂 body（避开 .ts-cr 的 overflow:hidden），宽度跟随内容但有限，列表内部滚动 */
.ts-expset-pop { z-index:46; width:max-content; min-width:300px; max-width:min(420px, calc(100vw - 32px)); max-height:64vh; overflow:auto; display:flex; flex-direction:column; gap:8px; padding:10px 12px; border-radius:12px; border:1px solid var(--ts-pop-line); background:var(--ts-pop-bg); color:var(--ts-pop-fg); box-shadow:var(--ts-pop-shadow); backdrop-filter:blur(12px) saturate(1.2); }
.ts-expset-head { display:flex; align-items:baseline; gap:8px; font-size:var(--ts-fs, 12.5px); font-weight:600; }
.ts-expset-head-tip { margin-left:auto; font-size:calc(var(--ts-fs, 12.5px) * 0.84); font-weight:400; opacity:.6; }
.ts-expset-err { font-size:calc(var(--ts-fs, 12.5px) * 0.92); color:#fca5a5; }
.ts-expset-empty { font-size:calc(var(--ts-fs, 12.5px) * 0.92); opacity:.55; padding:2px 0; }
.ts-expset-busy { font-size:calc(var(--ts-fs, 12.5px) * 0.88); opacity:.6; }
.ts-expset-group { display:flex; flex-direction:column; gap:5px; padding:7px 8px; border:1px solid rgba(127,127,127,.24); border-radius:9px; background:rgba(127,127,127,.07); }
.ts-expset-group-head { display:flex; align-items:center; gap:8px; }
.ts-expset-group-name { font-size:calc(var(--ts-fs, 12.5px) * 0.96); font-weight:600; }
.ts-expset-group-count { font-size:calc(var(--ts-fs, 12.5px) * 0.84); opacity:.55; font-variant-numeric:tabular-nums; }
.ts-expset-group-head .ts-switch { margin-left:auto; }
.ts-expset-row { display:flex; align-items:center; gap:8px; padding:2px 0 2px 2px; }
.ts-expset-row-off { opacity:.5; }
.ts-expset-name { flex:1; min-width:0; font-size:calc(var(--ts-fs, 12.5px) * 0.92); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-flex; align-items:center; gap:6px; }
.ts-expset-tag { flex:none; font-size:calc(var(--ts-fs, 12.5px) * 0.76); padding:0 5px; border-radius:99px; border:1px solid rgba(127,127,127,.5); opacity:.8; }
/* 开关（role=switch）：轨道 + 圆钮；开=绿 */
.ts-switch { flex:none; width:34px; height:18px; padding:0; border-radius:99px; border:1px solid rgba(127,127,127,.5); background:rgba(127,127,127,.25); cursor:pointer; position:relative; transition:background .15s ease, border-color .15s ease; }
.ts-switch:disabled { opacity:.4; cursor:not-allowed; }
.ts-switch .ts-switch-knob { position:absolute; top:1px; left:1px; width:14px; height:14px; border-radius:50%; background:var(--ts-fg); transition:transform .15s ease; }
.ts-switch.on { background:rgba(74,222,128,.55); border-color:rgba(74,222,128,.8); }
.ts-switch.on .ts-switch-knob { transform:translateX(16px); }
/* 分组开关：蓝色调，与单个探索者的绿色开关区分开 */
.ts-switch-group.on { background:rgba(96,165,250,.6); border-color:rgba(96,165,250,.9); }
`

export function injectProjectCenterStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}
