/**
 * 「设置 → 脱敏」页的样式（独立注入，不依赖 tokensave 工作台那份大样式表）。
 *
 * 只用半透明中性色 + 主题蓝/绿点缀，深浅色主题都自适应；字号跟随宿主的 --ts-fs
 * （没有时回落到 13px）。类名前缀 tsm- 避免与工作台样式互撞。
 */

const STYLE_ID = 'tokensave-mask-settings-css'

const CSS = `
.tsm-page { display:flex; flex-direction:column; gap:14px; padding:2px 2px 18px; color:inherit; }
.tsm-head { display:flex; align-items:baseline; gap:8px; }
.tsm-title { margin:0; font-size:calc(var(--ts-fs, 13px) * 1.15); font-weight:650; }
.tsm-badge { font-size:calc(var(--ts-fs, 13px) * 0.78); padding:1px 7px; border-radius:99px; border:1px solid rgba(74,222,128,.5); color:rgba(74,222,128,.95); }
.tsm-desc { margin:0; font-size:calc(var(--ts-fs, 13px) * 0.88); line-height:1.55; opacity:.72; }
.tsm-desc code { padding:0 4px; border-radius:4px; background:rgba(127,127,127,.16); }
.tsm-card { display:flex; flex-direction:column; gap:2px; padding:10px 12px; border:1px solid rgba(127,127,127,.22); border-radius:12px; background:rgba(127,127,127,.06); }
.tsm-card-head { display:flex; align-items:baseline; gap:8px; padding:2px 0 6px; font-size:calc(var(--ts-fs, 13px) * 0.94); font-weight:600; }
.tsm-card-tip { margin-left:auto; font-size:calc(var(--ts-fs, 13px) * 0.8); font-weight:400; opacity:.55; }
.tsm-row { display:flex; align-items:center; gap:12px; padding:7px 0; }
.tsm-row + .tsm-row { border-top:1px solid rgba(127,127,127,.14); }
.tsm-row-text { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1; }
.tsm-row-label { font-size:calc(var(--ts-fs, 13px) * 0.94); }
.tsm-row-hint { font-size:calc(var(--ts-fs, 13px) * 0.8); line-height:1.45; opacity:.6; }
.tsm-row-off .tsm-row-label { opacity:.55; }
.tsm-switch { flex:none; width:36px; height:20px; padding:0; border-radius:99px; border:1px solid rgba(127,127,127,.5); background:rgba(127,127,127,.25); cursor:pointer; position:relative; transition:background .15s ease, border-color .15s ease; }
.tsm-switch:disabled { opacity:.4; cursor:not-allowed; }
.tsm-switch .tsm-knob { position:absolute; top:1px; left:1px; width:16px; height:16px; border-radius:50%; background:#fff; opacity:.92; transition:transform .15s ease; }
.tsm-switch[aria-checked="true"] { background:rgba(74,222,128,.6); border-color:rgba(74,222,128,.85); }
.tsm-switch[aria-checked="true"] .tsm-knob { transform:translateX(16px); }
.tsm-threshold { display:flex; align-items:center; gap:10px; flex:none; }
.tsm-threshold input[type="range"] { width:150px; accent-color:rgba(96,165,250,.9); }
.tsm-threshold-value { font-size:calc(var(--ts-fs, 13px) * 0.88); font-variant-numeric:tabular-nums; opacity:.8; min-width:34px; text-align:right; }
.tsm-paths { gap:6px; }
.tsm-path { display:flex; gap:8px; font-size:calc(var(--ts-fs, 13px) * 0.8); line-height:1.5; }
.tsm-path-key { flex:none; opacity:.6; }
.tsm-path-val { min-width:0; word-break:break-all; opacity:.85; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
.tsm-foot { display:flex; align-items:center; gap:10px; font-size:calc(var(--ts-fs, 13px) * 0.8); opacity:.62; }
.tsm-foot button { font:inherit; padding:2px 9px; border-radius:7px; border:1px solid rgba(127,127,127,.4); background:transparent; color:inherit; cursor:pointer; }
.tsm-foot button:hover { background:rgba(127,127,127,.16); }
.tsm-foot button:disabled { opacity:.45; cursor:not-allowed; }
.tsm-err { padding:8px 10px; border-radius:9px; border:1px solid rgba(248,113,113,.55); background:rgba(248,113,113,.12); font-size:calc(var(--ts-fs, 13px) * 0.88); }
.tsm-loading { font-size:calc(var(--ts-fs, 13px) * 0.88); opacity:.6; }
`

export function injectMaskSettingsStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}
