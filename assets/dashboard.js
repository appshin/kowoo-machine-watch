import {
  authGate, isConfigured, showSetup, R, onValue, set, remove, onDisconnect, serverTimestamp,
  query, orderByChild, limitToLast, now, SITE, t, applyI18n, bindLangSelects, shiftOf, fmtClock, fmtStamp,
  fmtDur, fmtHM, drawOverlay, areaLabel, stateLabel, esc, natCmp, $
} from "./core.js?v=20261120j";
import { initRemoteZones, openRemoteZones, refreshRemoteZones } from "./remote-zones.js?v=20261120j";

const STALE_MS = 30000;        // 분석 PC 신호가 30초 넘게 없으면 '신호없음'
const S = {
  user: null, role: null,
  cams: {}, live: {}, plan: {}, thumbs: {}, events: [], stats: {},
  sel: null, frame: null, hl: null, blink: false,
  statKey: null, statManual: false, statUnsub: null,
  sound: false, audio: null, prevIdle: null, tickN: 0
};

applyI18n();
bindLangSelects();
if (!isConfigured()) showSetup();
else authGate({ onReady });

function onReady({ user, role }) {
  S.user = user; S.role = role;
  onValue(R("config/cameras"), s => {
    S.cams = s.val() || {};
    if (!S.sel || !S.cams[S.sel]) selectCam(camIds()[0] || null);
    renderAll();
    refreshRemoteZones();
  });
  onValue(R("live"), s => { S.live = s.val() || {}; renderAll(); checkAlerts(); });
  onValue(R("plan"), s => { S.plan = s.val() || {}; renderAll(); checkAlerts(); });
  onValue(R("thumbs"), s => { S.thumbs = s.val() || {}; renderTabs(items()); });
  onValue(query(R("events"), orderByChild("ts"), limitToLast(80)), s => {
    const a = [];
    s.forEach(c => { a.push(c.val()); });
    S.events = a.reverse();
    renderEvents();
  });
  setStatKey(shiftOf(now()));
  bindUi();
  $("#zvClose").addEventListener("click", () => $("#zvDlg").close());
  $("#statTable").addEventListener("click", e => {
    const tr = e.target.closest("tr[data-cid]");
    if (tr) focusZone(tr.dataset.cid, tr.dataset.zid);
  });
  // 상황실에서 설비를 눌러 들어온 경우 바로 그 설비 영상 팝업
  const openFromHash = () => {
    const m = location.hash.match(/^#zone=([^/]+)\/(.+)$/);
    if (!m) return;
    const cid = decodeURIComponent(m[1]), zid = decodeURIComponent(m[2]);
    history.replaceState(null, "", location.pathname);
    const tryOpen = (n) => S.cams[cid]?.zones?.[zid] ? focusZone(cid, zid) : n > 0 && setTimeout(() => tryOpen(n - 1), 300);
    tryOpen(20);
  };
  window.addEventListener("hashchange", openFromHash);
  openFromHash();
  $("#zvDlg").addEventListener("close", () => { S.zv = null; S.hl = null; drawOverlayOnly(); });
  initRemoteZones({ cams: () => S.cams, img: () => $("#frameImg"), live: () => S.live });
  $("#rzOpen").addEventListener("click", () => openRemoteZones(S.sel));
  window.addEventListener("langchange", renderAll);
  document.addEventListener("visibilitychange", syncWatch);
  setInterval(tick, 1000);
  tick();
}

/* ---------- data shaping ---------- */
function camIds() {
  return Object.keys(S.cams).sort((a, b) =>
    natCmp(S.cams[a].area, S.cams[b].area) || natCmp(S.cams[a].name, S.cams[b].name));
}
function camFresh(cid) {
  const lv = S.live[cid];
  return !!lv && lv.online !== false && now() - (lv.ts || 0) < STALE_MS;
}
function items() {
  const out = [];
  for (const cid of camIds()) {
    const cam = S.cams[cid], lv = S.live[cid], fresh = camFresh(cid);
    for (const [zid, z] of Object.entries(cam.zones || {})) {
      let state, since, r = null, m = 0;
      const pl = S.plan?.[cid]?.[zid];
      if (pl) { state = "off"; since = pl.ts; }
      else if (!fresh) { state = "nosig"; since = lv?.ts; }
      else { const zs = lv.zones?.[zid]; state = zs?.state || "nosig"; since = zs?.since; r = zs?.r ?? null; m = zs?.m || 0; }
      out.push({ cid, zid, cam, z, state, since, r, m, area: z.area || cam.area || "ETC" });
    }
  }
  const order = SITE.areas;
  return out.sort((a, b) => (order.indexOf(a.area) - order.indexOf(b.area)) || natCmp(a.z.eqId, b.z.eqId));
}
function statesFor(cid) {
  const o = {};
  for (const i of items()) if (i.cid === cid) o[i.zid] = { state: i.state, since: i.since, r: i.r, m: i.m };
  return o;
}

/* ---------- render ---------- */
function renderAll() {
  const list = items();
  renderAndon(list);
  renderTabs(list);
  renderIdle(list);
  renderStats();
  renderEvents();
  drawViewer();
}

function renderAndon(list) {
  const c = { run: 0, idle: 0, wait: 0, off: 0, nosig: 0 };
  list.forEach(i => { c[i.state]++; });
  const title = $("#andonTitle");
  if (!list.length) { title.textContent = t("noCameras"); title.className = "andon-title"; }
  else if (c.idle) { title.textContent = t("idleHeadline", { n: c.idle }); title.className = "andon-title is-idle"; }
  else { title.textContent = t("allRunning"); title.className = "andon-title is-ok"; }
  $("#brandMark").classList.toggle("alert", c.idle > 0);
  document.title = (c.idle ? `(${c.idle}) ` : "") + t("appTitle");

  $("#tally").innerHTML = ["run", "idle", "wait", "off", "nosig"].map(k =>
    `<span style="--c:var(--${k})">${esc(stateLabel(k))}<b>${c[k]}</b></span>`).join("");

  const groups = {};
  list.forEach(i => { (groups[i.area] ||= []).push(i); });
  $("#andonStrip").innerHTML = Object.entries(groups).map(([area, arr]) => `
    <div class="andon-group">
      <span class="andon-area">${esc(areaLabel(area))}</span>
      <div class="andon-segs">${arr.map(i => `
        <button type="button" class="seg ${i.state}" data-cid="${esc(i.cid)}" data-zid="${esc(i.zid)}"
          title="${esc(i.z.eqId)} ${esc(i.z.name || "")}: ${esc(stateLabel(i.state))}">
          <span>${esc(i.z.eqId)}</span>
          ${i.state === "idle"
            ? `<small data-since="${i.since || now()}">${fmtDur((now() - (i.since || now())) / 1000)}</small>`
            : `<small>${esc(stateLabel(i.state))}</small>`}
        </button>`).join("")}
      </div>
    </div>`).join("");
}

function renderTabs(list) {
  const ids = camIds();
  $("#camMeta").textContent = ids.length ? `${ids.length}` : "";
  $("#camTabs").innerHTML = ids.map(cid => {
    const cam = S.cams[cid], mine = list.filter(i => i.cid === cid);
    const idleN = mine.filter(i => i.state === "idle").length;
    const runN = mine.filter(i => i.state === "run").length;
    const th = S.thumbs[cid]?.jpg;
    return `<button type="button" class="cam-tab ${cid === S.sel ? "sel" : ""}" data-cid="${esc(cid)}" aria-pressed="${cid === S.sel}">
      <span class="thumb">${th ? `<img src="${th}" alt="">` : ""}${camFresh(cid) ? "" : `<em class="tab-flag">${esc(t("camOffline"))}</em>`}</span>
      <span class="tab-name">${esc(cam.name)}</span>
      <span class="tab-counts">${idleN ? `<b class="c-idle">${esc(t("idle"))} ${idleN}</b>` : ""}<span>${esc(t("run"))} ${runN}</span></span>
    </button>`;
  }).join("");
}

// 설비 상태 목록: 위 안돈 칸과 같은 색으로, 비가동 의심 → 가동 → 계획정지 → 신호없음 순
function renderIdle(list) {
  const order = { idle: 0, wait: 1, run: 2, off: 3, nosig: 4 };
  const sorted = [...list].sort((a, b) => (order[a.state] - order[b.state]) ||
    (a.state === "idle" ? (a.since || 0) - (b.since || 0) : 0) ||
    (SITE.areas.indexOf(a.area) - SITE.areas.indexOf(b.area)) || natCmp(a.z.eqId, b.z.eqId));
  const idleN = list.filter(i => i.state === "idle").length;
  const canPlan = S.role === "admin" || S.role === "manager";
  const cnt = $("#idleCount");
  cnt.textContent = idleN;
  cnt.classList.toggle("hot", idleN > 0);
  $("#offWrap").innerHTML = "";

  $("#idleList").innerHTML = sorted.length ? sorted.map(i => {
    const right = i.state === "idle"
      ? `<span class="idle-timer" data-since="${i.since || now()}">${fmtDur((now() - (i.since || now())) / 1000)}</span>`
      : `<span class="st-badge ${i.state}">${esc(stateLabel(i.state))}${i.state === "run" && i.r != null ? ` ${i.r}%` : ""}</span>`;
    const btn = !canPlan ? "" : i.state === "idle" ? `<button type="button" class="btn small" data-plan="on">${esc(t("planStop"))}</button>`
      : i.state === "off" ? `<button type="button" class="btn small" data-plan="off">${esc(t("planResume"))}</button>` : "";
    return `
    <li class="idle-item st-${i.state}" data-cid="${esc(i.cid)}" data-zid="${esc(i.zid)}">
      <button type="button" class="idle-main" data-go>
        <span class="eq-id">${esc(i.z.eqId)}</span>
        ${i.z.name ? `<span class="eq-name">${esc(i.z.name)}</span>` : ""}
        <span class="eq-where">${esc(areaLabel(i.area))} / ${esc(i.cam.name)}${i.state === "idle" && i.r != null ? `  ·  ${esc(t("ratioShort", { r: i.r, m: i.z.windowMin || 5 }))}` : ""}</span>
      </button>
      ${right}
      ${btn}
    </li>`;
  }).join("") : `<li class="empty">${esc(t("noCameras"))}</li>`;
}

function renderStats() {
  // 지금 보고 있는 근무조가 현재 근무조면 "현재 상태" 칸을 보여 줌
  const cur = shiftOf(now());
  const isNow = S.statKey && S.statKey.date === cur.date && S.statKey.shift === cur.shift;
  const live = {};
  for (const i of items()) live[`${i.cid}__${i.zid}`] = i;
  const rows = [];
  for (const cid of camIds()) {
    for (const [zid, z] of Object.entries(S.cams[cid].zones || {})) {
      const s = S.stats[`${cid}__${zid}`] || {};
      const it = live[`${cid}__${zid}`];
      rows.push({ z, cam: S.cams[cid], cid, zid, run: s.run || 0, idle: s.idle || 0, it,
        area: z.area || S.cams[cid].area || "ETC" });
    }
  }
  const tbl = $("#statTable");
  const totRun = rows.reduce((a, r) => a + r.run, 0), totIdle = rows.reduce((a, r) => a + r.idle, 0);
  if (!rows.length || (!isNow && totRun + totIdle === 0)) { tbl.innerHTML = `<tbody><tr><td class="empty">${esc(t("noData"))}</td></tr></tbody>`; return; }
  // 현재 비가동 의심 → 오래 지속된 순, 나머지는 누적 비가동 시간 순
  const curIdle = r => isNow && r.it?.state === "idle";
  rows.sort((a, b) => (curIdle(b) - curIdle(a)) ||
    (curIdle(a) ? (a.it.since || 0) - (b.it.since || 0) : 0) ||
    b.idle - a.idle || natCmp(a.z.eqId, b.z.eqId));
  const rate = (i, r) => (i + r) ? Math.round((i / (i + r)) * 100) : 0;
  const rateCell = (i, r) => `<span class="rate">${rate(i, r)}%<i><b style="width:${rate(i, r)}%"></b></i></span>`;
  const nowCell = r => {
    const it = r.it;
    if (!it) return "";
    if (it.state === "idle") {
      const since = it.since || now();
      return `<span class="st-badge idle">${esc(t("idle"))} <b data-since="${since}">${fmtDur((now() - since) / 1000)}</b></span>`;
    }
    return `<span class="st-badge ${it.state}">${esc(stateLabel(it.state))}</span>`;
  };
  tbl.innerHTML = `
    <thead><tr><th>${esc(t("equipment"))}</th>${isNow ? `<th>${esc(t("nowState"))}</th>` : ""}<th class="num">${esc(t("runTime"))}</th><th class="num">${esc(t("idleTime"))}</th><th class="num">${esc(t("idleRate"))}</th></tr></thead>
    <tbody>${rows.map(r => `<tr class="${curIdle(r) ? "row-idle" : ""}" data-cid="${esc(r.cid)}" data-zid="${esc(r.zid)}">
      <td><b>${esc(r.z.eqId)}</b> ${esc(r.z.name || "")}<div class="stat-where">${esc(areaLabel(r.area))} / ${esc(r.cam.name)}</div></td>
      ${isNow ? `<td>${nowCell(r)}</td>` : ""}
      <td class="num">${fmtHM(r.run)}</td><td class="num">${fmtHM(r.idle)}</td>
      <td class="num">${rateCell(r.idle, r.run)}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td>${esc(t("total"))}</td>${isNow ? "<td></td>" : ""}<td class="num">${fmtHM(totRun)}</td><td class="num">${fmtHM(totIdle)}</td><td class="num">${rateCell(totIdle, totRun)}</td></tr></tfoot>`;
}

function renderEvents() {
  const el = $("#eventList");
  if (!S.events.length) { el.innerHTML = `<li class="empty">${esc(t("noEvents"))}</li>`; return; }
  el.innerHTML = S.events.map(e => {
    const toIdle = e.to === "idle";
    const text = toIdle ? t("evIdleStart")
      : `${t("evIdleEnd")} (${stateLabel(e.to)}), ${t("evDur", { d: fmtDur(e.dur) })}`;
    return `<li class="ev ${toIdle ? "ev-idle" : ""}">
      <time>${esc(fmtStamp(e.ts))}</time>
      <span class="ev-eq">${esc(e.eqId)} ${esc(e.name || "")}</span>
      <span class="ev-text">${esc(text)}</span>
    </li>`;
  }).join("");
}

/* ---------- live viewer ---------- */
const img = $("#frameImg"), cv = $("#overlay"), ctx = cv.getContext("2d");
let lastFrameTs = 0, watchRef = null, frameUnsub = null;

img.addEventListener("load", () => {
  const w = img.naturalWidth, h = img.naturalHeight;
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  $("#stage").style.aspectRatio = `${w} / ${h}`;
  drawOverlayOnly();
});

function selectCam(cid) {
  if (S.sel === cid && (frameUnsub || !cid)) return;
  unwatch();
  if (frameUnsub) { frameUnsub(); frameUnsub = null; }
  S.sel = cid; S.frame = null; lastFrameTs = 0;
  img.removeAttribute("src");
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!cid) { drawViewer(); return; }
  frameUnsub = onValue(R(`frames/${cid}`), s => { S.frame = s.val(); drawViewer(); });
  syncWatch();
  renderTabs(items());
  drawViewer();
}
// 누군가 보고 있을 때만 분석 PC가 영상을 올림 (데이터 사용량 절약)
function syncWatch() {
  if (document.hidden || !S.sel) { unwatch(); return; }
  if (watchRef) return;
  watchRef = R(`watch/${S.sel}/${S.user.uid}`);
  set(watchRef, serverTimestamp()).catch(console.warn);
  onDisconnect(watchRef).remove();
}
function unwatch() {
  if (!watchRef) return;
  onDisconnect(watchRef).cancel();
  remove(watchRef).catch(() => {});
  watchRef = null;
}

function drawViewer() {
  const msg = $("#stageMsg");
  if (!S.sel) { msg.textContent = t("noCameras"); return; }
  const f = S.frame;
  if (f?.jpg && f.ts !== lastFrameTs) { lastFrameTs = f.ts; img.src = f.jpg; }
  if (!f?.jpg) msg.textContent = t("waitingFrame");
  else if (now() - (f.ts || 0) > 15000) msg.textContent = camFresh(S.sel) ? t("frameStale") : t("waitingFrame");
  else msg.textContent = "";
  drawOverlayOnly();
}
function drawOverlayOnly() {
  drawZoneView();
  if (!cv.width) return;
  ctx.clearRect(0, 0, cv.width, cv.height);
  const cam = S.cams[S.sel];
  if (!cam || !img.getAttribute("src")) return;
  drawOverlay(ctx, cv.width, cv.height, cam.zones, statesFor(S.sel), S.frame?.p || [], { blink: S.blink, highlight: S.hl });
}

/* ---------- stats key ---------- */
function setStatKey(k) {
  S.statKey = k;
  $("#statDate").value = k.date;
  $("#statShift").value = k.shift;
  if (S.statUnsub) S.statUnsub();
  S.statUnsub = onValue(R(`stats/${k.date}/${k.shift}`), s => { S.stats = s.val() || {}; renderStats(); });
}

/* ---------- interaction ---------- */
function bindUi() {
  $("#andonStrip").addEventListener("click", e => {
    const b = e.target.closest(".seg");
    if (b) focusZone(b.dataset.cid, b.dataset.zid);
  });
  $("#camTabs").addEventListener("click", e => {
    const b = e.target.closest(".cam-tab");
    if (b) selectCam(b.dataset.cid);
  });
  document.querySelector(".area-idle").addEventListener("click", async e => {
    const li = e.target.closest("[data-cid]");
    if (!li) return;
    const { cid, zid } = li.dataset;
    if (e.target.closest("[data-go]")) { focusZone(cid, zid); return; }
    const pb = e.target.closest("[data-plan]");
    if (!pb) return;
    pb.disabled = true;
    const r = R(`plan/${cid}/${zid}`);
    try {
      if (pb.dataset.plan === "on") await set(r, { ts: serverTimestamp(), by: S.user.email || S.user.uid });
      else await remove(r);
    } catch (err) { console.warn(err); pb.disabled = false; }
  });
  $("#statDate").addEventListener("change", e => { S.statManual = true; setStatKey({ date: e.target.value, shift: $("#statShift").value }); });
  $("#statShift").addEventListener("change", e => { S.statManual = true; setStatKey({ date: $("#statDate").value, shift: e.target.value }); });
  $("#soundBtn").addEventListener("click", () => {
    S.sound = !S.sound;
    $("#soundBtn").setAttribute("aria-pressed", S.sound);
    if (S.sound) { S.audio ||= new (window.AudioContext || window.webkitAudioContext)(); S.audio.resume(); beep(); }
  });
}
// 설비를 누르면 그 카메라 영상을 팝업으로 크게 (감시 구역은 흰 테두리로 강조)
function focusZone(cid, zid) {
  selectCam(cid);
  S.hl = zid;
  S.zv = { cid, zid };
  $("#zvDlg").showModal();
  drawZoneView();
}
function drawZoneView() {
  if (!S.zv || !$("#zvDlg").open) return;
  const { cid, zid } = S.zv;
  const it = items().find(i => i.cid === cid && i.zid === zid);
  const cam = S.cams[cid];
  if (!it || !cam) { $("#zvDlg").close(); return; }
  $("#zvTitle").textContent = it.z.eqId + (it.z.name ? "  " + it.z.name : "");
  const st = $("#zvState");
  st.className = "st-badge " + it.state;
  st.textContent = stateLabel(it.state) + (it.state === "idle" && it.since ? "  " + fmtDur((now() - it.since) / 1000) : "") + (it.r != null ? `  ${it.r}%` : "");
  $("#zvWhere").textContent = `${areaLabel(it.area)} / ${cam.name}`;
  const cvs = $("#zvCanvas"), msg = $("#zvMsg");
  if (!img.getAttribute("src") || !img.naturalWidth) { msg.textContent = t("waitingFrame"); msg.hidden = false; return; }
  msg.hidden = true;
  if (cvs.width !== img.naturalWidth || cvs.height !== img.naturalHeight) { cvs.width = img.naturalWidth; cvs.height = img.naturalHeight; }
  const c = cvs.getContext("2d");
  c.drawImage(img, 0, 0);
  drawOverlay(c, cvs.width, cvs.height, cam.zones, statesFor(cid), [], { blink: S.blink, highlight: zid });
}

function checkAlerts() {
  const idle = new Set(items().filter(i => i.state === "idle").map(i => `${i.cid}/${i.zid}`));
  if (S.prevIdle && S.sound && [...idle].some(k => !S.prevIdle.has(k))) beep();
  S.prevIdle = idle;
}
function beep() {
  const a = S.audio;
  if (!a) return;
  [0, 0.35].forEach(off => {
    const o = a.createOscillator(), g = a.createGain();
    o.frequency.value = 880; o.type = "square";
    g.gain.setValueAtTime(0.0001, a.currentTime + off);
    g.gain.exponentialRampToValueAtTime(0.2, a.currentTime + off + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + off + 0.25);
    o.connect(g).connect(a.destination);
    o.start(a.currentTime + off); o.stop(a.currentTime + off + 0.3);
  });
}

function tick() {
  const n = now();
  $("#clkSite").textContent = fmtClock(n, SITE.timezone);
  $("#clkHome").textContent = fmtClock(n, SITE.homeTimezone);
  document.querySelectorAll("[data-since]").forEach(el => { el.textContent = fmtDur((n - +el.dataset.since) / 1000); });
  S.blink = !S.blink;
  drawOverlayOnly();
  if (!S.statManual) {
    const k = shiftOf(n);
    if (!S.statKey || k.date !== S.statKey.date || k.shift !== S.statKey.shift) setStatKey(k);
  }
  // 오래된 신호를 '신호없음'으로 바꾸기 위해 주기적으로 다시 그림
  if (++S.tickN % 5 === 0) { renderAll(); checkAlerts(); }
}
