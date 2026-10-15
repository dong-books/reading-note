'use strict';
(() => {
const W = 1080, H = 1350;
const SERIF = "'Nanum Myeongjo','Noto Serif KR',serif";
const SANS = "'Nanum Gothic','Apple SD Gothic Neo','Malgun Gothic',sans-serif";
const PUBLIC = true;
const PEN = "'Nanum Pen Script','Nanum Gothic',cursive";
const PALETTE = ["#7A2E2E","#2F4F6F","#6B7F3A","#C58B2C","#3E5E5A","#8C5A7A","#B5543C","#40424E","#D9CDAE","#5A6E8C","#9A3F4F","#2E5B44","#A86B3C","#E3B85C"];
const LIGHT = new Set(["#D9CDAE","#E3B85C"]);
const CACHE_KEY = "bs_cache_v1", THUMB_KEY = "bs_thumbs_v1";
const LIST_PER_PAGE = 11;

const TODAY_DEFAULT = { label: "", ids: [] };
const OPEN_DEFAULT = "2026-10-13";
let data = { shopName: "작은책방", menu: "소금빵\n무화과 깜빠뉴\n핸드드립 커피", openDate: OPEN_DEFAULT, books: [], today: { ...TODAY_DEFAULT }, pub: { publicOn: false, publicCovers: false, publicMemo: false, commentMode: "open" } };
const shortName = () => String(data.shopName || "").replace(/\s*책방\s*$/, "").trim() || data.shopName;
const recName = () => `${shortName()} 추천`;
const recLabel = () => `${shortName()}에서 추천하는 책`;
const OLD_LABELS = ["", "오늘 소개하고 싶은 책", "오늘 읽을 책"];
const todayLabel = () => OLD_LABELS.includes(data.today.label || "") ? recLabel() : data.today.label;
const openDot = () => dot(data.openDate || OPEN_DEFAULT);
function openDays(){ const o = new Date((data.openDate || OPEN_DEFAULT) + "T00:00:00"), t = new Date(today() + "T00:00:00"); return Math.round((t - o) / 86400000) + 1; }
const openLine = () => { const n = openDays(); return n >= 1 ? `문 연 지 ${n}일째` : `오픈 D-${1 - n}`; };
let view = "out", wallPage = 0, page = 0, selectedId = null, justAdded = new Set(), editingId = null, formStatus = "read", listTab = "read";
const coverSource = new Map();
let thumbs = {}, pendingCover = null, hiddenIds = new Set(), rec = null, online = false;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,10); };
const dot = s => (s || "").replaceAll("-", ".");
const cut = (s, n) => { const a = [...(s || "")]; return a.length > n ? a.slice(0, n - 1).join("") + "…" : a.join(""); };
function isLight(hex){ const n = parseInt(hex.slice(1), 16); const r = n >> 16, g = (n >> 8) & 255, b = n & 255; return (0.299*r + 0.587*g + 0.114*b) / 255 > 0.62; }
const coverSrc = b => (thumbs[b.id] && thumbs[b.id].data) || b._tmpCover || "";
function hash(s){ let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

/* ---------- storage: 독서노트 Apps Script(같은 구글 시트) ---------- */
const SYNC_FIELDS = ["title", "author", "status", "readDate", "startDate", "memo", "color"];
const snapOf = b => JSON.stringify(SYNC_FIELDS.map(k => b[k] || ""));
const pickSync = b => { const o = { id: b.id }; SYNC_FIELDS.forEach(k => { o[k] = b[k] || ""; }); return o; };
const settingsOf = () => JSON.stringify({ shopName: data.shopName, menu: data.menu, openDate: data.openDate, today: data.today, pub: data.pub });
let lastSynced = new Map(), settingsSynced = "", coverQueue = [], syncTimer = null, syncing = false, syncAgain = false, lastRefresh = 0;

function setStatus(t, warn, withLink){
  $("#syncStatus").textContent = t;
  const bn = $("#syncBanner"); if (!bn) return;
  bn.hidden = !warn;
  if (warn) bn.innerHTML = esc(t) + (withLink ? ' <a href="index.html" class="banner-link">독서노트 열기</a>' : "");
}
function saveCache(){
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, lastSynced: [...lastSynced], settingsSynced })); } catch {}
}
function loadCache(){
  try { const v = localStorage.getItem(CACHE_KEY); return v ? JSON.parse(v) : null; } catch { return null; }
}
function saveThumbs(){
  try { localStorage.setItem(THUMB_KEY, JSON.stringify(thumbs)); }
  catch { // 저장 공간이 부족하면 화면에 없는 책의 표지부터 비움
    const keep = new Set(data.books.map(b => b.id)); Object.keys(thumbs).forEach(k => { if (!keep.has(k)) delete thumbs[k]; });
    try { localStorage.setItem(THUMB_KEY, JSON.stringify(thumbs)); } catch {}
  }
}
function loadThumbsLocal(){ try { return JSON.parse(localStorage.getItem(THUMB_KEY) || "{}") || {}; } catch { return {}; } }
function normalize(d){
  d = JSON.parse(JSON.stringify(d || {}));
  return { shopName: d.shopName || "작은책방", menu: typeof d.menu === "string" ? d.menu : data.menu, openDate: /^\d{4}-\d{2}-\d{2}$/.test(d.openDate || "") ? d.openDate : OPEN_DEFAULT,
           pub: { publicOn: !!(d.pub && d.pub.publicOn), publicCovers: !!(d.pub && d.pub.publicCovers), publicMemo: !!(d.pub && d.pub.publicMemo), commentMode: d.pub && d.pub.commentMode === "review" ? "review" : "open" },
           books: Array.isArray(d.books) ? d.books.filter(b => b && b.title) : [],
           today: d.today && Array.isArray(d.today.ids) ? { label: String(d.today.label || TODAY_DEFAULT.label), ids: d.today.ids.slice(0, 5) } : { ...TODAY_DEFAULT } };
}
function showLogin(){ online = false; setStatus("독서노트에서 먼저 로그인해 주세요. 로그인하면 이 책방도 바로 연결돼요.", true, true); }
async function api(action, params){
  if (!window.RN) throw Object.assign(new Error("독서노트 파일(outbox.js)을 찾지 못했어요."), { code: "config" });
  try { return await window.RN.call(action, params || {}); }
  catch (e) {
    if (e.code === "auth") showLogin();
    if (e.code === "unknown" || /알 수 없는 요청/.test(e.message || "")) {
      setStatus("서버(Code.gs)가 책방 기능이 없는 옛 버전이에요. 새 Code.gs로 업데이트해 주세요.", true, true);
    }
    throw e;
  }
}
function remapId(oldId, newId){
  if (!oldId || !newId || oldId === newId) return;
  const b = data.books.find(x => x.id === oldId); if (b) b.id = newId;
  if (thumbs[oldId]) { thumbs[newId] = thumbs[oldId]; delete thumbs[oldId]; saveThumbs(); }
  data.today.ids = data.today.ids.map(x => x === oldId ? newId : x);
  if (selectedId === oldId) selectedId = newId;
  if (editingId === oldId) editingId = newId;
  if (lastSynced.has(oldId)) { lastSynced.set(newId, lastSynced.get(oldId)); lastSynced.delete(oldId); }
  if (coverSource.has(oldId)) { coverSource.set(newId, coverSource.get(oldId)); coverSource.delete(oldId); }
  pickIds = pickIds.map(x => x === oldId ? newId : x);
  const g = document.querySelector(`#scene [data-id="${CSS.escape(oldId)}"]`); if (g) g.dataset.id = newId;
}
function persist(){ saveCache(); clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 450); }
function persistNow(){ clearTimeout(syncTimer); return syncNow(); }
async function syncNow(){
  if (!online) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  let failed = null;
  try {
    // 1) 바뀐 책 저장
    for (const b of data.books.slice()) {
      const s = snapOf(b), prev = lastSynced.get(b.id);
      if (prev && prev.s === s) continue;
      setStatus("저장 중…");
      const sent = pickSync(b), r = await api("shopsave", { book: sent });
      remapId(sent.id, r.book.id);
      lastSynced.set(r.book.id, { s, title: sent.title, author: sent.author });
      delete b.virtual;
    }
    // 2) 표지
    while (coverQueue.length) {
      const job = coverQueue[0], b = job.book, sent = pickSync(b);
      setStatus("표지 올리는 중…");
      const params = Object.assign({ book: sent }, job.params);
      const r = await api("shopcover", params);
      remapId(sent.id, r.book.id);
      lastSynced.set(r.book.id, { s: snapOf(sent), title: sent.title, author: sent.author });
      b.cover = r.book.cover; delete b._tmpCover; delete b.virtual;
      if (r.thumb) thumbs[r.book.id] = { v: r.book.cover, data: r.thumb }; else if (job.params.remove) delete thumbs[r.book.id];
      saveThumbs(); coverQueue.shift();
      if (!rec) { $("#coverPop").dataset.id = ""; renderScene(); if (selectedId === r.book.id) renderDetail(); }
    }
    // 3) 뺀 책
    for (const [id, v] of [...lastSynced]) {
      if (data.books.some(b => b.id === id)) continue;
      setStatus("저장 중…");
      await api("shopdel", { id, title: v.title, author: v.author }); lastSynced.delete(id);
    }
    // 4) 간판·메뉴·오늘의 책
    const st = settingsOf();
    if (settingsSynced && st !== settingsSynced) { await api("shopset", Object.assign({ shopName: data.shopName, menu: data.menu, openDate: data.openDate, today: data.today }, data.pub)); settingsSynced = st; }
    saveCache();
    setStatus("독서노트 구글 시트에 저장됨");
  } catch (e) {
    failed = e; saveCache();
    if (e.code !== "auth" && e.code !== "unknown") { setStatus("저장하지 못했어요: " + (e.message || "오류") + " (잠시 뒤 다시 시도해요)", true); setTimeout(persist, 15000); }
  }
  syncing = false;
  if (syncAgain && !failed) { syncAgain = false; return syncNow(); }
  syncAgain = false;
}
function applyServer(r){
  const keepSel = selectedId;
  data = normalize({ shopName: r.settings.shopName, menu: r.settings.menu, openDate: r.settings.openDate, today: r.settings.today, books: r.books, pub: r.settings });
  lastSynced = new Map(data.books.map(b => [b.id, { s: snapOf(b), title: b.title, author: b.author }]));
  settingsSynced = settingsOf();
  selectedId = data.books.some(b => b.id === keepSel) ? keepSel : null;
  saveCache(); renderAll(); loadThumbs();
}
async function refresh(force){
  if (!online || syncing || coverQueue.length || rec) return;
  if (!force && Date.now() - lastRefresh < 60000) return;
  lastRefresh = Date.now();
  try { const r = await api("shop", {}); if (!syncing && !coverQueue.length && !rec) applyServer(r); setStatus("독서노트 구글 시트에 저장됨"); }
  catch (e) { if (e.code !== "auth" && e.code !== "unknown") setStatus("책 목록을 불러오지 못했어요: " + (e.message || "오류"), true); }
}
async function loadThumbs(){
  const need = data.books.filter(b => b.cover && (!thumbs[b.id] || thumbs[b.id].v !== b.cover)).map(b => b.id);
  for (let i = 0; i < need.length; i += 30) {
    try { const r = await api("shopthumbs", { ids: need.slice(i, i + 30) }); Object.assign(thumbs, r.thumbs || {}); } catch { return; }
  }
  if (need.length) { saveThumbs(); if (!rec) { renderScene(); renderList(); } }
}
async function boot(){
  thumbs = loadThumbsLocal();
  const c = loadCache();
  if (c && c.data) { data = normalize(c.data); lastSynced = new Map(c.lastSynced || []); settingsSynced = c.settingsSynced || ""; }
  renderAll();
  if (!window.RN) { setStatus("독서노트 파일(outbox.js)을 찾지 못했어요. bookshop.html을 독서노트와 같은 저장소에 올려 주세요.", true); return; }
  let ok = false;
  try { ok = !!((await window.RN.getAuth()) && (await window.RN.getKey())); } catch {}
  if (!ok) { showLogin(); return; }
  online = true; setStatus("불러오는 중…");
  await syncNow();
  await refresh(true);
}

