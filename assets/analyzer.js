import {
  authGate, isConfigured, showSetup, R, onValue, get, set, update, push, remove, onDisconnect,
  serverTimestamp, increment, now, SITE, t, applyI18n, bindLangSelects, shiftOf, drawOverlay,
  areaLabel, esc, natCmp, $, COLORS, ALERT, tl, tzParts, fmtClock, nextEqId
} from "./core.js?v=20261120p";
import { toGray, diffFraction, diffFractionMasked, polyMask, sensPct, newZoneState, judge, fingerprint, fpSimilarity, adaptFingerprint } from "./motion.js?v=20261120p";
import { createShapeEditor, rectToPoly, polyBBox, zonePoly, strokePoly } from "./shape-editor.js?v=20261120p";

const DEFAULTS = { analyzeMs: 1000, pixThresh: 22, skipPct: 40, frameMs: 2000, frameW: 960, refMatch: 0.7, unseenMin: 10 };
const CROP_MS = 5000, ALERT_CHECK_MS = 30000;
const THUMB_MS = 60000, LIVE_HEARTBEAT_MS = 5000, STATS_FLUSH_MS = 15000;

// 브라우저가 화면 밖 영상을 멈추지 않도록 1px 컨테이너에 붙여 둠
const vidHost = document.createElement("div");
vidHost.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:1px;overflow:hidden;opacity:.01;pointer-events:none";
document.body.appendChild(vidHost);

// CCTV 프로그램 창 캡처는 PC당 하나를 모든 "CCTV 프로그램 화면" 카메라가 함께 씀
const SCR = { stream: null, video: null, picking: null, autoTried: false };
function stopScreen() {
  if (SCR.stream) SCR.stream.getTracks().forEach(tr => tr.stop());
  if (SCR.video) { SCR.video.srcObject = null; SCR.video.remove(); }
  SCR.stream = null; SCR.video = null;
}
function pickScreen(fromClick) {
  if (SCR.picking) return SCR.picking;
  if (!fromClick && SCR.autoTried) return Promise.resolve();
  SCR.autoTried = true;
  SCR.picking = (async () => {
    try {
      const st = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 }, audio: false, selfBrowserSurface: "exclude", surfaceSwitching: "include"
      });
      stopScreen();
      const v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.autoplay = true;
      vidHost.appendChild(v);
      v.srcObject = st;
      SCR.stream = st; SCR.video = v;
      st.getVideoTracks()[0].addEventListener("ended", () => { if (SCR.stream === st) { stopScreen(); refreshScreenTiles(); } });
      await v.play().catch(() => {});
    } catch (e) { console.warn("screen", e); }
    finally { SCR.picking = null; refreshScreenTiles(); }
  })();
  return SCR.picking;
}
function refreshScreenTiles() {
  for (const r of S.runners.values()) {
    if (r.type() !== "screen") continue;
    r.needPick = !SCR.stream;
    for (const zs of Object.values(r.zs)) zs.prev = null;
    r.prevFull = null;
    r.render(S.running);
  }
}
// 잘라낼 영역 (0~1). 없거나 잘못되면 전체
function cropOf(src) {
  const c = src?.crop;
  if (!Array.isArray(c) || c.length !== 4 || !(c[2] > 0.01) || !(c[3] > 0.01)) return [0, 0, 1, 1];
  return c.map(v => Math.min(1, Math.max(0, +v)));
}

