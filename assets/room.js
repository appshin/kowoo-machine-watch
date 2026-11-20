import {
  authGate, isConfigured, showSetup, R, onValue, set, remove, onDisconnect, serverTimestamp,
  now, SITE, t, applyI18n, bindLangSelects, fmtClock, fmtDur, areaLabel, stateLabel, esc, $,
  buildItems, camFreshOf, beep
} from "./core.js?v=20261120j";

// 종합상황실: 비가동 의심 설비만 크게 모아 보여 줌 (사무실 벽 모니터용)
const S = { user: null, role: null, cams: {}, live: {}, plan: {}, crops: {}, thumbs: {}, sound: false, prevIdle: null, watchRef: null };

applyI18n();
bindLangSelects();
if (!isConfigured()) showSetup();
else authGate({ onReady });

function onReady({ user, role }) {
  S.user = user; S.role = role;
  onValue(R("config/cameras"), s => { S.cams = s.val() || {}; render(); });
  onValue(R("live"), s => { S.live = s.val() || {}; render(); checkSound(); });
  onValue(R("plan"), s => { S.plan = s.val() || {}; render(); checkSound(); });
  onValue(R("crops"), s => { S.crops = s.val() || {}; updateImages(); });
  onValue(R("thumbs"), s => { S.thumbs = s.val() || {}; updateImages(); });
  bindUi();
  syncWatch();
  document.addEventListener("visibilitychange", syncWatch);
  window.addEventListener("langchange", render);
  setInterval(tick, 1000);
  tick();
}

// 상황실이 열려 있는 동안만 분석 PC가 비가동 구역 확대 화면을 올림
function syncWatch() {
  if (document.hidden) {
    if (S.watchRef) { onDisconnect(S.watchRef).cancel(); remove(S.watchRef).catch(() => {}); S.watchRef = null; }
    return;
  }
  if (S.watchRef) return;
  S.watchRef = R(`watch/_room/${S.user.uid}`);
  set(S.watchRef, serverTimestamp()).catch(console.warn);
  onDisconnect(S.watchRef).remove();
}

function render() {
  const list = buildItems(S.cams, S.live, S.plan);
  const idle = list.filter(i => i.state === "idle").sort((a, b) => (a.since || 0) - (b.since || 0));
  const c = { run: 0, idle: 0, wait: 0, off: 0, nosig: 0 };
  list.forEach(i => { c[i.state]++; });

  const title = $("#andonTitle");
  if (!list.length) { title.textContent = t("noCameras"); title.className = "andon-title"; }
  else if (c.idle) { title.textContent = t("idleHeadline", { n: c.idle }); title.className = "andon-title is-idle"; }
  else { title.textContent = t("allRunning"); title.className = "andon-title is-ok"; }
  $("#brandMark").classList.toggle("alert", c.idle > 0);
  document.title = (c.idle ? `(${c.idle}) ` : "") + t("roomTitle");
  $("#tally").innerHTML = ["run", "idle", "wait", "off", "nosig"].map(k =>
    `<span style="--c:var(--${k})">${esc(stateLabel(k))}<b>${c[k]}</b></span>`).join("");

  const groups = {};
  list.forEach(i => { (groups[i.area] ||= []).push(i); });
  $("#andonStrip").innerHTML = Object.entries(groups).map(([area, arr]) => `
    <div class="andon-group">
      <span class="andon-area">${esc(areaLabel(area))}</span>
      <div class="andon-segs">${arr.map(i => `
        <a class="seg ${i.state}" href="index.html#zone=${encodeURIComponent(i.cid)}/${encodeURIComponent(i.zid)}" target="kcw_dash" title="${esc(i.z.eqId)}: ${esc(stateLabel(i.state))}">
          <span>${esc(i.z.eqId)}</span>
          ${i.state === "idle" ? `<small data-since="${i.since || now()}"></small>` : `<small>${esc(stateLabel(i.state))}</small>`}
        </a>`).join("")}
      </div>
    </div>`).join("");

  // 비가동 의심 카드
  const canPlan = S.role === "admin" || S.role === "manager";
  $("#idleSec").hidden = !idle.length;
  $("#idleN").textContent = idle.length;
  $("#idleGrid").innerHTML = idle.map(i => `
    <article class="room-card" data-cid="${esc(i.cid)}" data-zid="${esc(i.zid)}">
      <div class="room-img"><img alt="" data-crop="${esc(i.cid)}__${esc(i.zid)}"><p class="room-noimg">${esc(t("roomNoImage"))}</p></div>
      <div class="room-info">
        <div class="room-row"><span class="eq-id">${esc(i.z.eqId)}</span><span class="idle-timer" data-since="${i.since || now()}"></span></div>
        <div class="eq-name">${esc(i.z.name || "")}</div>
        <div class="eq-where">${esc(areaLabel(i.area))} / ${esc(i.cam.name)}${i.r != null ? `  ·  ${esc(t("ratioShort", { r: i.r, m: i.z.windowMin || 5 }))}` : ""}</div>
        ${canPlan ? `<button type="button" class="btn small" data-plan>${esc(t("planStop"))}</button>` : ""}
      </div>
    </article>`).join("");

  // 영상 신호가 끊긴 카메라 (분석 PC 꺼짐, 화면 미선택 등)
  const nosig = Object.entries(S.cams).filter(([cid, cam]) => Object.keys(cam.zones || {}).length && !camFreshOf(S.live, cid));
  $("#nosigSec").hidden = !nosig.length;
  $("#nosigN").textContent = nosig.length;
  $("#nosigGrid").innerHTML = nosig.map(([cid, cam]) => `
    <article class="room-card nosig">
      <div class="room-img"><img alt="" data-thumb="${esc(cid)}"><p class="room-noimg">${esc(t("roomNoImage"))}</p></div>
      <div class="room-info">
        <div class="room-row"><span class="eq-id">${esc(cam.name)}</span></div>
        <div class="eq-where">${esc(areaLabel(cam.area))} / ${esc(cam.agent || "")}  ·  ${esc(t("nosig"))}${S.live[cid]?.ts ? `  ·  ${esc(fmtClock(S.live[cid].ts))}` : ""}</div>
      </div>
    </article>`).join("");

  const ok = $("#roomOk");
  ok.hidden = !!(idle.length || nosig.length) || !list.length;
  ok.textContent = t("roomAllOk");
  updateImages();
  tick(true);
}