/* ---------- data views ---------- */
const byStatus = s => data.books.filter(b => b.status === s);
const readBooks = () => byStatus("read").sort((a,b) => (a.readDate||"").localeCompare(b.readDate||"") || a.addedAt - b.addedAt);
const readingBooks = () => byStatus("reading").sort((a,b) => (a.startDate||"").localeCompare(b.startDate||"") || a.addedAt - b.addedAt);
const wantBooks = () => byStatus("want").sort((a,b) => a.addedAt - b.addedAt);

/* ---------- shelf layout ---------- */
const SHELF = { x0: 508, x1: 1016, top: 214, rowH: 158, board: 16, rows: 5, readRows: 4, wantRow: 4 };
function spine(b){ const h = hash(b.id + b.title); return { w: 26 + (h % 15), h: 112 + ((h >> 5) % 36), color: b.color || PALETTE[h % PALETTE.length] }; }
function pages(){
  const out = []; let cur = [], row = 0, x = SHELF.x0;
  for (const b of readBooks()) {
    const s = spine(b);
    if (x + s.w > SHELF.x1) { row++; x = SHELF.x0; if (row >= SHELF.readRows) { out.push(cur); cur = []; row = 0; } }
    cur.push({ b, ...s, row, x }); x += s.w + 2;
  }
  out.push(cur); return out;
}
function wantLayout(){
  const out = []; let x = SHELF.x0, more = 0;
  for (const b of wantBooks()) {
    const s = spine(b);
    if (x + s.w > SHELF.x1 - 70 && out.length) { more++; continue; }
    out.push({ b, ...s, row: SHELF.wantRow, x, want: true }); x += s.w + 2;
  }
  return { items: out, more, endX: x };
}
const bookCls = id => ["book", selectedId === id ? "out" : "", justAdded.has(id) ? "drop" : ""].join(" ");