const LS = {
  get(k, d) { try { const v = localStorage.getItem("kcw." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("kcw." + k, JSON.stringify(v)); } catch {} }
};
const cleanKey = s => String(s || "").trim().replace(/[.#$\[\]\/\s]+/g, "-").slice(0, 24) || "PC-1";
// 한 컴퓨터에서 모니터별로 분석 창을 따로 띄울 때: analyzer.html?pc=PC-2 (창마다 PC 이름이 따로)
const URL_PC = (() => { const v = new URLSearchParams(location.search).get("pc"); return v ? cleanKey(v) : ""; })();
const clamp01 = v => Math.min(1, Math.max(0, v));

const S = {
  user: null, role: null, agent: URL_PC || cleanKey(LS.get("agent", "PC-1")),
  cams: {}, plan: {}, settings: { ...DEFAULTS },
  runners: new Map(), running: false, wake: null, roomWatchers: 0, alertCfg: null
};

applyI18n();
bindLangSelects();
if (!isConfigured()) showSetup();
else authGate({ onReady });

// 대시보드·상황실의 [분석 화면] 버튼이 새 탭 대신 이 탭으로 오도록 탭 이름을 붙임
window.name = URL_PC ? `kcw_analyzer_${URL_PC}` : "kcw_analyzer";

async function onReady({ user, role }) {
  S.user = user; S.role = role;
  // 이미 다른 곳에서 분석 중이면 이 탭은 아무것도 시작하지 않음 (기존 감시를 건드리지 않음)
  const other = await findRunningAnalyzer();
  if (other && !(await showBlocked(other))) return;
  startAnalyzer();
}
function startAnalyzer() {
  S.started = true;
  $("#agentName").value = S.agent;
  $("#autoStart").checked = LS.get("autostart", false);
  document.querySelectorAll(".area-select").forEach(sel => {
    sel.innerHTML = SITE.areas.map(a => `<option value="${a}">${esc(areaLabel(a))}</option>`).join("");
  });
  onValue(R("config/cameras"), s => { S.cams = s.val() || {}; syncRunners(); if ($("#zoneDlg").open) renderZoneList(); });
  onValue(R("config/settings"), s => { S.settings = { ...DEFAULTS, ...(s.val() || {}) }; });
  onValue(R("plan"), s => { S.plan = s.val() || {}; });
  onValue(R("watch/_room"), s => { S.roomWatchers = Object.keys(s.val() || {}).length; });
  onValue(ALERT(), s => { S.alertCfg = s.val(); }, () => { S.alertCfg = null; });
  setInterval(checkAlerts, ALERT_CHECK_MS);
  bindUi();
  updateRunBtn();
  heartbeat();
  setInterval(heartbeat, 10000);
  window.addEventListener("langchange", () => { updateRunBtn(); syncRunners(true); });
  loop();
  if ($("#autoStart").checked) setRunning(true);
}

// 같은 컴퓨터의 다른 탭, 또는 같은 PC 이름으로 다른 컴퓨터에서 분석 중인지 확인
async function findRunningAnalyzer() {
  if (await checkDuplicate()) return "tab";
  try {
    const a = (await get(R(`agents/${S.agent}`))).val();
    if (a?.running && now() - (a.ts || 0) < 30000) return "remote";
  } catch (e) { console.warn(e); }
  return null;
}
// 안내 화면. "여기서 실행"을 누르면 true
function showBlocked(kind) {
  return new Promise(res => {
    const box = document.createElement("section");
    box.className = "blocked panel";
    box.innerHTML = `
      <h2>${esc(t(kind === "tab" ? "blkTabTitle" : "blkRemoteTitle", { pc: S.agent }))}</h2>
      <p class="blk-ok">${esc(t("blkKeep"))}</p>
      <p>${esc(t(kind === "tab" ? "blkTabHelp" : "blkRemoteHelp"))}</p>
      <div class="row">
        <a class="btn primary" href="index.html">${esc(t("backDash"))}</a>
        <a class="btn" href="room.html">${esc(t("openRoom"))}</a>
        <span class="spacer"></span>
        <button type="button" class="btn small danger" data-force>${esc(t("blkForce"))}</button>
      </div>`;
    document.querySelector(".toolbar").before(box);
    document.querySelector(".toolbar").hidden = true;
    $("#tiles").hidden = true;
    document.querySelectorAll("#app > .hint").forEach(h => { h.hidden = true; });
    box.querySelector("[data-force]").addEventListener("click", () => {
      if (!confirm(t("blkForceConfirm"))) return;
      box.remove();
      document.querySelector(".toolbar").hidden = false;
      $("#tiles").hidden = false;
      document.querySelectorAll("#app > .hint").forEach(h => { h.hidden = false; });
      res(true);
    });
  });
}

/* =========================================================
   화면 일부를 작은 흑백 이미지로 뽑기 (움직임 비교용)
   ========================================================= */
const mcv = document.createElement("canvas");
const mctx = mcv.getContext("2d", { willReadFrequently: true });
function sampleGray(src, box, maxSide = 64) {
  const rx = box[0] * src.width, ry = box[1] * src.height, rw = box[2] * src.width, rh = box[3] * src.height;
  if (rw < 2 || rh < 2) return null;
  const sc = Math.min(1, maxSide / Math.max(rw, rh));
  const w = Math.max(4, Math.round(rw * sc)), h = Math.max(4, Math.round(rh * sc));
  if (mcv.width !== w || mcv.height !== h) { mcv.width = w; mcv.height = h; }
  mctx.drawImage(src, rx, ry, rw, rh, 0, 0, w, h);   // 축소하면서 잡음이 평균되어 줄어듦
  const g = toGray(mctx.getImageData(0, 0, w, h).data);
  g.w = w; g.h = h;
  return g;
}

/* =========================================================
   영상 입력 1개 = Runner 1개
   ========================================================= */
class Runner {
  constructor(id, cam) {
    this.id = id; this.cam = cam;
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.zs = {}; this.acc = {}; this.states = {};
    this.online = false; this.fail = 0; this.ms = 0; this.watchers = 0;
    this.needPick = false; this.skipped = false; this.prevFull = null;
    this.observed = true; this.miss = 0; this.unseenSince = null; this.ref = null;
    this.lastLive = 0; this.lastFrame = 0; this.lastThumb = 0; this.lastAcc = 0; this.lastFlush = now();
    this.srcKey = JSON.stringify(cam.src || {});
    this.unwatch = onValue(R(`watch/${id}`), s => { this.watchers = Object.keys(s.val() || {}).length; });
    this.buildTile();
  }
  type() { return this.cam.src?.type || "screen"; }
  base() { return (this.cam.src?.base || location.origin).replace(/\/+$/, ""); }

  // fromClick: 버튼을 눌러 연 경우 (화면 공유는 클릭이 있어야 허용됨)
  async open(fromClick = false) {
    this.close();
    const src = this.cam.src || {}, type = this.type();
    this.openedAt = Date.now(); this.lastT = -1; this.stallSince = Date.now(); this.prevFull = null;
    for (const zs of Object.values(this.zs)) zs.prev = null;
    if (type === "jpeg") return;
    if (type === "image") { await this.loadSavedImage(); this.render(S.running); return; }
    if (type === "screen") {
      if (fromClick || !SCR.stream) await pickScreen(fromClick);
      this.needPick = !SCR.stream;
      this.render(S.running);
      return;
    }
    const pageMode = type === "url" && (this.urlMode === "page" || this.urlFailed);
    if (type === "url" && !(fromClick && pageMode)) { await this.openUrl(); this.render(S.running); return; }
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.autoplay = true;
    vidHost.appendChild(v);
    this.video = v;
    try {
      if (type === "url") {
        this.stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 5 }, audio: false, selfBrowserSurface: "exclude", surfaceSwitching: "include"
        });
        this.stream.getVideoTracks()[0].addEventListener("ended", () => {
          this.close(); this.needPick = true; this.render(S.running);
        });
        v.srcObject = this.stream;
        this.needPick = false;
      } else if (type === "webcam") {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: src.deviceId ? { deviceId: { exact: src.deviceId }, width: { ideal: 1280 } } : { width: { ideal: 1280 } }
        });
        v.srcObject = this.stream;
      } else {
        v.src = `${this.base()}/api/stream.mp4?src=${encodeURIComponent(src.stream || "")}`;
      }
      await v.play().catch(() => {});
    } catch (e) {
      console.warn("open", this.cam.name, e);
      if (type === "url") this.needPick = true;
    }
    this.render(S.running);
  }
  // 시험용 사진: 이 PC 브라우저에만 저장 (Firebase에는 올리지 않음)
  imgKey() { return "kcw.img." + this.id; }
  async loadSavedImage() {
    let url = null;
    try { url = localStorage.getItem(this.imgKey()); } catch {}
    this.img = url ? await loadImg(url).catch(() => null) : (this.img || null);
    this.needPick = !this.img;
  }
  pickImage() {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*,video/*";
    inp.addEventListener("change", async () => {
      const file = inp.files?.[0];
      if (!file) return;
      this.resetJudge();
      if (file.type.startsWith("video/")) { this.openTestVideo(file); return; }
      this.close();
      try {
        const bmp = await createImageBitmap(file);
        const sc = Math.min(1, 1280 / bmp.width), c = document.createElement("canvas");
        c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
        c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
        const url = c.toDataURL("image/jpeg", 0.85);
        try { localStorage.setItem(this.imgKey(), url); } catch {}
        this.img = await loadImg(url);
        this.needPick = false;
      } catch (e) { console.warn(e); toast(t("imageFail")); }
      this.render(S.running);
    });
    inp.click();
  }
  // 시험용 영상 파일: 반복 재생하며 실제 CCTV처럼 분석. 브라우저에 저장하지 않으므로 새로 열면 다시 선택
  async openTestVideo(file) {
    this.close();
    this.img = null;
    try { localStorage.removeItem(this.imgKey()); } catch {}
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.autoplay = true; v.loop = true;
    v.src = this.videoUrl = URL.createObjectURL(file);
    vidHost.appendChild(v);
    this.video = v;
    this.openedAt = Date.now();
    this.needPick = false;
    await v.play().catch(e => { console.warn(e); toast(t("imageFail")); });
    this.render(S.running);
  }
  // 웹 주소 시험: 직접 영상 주소면 바로 분석, 일반 사이트 페이지면 새 창으로 열고 화면 캡처
  async openUrl() {
    const url = (this.cam.src?.url || "").trim();
    this.urlMode = urlKind(url);
    this.urlFailed = false;
    this.needPick = this.urlMode === "page";
    if (this.urlMode === "page") return;
    const fail = () => { this.urlFailed = true; this.needPick = true; this.close(); this.render(S.running); };
    if (this.urlMode === "mjpeg") {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onerror = fail;
      im.src = url;
      vidHost.appendChild(im);
      this.urlImg = im;
      return;
    }
    if (this.urlMode === "snapshot") { this.snapUrl = url; return; }
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.autoplay = true; v.loop = true;
    v.crossOrigin = "anonymous";
    v.addEventListener("error", fail);
    vidHost.appendChild(v);
    this.video = v;
    this.openedAt = Date.now();
    if (this.urlMode === "hls" && !v.canPlayType("application/vnd.apple.mpegurl")) {
      const Hls = await loadHls();
      if (Hls?.isSupported()) {
        this.hls = new Hls();
        this.hls.on(Hls.Events.ERROR, (e, d) => { if (d?.fatal) fail(); });
        this.hls.loadSource(url);
        this.hls.attachMedia(v);
      } else v.src = url;
    } else v.src = url;
    await v.play().catch(() => {});
  }
  openSite() {
    const url = (this.cam.src?.url || "").trim();
    if (url) window.open(url, "kcw_site_" + this.id, "width=1280,height=800");
  }
  resetJudge() {
    this.prevFull = null;
    for (const zs of Object.values(this.zs)) { zs.prev = null; zs.hist = []; zs.ratio = null; zs.state = "wait"; zs.since = now(); }
  }
  close() {
    if (this.hls) { try { this.hls.destroy(); } catch {} this.hls = null; }
    if (this.urlImg) { this.urlImg.onerror = null; this.urlImg.src = ""; this.urlImg.remove(); this.urlImg = null; }
    this.snapUrl = null;
    if (this.videoUrl) { URL.revokeObjectURL(this.videoUrl); this.videoUrl = null; }
    if (this.stream) { this.stream.getTracks().forEach(tr => tr.stop()); this.stream = null; }
    if (this.video) { this.video.pause(); this.video.removeAttribute("src"); this.video.srcObject = null; this.video.load(); this.video.remove(); this.video = null; }
  }
  // ---- 화면 지문: 이 칸에 원래 채널이 나오고 있는지 확인 ----
  refKey() { return "kcw.ref." + this.id; }
  resetRef() {
    this.ref = null; this.observed = true; this.miss = 0; this.unseenSince = null; this.sim = null;
    try { localStorage.removeItem(this.refKey()); } catch {}
  }
  loadRef() {
    try {
      const v = JSON.parse(localStorage.getItem(this.refKey()) || "null");
      if (Array.isArray(v) && v.length) return Float32Array.from(v);
    } catch {}
    return null;
  }
  saveRef() {
    try { localStorage.setItem(this.refKey(), JSON.stringify(Array.from(this.ref, v => Math.round(v * 1e4) / 1e4))); } catch {}
    this.refSavedAt = Date.now();
  }
  checkScreen(t0, st) {
    const g = sampleGray(this.canvas, [0, 0, 1, 1], 64);
    if (!g || g.w !== 64) { this.observed = true; return; }
    const fp = fingerprint(g, g.w, g.h);
    if (!this.ref) this.ref = this.loadRef();
    if (!this.ref || this.refNow) {        // 처음이면 지금 화면을 이 카메라의 기준으로 저장
      this.ref = fp; this.refNow = false; this.saveRef();
    }
    this.sim = fpSimilarity(fp, this.ref);
    if (this.sim != null && this.sim >= (+st.refMatch || DEFAULTS.refMatch)) {
      this.miss = 0; this.unseenSince = null; this.observed = true;
      adaptFingerprint(this.ref, fp, 0.05);
      if (Date.now() - (this.refSavedAt || 0) > 60000) this.saveRef();
    } else {
      this.miss = (this.miss || 0) + 1;
      if (this.miss >= 3) { this.observed = false; this.unseenSince ||= t0; }   // 잠깐 가려진 것은 무시
    }
  }
  updateCam(cam) {
    this.cam = cam;
    const k = JSON.stringify(cam.src || {});
    if (k !== this.srcKey) { this.srcKey = k; this.resetRef(); this.open(); }
    this.tile.querySelector(".tile-name").textContent = cam.name;
  }
  async grab() {
    let el, w, h;
    const type = this.type();
    if (type === "url" && this.urlImg) {
      el = this.urlImg; w = el.naturalWidth; h = el.naturalHeight;
    } else if (type === "url" && this.snapUrl) {
      try { el = await loadImg(this.snapUrl + (this.snapUrl.includes("?") ? "&" : "?") + "_t=" + Date.now(), true); }
      catch { this.urlFailed = true; this.needPick = true; this.snapUrl = null; throw new Error("snapshot failed"); }
      w = el.naturalWidth; h = el.naturalHeight;
    } else if (type === "image" && !this.video) {
      if (!this.img) throw new Error("no image");
      el = this.img; w = el.naturalWidth; h = el.naturalHeight;
    } else if (type === "jpeg") {
      const r = await fetch(`${this.base()}/api/frame.jpeg?src=${encodeURIComponent(this.cam.src.stream || "")}&t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error("http " + r.status);
      el = await createImageBitmap(await r.blob()); w = el.width; h = el.height;
    } else if (type === "screen") {
      const v = SCR.video;
      if (!v) { this.needPick = true; throw new Error("no screen"); }
      this.needPick = false;
      if (v.readyState < 2) throw new Error("screen not ready");
      el = v; w = v.videoWidth; h = v.videoHeight;
    } else {
      const v = this.video;
      if (!v || this.needPick) throw new Error("no video");
      if (v.readyState < 2) {
        if (type === "mp4" && Date.now() - this.openedAt > 15000) await this.open();
        throw new Error("video not ready");
      }
      if (type === "mp4") {   // 네트워크 영상만 멈춤 감지·재연결
        if (v.currentTime !== this.lastT) { this.lastT = v.currentTime; this.stallSince = Date.now(); }
        else if (Date.now() - this.stallSince > 10000) { await this.open(); throw new Error("stalled"); }
        if (v.buffered.length) {
          const end = v.buffered.end(v.buffered.length - 1);
          if (end - v.currentTime > 3) v.currentTime = end - 0.3;
        }
      }
      if (v.paused) v.play().catch(() => {});
      el = v; w = v.videoWidth; h = v.videoHeight;
    }
    if (!w || !h) throw new Error("empty frame");
    // 분할 화면의 한 칸만 잘라 크게 (작은 칸은 960px 폭까지 키움)
    const cr = cropOf(this.cam.src);
    const sx = cr[0] * w, sy = cr[1] * h, sw = Math.max(1, cr[2] * w), sh = Math.max(1, cr[3] * h);
    const sc = Math.min(1280 / sw, Math.max(1, 960 / sw)), W = Math.round(sw * sc), H = Math.round(sh * sc);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W; this.canvas.height = H;
      this.prevFull = null;
      for (const zs of Object.values(this.zs)) zs.prev = null;
    }
    this.ctx.drawImage(el, sx, sy, sw, sh, 0, 0, W, H);
    if (el.close && type === "jpeg") el.close();
    // 다른 사이트 영상을 읽을 수 없으면(보안 차단) 화면 캡처 방식으로 전환
    if (type === "url" && !this.stream) {
      try { this.ctx.getImageData(0, 0, 1, 1); }
      catch { this.urlFailed = true; this.needPick = true; this.close(); throw new Error("blocked"); }
    }
  }

  async step(analyze) {
    let grabbed = false;
    try { await this.grab(); grabbed = true; this.fail = 0; }
    catch { this.fail++; }
    const wasOnline = this.online;
    this.online = grabbed || (this.online && this.fail < 5);
    if (!analyze) { this.render(false); return; }

    const t0 = now(), p0 = performance.now();
    const st = S.settings, th = +st.pixThresh || DEFAULTS.pixThresh;
    const zones = Object.entries(this.cam.zones || {}).filter(([, z]) => z.eq);

    // 화면 전체가 한꺼번에 크게 바뀌면(조명, 야간 흑백 전환, 화면 배치 변경) 이번 회차는 판정에서 뺌
    this.skipped = false;
    if (grabbed) {
      const full = sampleGray(this.canvas, [0, 0, 1, 1], 160);
      const fd = diffFraction(full, this.prevFull, th);
      this.prevFull = full;
      if (fd !== null && fd * 100 >= (+st.skipPct || DEFAULTS.skipPct)) this.skipped = true;
      this.checkScreen(t0, st);
    }

    let changed = wasOnline !== this.online;
    const states = {};
    for (const [zid, z] of zones) {
      if (!this.zs[zid]) {
        this.zs[zid] = newZoneState(t0);
        logState(this, zid, z, null, "wait", 0);   // 감시 시작
      }
      const zs = this.zs[zid];
      let ns = zs.state;
      if (S.plan?.[this.id]?.[zid]) { ns = "off"; zs.hist = []; zs.prev = null; zs.ratio = null; }
      else if (!this.online) { ns = "nosig"; zs.hist = []; zs.prev = null; zs.ratio = null; }
      else if (grabbed && !this.observed) {
        // 다른 화면(다른 레이아웃·채널)이 떠 있음: 판정을 멈추고 상태 유지. 오래 계속되면 "신호없음"
        zs.prev = null;
        if (this.unseenSince && t0 - this.unseenSince >= (+st.unseenMin || DEFAULTS.unseenMin) * 60000) { ns = "nosig"; zs.hist = []; zs.ratio = null; }
      }
      else if (grabbed) {
        const g = sampleGray(this.canvas, z.eq);
        // 다각형 구역이면 모양 안쪽 화소만 계산 (통로 등 바깥은 무시)
        let mask = null;
        if (g && Array.isArray(z.poly) && z.poly.length >= 3) {
          const key = JSON.stringify(z.poly) + g.w + "x" + g.h;
          if (zs.maskKey !== key) { zs.maskKey = key; zs.mask = polyMask(z.poly, z.eq, g.w, g.h); }
          mask = zs.mask;
        }
        const d = diffFractionMasked(g, zs.prev, th, mask);
        zs.prev = g;
        if (d !== null && !this.skipped) {
          if (zs.state === "off" || zs.state === "nosig") { zs.state = "wait"; zs.since = t0; zs.hist = []; }
          ns = judge(zs, t0, d * 100 >= sensPct(z.sens), z);
        } else if (zs.state === "off" || zs.state === "nosig") ns = "wait";
      }
      if (ns !== zs.state) {
        // 모든 상태 변화를 기록 (가동 이력 화면에서 시간대별로 보여 주기 위해)
        {
          push(R("events"), {
            ts: serverTimestamp(), cam: this.id, zone: zid, eqId: z.eqId || "", name: z.name || "",
            area: z.area || this.cam.area || "", from: zs.state, to: ns, dur: Math.round((t0 - zs.since) / 1000),
            r: zs.ratio == null ? null : Math.round(zs.ratio * 100)
          }).catch(console.warn);
        }
        if (zs.state === "idle") remove(R(`crops/${this.id}__${zid}`)).catch(() => {});
        // 판정 중 → 비가동이면, 관찰을 시작한 시각부터 멈춰 있던 것으로 봄
        zs.since = zs.state === "wait" && ns === "idle" && zs.hist.length ? zs.hist[0][0] : t0;
        zs.state = ns; changed = true;
      }
      states[zid] = {
        state: zs.state, since: zs.since,
        r: zs.ratio == null ? null : Math.round(zs.ratio * 100), m: zs.motion ? 1 : 0
      };
    }
    for (const zid of Object.keys(this.zs)) if (!states[zid]) { delete this.zs[zid]; delete this.acc[zid]; changed = true; }
    this.ms = performance.now() - p0;

    // 근무조별 누적 시간
    const dt = this.lastAcc ? (t0 - this.lastAcc) / 1000 : 0;
    this.lastAcc = t0;
    if (dt > 0 && dt < 30 && this.observed) for (const [zid, s] of Object.entries(states)) {
      if (s.state !== "run" && s.state !== "idle") continue;
      const a = this.acc[zid] ||= { run: 0, idle: 0 };
      a[s.state] += dt;
    }
    if (t0 - this.lastFlush >= STATS_FLUSH_MS) this.flush();
    // 근무조가 바뀌면 그 시각의 상태를 이력에 한 번 남김 (긴 시간 변화가 없어도 이력 화면에서 상태를 알 수 있게)
    const sk = shiftOf(t0); const skKey = sk.date + sk.shift;
    if (this.shiftKey && this.shiftKey !== skKey) {
      for (const [zid, zs] of Object.entries(this.zs)) {
        const z = this.cam.zones?.[zid];
        if (z) logState(this, zid, z, zs.state, zs.state, Math.round((t0 - zs.since) / 1000));
      }
    }
    this.shiftKey = skKey;

    if (changed || t0 - this.lastLive >= LIVE_HEARTBEAT_MS) {
      this.lastLive = t0;
      set(R(`live/${this.id}`), { ts: serverTimestamp(), online: this.online, agent: S.agent, ms: Math.round(this.ms), zones: states,
        scr: this.observed ? 1 : 0, sim: this.sim == null ? null : Math.round(this.sim * 100) }).catch(console.warn);
    }
    // 원격 영상: 대시보드에서 누군가 보고 있을 때만
    if (grabbed && this.watchers > 0 && t0 - this.lastFrame >= +st.frameMs) {
      this.lastFrame = t0;
      set(R(`frames/${this.id}`), { ts: serverTimestamp(), jpg: toJpeg(this.canvas, +st.frameW, 0.6), p: [] }).catch(console.warn);
    }
    // 종합상황실: 누군가 보고 있을 때만 비가동 구역 확대 화면 올림
    if (grabbed && S.roomWatchers > 0 && t0 - (this.lastCrop || 0) >= CROP_MS) {
      this.lastCrop = t0;
      const idleZ = zones.filter(([zid]) => states[zid]?.state === "idle");
      if (idleZ.length) {
        const comp = composeOverlay(this.canvas, this.cam.zones, states);
        for (const [zid, z] of idleZ) {
          set(R(`crops/${this.id}__${zid}`), { ts: serverTimestamp(), jpg: cropAround(comp, z.eq) }).catch(console.warn);
        }
      }
    }
    if (grabbed && t0 - this.lastThumb >= THUMB_MS) {
      this.lastThumb = t0;
      set(R(`thumbs/${this.id}`), { ts: serverTimestamp(), jpg: toJpeg(this.canvas, 320, 0.5) }).catch(console.warn);
    }
    this.states = states;
    this.render(true);
  }
  flush() {
    this.lastFlush = now();
    const { date, shift } = shiftOf(now());
    const upd = {};
    for (const [zid, a] of Object.entries(this.acc)) {
      for (const k of ["run", "idle"]) {
        const whole = Math.floor(a[k]);
        if (whole >= 1) { upd[`${this.id}__${zid}/${k}`] = increment(whole); a[k] -= whole; }
      }
    }
    if (Object.keys(upd).length) update(R(`stats/${date}/${shift}`), upd).catch(console.warn);
  }
  stopped() {
    this.flush();
    // 분석 중지도 이력에 남김 (중지된 동안을 가동/비가동으로 잘못 보지 않도록)
    for (const [zid, zs] of Object.entries(this.zs)) {
      const z = this.cam.zones?.[zid];
      if (z && zs.state !== "nosig") logState(this, zid, z, zs.state, "nosig", Math.round((now() - zs.since) / 1000), true);
    }
    for (const zs of Object.values(this.zs)) { zs.hist = []; zs.ratio = null; zs.state = "wait"; zs.since = now(); }
    this.states = {}; this.lastAcc = 0;
    set(R(`live/${this.id}`), { ts: serverTimestamp(), online: false, agent: S.agent, stopped: true }).catch(() => {});
  }
  destroy() {
    // 카메라가 삭제된 경우에는 상태를 다시 쓰지 않음 (지운 기록이 되살아나지 않도록)
    if (S.running && S.cams[this.id]) this.stopped();
    this.unwatch(); this.close(); this.tile.remove();
  }

  buildTile() {
    const el = document.createElement("article");
    el.className = "tile panel";
    el.innerHTML = `
      <header class="tile-head"><label class="tile-sel"><input type="checkbox" tabindex="-1"></label><strong class="tile-name"></strong><span class="tile-meta meta"></span></header>
      <div class="tile-stage">
        <canvas class="tile-cv" width="640" height="360"></canvas>
        <div class="tile-pick" hidden>
          <p class="tile-pick-msg"></p>
          <div class="row">
            <button type="button" class="btn" data-act="site"></button>
            <button type="button" class="btn primary" data-act="pick"></button>
          </div>
        </div>
      </div>
      <footer class="tile-foot">
        <span class="tile-status"></span><span class="spacer"></span>
        <button type="button" class="btn small" data-act="full"></button>
        <button type="button" class="btn small admin-only" data-act="ref"></button>
        <button type="button" class="btn small" data-act="repick"></button>
        <button type="button" class="btn small" data-act="zones"></button>
        <button type="button" class="btn small admin-only" data-act="cam"></button>
      </footer>`;
    el.querySelector(".tile-name").textContent = this.cam.name;
    const pick = () => this.type() === "image" ? this.pickImage() : this.open(true);
    el.querySelector("[data-act=pick]").addEventListener("click", pick);
    el.querySelector("[data-act=repick]").addEventListener("click", pick);
    el.querySelector("[data-act=site]").addEventListener("click", () => this.openSite());
    el.querySelector("[data-act=zones]").addEventListener("click", () => openZones(this.id));
    const stage = el.querySelector(".tile-stage");
    const full = () => { if (document.fullscreenElement) document.exitFullscreen(); else stage.requestFullscreen?.().catch(() => {}); };
    el.querySelector("[data-act=full]").addEventListener("click", full);
    el.querySelector("[data-act=ref]").addEventListener("click", () => {
      if (!confirm(t("refConfirm"))) return;
      this.resetRef(); this.refNow = true; toast(t("refSaved"));
    });
    el.querySelector(".tile-cv").addEventListener("dblclick", full);
    el.querySelector("[data-act=cam]").addEventListener("click", () => openCam(this.id));
    // 여러 개 선택 모드: 칸 어디를 눌러도 선택/해제
    el.addEventListener("click", e => {
      if (!SEL.on) return;
      e.preventDefault(); e.stopPropagation();
      toggleSel(this.id);
    }, true);
    this.tile = el;
    this.tileCv = el.querySelector(".tile-cv");
    this.labelTile();
  }
  labelTile() {
    const q = s => this.tile.querySelector(s);
    q("[data-act=zones]").textContent = t("editZones");
    q("[data-act=full]").textContent = t("bigView");
    q("[data-act=ref]").textContent = t("refSave");
    q("[data-act=cam]").textContent = t("editCamera");
    const img = this.type() === "image";
    q("[data-act=pick]").textContent = t(img ? "pickImage" : "pickScreen");
    q("[data-act=repick]").textContent = t(img ? "repickImage" : "repickScreen");
    q(".tile-pick-msg").textContent = t(img ? "needImage" : "needPick");
    q("[data-act=site]").textContent = t("openSite");
    q("[data-act=site]").hidden = this.type() !== "url";
    if (this.type() === "url") q(".tile-pick-msg").textContent = t(this.urlFailed ? "urlBlocked" : "urlPageMsg");
  }
  render(analyzing) {
    const screen = ["screen", "image", "url"].includes(this.type());
    const lk = this.type() + (this.urlFailed ? "!" : "");
    if (this.labeledType !== lk) { this.labeledType = lk; this.labelTile(); }
    this.tile.querySelector(".tile-pick").hidden = !(screen && this.needPick);
    this.tile.querySelector("[data-act=repick]").hidden = !screen || this.needPick;
    const st = this.tile.querySelector(".tile-status");
    const zn = Object.keys(this.cam.zones || {}).length;
    this.tile.querySelector(".tile-meta").textContent = `${areaLabel(this.cam.area)} / ${zn}`;
    if (screen && this.needPick) { st.textContent = t(this.type() === "image" ? "needImageShort" : "needPickShort"); st.className = "tile-status bad"; }
    else if (!this.canvas.width || !this.online) { st.textContent = t("stOffline"); st.className = "tile-status bad"; }
    else if (analyzing) {
      if (!this.observed) {
        st.textContent = t("otherScreen", { s: this.sim == null ? "-" : Math.round(this.sim * 100) });
        st.className = "tile-status bad";
      } else {
        st.textContent = `${t("stOnline")}  ${Math.round(this.ms)}ms` + (this.skipped ? `  ${t("skippedNow")}` : "") +
          (this.watchers ? `  ${t("watching", { n: this.watchers })}` : "");
        st.className = "tile-status on";
      }
    } else { st.textContent = t("stPreview"); st.className = "tile-status"; }
    if (!this.canvas.width) return;
    const cv = this.tileCv;
    if (cv.width !== this.canvas.width || cv.height !== this.canvas.height) { cv.width = this.canvas.width; cv.height = this.canvas.height; }
    const c = cv.getContext("2d");
    c.drawImage(this.canvas, 0, 0);
    drawOverlay(c, cv.width, cv.height, this.cam.zones, analyzing ? this.states : {}, []);
  }
}

// 영역 지정 도구에 쓸 원본(잘라내기 전) 화면
function sourceOf(type, cid) {
  if (type === "screen") return SCR.video && SCR.video.videoWidth ? SCR.video : null;
  const r = cid && S.runners.get(cid);
  if (!r) return null;
  if (r.video && r.video.videoWidth) return r.video;
  if (r.img && r.img.naturalWidth) return r.img;
  if (r.urlImg && r.urlImg.naturalWidth) return r.urlImg;
  return null;
}
const srcW = el => el.videoWidth || el.naturalWidth || el.width;
const srcH = el => el.videoHeight || el.naturalHeight || el.height;

function logState(r, zid, z, from, to, dur, stop = false) {
  push(R("events"), {
    ts: serverTimestamp(), cam: r.id, zone: zid, eqId: z.eqId || "", name: z.name || "",
    area: z.area || r.cam.area || "", from: from || "", to, dur, ...(stop ? { stop: true } : {})
  }).catch(console.warn);
}

function loadImg(url, cors = false) {
  return new Promise((res, rej) => {
    const i = new Image();
    if (cors) i.crossOrigin = "anonymous";
    i.onload = () => res(i); i.onerror = rej; i.src = url;
  });
}
// 주소 모양으로 종류 판단
function urlKind(url) {
  const u = url.toLowerCase().split("#")[0];
  const path = u.split("?")[0];
  if (/\.m3u8$/.test(path)) return "hls";
  if (/\.(mp4|webm|ogv|mov)$/.test(path)) return "video";
  if (/mjpe?g|video\.cgi|faststream|action=stream/.test(u)) return "mjpeg";
  if (/\.(jpe?g|png)$/.test(path) || /snapshot|image\.cgi|jpg\.cgi/.test(u)) return "snapshot";
  return "page";
}
let hlsPromise = null;
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  return hlsPromise ||= new Promise(res => {
    const sc = document.createElement("script");
    sc.src = "https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js";
    sc.onload = () => res(window.Hls || null);
    sc.onerror = () => res(null);
    document.head.appendChild(sc);
  });
}

// 화면 + 박스 표시를 합친 캔버스
const compCanvas = document.createElement("canvas");
function composeOverlay(src, zones, states) {
  compCanvas.width = src.width; compCanvas.height = src.height;
  const c = compCanvas.getContext("2d");
  c.drawImage(src, 0, 0);
  drawOverlay(c, src.width, src.height, zones, states, []);
  return compCanvas;
}
// 박스 주변을 4:3으로 넉넉히 잘라 JPEG로
const cropCanvas = document.createElement("canvas");
function cropAround(src, box) {
  const W = src.width, H = src.height;
  const bw = box[2] * W, bh = box[3] * H, cx = (box[0] + box[2] / 2) * W, cy = (box[1] + box[3] / 2) * H;
  let cw = Math.max(bw * 2.2, W * 0.3), ch = Math.max(bh * 2.2, cw * 0.75);
  cw = Math.max(cw, ch * 4 / 3);
  cw = Math.min(cw, W); ch = Math.min(ch, H);
  const x = Math.min(Math.max(0, cx - cw / 2), W - cw), y = Math.min(Math.max(0, cy - ch / 2), H - ch);
  const sc = Math.min(1, 640 / cw);
  cropCanvas.width = Math.round(cw * sc); cropCanvas.height = Math.round(ch * sc);
  cropCanvas.getContext("2d").drawImage(src, x, y, cw, ch, 0, 0, cropCanvas.width, cropCanvas.height);
  return cropCanvas.toDataURL("image/jpeg", 0.65);
}

const jpgCanvas = document.createElement("canvas");
function toJpeg(src, maxW, q) {
  const sc = Math.min(1, maxW / src.width);
  jpgCanvas.width = Math.round(src.width * sc);
  jpgCanvas.height = Math.round(src.height * sc);
  jpgCanvas.getContext("2d").drawImage(src, 0, 0, jpgCanvas.width, jpgCanvas.height);
  return jpgCanvas.toDataURL("image/jpeg", q);
}

/* =========================================================
   실행 루프
   ========================================================= */
async function loop() {
  const t0 = performance.now();
  for (const r of [...S.runners.values()]) {
    try { await r.step(S.running); } catch (e) { console.error(e); }
  }
  const spent = performance.now() - t0;
  setTimeout(loop, Math.max(100, (S.running ? +S.settings.analyzeMs : 1000) - spent));
}

async function setRunning(on) {
  if (on) {
    S.running = true;
    try { S.wake = await navigator.wakeLock?.request("screen"); } catch {}
  } else {
    S.running = false;
    for (const r of S.runners.values()) r.stopped();
    try { await S.wake?.release(); } catch {}
    S.wake = null;
  }
  updateRunBtn();
  heartbeat();
}
// 분석 중에 탭을 닫거나 다른 주소로 이동하면 분석이 멈추므로 확인
window.addEventListener("beforeunload", e => {
  if (S.running) { e.preventDefault(); e.returnValue = ""; }
});
const bc = "BroadcastChannel" in window ? new BroadcastChannel("kcw-analyzer") : null;
// 같은 PC 이름의 분석 창이 이미 열려 있는지 (PC 이름이 다르면 같은 컴퓨터에서 함께 실행 가능)
bc?.addEventListener("message", e => { if (e.data?.who === S.agent && S.started) bc.postMessage({ running: S.agent }); });
function checkDuplicate() {
  if (!bc) return Promise.resolve(false);
  return new Promise(res => {
    const on = e => { if (e.data?.running === S.agent) { bc.removeEventListener("message", on); res(true); } };
    bc.addEventListener("message", on);
    bc.postMessage({ who: S.agent });
    setTimeout(() => { bc.removeEventListener("message", on); res(false); }, 600);
  });
}
document.addEventListener("visibilitychange", async () => {
  if (S.running && !document.hidden && !S.wake) { try { S.wake = await navigator.wakeLock?.request("screen"); } catch {} }
});
function updateRunBtn() {
  const b = $("#runBtn");
  b.textContent = S.running ? t("stop") : t("start");
  b.classList.toggle("primary", !S.running);
  b.classList.toggle("danger", S.running);
  $("#brandMark").classList.toggle("alert", !S.running);
}
function heartbeat() {
  if (!S.user || !S.started) return;
  const r = R(`agents/${S.agent}`);
  set(r, { ts: serverTimestamp(), running: S.running, cams: [...S.runners.keys()], by: S.user.email || "" }).catch(() => {});
  onDisconnect(r).remove();
}

function syncRunners(relabel = false) {
  const mine = Object.entries(S.cams).filter(([, c]) => cleanKey(c.agent) === S.agent)
    .sort((a, b) => natCmp(a[1].name, b[1].name));
  const ids = new Set(mine.map(([id]) => id));
  for (const [id, r] of S.runners) if (!ids.has(id)) { r.destroy(); S.runners.delete(id); }
  const tiles = $("#tiles");
  for (const [id, c] of mine) {
    let r = S.runners.get(id);
    if (!r) { r = new Runner(id, c); S.runners.set(id, r); r.open(); }
    else { r.updateCam(c); if (relabel) r.labelTile(); }
    tiles.appendChild(r.tile);
  }
  tiles.querySelectorAll(".empty-tiles, .other-cams").forEach(e => e.remove());
  if (typeof SEL !== "undefined" && SEL.on) setTimeout(syncSel, 0);
  if (!mine.length) {
    const p = document.createElement("p");
    p.className = "empty-tiles";
    p.textContent = t("noLocalCams", { pc: S.agent });
    tiles.appendChild(p);
  }
  const others = Object.entries(S.cams).filter(([id]) => !ids.has(id));
  if (others.length && S.role === "admin") {
    const box = document.createElement("div");
    box.className = "other-cams";
    box.innerHTML = `<b>${esc(t("otherCams"))}</b><ul>${others.map(([id, c]) =>
      `<li>${esc(c.name)} <span class="meta">${esc(c.agent)}</span><button type="button" class="btn small" data-edit="${esc(id)}">${esc(t("editCamera"))}</button></li>`).join("")}</ul>`;
    box.addEventListener("click", e => { const b = e.target.closest("[data-edit]"); if (b) openCam(b.dataset.edit); });
    tiles.appendChild(box);
  }
  // CCTV 주소(go2rtc)를 쓰는 카메라가 있는데 https로 열었으면 안내
  const needLocal = mine.some(([, c]) => ["mp4", "jpeg"].includes(c.src?.type));
  const w = $("#warn");
  w.hidden = !(needLocal && location.protocol === "https:");
  if (!w.hidden) w.textContent = t("httpsWarn");
  heartbeat();
}

/* =========================================================
   UI: 툴바, 입력 설정, 분석 설정
   ========================================================= */
function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function bindUi() {
  $("#runBtn").addEventListener("click", () => setRunning(!S.running));
  $("#autoStart").addEventListener("change", e => LS.set("autostart", e.target.checked));
  const sizeSel = $("#tileSize");
  sizeSel.value = LS.get("tileSize", "m");
  $("#tiles").dataset.size = sizeSel.value;
  sizeSel.addEventListener("change", () => { $("#tiles").dataset.size = sizeSel.value; LS.set("tileSize", sizeSel.value); });
  $("#agentName").addEventListener("change", e => {
    const v = cleanKey(e.target.value);
    e.target.value = v;
    if (v === S.agent) return;
    remove(R(`agents/${S.agent}`)).catch(() => {});
    S.agent = v;
    if (URL_PC) history.replaceState(null, "", `?pc=${encodeURIComponent(v)}`);
    else LS.set("agent", v);
    syncRunners();
  });
  $("#addCamBtn").addEventListener("click", () => openCam(null));
  $("#newWinBtn").addEventListener("click", () => {
    const used = new Set([S.agent, ...Object.values(S.cams).map(c => cleanKey(c.agent))]);
    let n = 2; while (used.has(`PC-${n}`)) n++;
    const v = prompt(t("newWinAsk"), `PC-${n}`);
    if (!v) return;
    const pc = cleanKey(v);
    if (pc === S.agent) { alert(t("newWinSame", { pc })); return; }
    window.open(`analyzer.html?pc=${encodeURIComponent(pc)}`, `kcw_analyzer_${pc}`);
  });
  $("#settingsBtn").addEventListener("click", openSettings);
  document.querySelectorAll("dialog [data-close]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));

  const f = $("#camForm");
  f.type.addEventListener("change", syncSrcFields);
  $("#loadCams").addEventListener("click", loadWebcams);
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const id = f.dataset.id || "c" + Date.now().toString(36);
    const old = S.cams[id] || {};
    const type = f.type.value;
    const cam = {
      name: f.name.value.trim(), area: f.area.value, agent: cleanKey(f.agent.value),
      src: type === "screen" || type === "image" ? { type, ...(f.dataset.crop ? { crop: JSON.parse(f.dataset.crop) } : {}) }
        : type === "url" ? { type, url: f.url.value.trim() }
        : type === "webcam" ? { type, deviceId: f.deviceId.value || "", ...(f.dataset.crop ? { crop: JSON.parse(f.dataset.crop) } : {}) }
        : { type, stream: f.stream.value.trim(), base: f.base.value.trim() },
      zones: old.zones || {}
    };
    try { await set(R(`config/cameras/${id}`), cam); $("#camDlg").close(); toast(t("saved")); }
    catch (err) { console.warn(err); toast(t("saveFail")); }
  });
  $("#camDel").addEventListener("click", async () => {
    const id = f.dataset.id;
    if (!id || !confirm(t("confirmDelCam"))) return;
    try {
      await remove(R(`config/cameras/${id}`));
      await Promise.all(["live", "frames", "thumbs", "plan"].map(k => remove(R(`${k}/${id}`)).catch(() => {})));
      $("#camDlg").close();
    } catch (err) { console.warn(err); toast(t("saveFail")); }
  });

  $("#setForm").addEventListener("submit", async e => {
    e.preventDefault();
    const s = e.target;
    const v = {
      analyzeMs: +s.analyzeMs.value || DEFAULTS.analyzeMs, pixThresh: +s.pixThresh.value || DEFAULTS.pixThresh,
      skipPct: +s.skipPct.value || DEFAULTS.skipPct, frameMs: +s.frameMs.value || DEFAULTS.frameMs,
      frameW: +s.frameW.value || DEFAULTS.frameW,
      refMatch: Math.min(0.95, Math.max(0.3, +s.refMatch.value || DEFAULTS.refMatch)),
      unseenMin: Math.min(240, Math.max(1, +s.unseenMin.value || DEFAULTS.unseenMin))
    };
    try { await set(R("config/settings"), v); $("#setDlg").close(); toast(t("saved")); }
    catch (err) { console.warn(err); toast(t("saveFail")); }
  });

  bindZoneEditor();
  bindAlertUi();
  bindCropTools();
  bindSelection();
}

