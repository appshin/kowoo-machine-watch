import {
  authGate, isConfigured, showSetup, R, onValue, set, remove, onDisconnect, serverTimestamp,
  query, orderByChild, limitToLast, now, SITE, t, applyI18n, bindLangSelects, shiftOf, fmtClock, fmtStamp,
  fmtDur, fmtHM, drawOverlay, areaLabel, stateLabel, esc, natCmp, $
} from "./core.js";

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
      let state, since;
      const pl = S.plan?.[cid]?.[zid];
      if (pl) { state = "off"; since = pl.ts; }
      else if (!fresh) { state = "nosig"; since = lv?.ts; }
      else { const zs = lv.zones?.[zid]; state = zs?.state || "nosig"; since = zs?.since; }
      out.push({ cid, zid, cam, z, state, since, area: z.area || cam.area || "ETC" });
    }
  }
  const order = SITE.areas;
  return out.sort((a, b) => (order.indexOf(a.area) - order.indexOf(b.area)) || natCmp(a.z.eqId, b.z.eqId));
}
function statesFor(cid) {
  const o = {};
  for (const i of items()) if (i.cid === cid) o[i.zid] = { state: i.state, since: i.since };
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
  const c = { run: 0, idle: 0, off: 0, nosig: 0 };
  list.forEach(i => { c[i.state]++; });
  const title = $("#andonTitle");
  if (!list.length) { title.textContent = t("noCameras"); title.className = "andon-title"; }
  else if (c.idle) { title.textContent = t("idleHeadline", { n: c.idle }); title.className = "andon-title is-idle"; }
  else { title.textContent = t("allRunning"); title.className = "andon-title is-ok"; }
  $("#brandMark").classList.toggle("alert", c.idle > 0);
  document.title = (c.idle ? `(${c.idle}) ` : "") + t("appTitle");

  $("#tally").innerHTML = ["run", "idle", "off", "nosig"].map(k =>
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

function renderIdle(list) {
  const idle = list.filter(i => i.state === "idle").sort((a, b) => (a.since || 0) - (b.since || 0));
  const off = list.filter(i => i.state === "off");
  const canPlan = S.role === "admin" || S.role === "manager";
  const cnt = $("#idleCount");
  cnt.textContent = idle.length;
  cnt.classList.toggle("hot", idle.length > 0);

  $("#idleList").innerHTML = idle.length ? idle.map(i => `
    <li class="idle-item" data-cid="${esc(i.cid)}" data-zid="${esc(i.zid)}">
      <button type="button" class="idle-main" data-go>
        <span class="eq-id">${esc(i.z.eqId)}</span>
        ${i.z.name ? `<span class="eq-name">${esc(i.z.name)}</span>` : ""}
        <span class="eq-where">${esc(areaLabel(i.area))} / ${esc(i.cam.name)}</span>
      </button>
      <span class="idle-timer" data-since="${i.since || now()}">${fmtDur((now() - (i.since || now())) / 1000)}</span>
      ${canPlan ? `<button type="button" class="btn small" data-plan="on">${esc(t("planStop"))}</button>` : ""}
    </li>`).join("") : `<li class="empty">${esc(t("noIdle"))}</li>`;

  $("#offWrap").innerHTML = off.length ? `
    <p class="off-head">${esc(t("planned"))} ${off.length}</p>
    <ul class="off-list">${off.map(i => `
      <li class="off-item" data-cid="${esc(i.cid)}" data-zid="${esc(i.zid)}">
        <b>${esc(i.z.eqId)}</b><span>${esc(i.z.name || "")}</span><span class="spacer"></span>
        ${canPlan ? `<button type="button" class="btn small" data-plan="off">${esc(t("planResume"))}</button>` : ""}
      </li>`).join("")}
    </ul>` : "";
}

function renderStats() {
  const rows = [];
  for (const cid of camIds()) {
    for (const [zid, z] of Object.entries(S.cams[cid].zones || {})) {
      const s = S.stats[`${cid}__${zid}`] || {};
      rows.push({ z, run: s.run || 0, idle: s.idle || 0 });
    }
  }
  const tbl = $("#statTable");
  const totRun = rows.reduce((a, r) => a + r.run, 0), totIdle = rows.reduce((a, r) => a + r.idle, 0);
  if (!rows.length || totRun + totIdle === 0) { tbl.innerHTML = `<tbody><tr><td class="empty">${esc(t("noData"))}</td></tr></tbody>`; return; }
  rows.sort((a, b) => b.idle - a.idle || natCmp(a.z.eqId, b.z.eqId));
  const rate = (i, r) => (i + r) ? Math.round((i / (i + r)) * 100) : 0;
  const rateCell = (i, r) => `<span class="rate">${rate(i, r)}%<i><b style="width:${rate(i, r)}%"></b></i></span>`;
  tbl.innerHTML = `
    <thead><tr><th>${esc(t("equipment"))}</th><th class="num">${esc(t("runTime"))}</th><th class="num">${esc(t("idleTime"))}</th><th class="num">${esc(t("idleRate"))}</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td><b>${esc(r.z.eqId)}</b> ${esc(r.z.name || "")}</td>
      <td class="num">${fmtHM(r.run)}</td><td class="num">${fmtHM(r.idle)}</td>
      <td class="num">${rateCell(r.idle, r.run)}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td>${esc(t("total"))}</td><td class="num">${fmtHM(totRun)}</td><td class="num">${fmtHM(totIdle)}</td><td class="num">${rateCell(totIdle, totRun)}</td></tr></tfoot>`;
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
function focusZone(cid, zid) {
  selectCam(cid);
  S.hl = zid;
  clearTimeout(focusZone.tm);
  focusZone.tm = setTimeout(() => { S.hl = null; drawOverlayOnly(); }, 6000);
  drawOverlayOnly();
  if (matchMedia("(max-width: 900px)").matches) $("#stage").scrollIntoView({ behavior: "smooth", block: "center" });
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