function updateImages() {
  document.querySelectorAll("img[data-crop]").forEach(im => {
    const c = S.crops[im.dataset.crop];
    const fresh = c?.jpg && now() - (c.ts || 0) < 60000;
    if (fresh && im.getAttribute("src") !== c.jpg) im.src = c.jpg;
    im.closest(".room-img").classList.toggle("has-img", !!fresh);
  });
  document.querySelectorAll("img[data-thumb]").forEach(im => {
    const th = S.thumbs[im.dataset.thumb]?.jpg;
    if (th && im.getAttribute("src") !== th) im.src = th;
    im.closest(".room-img").classList.toggle("has-img", !!th);
  });
}

function checkSound() {
  const idle = new Set(buildItems(S.cams, S.live, S.plan).filter(i => i.state === "idle").map(i => `${i.cid}/${i.zid}`));
  if (S.prevIdle && S.sound && [...idle].some(k => !S.prevIdle.has(k))) beep();
  S.prevIdle = idle;
}

function bindUi() {
  $("#idleGrid").addEventListener("click", async e => {
    const b = e.target.closest("[data-plan]");
    if (!b) return;
    const card = b.closest(".room-card");
    b.disabled = true;
    try { await set(R(`plan/${card.dataset.cid}/${card.dataset.zid}`), { ts: serverTimestamp(), by: S.user.email || S.user.uid }); }
    catch (err) { console.warn(err); b.disabled = false; }
  });
  $("#soundBtn").addEventListener("click", () => {
    S.sound = !S.sound;
    $("#soundBtn").setAttribute("aria-pressed", S.sound);
    if (S.sound) beep(true);
  });
  const sel = $("#roomSize");
  try { sel.value = localStorage.getItem("kcw.roomSize") || "m"; } catch { sel.value = "m"; }
  document.querySelector(".room-main").dataset.size = sel.value;
  sel.addEventListener("change", () => {
    document.querySelector(".room-main").dataset.size = sel.value;
    try { localStorage.setItem("kcw.roomSize", sel.value); } catch {}
  });
  $("#fsBtn").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });
}

let tickN = 0;
function tick(onlyTimers = false) {
  const n = now();
  document.querySelectorAll("[data-since]").forEach(el => { el.textContent = fmtDur((n - +el.dataset.since) / 1000); });
  if (onlyTimers === true) return;
  $("#clkSite").textContent = fmtClock(n, SITE.timezone);
  $("#clkHome").textContent = fmtClock(n, SITE.homeTimezone);
  if (++tickN % 5 === 0) { render(); checkSound(); }
}