function syncSrcFields() {
  const f = $("#camForm"), ty = f.type.value;
  f.querySelector(".src-go2rtc").hidden = !(ty === "mp4" || ty === "jpeg");
  f.querySelector(".src-webcam").hidden = ty !== "webcam";
  f.querySelector(".src-screen").hidden = ty !== "screen";
  f.querySelector(".src-image").hidden = ty !== "image";
  f.querySelector(".src-url").hidden = ty !== "url";
  $("#cropRow").hidden = !["screen", "image", "webcam"].includes(ty);
  f.url.required = ty === "url";
  f.stream.required = ty === "mp4" || ty === "jpeg";
}
async function loadWebcams(keep) {
  const sel = $("#camForm").deviceId;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    s.getTracks().forEach(tr => tr.stop());
  } catch {}
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
  const cur = typeof keep === "string" ? keep : sel.value;
  sel.innerHTML = devs.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || "Camera " + (i + 1))}</option>`).join("");
  if (cur) sel.value = cur;
}
function openCam(id) {
  const f = $("#camForm"), c = id ? S.cams[id] : null;
  f.dataset.id = id || "";
  f.name.value = c?.name || "";
  f.area.value = c?.area || SITE.areas[0];
  f.agent.value = c?.agent || S.agent;
  f.type.value = c?.src?.type || "screen";
  f.stream.value = c?.src?.stream || "";
  f.base.value = c?.src?.base || "";
  f.url.value = c?.src?.url || "";
  f.deviceId.innerHTML = c?.src?.deviceId ? `<option value="${esc(c.src.deviceId)}">${esc(c.src.deviceId.slice(0, 12))}…</option>` : "";
  $("#camDel").hidden = !id;
  syncSrcFields();
  if (f.type.value === "webcam") loadWebcams(c?.src?.deviceId || "");
  f.dataset.crop = c?.src?.crop ? JSON.stringify(c.src.crop) : "";
  syncCropLabel();
  $("#camDlg").showModal();
}
function openSettings() {
  const s = $("#setForm"), v = S.settings;
  s.analyzeMs.value = v.analyzeMs; s.pixThresh.value = v.pixThresh; s.skipPct.value = v.skipPct;
  s.frameMs.value = v.frameMs; s.frameW.value = v.frameW;
  s.refMatch.value = v.refMatch; s.unseenMin.value = v.unseenMin;
  $("#setDlg").showModal();
}

/* =========================================================
   감시 구역 편집기
   ========================================================= */
const Z = { cid: null, zid: null, draft: null, timer: null, ed: null };
const zcv = () => $("#zoneCanvas");

function openZones(cid) {
  const r = S.runners.get(cid);
  if (!r) { toast(t("zoneNeedLocal")); return; }
  Z.cid = cid;
  $("#zoneCamName").textContent = S.cams[cid]?.name || "";
  newDraft();
  renderZoneList();
  $("#zoneDlg").showModal();
  clearInterval(Z.timer);
  Z.timer = setInterval(() => { drawZone(); syncZoneState(); }, 500);
  drawZone();
}
function newDraft() {
  Z.zid = null;
  Z.draft = { eqId: nextEqId(S.cams), name: "", area: S.cams[Z.cid]?.area || SITE.areas[0], windowMin: 5, minRatio: 30, sens: 5 };
  Z.ed.set(null);
  fillZoneForm();
}
function pickZone(zid) {
  const z = S.cams[Z.cid]?.zones?.[zid];
  if (!z) return;
  Z.zid = zid;
  Z.draft = { windowMin: 5, minRatio: 30, sens: 5, ...JSON.parse(JSON.stringify(z)) };
  Z.ed.set(zonePoly(z));
  fillZoneForm();
  renderZoneList();
}
function fillZoneForm() {
  const f = $("#zoneForm"), d = Z.draft;
  f.eqId.value = d.eqId || ""; f.name.value = d.name || "";
  f.area.value = d.area || SITE.areas[0];
  f.windowMin.value = d.windowMin; f.minRatio.value = d.minRatio; f.sens.value = d.sens;
  $("#sensVal").textContent = d.sens;
  $("#zoneDel").hidden = !Z.zid;
  syncZoneState();
}
function syncZoneState() {
  let msg = t("boxStatus", { a: Z.ed.poly ? t("done") : t("missing") });
  const s = Z.zid && S.runners.get(Z.cid)?.states?.[Z.zid];
  if (s && s.r != null) msg += "  /  " + t("liveRatio", { r: s.r, m: Z.draft.windowMin });
  $("#zoneState").textContent = msg;
  document.querySelectorAll("#zoneMode button").forEach(b => b.classList.toggle("on", b.dataset.mode === Z.ed.mode));
}
function renderZoneList() {
  const zones = S.cams[Z.cid]?.zones || {};
  $("#zoneList").innerHTML = Object.entries(zones).sort((a, b) => natCmp(a[1].eqId, b[1].eqId))
    .map(([zid, z]) => `<li><button type="button" data-zid="${esc(zid)}" class="${zid === Z.zid ? "sel" : ""}">${esc(z.eqId)}</button></li>`).join("");
}
function drawZone() {
  const r = S.runners.get(Z.cid), cv = zcv();
  if (!r || !r.canvas.width) return;
  if (cv.width !== r.canvas.width || cv.height !== r.canvas.height) { cv.width = r.canvas.width; cv.height = r.canvas.height; }
  const c = cv.getContext("2d"), W = cv.width, H = cv.height;
  c.drawImage(r.canvas, 0, 0);
  for (const [zid, z] of Object.entries(S.cams[Z.cid]?.zones || {})) {
    if (zid !== Z.zid) strokePoly(c, W, H, zonePoly(z), "rgba(255,255,255,.75)", z.eqId);
  }
  Z.ed.draw(c, W, H, COLORS.person, Z.draft.eqId || "");
}
function bindZoneEditor() {
  Z.ed = createShapeEditor(zcv(), () => { drawZone(); syncZoneState(); });
  document.querySelectorAll("#zoneMode button").forEach(b => b.addEventListener("click", () => { Z.ed.setMode(b.dataset.mode); syncZoneState(); }));
  const f = $("#zoneForm");
  $("#zoneList").addEventListener("click", e => { const b = e.target.closest("[data-zid]"); if (b) pickZone(b.dataset.zid); });
  $("#zoneNew").addEventListener("click", () => { newDraft(); renderZoneList(); drawZone(); });
  f.eqId.addEventListener("input", e => { Z.draft.eqId = e.target.value; drawZone(); });
  f.sens.addEventListener("input", e => { $("#sensVal").textContent = e.target.value; });
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const poly = Z.ed.poly;
    const d = {
      eqId: f.eqId.value.trim(), name: f.name.value.trim(), area: f.area.value,
      windowMin: Math.min(60, Math.max(1, +f.windowMin.value || 5)),
      minRatio: Math.min(95, Math.max(1, +f.minRatio.value || 30)),
      sens: Math.min(10, Math.max(1, +f.sens.value || 5))
    };
    if (!d.eqId) d.eqId = nextEqId(S.cams);
    if (!poly) { toast(t("zoneNeedBox")); return; }
    // 같은 설비번호가 다른 곳에 있으면 확인 (목록에서 구분이 안 되므로)
    const dupAt = [];
    for (const [cid2, cam2] of Object.entries((() => S.cams)())) for (const [zid2, z2] of Object.entries(cam2.zones || {})) {
      if ((cid2 !== Z.cid || zid2 !== Z.zid) && String(z2.eqId || "").trim().toLowerCase() === d.eqId.toLowerCase())
        dupAt.push(`${areaLabel(z2.area || cam2.area)} / ${cam2.name}`);
    }
    if (dupAt.length && !confirm(t("dupEqId", { id: d.eqId, where: dupAt.join(", ") }))) return;

    d.poly = poly;
    d.eq = polyBBox(poly).map(v => Math.round(v * 10000) / 10000);   // 바깥 사각형 (확대 화면·표시용)
    const isNew = !Z.zid;
    const zid = Z.zid || "z" + Date.now().toString(36);
    try {
      await set(R(`config/cameras/${Z.cid}/zones/${zid}`), d);
      S.cams[Z.cid].zones = { ...(S.cams[Z.cid].zones || {}), [zid]: d };
      // 새 설비를 저장하면 바로 다음 새 설비(다음 번호)로 넘어가 연달아 그릴 수 있게
      if (isNew) { newDraft(); renderZoneList(); drawZone(); toast(t("savedNext", { id: d.eqId, next: Z.draft.eqId })); }
      else { Z.zid = zid; Z.draft = d; fillZoneForm(); renderZoneList(); toast(t("saved")); }
    } catch (err) { console.warn(err); toast(t("saveFail")); }
  });
  $("#zoneDel").addEventListener("click", async () => {
    if (!Z.zid || !confirm(t("confirmDelZone"))) return;
    try {
      await remove(R(`config/cameras/${Z.cid}/zones/${Z.zid}`));
      await remove(R(`plan/${Z.cid}/${Z.zid}`)).catch(() => {});
      newDraft(); renderZoneList(); drawZone();
    } catch (err) { console.warn(err); toast(t("saveFail")); }
  });
  $("#zoneClose").addEventListener("click", () => $("#zoneDlg").close());
  $("#zoneDlg").addEventListener("close", () => { clearInterval(Z.timer); Z.timer = null; });
}

/* =========================================================
   LINE 알림: 분석 PC가 30초마다 확인해서, 새로 생긴 비가동 의심 설비를 한 메시지로 묶어 보냄
   (LINE 공식계정은 "보낸 횟수 × 받는 사람 수"로 계산되므로 묶어서 보냄)
   ========================================================= */
const AL = { sent: new Map() };   // key → 마지막 알림 시각
const ALERT_DEF = { enabled: false, delayMin: 10, repeatMin: 60, resolved: false, quiet: "", langs: ["th", "ko"] };

function minutesOfDay(ts) { const p = tzParts(ts); return +p.hour * 60 + +p.minute; }
// "12:00-13:00, 00:00-00:30" 형식 (태국 현지 시간)
function inQuiet(spec, ts) {
  const m = minutesOfDay(ts);
  return String(spec || "").split(/[,;\n]+/).some(part => {
    const r = part.trim().match(/^(\d{1,2}):(\d{2})\s*[-~]\s*(\d{1,2}):(\d{2})$/);
    if (!r) return false;
    const a = +r[1] * 60 + +r[2], b = +r[3] * 60 + +r[4];
    return a <= b ? m >= a && m < b : m >= a || m < b;
  });
}
function langsOf(c) { return (c.langs?.length ? c.langs : ALERT_DEF.langs).filter(l => ["ko", "en", "th"].includes(l)); }
function head(langs, key, vars) { return langs.map(l => tl(l, key, vars)).join(" / "); }

function buildMessage(c, groups) {
  const langs = langsOf(c), n = groups.newIdle.length + groups.still.length;
  const out = [n ? `[KOWOO THAI] ${head(langs, "alertHead", { n })}` : "[KOWOO THAI]"];
  const line = (it, mark = "") => `${mark}• ${areaLabel(it.area)} ${it.eqId}${it.name ? " " + it.name : ""}  ${it.min} min`;
  groups.newIdle.forEach(it => out.push(line(it)));
  if (groups.still.length) { out.push(head(langs, "alertStill")); groups.still.forEach(it => out.push(line(it))); }
  if (groups.nosig.length) { out.push(head(langs, "alertNosig")); groups.nosig.forEach(it => out.push(`• ${it.name}  ${it.min} min`)); }
  if (groups.back.length) { out.push(head(langs, "alertBack")); groups.back.forEach(it => out.push(`• ${it.eqId}`)); }
  out.push(fmtClock(now()) + " (TH)");
  if (c.roomUrl) out.push(c.roomUrl);
  return out.join("\n");
}

async function sendLine(c, text, test = false) {
  if (!c?.url) throw new Error("no url");
  // 앱스 스크립트는 다른 사이트 호출 응답을 읽을 수 없으므로 no-cors로 보내고 결과는 LINE에서 확인
  await fetch(c.url, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ key: c.key || "", text }) });
  push(R("alertLog"), { ts: serverTimestamp(), text, test, agent: S.agent }).catch(() => {});
}

async function checkAlerts() {
  const c = { ...ALERT_DEF, ...(S.alertCfg || {}) };
  if (!S.running || !c.enabled || !c.url) return;
  const tnow = now(), delay = Math.max(1, +c.delayMin || 10) * 60000, rep = Math.max(0, +c.repeatMin || 0) * 60000;
  const quiet = inQuiet(c.quiet, tnow);
  const g = { newIdle: [], still: [], nosig: [], back: [] }, mark = [];
  for (const r of S.runners.values()) {
    // 카메라 전체 신호 없음 (화면 미선택, 영상 끊김)
    const camKey = r.id + "/_cam";
    const off = !r.online || r.needPick;
    if (off) r.offSince ||= tnow; else r.offSince = null;
    if (off && tnow - r.offSince >= delay) {
      const last = AL.sent.get(camKey);
      if (!last || (rep && tnow - last >= rep)) { g.nosig.push({ name: r.cam.name, min: Math.round((tnow - r.offSince) / 60000) }); mark.push(camKey); }
    } else if (!off) AL.sent.delete(camKey);

    for (const [zid, z] of Object.entries(r.cam.zones || {})) {
      const key = r.id + "/" + zid, st = r.states?.[zid];
      const it = { eqId: z.eqId || "?", name: z.name || "", area: z.area || r.cam.area || "", min: st?.since ? Math.round((tnow - st.since) / 60000) : 0 };
      if (st?.state === "idle" && tnow - st.since >= delay) {
        const last = AL.sent.get(key);
        if (!last) { g.newIdle.push(it); mark.push(key); }
        else if (rep && tnow - last >= rep) { g.still.push(it); mark.push(key); }
      } else if (AL.sent.has(key) && st?.state !== "idle") {
        if (st?.state === "run" && c.resolved) g.back.push(it);
        AL.sent.delete(key);
      }
    }
  }
  if (quiet) return;   // 쉬는 시간: 보내지 않음 (끝난 뒤에도 계속 비가동이면 그때 보냄)
  if (!g.newIdle.length && !g.still.length && !g.nosig.length && !g.back.length) return;
  try {
    await sendLine(c, buildMessage(c, g));
    mark.forEach(k => AL.sent.set(k, tnow));
  } catch (e) { console.warn("alert", e); }
}

function bindAlertUi() {
  const f = $("#alertForm");
  $("#alertBtn").addEventListener("click", () => {
    const c = { ...ALERT_DEF, ...(S.alertCfg || {}) };
    f.url.value = c.url || ""; f.key.value = c.key || "";
    f.enabled.checked = !!c.enabled; f.resolved.checked = !!c.resolved;
    f.delayMin.value = c.delayMin; f.repeatMin.value = c.repeatMin; f.quiet.value = c.quiet || "";
    f.roomUrl.value = c.roomUrl || (location.protocol === "https:" ? location.href.replace(/analyzer\.html.*$/, "room.html") : "https://appshin.github.io/kowoo-machine-watch/room.html");
    f.querySelectorAll("[name=langs]").forEach(cb => { cb.checked = langsOf(c).includes(cb.value); });
    $("#alertDlg").showModal();
  });
  const read = () => ({
    url: f.url.value.trim(), key: f.key.value.trim(), enabled: f.enabled.checked, resolved: f.resolved.checked,
    delayMin: Math.min(240, Math.max(1, +f.delayMin.value || 10)), repeatMin: Math.min(1440, Math.max(0, +f.repeatMin.value || 0)),
    quiet: f.quiet.value.trim(), roomUrl: f.roomUrl.value.trim(),
    langs: [...f.querySelectorAll("[name=langs]:checked")].map(cb => cb.value)
  });
  f.addEventListener("submit", async e => {
    e.preventDefault();
    try { await set(ALERT(), read()); $("#alertDlg").close(); toast(t("saved")); }
    catch (err) { console.warn(err); toast(t("saveFail")); }
  });
  $("#alertTest").addEventListener("click", async () => {
    const c = read();
    if (!c.url) { toast(t("alNeedUrl")); return; }
    try { await sendLine(c, `[KOWOO THAI] ${head(langsOf(c), "alTestText")}\n${c.roomUrl}`, true); toast(t("alTestSent")); }
    catch (err) { console.warn(err); toast(t("saveFail")); }
  });
}

/* =========================================================
   화면 영역 지정 (분할 화면에서 한 칸만 쓰기) + 분할 화면 자동 나누기
   ========================================================= */
const CR = { mode: null, rect: null, drag: null, timer: null, srcType: "screen", cid: null };

function syncCropLabel() {
  const f = $("#camForm");
  $("#cropState").textContent = f.dataset.crop ? t("cropSet") : t("cropAll");
}
async function openCropDlg(mode, retried = false) {
  const f = $("#camForm");
  CR.mode = mode;
  CR.srcType = mode === "split" ? "screen" : f.type.value;
  CR.cid = mode === "split" ? null : f.dataset.id || null;
  const src = sourceOf(CR.srcType, CR.cid);
  if (!src) {
    // CCTV 화면이 아직 선택되지 않았으면 여기서 바로 선택하고, 영상이 들어오면 창을 연다
    if (CR.srcType === "screen" && !retried) {
      await pickScreen(true);
      for (let i = 0; i < 30 && !(SCR.video && SCR.video.videoWidth); i++) await new Promise(r => setTimeout(r, 100));
      if (SCR.video && SCR.video.videoWidth) return openCropDlg(mode, true);
    }
    toast(t(CR.srcType === "screen" ? "cropNeedScreen" : "cropNeedSource"));
    return;
  }
  CR.rect = mode === "crop" && f.dataset.crop ? JSON.parse(f.dataset.crop) : null;
  $("#cropTitle").textContent = t(mode === "split" ? "splitTool" : "cropLabel");
  $("#cropHelp").textContent = t(mode === "split" ? "splitHelp" : "cropHelp");
  $("#splitFields").hidden = mode !== "split";
  $("#cropOk").textContent = mode === "split" ? t("splitCreate", { n: splitN() }) : t("save");
  if (mode === "split") {
    const sf = $("#splitForm");
    sf.area.innerHTML = SITE.areas.map(a => `<option value="${a}">${esc(areaLabel(a))}</option>`).join("");
  }
  $("#cropDlg").showModal();
  clearInterval(CR.timer);
  CR.timer = setInterval(drawCrop, 400);
  drawCrop();
}
function splitN() {
  const sf = $("#splitForm");
  return Math.max(1, +sf.rows.value || 1) * Math.max(1, +sf.cols.value || 1);
}
function drawCrop() {
  const src = sourceOf(CR.srcType, CR.cid), cv = $("#cropCanvas");
  if (!src) return;
  const sw = srcW(src), sh = srcH(src), sc = Math.min(1, 1600 / sw);
  const W = Math.round(sw * sc), H = Math.round(sh * sc);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const c = cv.getContext("2d");
  c.drawImage(src, 0, 0, W, H);
  const r = CR.drag?.cur || CR.rect;
  if (!r) return;
  const [x, y, w, h] = [r[0] * W, r[1] * H, r[2] * W, r[3] * H];
  c.fillStyle = "rgba(0,0,0,.45)";
  c.fillRect(0, 0, W, y); c.fillRect(0, y + h, W, H - y - h); c.fillRect(0, y, x, h); c.fillRect(x + w, y, W - x - w, h);
  c.strokeStyle = COLORS.person; c.lineWidth = 3; c.strokeRect(x, y, w, h);
  if (CR.mode === "split") {
    const sf = $("#splitForm"), rows = Math.max(1, +sf.rows.value || 1), cols = Math.max(1, +sf.cols.value || 1);
    c.lineWidth = 2; c.font = `600 ${Math.max(14, Math.round(W / 60))}px system-ui`; c.fillStyle = "#fff";
    for (let i = 1; i < cols; i++) { c.beginPath(); c.moveTo(x + w * i / cols, y); c.lineTo(x + w * i / cols, y + h); c.stroke(); }
    for (let j = 1; j < rows; j++) { c.beginPath(); c.moveTo(x, y + h * j / rows); c.lineTo(x + w, y + h * j / rows); c.stroke(); }
    let n = Math.max(1, +sf.start.value || 1);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) c.fillText(`${sf.prefix.value}${n++}`, x + w * i / cols + 8, y + h * j / rows + Math.max(20, W / 45));
  }
}
function bindCropTools() {
  const cv = $("#cropCanvas");
  const pt = e => { const b = cv.getBoundingClientRect(); return [clamp01((e.clientX - b.left) / b.width), clamp01((e.clientY - b.top) / b.height)]; };
  const rectOf = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])];
  cv.addEventListener("pointerdown", e => { cv.setPointerCapture(e.pointerId); CR.drag = { a: pt(e), cur: null }; });
  cv.addEventListener("pointermove", e => { if (CR.drag) { CR.drag.cur = rectOf(CR.drag.a, pt(e)); drawCrop(); } });
  cv.addEventListener("pointerup", () => {
    const r = CR.drag?.cur; CR.drag = null;
    if (r && r[2] > 0.02 && r[3] > 0.02) CR.rect = r.map(v => Math.round(v * 10000) / 10000);
    drawCrop();
  });
  $("#cropPick").addEventListener("click", () => openCropDlg("crop"));
  $("#cropReset").addEventListener("click", () => { $("#camForm").dataset.crop = ""; syncCropLabel(); });
  $("#splitBtn").addEventListener("click", () => openCropDlg("split"));
  $("#splitForm").addEventListener("input", () => { $("#cropOk").textContent = t("splitCreate", { n: splitN() }); drawCrop(); });
  $("#cropCancel").addEventListener("click", () => $("#cropDlg").close());
  $("#cropDlg").addEventListener("close", () => { clearInterval(CR.timer); CR.timer = null; });
  $("#cropOk").addEventListener("click", async () => {
    if (!CR.rect) { toast(t("cropNeedRect")); return; }
    if (CR.mode === "crop") {
      $("#camForm").dataset.crop = JSON.stringify(CR.rect);
      syncCropLabel();
      $("#cropDlg").close();
      return;
    }
    // 분할 화면 자동 나누기: 칸마다 카메라 하나
    const sf = $("#splitForm");
    const rows = Math.min(8, Math.max(1, +sf.rows.value || 1)), cols = Math.min(8, Math.max(1, +sf.cols.value || 1));
    const [x, y, w, h] = CR.rect, prefix = sf.prefix.value.trim() || "CH", area = sf.area.value;
    let n = Math.max(1, +sf.start.value || 1);
    const upd = {}, base = Date.now().toString(36);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const r4 = v => Math.round(v * 10000) / 10000;
      upd[`c${base}${String(n).padStart(2, "0")}`] = {
        name: `${prefix}${n}`, area, agent: S.agent,
        src: { type: "screen", crop: [r4(x + w * i / cols), r4(y + h * j / rows), r4(w / cols), r4(h / rows)] }, zones: {}
      };
      n++;
    }
    try {
      await update(R("config/cameras"), upd);
      $("#cropDlg").close();
      toast(t("splitDone", { n: rows * cols }));
    } catch (err) { console.warn(err); toast(t("saveFail")); }
  });
}

/* =========================================================
   여러 개 선택해서 한 번에 삭제
   ========================================================= */
const SEL = { on: false, ids: new Set() };
function toggleSel(id) {
  if (SEL.ids.has(id)) SEL.ids.delete(id); else SEL.ids.add(id);
  syncSel();
}
function syncSel() {
  document.body.classList.toggle("selecting", SEL.on);
  $("#selBar").hidden = !SEL.on;
  for (const id of [...SEL.ids]) if (!S.cams[id]) SEL.ids.delete(id);
  for (const [id, r] of S.runners) {
    const on = SEL.ids.has(id);
    r.tile.classList.toggle("selected", on);
    r.tile.querySelector(".tile-sel input").checked = on;
  }
  $("#selCount").textContent = t("selCount", { n: SEL.ids.size });
  $("#selDelete").disabled = !SEL.ids.size;
}
function bindSelection() {
  $("#selectBtn").addEventListener("click", () => { SEL.on = !SEL.on; SEL.ids.clear(); syncSel(); });
  $("#selCancel").addEventListener("click", () => { SEL.on = false; SEL.ids.clear(); syncSel(); });
  $("#selAll").addEventListener("click", () => { for (const id of S.runners.keys()) SEL.ids.add(id); syncSel(); });
  $("#selNone").addEventListener("click", () => { SEL.ids.clear(); syncSel(); });
  $("#selDelete").addEventListener("click", async () => {
    const ids = [...SEL.ids];
    if (!ids.length) return;
    const names = ids.map(id => S.cams[id]?.name || id);
    if (!confirm(t("selConfirm", { n: ids.length, names: names.join(", ") }))) return;
    const upd = {};
    for (const id of ids) {
      upd[`config/cameras/${id}`] = null;
      for (const k of ["live", "frames", "thumbs", "plan"]) upd[`${k}/${id}`] = null;
      for (const zid of Object.keys(S.cams[id]?.zones || {})) upd[`crops/${id}__${zid}`] = null;
    }
    try {
      await update(R(), upd);
      SEL.on = false; SEL.ids.clear(); syncSel();
      toast(t("selDone", { n: ids.length }));
    } catch (err) { console.warn(err); toast(t("saveFail")); }
  });
}