/* ---------- scene pieces ---------- */
function spineSvg(it){
  if (hiddenIds.has(it.b.id)) return "";
  const { b, w, h, color } = it;
  const txt = isLight(color) ? "#2A2420" : "#F5EEDD";
  const fs = Math.max(11, Math.min(16, Math.floor(w * 0.5)));
  const cap = Math.floor((h - 34) / (fs + 1));
  let chars = [...b.title.replace(/\s+/g, " ")];
  if (chars.length > cap) chars = chars.slice(0, Math.max(1, cap - 1)).concat("…");
  const tspans = chars.map((c, i) => `<tspan x="${w/2}" y="${22 + fs + i*(fs+1)}">${c === " " ? "&#160;" : esc(c)}</tspan>`).join("");
  const rowBottom = SHELF.top + it.row * (SHELF.rowH + SHELF.board) + SHELF.rowH;
  return `<g transform="translate(${it.x},${rowBottom - h})"><g class="${bookCls(b.id)}" data-id="${esc(b.id)}" tabindex="0" role="button" aria-label="${esc(b.title)} 꺼내기">
    <rect width="${w}" height="${h}" rx="2" fill="${color}"/>
    <rect width="${w}" height="9" y="8" fill="#000" opacity=".18"/>
    <rect width="${w}" height="3" y="${h-16}" fill="${txt}" opacity=".5"/>
    <rect width="3" height="${h}" fill="#fff" opacity=".12"/>
    <text font-family="${SERIF}" font-size="${fs}" fill="${txt}" text-anchor="middle">${tspans}</text>
    ${it.want ? `<rect y="${h-34}" width="${w}" height="14" fill="#F1E3B3"/><rect y="${h-34}" width="${w}" height="2" fill="#C8912A"/>` : ""}
  </g></g>`;
}
function coverSvg(b, x, y, i){
  if (hiddenIds.has(b.id)) return "";
  const s = spine(b), cw = 62, ch = 80, src = coverSrc(b);
  const txt = isLight(s.color) ? "#2A2420" : "#F5EEDD";
  const t = [...b.title]; const lines = [];
  for (let k = 0; k < t.length && lines.length < 3; k += 4) lines.push(t.slice(k, k+4).join(""));
  if (t.length > 12) lines[2] = lines[2].slice(0,3) + "…";
  return `<g transform="translate(${x},${y}) rotate(${i%2 ? 1.5 : -1.5} 31 80)"><g class="${bookCls(b.id)}" data-id="${esc(b.id)}" tabindex="0" role="button" aria-label="${esc(b.title)} 살펴보기">
    <rect width="${cw}" height="${ch}" rx="2" fill="${s.color}"/>
    ${src ? `<image href="${esc(src)}" width="${cw}" height="${ch}" preserveAspectRatio="xMidYMid slice"/>`
          : `<rect x="8" y="9" width="46" height="2" fill="${txt}" opacity=".6"/><text font-family="${SERIF}" font-size="12.5" fill="${txt}" text-anchor="middle">${lines.map((l,k)=>`<tspan x="31" y="${30+k*15}">${esc(l)}</tspan>`).join("")}</text>`}
    <rect width="${cw}" height="${ch}" rx="2" fill="none" stroke="#000" stroke-opacity=".22"/>
  </g></g>`;
}
let wallTex = "";
function wallTexture(){
  if (wallTex) return wallTex;
  let s = "";
  for (let i = 0; i < 340; i++) {
    const h = hash("st" + i), x = h % 1080, y = 56 + (h >> 11) % 1040, r = 1 + (h >> 21) % 3;
    s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${h & 1 ? "#FFFFFF" : "#1A2533"}" opacity="${(0.06 + ((h >> 4) % 7) / 100).toFixed(2)}"/>`;
  }
  for (let i = 0; i < 14; i++) { const h = hash("bl" + i); s += `<ellipse cx="${h % 1080}" cy="${80 + (h >> 9) % 1000}" rx="${60 + h % 90}" ry="${30 + (h >> 5) % 50}" fill="#1A2533" opacity=".05"/>`; }
  return (wallTex = s);
}
function stainedGlass(){ // 나무 창틀 + 창밖 나무 (이름은 예전 그대로)
  const leaves = [[96,300,66,"#7FA36B"],[176,256,74,"#6B9460"],[300,276,86,"#86AE73"],[386,350,66,"#5F8A57"],[118,430,78,"#739C64"],[262,420,92,"#678F5C"],[362,482,70,"#7FA36B"],[196,524,62,"#5F8A57"]];
  const p = dayPhase(), k = wxKind();
  const SKY = { night: ["#0E1A31", "#24365A"], dawn: ["#F4C6A8", "#F6E6D2"], morning: ["#C9E3F6", "#FFF2D4"], day: ["#B9D9F2", "#EEF5F9"], dusk: ["#F2A877", "#7C6FA0"] };
  let sky = SKY[p];
  if (k === "cloud" || k === "rain" || k === "storm" || k === "fog" || k === "snow") sky = p === "night" ? ["#151D2B", "#2A3446"] : ["#A9B5C2", "#D6DCE2"];
  const leafDim = p === "night" ? .45 : p === "dusk" || p === "dawn" ? .75 : 1;
  const vine = Array.from({ length: 9 }, (_, i) => `<ellipse cx="${80 + i * 38 + (i % 2) * 6}" cy="${240 + (i % 3) * 14}" rx="12" ry="7" fill="#4F7F4A" transform="rotate(${(i % 2 ? 30 : -25)} ${80 + i * 38} ${240 + (i % 3) * 14})"/>`).join("");
  return `
  <defs><linearGradient id="winSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient></defs>
  <rect x="44" y="214" width="382" height="352" fill="#A4703F"/>
  <rect x="58" y="228" width="354" height="324" fill="url(#winSky)"/>
  <clipPath id="winClip"><rect x="58" y="228" width="354" height="324"/></clipPath>
  <g clip-path="url(#winClip)">
  <rect x="226" y="380" width="14" height="172" fill="#7B6A52"/>
  ${leaves.map(([x, y, r, c]) => `<circle cx="${x}" cy="${y + 40}" r="${Math.round(r * 0.82)}" fill="${c}" opacity=".9"/>`).join("")}
  ${vine}
  ${p === "night" ? `<rect x="58" y="228" width="354" height="324" fill="#0B1424" opacity="${(1 - leafDim).toFixed(2)}"/>` : leafDim < 1 ? `<rect x="58" y="228" width="354" height="324" fill="#5A3A50" opacity=".18"/>` : ""}
  ${p === "night" && k === "clear" ? `<circle cx="360" cy="262" r="16" fill="#F6F0D2"/><circle cx="366" cy="257" r="14" fill="#0E1A31"/>${[[90, 250], [150, 280], [300, 246], [250, 300]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="#FFFFFF"/>`).join("")}` : ""}
  ${(p === "morning" || p === "dawn") && k === "clear" ? `<circle cx="104" cy="266" r="34" fill="#FFF4C8" opacity=".9"/><circle cx="104" cy="266" r="70" fill="#FFF4C8" opacity=".25"/>` : ""}
  ${k === "fog" ? `<rect x="58" y="228" width="354" height="324" fill="#EEF2F5" opacity=".55"/>` : ""}
  ${fallSvg(k, 58, 228, 354, 324, "win")}
  </g>
  <rect x="58" y="228" width="354" height="324" fill="url(#glassShine)"/>
  <rect x="58" y="228" width="177" height="324" fill="none" stroke="#F2F0EA" stroke-width="12"/>
  <rect x="235" y="228" width="177" height="324" fill="none" stroke="#F2F0EA" stroke-width="12"/>
  <line x1="58" y1="300" x2="412" y2="300" stroke="#F2F0EA" stroke-width="8"/>
  <rect x="224" y="416" width="5" height="26" rx="2" fill="#C8A060"/><rect x="241" y="416" width="5" height="26" rx="2" fill="#C8A060"/>
  <rect x="36" y="560" width="398" height="14" fill="#8A5A33"/>
  <ellipse cx="230" cy="812" rx="150" ry="10" fill="#FFE7A8" opacity=".25"/>`;
}

function interiorLight(){
  const p = dayPhase(), k = wxKind();
  if ((p === "morning" || p === "dawn" || p === "day") && (k === "clear" || k === "cloud")) {
    const a = (p === "day" ? .08 : .14) * (k === "clear" ? 1 : .45);
    return `<g pointer-events="none"><path d="M235 300 L412 300 L800 1350 L380 1350 Z" fill="#FFF2C4" opacity="${a.toFixed(3)}"/><path d="M90 300 L220 300 L520 1350 L220 1350 Z" fill="#FFF2C4" opacity="${(a * .7).toFixed(3)}"/></g>`;
  }
  if (p === "night") return `<rect width="${W}" height="${H}" fill="#0B1424" opacity=".16" pointer-events="none"/>`;
  return "";
}
function sceneBody(exp){
  const pg = pages(); page = Math.min(page, pg.length - 1);
  const items = pg[page], wants = wantBooks(), reading = readingBooks(), nRead = readBooks().length;
  const shelfBoards = Array.from({length: SHELF.rows}, (_, r) => {
    const y = SHELF.top + r * (SHELF.rowH + SHELF.board) + SHELF.rowH;
    return `<rect x="496" y="${y}" width="532" height="${SHELF.board}" fill="#6B4632"/><rect x="496" y="${y}" width="532" height="3" fill="#8A5E44"/>`;
  }).join("");
  let bookend = "";
  if (items.length) { const l = items[items.length-1]; const yb = SHELF.top + l.row*(SHELF.rowH+SHELF.board) + SHELF.rowH;
    if (l.x + l.w + 20 < SHELF.x1) bookend = `<path d="M${l.x+l.w+4} ${yb} v-70 h6 v62 h14 v8 z" fill="#C8912A"/>`; }
  const wl = wantLayout();
  const wantTop = SHELF.top + SHELF.wantRow * (SHELF.rowH + SHELF.board);
  const wantRowSvg = `<rect x="496" y="${wantTop}" width="532" height="${SHELF.rowH}" fill="#3F2D22"/>
    <rect x="702" y="${wantTop - 18}" width="120" height="26" rx="3" fill="#C8912A"/><rect x="706" y="${wantTop - 14}" width="112" height="18" rx="2" fill="none" stroke="#7F5A1A" stroke-width="1.5"/>
    <text x="762" y="${wantTop + 1}" font-family="${SANS}" font-weight="700" font-size="15" fill="#3E2A1E" text-anchor="middle">입고 예정</text>
    ${wl.items.length ? wl.items.map(spineSvg).join("") : `<text x="762" y="${wantTop + 92}" font-family="${SANS}" font-size="22" fill="#E9DCC2" opacity=".7" text-anchor="middle">입고 예정 책을 담아보세요</text>`}
    ${wl.more ? `<rect x="${SHELF.x1 - 64}" y="${wantTop + SHELF.rowH - 40}" width="60" height="32" rx="4" fill="#F3E6C8"/><text x="${SHELF.x1 - 34}" y="${wantTop + SHELF.rowH - 18}" font-family="${SANS}" font-size="16" fill="#5B3A29" text-anchor="middle">외 ${wl.more}권</text>` : ""}`;
  const emptyMsg = nRead ? "" : `<text x="762" y="${SHELF.top+92}" font-family="${SANS}" font-size="24" fill="#E9DCC2" opacity=".75" text-anchor="middle">첫 책을 꽂아보세요</text>`;
  const menu = (data.menu || "").split("\n").map(s => s.trim()).filter(Boolean).slice(0,3);
  const planks = Array.from({length: 13}, (_, i) => `<line x1="${i*90+(i%2?20:0)}" y1="1104" x2="${i*90-40+(i%2?20:0)}" y2="1350" stroke="#86593A" stroke-width="2"/>`).join("");
  const breads = [[285,742],[330,738],[375,744],[300,778],[350,780],[400,776]].map(([x,y],i)=>`<ellipse cx="${x}" cy="${y}" rx="${i%3===1?20:17}" ry="11" fill="${i%2?"#B5732F":"#CF9150"}"/><path d="M${x-9} ${y-3} q9 -6 18 0" stroke="#F1D2A0" stroke-width="2" fill="none"/>`).join("");
  const mugs = [262,312,362].map((x,i)=>`<rect x="${x}" y="584" width="34" height="26" rx="4" fill="${["#E8E2D6","#3F6E9E","#E8E2D6"][i]}"/><path d="M${x+34} 590 q12 6 0 14" stroke="#8C8C80" stroke-width="3" fill="none"/>`).join("");
  const recCols = todayBooks().slice(0, 3).map(b => spine(b).color).concat(["#2F4F6F", "#9A3F4F", "#C58B2C"]).slice(0, 3);
  const miniBooks = recCols.map((c, i) => `<rect x="${74 + i * 44}" y="${572 + (i % 2) * 2}" width="34" height="${38 - (i % 2) * 2}" fill="${c}" transform="rotate(${i - 1} ${91 + i * 44} 610)"/><rect x="${78 + i * 44}" y="580" width="26" height="2" fill="#F5EEDD" opacity=".6" transform="rotate(${i - 1} ${91 + i * 44} 610)"/>`).join("");

  // 가판대: two slanted ledges, 5 covers each
  const rack = reading.slice(0, 10).map((b, i) => coverSvg(b, 590 + (i % 5) * 82, i < 5 ? 1128 : 1216, i)).join("");
  const rackLabel = reading.length > 10 ? `지금 읽는 책 외 ${reading.length - 10}권` : "지금 읽는 책";

  return `
  <defs>
    <radialGradient id="glow" cx="50%" cy="0%" r="70%"><stop offset="0" stop-color="#FFE7A8" stop-opacity=".5"/><stop offset="1" stop-color="#FFE7A8" stop-opacity="0"/></radialGradient>
    <linearGradient id="glassShine" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".28"/><stop offset=".5" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="1" stop-color="#FFFFFF" stop-opacity=".12"/></linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9C6B43"/><stop offset="1" stop-color="#7F5434"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#6F7E91"/>${wallTexture()}
  <rect width="${W}" height="56" fill="#2B3646"/>
  <rect y="1100" width="${W}" height="250" fill="url(#floor)"/>${planks}
  <rect y="1092" width="${W}" height="12" fill="#5B3A29"/>

  ${stainedGlass()}

  ${[150,330].map(x=>`<line x1="${x}" y1="56" x2="${x}" y2="168" stroke="#2A2F2C" stroke-width="2"/><ellipse cx="${x}" cy="300" rx="190" ry="240" fill="url(#glow)" opacity="${lampsOn() ? 1 : .55}"/><path d="M${x-34} 200 L${x-14} 166 H${x+14} L${x+34} 200 Z" fill="#C8912A"/><ellipse cx="${x}" cy="202" rx="10" ry="6" fill="#FFF3CC"/>`).join("")}

  <rect x="300" y="76" width="480" height="100" rx="10" fill="#5B3A29"/>
  <rect x="312" y="88" width="456" height="76" rx="6" fill="none" stroke="#C8912A" stroke-width="2"/>
  <text x="540" y="136" font-family="${SERIF}" font-weight="800" font-size="46" fill="#F3E6C8" text-anchor="middle">${esc(data.shopName)}</text>
  <text x="540" y="160" font-family="${SANS}" font-size="15" fill="#F3E6C8" fill-opacity=".8" text-anchor="middle">since ${openDot()}</text>

  <rect x="60" y="610" width="360" height="14" fill="#8A5A33"/><rect x="60" y="610" width="360" height="3" fill="#A87A4E"/>${miniBooks}${mugs}
  <rect x="80" y="630" width="120" height="32" rx="3" fill="#C9A46A"/><rect x="84" y="634" width="112" height="24" rx="2" fill="none" stroke="#8A6A3A" stroke-width="1.5"/>
  <text x="140" y="654" font-family="${PEN}" font-size="26" fill="#3E2A1E" text-anchor="middle">${esc(cut(recName(), 7))}</text>

  <rect x="70" y="690" width="160" height="110" rx="6" fill="#AEB5B6"/>
  <rect x="70" y="690" width="160" height="22" rx="6" fill="#8F9798"/>
  <rect x="96" y="730" width="22" height="16" fill="#4A4F50"/><rect x="182" y="730" width="22" height="16" fill="#4A4F50"/>
  <rect x="98" y="770" width="20" height="26" rx="3" fill="#F2EFE8"/><rect x="184" y="770" width="20" height="26" rx="3" fill="#F2EFE8"/>
  <circle cx="150" cy="740" r="9" fill="#C8912A"/>

  <rect x="255" y="702" width="180" height="98" rx="4" fill="#FFFFFF" fill-opacity=".38" stroke="#8E9A94" stroke-width="3"/>
  <line x1="258" y1="760" x2="432" y2="760" stroke="#8E9A94" stroke-width="2"/>${breads}

  <rect x="30" y="800" width="420" height="26" fill="#ECE7DC"/>
  <rect x="40" y="826" width="400" height="270" fill="#2F4F74"/>
  ${[90,190,290,390].map(x=>`<line x1="${x}" y1="836" x2="${x}" y2="1086" stroke="#284466" stroke-width="3"/>`).join("")}
  <rect x="84" y="866" width="312" height="180" rx="4" fill="#A9784A"/>
  <rect x="94" y="876" width="292" height="160" fill="#22324A"/>
  <text x="240" y="918" font-family="${PEN}" font-size="40" fill="#EDEAE0" text-anchor="middle">오늘의 메뉴</text>
  ${menu.map((m,i)=>`<text x="240" y="${960+i*32}" font-family="${PEN}" font-size="31" fill="#EDEAE0" fill-opacity=".92" text-anchor="middle">${esc(cut(m,12))}</text>`).join("")}

  <rect x="478" y="196" width="568" height="904" fill="#5B3A29"/>
  <rect x="496" y="214" width="532" height="870" fill="#33251C"/>
  ${shelfBoards}${wantRowSvg}${emptyMsg}
  ${items.map(spineSvg).join("")}${bookend}

  <path d="M452 1092 l6 -48 h22 l6 48 z" fill="#B5543C"/>
  <path d="M468 1046 q-30 -50 -8 -90 M470 1046 q4 -60 26 -84 M466 1046 q-12 -40 -40 -52" stroke="#4E7A55" stroke-width="7" fill="none" stroke-linecap="round"/>

  ${interiorLight()}
  <!-- 의자, 작은 테이블, 아이스 커피 -->
  <rect x="340" y="1056" width="10" height="240" fill="#7A4A2A"/><rect x="392" y="1070" width="9" height="120" fill="#7A4A2A"/>
  <rect x="340" y="1060" width="60" height="14" rx="3" fill="#8A5A33"/><rect x="342" y="1104" width="56" height="10" rx="3" fill="#8A5A33"/>
  <rect x="334" y="1182" width="78" height="14" rx="3" fill="#9B6A3E"/>
  <rect x="338" y="1196" width="8" height="104" fill="#6B3E22"/><rect x="400" y="1196" width="8" height="104" fill="#6B3E22"/>
  <ellipse cx="488" cy="1178" rx="76" ry="15" fill="#A8774A"/><rect x="412" y="1178" width="152" height="8" fill="#8A5A33"/><ellipse cx="488" cy="1186" rx="76" ry="15" fill="#8A5A33" opacity=".5"/>
  <rect x="482" y="1190" width="12" height="100" fill="#5B3A29"/><ellipse cx="488" cy="1292" rx="42" ry="8" fill="#4A2E20"/>
  <path d="M452 1110 L478 1110 L474 1172 L456 1172 Z" fill="#FFFFFF" fill-opacity=".38" stroke="#E5ECF2" stroke-width="2"/>
  <path d="M455 1128 L475 1128 L473 1170 L457 1170 Z" fill="#6B3E22"/>
  <rect x="459" y="1130" width="7" height="7" fill="#FFFFFF" opacity=".55"/><rect x="466" y="1140" width="6" height="6" fill="#FFFFFF" opacity=".5"/>
  <line x1="468" y1="1096" x2="464" y2="1150" stroke="#E9E2D6" stroke-width="3"/>
  <rect x="500" y="1158" width="52" height="11" rx="1" fill="#2F4F74" transform="rotate(-4 526 1163)"/>

  <!-- 가판대 (reading) -->
  <path d="M580 1116 H1006 L1016 1300 H570 Z" fill="#A9784A"/>
  <path d="M580 1116 H1006 L1008 1132 H578 Z" fill="#C49466"/>
  <rect x="574" y="1206" width="438" height="12" fill="#7F5434"/>
  <rect x="570" y="1294" width="446" height="12" fill="#7F5434"/>
  <rect x="590" y="1306" width="12" height="36" fill="#5B3A29"/><rect x="984" y="1306" width="12" height="36" fill="#5B3A29"/>
  <rect x="692" y="1088" width="200" height="34" rx="4" fill="#F3E6C8"/>
  <text x="792" y="1112" font-family="${SANS}" font-size="19" fill="#5B3A29" text-anchor="middle">${rackLabel}</text>
  ${reading.length ? rack : `<text x="792" y="1180" font-family="${SANS}" font-size="20" fill="#F3E6C8" opacity=".85" text-anchor="middle">읽고 있는 책을 올려두세요</text>`}


  <text x="44" y="1236" font-family="${SERIF}" font-weight="700" font-size="34" fill="#F7EEDC">읽은 책 ${nRead}권</text>
  <text x="44" y="1274" font-family="${SANS}" font-size="21" fill="#F7EEDC" fill-opacity=".88">읽는 중 ${reading.length}권, 입고 예정 ${wants.length}권</text>
  <text x="44" y="1306" font-family="${SANS}" font-size="19" fill="#F7EEDC" fill-opacity=".75">${dot(today())} · ${openLine()}${pg.length > 1 ? `  책장 ${page+1}/${pg.length}` : ""}</text>
  ${exp ? "" : `<g class="nav" data-nav="out" role="button" aria-label="밖으로 나가기"><rect x="34" y="92" width="190" height="58" rx="29" fill="#1C2A3A" fill-opacity=".82"/><text x="129" y="130" font-family="${SANS}" font-size="24" fill="#F7EEDC" text-anchor="middle">← 밖으로</text></g>
  <g class="nav" data-nav="today" role="button" aria-label="추천 책으로"><rect x="836" y="160" width="210" height="58" rx="29" fill="#C8912A" fill-opacity=".95"/><text x="941" y="198" font-family="${SANS}" font-size="22" fill="#1C2A3A" text-anchor="middle">${esc(cut(recName(), 7))} →</text></g>
  <g class="nav" data-nav="wall" role="button" aria-label="입고 예정으로"><rect x="836" y="92" width="210" height="58" rx="29" fill="#1C2A3A" fill-opacity=".82"/><text x="941" y="130" font-family="${SANS}" font-size="24" fill="#F7EEDC" text-anchor="middle">입고 예정 →</text></g>`}`;
}

/* ---------- 시간대 · 날씨 (이천시 호법면) ---------- */
const WX = { lat: 37.207, lon: 127.437, place: "이천 호법" };
let wx = null;
try { wx = JSON.parse(localStorage.getItem("bs_wx_v1") || "null"); } catch { wx = null; }
const toMin = s => { const m = String(s || "").match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
function wxKind(){
  const c = wx ? wx.code : 0;
  if (c >= 95) return "storm";
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow";
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return "rain";
  if (c === 45 || c === 48) return "fog";
  if (c >= 2) return "cloud";
  return "clear";
}
const WX_LABEL = { clear: "맑음", cloud: "흐림", fog: "안개", rain: "비", snow: "눈", storm: "천둥번개" };
const wxLabel = () => (wx && wx.code === 1) ? "구름 조금" : (wx && wx.code === 2) ? "구름 많음" : WX_LABEL[wxKind()];
function dayPhase(){
  const now = new Date(), m = now.getHours() * 60 + now.getMinutes();
  const sr = toMin(wx && wx.sunrise) ?? 400, ss = toMin(wx && wx.sunset) ?? 1070;
  if (m < sr - 25 || m > ss + 35) return "night";
  if (m < sr + 30) return "dawn";
  if (m > ss - 50) return "dusk";
  if (m < 11 * 60) return "morning";
  return "day";
}
const lampsOn = () => { const p = dayPhase(); return p === "night" || p === "dusk" || wxKind() === "storm"; };
const wxText = () => wx ? `${WX.place} ${wxLabel()} ${wx.temp}°` : "";
async function fetchWx(){
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${WX.lat}&longitude=${WX.lon}&current=temperature_2m,weather_code&daily=sunrise,sunset&timezone=Asia%2FSeoul&forecast_days=1`;
    const r = await fetch(u, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
    if (!r.ok) throw 0;
    const j = await r.json();
    wx = { code: Number(j.current.weather_code) || 0, temp: Math.round(j.current.temperature_2m), sunrise: String(j.daily.sunrise[0]).slice(11, 16), sunset: String(j.daily.sunset[0]).slice(11, 16), at: Date.now() };
    try { localStorage.setItem("bs_wx_v1", JSON.stringify(wx)); } catch {}
  } catch {}
  if (!rec) renderAll();
}
let lastPhaseKey = "";
setInterval(() => {
  if (rec || document.visibilityState !== "visible") return;
  if (!wx || Date.now() - wx.at > 30 * 60000) { fetchWx(); return; }
  const k = dayPhase() + wxKind();
  if (k !== lastPhaseKey) { lastPhaseKey = k; renderScene(); }
}, 5 * 60000);

/* 떨어지는 비·눈 (화면에서는 움직이고, 저장 그림에는 멈춘 모습) */
function fallSvg(kind, x, y, w, h, seed){
  if (kind !== "rain" && kind !== "storm" && kind !== "snow") return "";
  const snow = kind === "snow", n = Math.round(w * h / (snow ? 5200 : 2600));
  let s = "";
  for (let i = 0; i < n; i++) {
    const hh = hash(seed + i), px = x + hh % w, py = y - 60 + (hh >> 10) % (h + 60);
    s += snow ? `<circle cx="${px}" cy="${py}" r="${2 + hh % 4}" fill="#FFFFFF" opacity=".85"/>`
              : `<line x1="${px}" y1="${py}" x2="${px - 8}" y2="${py + 26}" stroke="#DDE8F4" stroke-width="2" opacity=".55"/>`;
  }
  return `<g pointer-events="none"><g class="${snow ? "wx-snow" : "wx-rain"}">${s}<g transform="translate(0 ${-h})">${s}</g></g></g>`;
}

/* ---------- facade ---------- */
function facadeFx(){
  const p = dayPhase(), k = wxKind(), on = lampsOn();
  const holes = "M60 352 h560 v810 h-560 z M644 352 h376 v70 h-376 z M712 488 h240 v276 h-240 z M560 150 h480 v130 h-480 z";
  const dark = { night: .62, dusk: .3, dawn: .22, morning: 0, day: 0 }[p] + ({ rain: .12, storm: .22, cloud: .08, fog: .04, snow: .05, clear: 0 }[k]);
  const tint = p === "dusk" ? "#3A2440" : p === "dawn" ? "#3A2E44" : "#0B1424";
  let s = "";
  if ((p === "morning" || p === "dawn") && (k === "clear" || k === "cloud")) {
    const a = k === "clear" ? 1 : .5;
    s += `<g pointer-events="none" opacity="${a}"><rect width="${W}" height="${H}" fill="#FFE2A8" opacity=".08"/>
      ${[[-120, 260], [140, 170], [420, 230], [720, 150]].map(([x, w], i) => `<path d="M${x} 0 h${w} L${x + w + 520} ${H} h-${w + 120} Z" fill="#FFF3D1" opacity="${(.13 - i * .02).toFixed(2)}"/>`).join("")}</g>`;
  }
  if (p === "day" && k === "clear") s += `<rect width="${W}" height="${H}" fill="#FFF6DD" opacity=".05" pointer-events="none"/>`;
  if (dark > 0) s += `<path d="M0 0 H${W} V${H} H0 Z ${holes}" fill-rule="evenodd" fill="${tint}" opacity="${Math.min(.75, dark).toFixed(2)}" pointer-events="none"/>`;
  if (on) {
    s += `<g pointer-events="none">${[536, 1060].map(x => `<circle cx="${x}" cy="236" r="70" fill="#FFE6A0" opacity=".18"/><circle cx="${x}" cy="236" r="28" fill="#FFE6A0" opacity=".35"/><path d="M${x - 10} 248 L${x - 90} 520 H${x + 90} L${x + 10} 248 Z" fill="#FFE6A0" opacity=".12"/>`).join("")}
      <rect x="560" y="150" width="480" height="130" rx="16" fill="#FFE9A8" opacity=".12"/>
      <rect x="60" y="1192" width="560" height="140" fill="#FFE2A8" opacity=".10"/></g>`;
  }
  if (k === "cloud") s += `<rect width="${W}" height="${H}" fill="#8796A8" opacity=".10" pointer-events="none"/>`;
  if (k === "fog") s += `<rect width="${W}" height="${H}" fill="#E8EDF2" opacity=".38" pointer-events="none"/>`;
  if (k === "rain" || k === "storm") s += `<g pointer-events="none"><rect y="1192" width="${W}" height="158" fill="#3A4656" opacity=".25"/>${[120, 360, 700, 940].map((x, i) => `<ellipse cx="${x}" cy="${1250 + (i % 2) * 50}" rx="${70 + i * 8}" ry="10" fill="#C9D6E4" opacity=".3"/>`).join("")}</g>`;
  if (k === "snow") s += `<g pointer-events="none"><rect y="1186" width="${W}" height="30" fill="#FFFFFF" opacity=".85"/><rect x="560" y="142" width="480" height="12" rx="6" fill="#FFFFFF"/><rect x="486" y="984" width="108" height="10" rx="5" fill="#FFFFFF"/></g>`;
  s += fallSvg(k, 0, 0, W, H, "fx");
  if (k === "storm" && p !== "day") s += `<path d="M180 0 l-40 120 h30 l-50 140 l110 -170 h-34 l40 -90 z" fill="#FFF7C8" opacity=".55" pointer-events="none"/>`;
  if (wx) s += `<g pointer-events="none"><rect x="36" y="1250" width="${36 + wxText().length * 21}" height="54" rx="27" fill="#0B1424" opacity=".55"/><text x="58" y="1286" font-family="${SANS}" font-size="25" fill="#FFFFFF">${esc(wxText())}</text></g>`;
  return s;
}
function facadeBody(exp){
  const books = readBooks().slice(-48);
  const fill = i => books.length ? spine(books[i % books.length]).color : PALETTE[i % PALETTE.length];
  let spinesSvg = "";
  [[176, 548], [176, 668], [176, 788]].forEach(([x0, yb], r) => {
    let x = x0;
    for (let i = 0; x < 548; i++) { const k = r * 17 + i, h = hash("f" + k), w = 14 + h % 9, hh = 66 + (h >> 4) % 30;
      if (h % 7 === 0) { x += 18; continue; }
      spinesSvg += `<rect x="${x}" y="${yb - hh}" width="${w}" height="${hh}" fill="${fill(k)}"/>`; x += w + 2; }
  });
  let doorSpines = ""; let dx = 820;
  for (let i = 0; dx < 948; i++) { const h = hash("d" + i), w = 12 + h % 7, hh = 40 + (h >> 3) % 20; doorSpines += `<rect x="${dx}" y="${640 - hh}" width="${w}" height="${hh}" fill="${fill(i + 5)}"/>`; dx += w + 2; }
  dx = 820;
  for (let i = 0; dx < 948; i++) { const h = hash("e" + i), w = 12 + h % 7, hh = 40 + (h >> 3) % 20; doorSpines += `<rect x="${dx}" y="${730 - hh}" width="${w}" height="${hh}" fill="${fill(i + 21)}"/>`; dx += w + 2; }
  const joints = Array.from({length: 6}, (_, i) => `<line x1="0" y1="${110 + i * 200}" x2="${W}" y2="${110 + i * 200}" stroke="#25292C" stroke-width="3"/>`).join("")
    + [250, 540, 830].map((x, i) => `<line x1="${x + (i % 2) * 60}" y1="0" x2="${x + (i % 2) * 60}" y2="330" stroke="#25292C" stroke-width="3"/>`).join("");
  const paving = Array.from({length: 9}, (_, i) => `<line x1="${i * 140 - 30}" y1="1192" x2="${i * 140 - 90}" y2="1350" stroke="#7F848A" stroke-width="2"/>`).join("") + `<line x1="0" y1="1268" x2="${W}" y2="1268" stroke="#7F848A" stroke-width="2"/>`;
  return `
  <defs>
    <linearGradient id="fWarm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FBF0D6"/><stop offset="1" stop-color="#E8D0A2"/></linearGradient>
    <linearGradient id="fGlass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".22"/><stop offset=".45" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="1" stop-color="#FFFFFF" stop-opacity=".08"/></linearGradient>
    <radialGradient id="fSignGlow" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="#FFE9A8" stop-opacity=".45"/><stop offset="1" stop-color="#FFE9A8" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#2F3337"/>${joints}
  <ellipse cx="800" cy="215" rx="330" ry="140" fill="url(#fSignGlow)"/>
  <rect x="560" y="150" width="480" height="130" rx="16" fill="#D9DCE0"/>
  <rect x="576" y="166" width="448" height="98" rx="8" fill="#FFF3C9"/>
  <text x="800" y="236" font-family="${SERIF}" font-weight="800" font-size="56" fill="#3A2F25" text-anchor="middle">${esc(data.shopName)}</text>
  <text x="800" y="314" font-family="${SANS}" font-size="22" fill="#D9DCE0" text-anchor="middle">since ${openDot()}</text>
  ${[536, 1060].map(x => `<rect x="${x - 3}" y="196" width="6" height="22" fill="#1E2226"/><path d="M${x - 14} 218 h28 l-4 34 h-20 z" fill="#2A2E33"/><rect x="${x - 9}" y="224" width="18" height="24" rx="2" fill="${lampsOn() ? "#FFE6A0" : "#8C9196"}"/>`).join("")}

  <rect x="36" y="330" width="1008" height="856" fill="#DADDE0"/>
  <rect x="60" y="352" width="560" height="810" fill="url(#fWarm)"/>
  <rect x="140" y="372" width="140" height="10" rx="5" fill="#FFFFFF"/><rect x="400" y="372" width="140" height="10" rx="5" fill="#FFFFFF"/>
  <rect x="160" y="450" width="400" height="360" fill="#7A5236"/>
  <rect x="170" y="460" width="380" height="340" fill="#F3E4C3"/>
  ${[548, 668, 788].map(y => `<rect x="160" y="${y}" width="400" height="12" fill="#7A5236"/>`).join("")}
  ${spinesSvg}
  <text x="340" y="432" font-family="${SERIF}" font-weight="700" font-size="54" fill="#5B7FB8" fill-opacity=".8" text-anchor="middle">${esc(data.shopName)}</text>
  <path d="M74 1162 V990 q0 -60 70 -60 h90 q70 0 70 60 v40 h20 v132 z" fill="#9C6236"/>
  <path d="M104 1040 h170 v122 h-170 z" fill="#B57744"/>
  <rect x="400" y="960" width="210" height="202" fill="#A7C9C4"/><rect x="392" y="944" width="226" height="18" fill="#F2F0EA"/>
  <rect x="430" y="922" width="60" height="22" fill="${fill(3)}"/><rect x="496" y="928" width="50" height="16" fill="${fill(9)}"/>
  <line x1="505" y1="352" x2="505" y2="840" stroke="#3A3A3A" stroke-width="2"/><path d="M470 880 L490 840 H520 L540 880 Z" fill="#E9E2D2"/>
  <rect x="60" y="352" width="560" height="810" fill="url(#fGlass)"/>
  <path d="M60 352 L230 352 L60 640 Z" fill="#FFFFFF" opacity=".1"/>

  <g class="nav" data-nav="in" role="button" aria-label="문을 열고 들어가기">
    <rect x="644" y="352" width="376" height="70" fill="url(#fWarm)"/>
    <rect x="656" y="432" width="352" height="732" fill="#2F6FA8"/>
    <rect x="700" y="476" width="264" height="300" fill="#235A8C"/>
    <rect x="712" y="488" width="240" height="276" fill="url(#fWarm)"/>
    <rect x="810" y="560" width="142" height="10" fill="#E8E2D6"/><rect x="810" y="650" width="142" height="10" fill="#E8E2D6"/><rect x="810" y="740" width="142" height="10" fill="#E8E2D6"/>
    ${doorSpines.replace(/y="(\d+)"/g, (m, v) => `y="${v}"`)}
    <line x1="760" y1="500" x2="760" y2="640" stroke="#4A4A4A" stroke-width="3"/><circle cx="760" cy="500" r="16" fill="#F4F1E8"/>
    <rect x="712" y="488" width="240" height="276" fill="url(#fGlass)"/>
    <rect x="806" y="800" width="64" height="14" rx="3" fill="#C9CCCF"/>
    <circle cx="690" cy="830" r="11" fill="#E2E4E6"/>
    <rect x="700" y="850" width="118" height="270" fill="none" stroke="#235A8C" stroke-width="8"/>
    <rect x="846" y="850" width="118" height="270" fill="none" stroke="#235A8C" stroke-width="8"/>
  </g>
  <rect x="620" y="352" width="24" height="810" fill="#DADDE0"/>

  <rect y="1176" width="${W}" height="16" fill="#3A3E42"/>
  <rect y="1192" width="${W}" height="158" fill="#9A9EA3"/>${paving}
  <g class="nav" data-nav="in" role="button" aria-label="책방으로 들어가기">
    <path d="M470 1240 L488 990 H592 L610 1240 Z" fill="#4A3426"/>
    <rect x="496" y="1004" width="88" height="200" fill="#5B3A29"/>
    <text x="540" y="1100" font-family="${SERIF}" font-weight="700" font-size="64" fill="#8FB4E8" text-anchor="middle">책</text>
    <text x="540" y="1176" font-family="${SANS}" font-size="18" fill="#F3E6C8" text-anchor="middle">${esc(cut(data.shopName, 6))}</text>
  </g>
  ${facadeFx()}
  ${exp ? "" : `<g class="nav" data-nav="in"><rect x="690" y="1238" width="300" height="60" rx="30" fill="#000" fill-opacity=".45"/><text x="840" y="1277" font-family="${SANS}" font-size="25" fill="#FFFFFF" text-anchor="middle">문을 눌러 들어가기</text></g>`}`;
}

/* ---------- to-buy wall ---------- */
const WALL_PER = 6;
function wallItems(){
  const all = wantBooks(), pagesN = Math.max(1, Math.ceil(all.length / WALL_PER));
  wallPage = Math.min(wallPage, pagesN - 1);
  const items = all.slice(wallPage * WALL_PER, (wallPage + 1) * WALL_PER).map((b, i) => ({ b, x: 430 + (i % 2) * 310, y: 150 + Math.floor(i / 2) * 350 }));
  return { items, pagesN, total: all.length };
}
function wallCoverSvg(it){
  const { b, x, y } = it; if (hiddenIds.has(b.id)) return "";
  const s = spine(b), src = coverSrc(b), txt = isLight(s.color) ? "#2A2420" : "#F5EEDD";
  const t = [...b.title]; const lines = [];
  for (let k = 0; k < t.length && lines.length < 5; k += 6) lines.push(t.slice(k, k + 6).join(""));
  if (t.length > 30) lines[4] = lines[4].slice(0, 5) + "…";
  return `<g transform="translate(${x},${y})"><g class="${bookCls(b.id)}" data-id="${esc(b.id)}" tabindex="0" role="button" aria-label="${esc(b.title)} 살펴보기">
    <rect width="200" height="290" fill="${s.color}"/>
    ${src ? `<image href="${esc(src)}" width="200" height="290" preserveAspectRatio="xMidYMid slice"/>`
      : `<rect y="26" width="200" height="8" fill="#000" opacity=".16"/>
         <text font-family="${SERIF}" font-weight="700" font-size="27" fill="${txt}" text-anchor="middle">${lines.map((l, k) => `<tspan x="100" y="${86 + k * 34}">${esc(l)}</tspan>`).join("")}</text>
         ${b.author ? `<text x="100" y="262" font-family="${SANS}" font-size="17" fill="${txt}" fill-opacity=".85" text-anchor="middle">${esc(cut(b.author, 12))}</text>` : ""}`}
    <rect width="200" height="290" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="2"/>
  </g></g>`;
}
function wallBody(exp){
  const { items, pagesN, total } = wallItems();
  const rows = [0, 1, 2].filter(r => items.some((_, i) => Math.floor(i / 2) === r) || !items.length && r < 3);
  const racks = [0, 1, 2].map(r => { const bottom = 150 + r * 350 + 290;
    return `<g pointer-events="none"><rect x="400" y="${bottom - 84}" width="630" height="96" rx="5" fill="#FFFFFF" fill-opacity=".3" stroke="#BCC8CE" stroke-width="3"/>
      <line x1="406" y1="${bottom - 80}" x2="1024" y2="${bottom - 80}" stroke="#FFFFFF" stroke-opacity=".9" stroke-width="3"/>
      <rect x="400" y="${bottom + 12}" width="630" height="6" fill="#B9C4C9" opacity=".5"/></g>`; });
  return `
  <defs><linearGradient id="wWall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F4F3EF"/><stop offset="1" stop-color="#E2E0DA"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#wWall)"/>
  <rect y="1232" width="${W}" height="118" fill="#CDB693"/><rect y="1222" width="${W}" height="12" fill="#DAD6CD"/>
  <g transform="rotate(-3 200 560)">
    <rect x="70" y="420" width="260" height="280" fill="#A9C8E8"/>
    <rect x="58" y="408" width="70" height="24" fill="#D6E6F5" opacity=".85" transform="rotate(-20 93 420)"/>
    <rect x="276" y="408" width="70" height="24" fill="#D6E6F5" opacity=".85" transform="rotate(18 311 420)"/>
    <text x="200" y="545" font-family="${SERIF}" font-weight="700" font-size="44" fill="#1C2A3A" text-anchor="middle">입고 예정</text>
    <text x="200" y="608" font-family="${SANS}" font-size="30" fill="#1C2A3A" text-anchor="middle">${total}권</text>
  </g>
  ${[0, 1, 2].map(i => `<rect x="${130 + i * 46}" y="712" width="30" height="96" fill="#FFFFFF" transform="rotate(${i - 1} ${145 + i * 46} 712)"/><text x="${145 + i * 46}" y="790" font-family="${SANS}" font-size="16" fill="#6B7F3A" text-anchor="middle" transform="rotate(${i - 1} ${145 + i * 46} 712)">♣</text>`).join("")}
  ${items.length ? items.map(wallCoverSvg).join("") : `<text x="715" y="560" font-family="${SANS}" font-size="28" fill="#8A8578" text-anchor="middle">입고 예정 책을 담으면</text><text x="715" y="604" font-family="${SANS}" font-size="28" fill="#8A8578" text-anchor="middle">이 벽에 진열돼요</text>`}
  ${racks.join("")}
  ${pagesN > 1 ? `<text x="200" y="880" font-family="${SANS}" font-size="24" fill="#6E6A60" text-anchor="middle">${wallPage + 1} / ${pagesN}</text>` : ""}
  ${exp ? "" : `<g class="nav" data-nav="in" role="button" aria-label="책방으로 돌아가기"><rect x="40" y="1252" width="230" height="62" rx="31" fill="#1C2A3A"/><text x="155" y="1292" font-family="${SANS}" font-size="25" fill="#F7EEDC" text-anchor="middle">← 책방으로</text></g>`}`;
}
/* ---------- today's picks ---------- */
const todayBooks = () => {
  const picked = data.today.ids.map(id => data.books.find(b => b.id === id)).filter(b => b && b.status !== "hidden");
  return picked.length ? picked : readingBooks().slice(0, 5);   // 고른 책이 없으면 지금 읽는 책
};
function todayItems(){
  const bs = todayBooks(), n = bs.length;
  if (!n) return [];
  if (n <= 3) { const w = n === 1 ? 320 : n === 2 ? 280 : 240, h = Math.round(w * 1.44), gap = 50, total = n * w + (n - 1) * gap;
    return bs.map((b, i) => ({ b, x: (W - total) / 2 + i * (w + gap), y: 1060 - h, w, h })); }
  const top = Math.ceil(n / 2), w = 200, h = 288, gap = 46;
  return bs.map((b, i) => { const row = i < top ? 0 : 1, cnt = row ? n - top : top, j = row ? i - top : i, total = cnt * w + (cnt - 1) * gap;
    return { b, x: (W - total) / 2 + j * (w + gap), y: (row ? 1060 : 660) - h, w, h }; });
}
function bigCoverSvg(it){
  const { b, x, y, w, h } = it; if (hiddenIds.has(b.id)) return "";
  const s = spine(b), src = coverSrc(b), txt = isLight(s.color) ? "#2A2420" : "#F5EEDD", k = w / 200;
  const t = [...b.title]; const lines = [];
  for (let i = 0; i < t.length && lines.length < 5; i += 6) lines.push(t.slice(i, i + 6).join(""));
  if (t.length > 30) lines[4] = lines[4].slice(0, 5) + "…";
  return `<g transform="translate(${x},${y})"><g class="${bookCls(b.id)}" data-id="${esc(b.id)}" tabindex="0" role="button" aria-label="${esc(b.title)} 살펴보기">
    <rect width="${w}" height="${h}" fill="${s.color}"/>
    ${src ? `<image href="${esc(src)}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`
      : `<rect y="${26*k}" width="${w}" height="${8*k}" fill="#000" opacity=".16"/>
         <text font-family="${SERIF}" font-weight="700" font-size="${27*k}" fill="${txt}" text-anchor="middle">${lines.map((l, i) => `<tspan x="${w/2}" y="${(86 + i * 34) * k}">${esc(l)}</tspan>`).join("")}</text>
         ${b.author ? `<text x="${w/2}" y="${h - 28*k}" font-family="${SANS}" font-size="${17*k}" fill="${txt}" fill-opacity=".85" text-anchor="middle">${esc(cut(b.author, 12))}</text>` : ""}`}
    <rect width="${w}" height="${h}" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="2"/>
  </g></g>`;
}
function todayBody(exp){
  const items = todayItems(), two = items.length > 3, LY = two ? 110 : 250, SY = two ? 136 : 300;
  const lights = items.map(it => `<path d="M${it.x + it.w/2 - 40} ${LY} L${it.x - 30} ${it.y + it.h} H${it.x + it.w + 30} L${it.x + it.w/2 + 40} ${LY} Z" fill="#FFF6DC" opacity=".22"/>`).join("");
  const shadows = items.map(it => `<ellipse cx="${it.x + it.w/2}" cy="${it.y + it.h + 4}" rx="${it.w * 0.55}" ry="10" fill="#000" opacity=".22"/>
    <path d="M${it.x + it.w*0.2} ${it.y + it.h} L${it.x + it.w*0.5} ${it.y + it.h*0.35} L${it.x + it.w*0.8} ${it.y + it.h} Z" fill="#5B3A29"/>`).join("");
  return `
  <defs><linearGradient id="tWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E4EAF1"/><stop offset="1" stop-color="#C6D1DE"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#tWall)"/>
  ${[220, 540, 860].map(x => `<rect x="${x - 3}" y="0" width="6" height="${LY}" fill="#3E4A44"/><path d="M${x - 40} ${LY} L${x - 22} ${LY - 24} H${x + 22} L${x + 40} ${LY} Z" fill="#22324A"/>`).join("")}
  ${lights}
  <rect x="200" y="${SY}" width="680" height="190" rx="8" fill="#A9784A"/>
  <rect x="214" y="${SY + 14}" width="652" height="162" fill="#22324A"/>
  <text x="540" y="${SY + 110}" font-family="${SERIF}" font-weight="700" font-size="54" fill="#F3EEDF" text-anchor="middle">${esc(cut(todayLabel(), 16))}</text>
  <text x="540" y="${SY + 156}" font-family="${SANS}" font-size="24" fill="#F3EEDF" fill-opacity=".7" text-anchor="middle">${esc(data.shopName)}, ${dot(today())}</text>
  ${two ? `<rect x="150" y="660" width="780" height="22" fill="#A9784A"/><rect x="170" y="682" width="16" height="378" fill="#7F5434"/><rect x="894" y="682" width="16" height="378" fill="#7F5434"/>` : ""}
  <rect x="70" y="1060" width="940" height="30" fill="#A9784A"/>
  <rect x="90" y="1090" width="900" height="200" fill="#8A5E3E"/>
  <rect x="90" y="1090" width="900" height="8" fill="#000" opacity=".15"/>
  ${shadows}
  ${items.length ? items.map(bigCoverSvg).join("") : `<text x="540" y="800" font-family="${SANS}" font-size="30" fill="#6E6152" text-anchor="middle">곧 추천 책이 진열돼요</text>`}
  ${exp ? "" : `<g class="nav" data-nav="in" role="button" aria-label="책방으로 돌아가기"><rect x="40" y="1252" width="230" height="62" rx="31" fill="#1C2A3A"/><text x="155" y="1292" font-family="${SANS}" font-size="25" fill="#F7EEDC" text-anchor="middle">← 책방으로</text></g>`}`;
}
const viewBody = (v, exp) => v === "out" ? facadeBody(exp) : v === "wall" ? wallBody(exp) : v === "today" ? todayBody(exp) : sceneBody(exp);

/* ---------- shopping list card ---------- */
function listCardSvg(books, pIdx, pTotal){
  const total = wantBooks().length;
  const band = Array.from({length: 40}, (_, i) => { const h = hash("band" + i); const w = 20 + h % 14; return { w, h: 56 + (h >> 4) % 30, c: PALETTE[h % PALETTE.length] }; });
  let x = 0; const bandSvg = band.map(s => { const r = `<rect x="${x}" y="${92 - s.h}" width="${s.w}" height="${s.h}" fill="${s.c}"/>`; x += s.w + 2; return r; }).join("");
  const rows = books.map((b, i) => {
    const y = 360 + i * 82;
    const sub = [b.author, b.memo].filter(Boolean).join(", "), src = coverSrc(b), sp = spine(b);
    return `<rect x="84" y="${y - 28}" width="30" height="30" rx="3" fill="none" stroke="#5B3A29" stroke-width="3"/>
      <rect x="134" y="${y - 40}" width="44" height="62" rx="2" fill="${sp.color}"/>
      ${src ? `<image href="${esc(src)}" x="134" y="${y - 40}" width="44" height="62" preserveAspectRatio="xMidYMid slice"/>` : ""}
      <text x="198" y="${y}" font-family="${SERIF}" font-size="34" fill="#22302C">${esc(cut(b.title, 22))}</text>
      ${sub ? `<text x="198" y="${y + 32}" font-family="${SANS}" font-size="22" fill="#5E6B66">${esc(cut(sub, 36))}</text>` : ""}
      <line x1="84" y1="${y + 50}" x2="996" y2="${y + 50}" stroke="#D3CBB8" stroke-width="2" stroke-dasharray="6 6"/>`;
  }).join("");
  return `<rect width="${W}" height="${H}" fill="#EFEADF"/>
    <rect width="${W}" height="100" fill="#33251C"/>${bandSvg}<rect y="92" width="${W}" height="10" fill="#6B4632"/>
    <text x="84" y="178" font-family="${SANS}" font-size="26" fill="#5E6B66">${esc(data.shopName)}</text>
    <text x="84" y="250" font-family="${SERIF}" font-weight="700" font-size="66" fill="#22302C">입고 예정 목록</text>
    <text x="996" y="250" font-family="${SANS}" font-size="24" fill="#5E6B66" text-anchor="end">${dot(today())}</text>
    <line x1="84" y1="282" x2="996" y2="282" stroke="#5B3A29" stroke-width="3"/>
    ${rows}
    <line x1="84" y1="1270" x2="996" y2="1270" stroke="#5B3A29" stroke-width="2"/>
    <text x="84" y="1312" font-family="${SERIF}" font-size="28" fill="#22302C">모두 ${total}권</text>
    ${pTotal > 1 ? `<text x="996" y="1312" font-family="${SANS}" font-size="24" fill="#5E6B66" text-anchor="end">${pIdx + 1} / ${pTotal}</text>` : ""}`;
}


/* ===================== 방문객 화면 ===================== */
const VISIT = { url: "", vid: "", loaded: false };
(function setupVisit(){
  const m = location.hash.match(/s=([A-Za-z0-9_-]{20,})/);
  let sid = m ? m[1] : "";
  try { if (sid) localStorage.setItem("bs_visit_s", sid); else sid = localStorage.getItem("bs_visit_s") || ""; } catch {}
  if (sid) VISIT.url = `https://script.google.com/macros/s/${sid}/exec`;
  let v = ""; try { v = localStorage.getItem("bs_vid") || ""; } catch {}
  if (!/^[a-f0-9]{32}$/.test(v)) { v = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join(""); try { localStorage.setItem("bs_vid", v); } catch {} }
  VISIT.vid = v;
})();
async function pubCall(action, params){
  if (!VISIT.url) throw Object.assign(new Error("책방 주소가 올바르지 않아요. 받은 링크를 다시 열어 주세요."), { code: "config" });
  let r;
  try { r = await fetch(VISIT.url, { method: "POST", body: JSON.stringify({ action, payload: JSON.stringify(Object.assign({ vid: VISIT.vid }, params || {})) }), credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", redirect: "follow" }); }
  catch { throw new Error("책방에 연결하지 못했어요. 인터넷을 확인해 주세요."); }
  if (!r.ok) throw new Error("책방 응답 오류 (" + r.status + ")");
  const j = await r.json();
  if (!j.ok) throw Object.assign(new Error(j.error || "오류가 났어요"), { code: j.code });
  return j;
}
function toast(t, ms){ const el = $("#toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("on"), ms || 1800); }
function setNotice(t){ const n = $("#notice"); n.hidden = !t; n.textContent = t || ""; }

function renderScene(){
  const svg = $("#scene");
  svg.innerHTML = viewBody(view, false);
  svg.classList.toggle("picking", !!selectedId);
  const n = view === "in" ? pages().length : view === "wall" ? wallItems().pagesN : 1;
  $("#pager").hidden = n < 2;
  $("#pageInfo").textContent = view === "in" ? `책장 ${page + 1} / ${n}` : `입고 예정 ${wallPage + 1} / ${n}`;
  document.querySelectorAll(".views button").forEach(b => b.setAttribute("aria-selected", b.dataset.view === view));
  justAdded.clear();
}
function renderAll(){
  document.title = data.shopName;
  $("#title").textContent = data.shopName;
  $("#viewTodayBtn").textContent = recName() + " 책";
  $("#sinceText").textContent = `since ${openDot()} · ${openLine()}` + (wx ? ` · ${wxText()}` : "");
  renderScene(); renderDetail();
}
const statusLine = b => b.status === "read" ? `책방지기가 ${b.readDate ? dot(b.readDate) + "에 " : ""}다 읽은 책`
  : b.status === "reading" ? "책방지기가 지금 읽고 있는 책" : "곧 들어올 책 (입고 예정)";
const heartSvg = on => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4h2c.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z" fill="${on ? "#E0245E" : "none"}" stroke="${on ? "#E0245E" : "currentColor"}" stroke-width="1.8"/></svg>`;
function coverHtml(b, cls){
  const src = coverSrc(b), c = spine(b).color;
  return src ? `<img class="${cls}" src="${esc(src)}" alt="${esc(b.title)} 표지">`
    : `<span class="${cls} gen" style="background:${c};color:${isLight(c) ? "#2A2420" : "#F5EEDD"}">${esc(b.title)}${b.author ? `<small>${esc(b.author)}</small>` : ""}</span>`;
}
function updatePop(){
  const el = $("#coverPop"), b = data.books.find(x => x.id === selectedId);
  if (!b || view !== "in") { el.hidden = true; el.innerHTML = ""; el.dataset.id = ""; return; }
  if (el.dataset.id === b.id && !el.hidden) return;
  el.innerHTML = coverHtml(b, "pc");
  el.dataset.id = b.id; el.hidden = false; el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
}
let cmtCache = {};
function renderDetail(){
  updatePop();
  const box = $("#detail"), b = data.books.find(x => x.id === selectedId);
  if (!b) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  let name = ""; try { name = localStorage.getItem("bs_vname") || ""; } catch {}
  box.innerHTML = `<div class="v-top">${coverHtml(b, "vc")}<div class="v-info">
      <h2>${esc(b.title)}</h2><p class="meta">${esc(b.author || "")}</p><p class="meta">${esc(statusLine(b))}</p>
      ${b.memo ? `<blockquote>${esc(b.memo)}</blockquote>` : ""}</div></div>
    <div class="v-actions">
      <button class="heart${b.liked ? " on" : ""}" data-act="like" aria-pressed="${!!b.liked}" aria-label="좋아요">${heartSvg(b.liked)}</button>
      <span class="cnt" id="likeCnt">좋아요 ${b.likes || 0}개</span>
      <span class="cnt">댓글 ${b.comments || 0}개</span>
      <button class="btn text" data-act="share">공유</button>
      <button class="btn text" data-act="close">닫기</button>
    </div>
    <div class="v-cmts" id="cmtList">${cmtCache[b.id] ? "" : "댓글 불러오는 중…"}</div>
    <div class="v-write">
      <input id="cName" maxlength="20" placeholder="이름 (없으면 손님)" value="${esc(name)}" aria-label="이름">
      <textarea id="cText" maxlength="300" rows="2" placeholder="이 책에 대한 한마디를 남겨 주세요" aria-label="댓글"></textarea>
      <input id="cHp" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <button class="btn primary" data-act="send">남기기</button>
    </div>`;
  if (cmtCache[b.id]) renderCmts(cmtCache[b.id]); else loadCmts(b);
}
function renderCmts(list){
  const el = $("#cmtList"); if (!el) return;
  el.innerHTML = list.length ? list.map(c => `<div class="cmt"><b>${esc(c.name)}</b> ${esc(c.text)}<span class="when">${esc(String(c.at).slice(5).replace("-", "."))}${c.waiting ? " · 책방지기가 확인하면 보여요" : ""}</span></div>`).join("")
    : `<div class="cmt empty">첫 댓글을 남겨 주세요.</div>`;
}
async function loadCmts(b){
  try { const r = await pubCall("pubcomments", { title: b.title }); cmtCache[b.id] = r.comments; if (selectedId === b.id) renderCmts(r.comments); }
  catch (e) { const el = $("#cmtList"); if (el) el.textContent = e.message; }
}
function burst(){
  const h = $("#burst"); h.classList.remove("go"); void h.offsetWidth; h.classList.add("go");
}
async function like(b, force){
  const want = force === true ? true : !b.liked;
  if (force === true) burst();
  if (want === !!b.liked) return;
  b.liked = want; b.likes = Math.max(0, (b.likes || 0) + (want ? 1 : -1)); renderDetail();
  const hb = document.querySelector(".heart"); if (hb && want) hb.classList.add("pop");
  try { const r = await pubCall("publike", { title: b.title, like: want }); b.liked = r.liked; b.likes = r.likes; const c = $("#likeCnt"); if (c) c.textContent = `좋아요 ${b.likes}개`; }
  catch (e) { b.liked = !want; b.likes = Math.max(0, b.likes + (want ? -1 : 1)); renderDetail(); toast(e.message, 3000); }
}
async function send(b){
  const text = $("#cText").value.trim(), name = $("#cName").value.trim();
  if (!text) { $("#cText").focus(); return; }
  try { localStorage.setItem("bs_vname", name); } catch {}
  const btn = document.querySelector('[data-act="send"]'); btn.disabled = true;
  try {
    const r = await pubCall("pubcomment", { title: b.title, name, text, hp: $("#cHp").value });
    cmtCache[b.id] = r.comments; if (!r.waiting) b.comments = (b.comments || 0) + 1;
    renderDetail(); toast(r.waiting ? "남겼어요. 책방지기가 확인하면 보여요" : "댓글을 남겼어요", 2500);
  } catch (e) { toast(e.message, 3000); btn.disabled = false; }
}
function select(id){ selectedId = selectedId === id ? null : id; renderScene(); renderDetail(); if (selectedId && innerWidth < 900) setTimeout(() => $("#detail").scrollIntoView({ behavior: "smooth", block: "nearest" }), 60); }
function goView(v){
  if (v === "pick" || v === view) return;
  const forward = VIEW_ORDER[v] > VIEW_ORDER[view], svg = $("#scene"), box = svg.parentNode;
  box.querySelectorAll(".page").forEach(n => n.remove());
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches, oldPage = reduce ? null : svg.cloneNode(true);
  selectedId = null; view = v; renderScene(); renderDetail();
  if (!oldPage) return;
  oldPage.removeAttribute("id"); oldPage.classList.add("page");
  if (forward) { oldPage.classList.add("turn-out"); box.appendChild(oldPage); oldPage.addEventListener("animationend", () => oldPage.remove()); }
  else { const np = svg.cloneNode(true); np.removeAttribute("id"); np.classList.add("page", "turn-in"); box.appendChild(oldPage); box.appendChild(np); np.addEventListener("animationend", () => { oldPage.remove(); np.remove(); }); }
}
const VIEW_ORDER = { out: 0, in: 1, today: 2, wall: 3 };

$("#scene").addEventListener("click", e => {
  const nav = e.target.closest("[data-nav]"); if (nav) { goView(nav.dataset.nav); return; }
  const g = e.target.closest(".book"); if (g) select(g.dataset.id); else if (selectedId) select(selectedId);
});
$("#scene").addEventListener("keydown", e => { if (e.key !== "Enter" && e.key !== " ") return; const nv = e.target.closest("[data-nav]"), g = e.target.closest(".book"); if (nv) { e.preventDefault(); goView(nv.dataset.nav); } else if (g) { e.preventDefault(); select(g.dataset.id); } });
let lastTap = 0;
function dbl(handler){ return e => { const now = Date.now(); if (now - lastTap < 320) handler(e); lastTap = now; }; }
$("#coverPop").addEventListener("click", dbl(() => { const b = data.books.find(x => x.id === selectedId); if (b) like(b, true); }));
$("#detail").addEventListener("click", e => {
  const b = data.books.find(x => x.id === selectedId); if (!b) return;
  if (e.target.closest(".vc")) { dbl(() => like(b, true))(e); return; }
  const a = e.target.closest("[data-act]"); if (!a) return;
  const act = a.dataset.act;
  if (act === "like") like(b);
  else if (act === "send") send(b);
  else if (act === "close") select(b.id);
  else if (act === "share") {
    const u = location.href, t = `${data.shopName} · ${b.title}`;
    if (navigator.share) navigator.share({ title: t, url: u }).catch(() => {});
    else navigator.clipboard.writeText(u).then(() => toast("링크를 복사했어요")).catch(() => {});
  }
});
document.querySelectorAll(".views button").forEach(b => b.addEventListener("click", () => goView(b.dataset.view)));
function turn(d){ if (view === "wall") { const n = wallItems().pagesN; wallPage = (wallPage + d + n) % n; } else { const n = pages().length; page = (page + d + n) % n; } selectedId = null; renderScene(); renderDetail(); }
$("#prev").addEventListener("click", () => turn(-1));
$("#next").addEventListener("click", () => turn(1));

async function loadVisit(){
  try {
    const r = await pubCall("pubshop", {});
    const s = r.settings || {};
    data = normalize({ shopName: s.shopName, menu: s.menu, openDate: s.openDate, today: s.today, books: r.books });
    setNotice(""); renderAll();
    if (s.publicCovers) {
      const ids = data.books.filter(b => b.cover && !/^[nw]_/.test(b.id)).map(b => b.id);
      for (let i = 0; i < ids.length; i += 30) { try { const t = await pubCall("pubthumbs", { ids: ids.slice(i, i + 30) }); Object.assign(thumbs, t.thumbs || {}); } catch { break; } }
      if (ids.length) renderAll();
    }
  } catch (e) {
    setNotice(e.code === "closed" ? "지금은 책방 문을 잠시 닫았어요. 다음에 다시 놀러 와 주세요." : e.message);
    renderAll();
  }
}
renderAll();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => renderScene());
loadVisit();
fetchWx();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") loadVisit(); });
})();
