import {
  authGate, isConfigured, showSetup, R, onValue, set, update, push, remove, onDisconnect,
  serverTimestamp, increment, now, SITE, t, applyI18n, bindLangSelects, shiftOf, drawOverlay,
  areaLabel, esc, natCmp, $, COLORS, ALERT, tl, tzParts, fmtClock
} from "./core.js";
import { toGray, diffFraction, sensPct, newZoneState, judge } from "./motion.js";

const DEFAULTS = { analyzeMs: 1000, pixThresh: 22, skipPct: 40, frameMs: 2000, frameW: 960 };
const CROP_MS = 5000, ALERT_CHECK_MS = 30000;
const THUMB_MS = 60000, LIVE_HEARTBEAT_MS = 5000, STATS_FLUSH_MS = 15000;

// 브라우저가 화면 밖 영상을 멈추지 않도록 1px 컨테이너에 붙여 둠
const vidHost = document.createElement("div");
vidHost.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:1px;overflow:hidden;opacity:.01;pointer-events:none";
document.body.appendChild(vidHost);

const LS = {
  get(k, d) { try { const v = localStorage.getItem("kcw." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("kcw." + k, JSON.stringify(v)); } catch {} }
};
const cleanKey = s => String(s || "").trim().replace(/[.#$\[\]\/\s]+/g, "-").slice(0, 24) || "PC-1";
const clamp01 = v => Math.min(1, Math.max(0, v));

const S = {
  user: null, role: null, agent: cleanKey(LS.get("agent", "PC-1")),
  cams: {}, plan: {}, settings: { ...DEFAULTS },
  runners: new Map(), running: false, wake: null, roomWatchers: 0, alertCfg: null
};

applyI18n();
bindLangSelects();
if (!isConfigured()) showSetup();
else authGate({ onReady });

function onReady({ user, role }) {
  S.user = user; S.role = role;
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
  return toGray(mctx.getImageData(0, 0, w, h).data);
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
    const pageMode = type === "url" && (this.urlMode === "page" || this.urlFailed);
    if (type === "url" && !(fromClick && pageMode)) { await this.openUrl(); this.render(S.running); return; }
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.autoplay = true;
    vidHost.appendChild(v);
    this.video = v;
    try {
      if (type === "screen" || type === "url") {
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
      if (type === "screen" || type === "url") this.needPick = true;
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
    for (const zs of Object.values(this.zs)) { zs.prev = null; zs.hist = []; zs.ratio = null; zs.state = "run"; zs.since = now(); }
  }
  close() {
    if (this.hls) { try { this.hls.destroy(); } catch {} this.hls = null; }
    if (this.urlImg) { this.urlImg.onerror = null; this.urlImg.src = ""; this.urlImg.remove(); this.urlImg = null; }
    this.snapUrl = null;
    if (this.videoUrl) { URL.revokeObjectURL(this.videoUrl); this.videoUrl = null; }
    if (this.stream) { this.stream.getTracks().forEach(tr => tr.stop()); this.stream = null; }
    if (this.video) { this.video.pause(); this.video.removeAttribute("src"); this.video.srcObject = null; this.video.load(); this.video.remove(); this.video = null; }
  }
  updateCam(cam) {
    this.cam = cam;
    const k = JSON.stringify(cam.src || {});
    if (k !== this.srcKey) { this.srcKey = k; this.open(); }
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
    const sc = Math.min(1, 1280 / w), W = Math.round(w * sc), H = Math.round(h * sc);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W; this.canvas.height = H;
      this.prevFull = null;
      for (const zs of Object.values(this.zs)) zs.prev = null;
    }
    this.ctx.drawImage(el, 0, 0, W, H);
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
    }

    let changed = wasOnline !== this.online;
    const states = {};
    for (const [zid, z] of zones) {
      const zs = this.zs[zid] ||= newZoneState(t0);
      let ns = zs.state;
      if (S.plan?.[this.id]?.[zid]) { ns = "off"; zs.hist = []; zs.prev = null; zs.ratio = null; }
      else if (!this.online) { ns = "nosig"; zs.hist = []; zs.prev = null; zs.ratio = null; }
      else if (grabbed) {
        const g = sampleGray(this.canvas, z.eq);
        const d = diffFraction(g, zs.prev, th);
        zs.prev = g;
        if (d !== null && !this.skipped) {
          if (zs.state === "off" || zs.state === "nosig") zs.state = "run";
          ns = judge(zs, t0, d * 100 >= sensPct(z.sens), z);
        } else if (zs.state === "off" || zs.state === "nosig") ns = "run";
      }
      if (ns !== zs.state) {
        if (ns === "idle" || zs.state === "idle") {
          push(R("events"), {
            ts: serverTimestamp(), cam: this.id, zone: zid, eqId: z.eqId || "", name: z.name || "",
            area: z.area || this.cam.area || "", from: zs.state, to: ns, dur: Math.round((t0 - zs.since) / 1000),
            r: zs.ratio == null ? null : Math.round(zs.ratio * 100)
          }).catch(console.warn);
        }
        if (zs.state === "idle") remove(R(`crops/${this.id}__${zid}`)).catch(() => {});
        zs.state = ns; zs.since = t0; changed = true;
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
    if (dt > 0 && dt < 30) for (const [zid, s] of Object.entries(states)) {
      if (s.state !== "run" && s.state !== "idle") continue;
      const a = this.acc[zid] ||= { run: 0, idle: 0 };
      a[s.state] += dt;
    }
    if (t0 - this.lastFlush >= STATS_FLUSH_MS) this.flush();

    if (changed || t0 - this.lastLive >= LIVE_HEARTBEAT_MS) {
      this.lastLive = t0;
      set(R(`live/${this.id}`), { ts: serverTimestamp(), online: this.online, agent: S.agent, ms: Math.round(this.ms), zones: states }).catch(console.warn);
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
    for (const zs of Object.values(this.zs)) { zs.hist = []; zs.ratio = null; zs.state = "run"; }
    this.states = {}; this.lastAcc = 0;
    set(R(`live/${this.id}`), { ts: serverTimestamp(), online: false, agent: S.agent, stopped: true }).catch(() => {});
  }
  destroy() {
    if (S.running) this.stopped();
    this.unwatch(); this.close(); this.tile.remove();
  }

  buildTile() {
    const el = document.createElement("article");
    el.className = "tile panel";
    el.innerHTML = `
      <header class="tile-head"><strong class="tile-name"></strong><span class="tile-meta meta"></span></header>
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
    el.querySelector(".tile-cv").addEventListener("dblclick", full);
    el.querySelector("[data-act=cam]").addEventListener("click", () => openCam(this.id));
    this.tile = el;
    this.tileCv = el.querySelector(".tile-cv");
    this.labelTile();
  }
  labelTile() {
    const q = s => this.tile.querySelector(s);
    q("[data-act=zones]").textContent = t("editZones");
    q("[data-act=full]").textContent = t("bigView");
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
      st.textContent = `${t("stOnline")}  ${Math.round(this.ms)}ms` + (this.skipped ? `  ${t("skippedNow")}` : "") +
        (this.watchers ? `  ${t("watching", { n: this.watchers })}` : "");
      st.className = "tile-status on";
    } else { st.textContent = t("stPreview"); st.className = "tile-status"; }
    if (!this.canvas.width) return;
    const cv = this.tileCv;
    if (cv.width !== this.canvas.width || cv.height !== this.canvas.height) { cv.width = this.canvas.width; cv.height = this.canvas.height; }
    const c = cv.getContext("2d");
    c.drawImage(this.canvas, 0, 0);
    drawOverlay(c, cv.width, cv.height, this.cam.zones, analyzing ? this.states : {}, []);
  }
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
  if (!S.user) return;
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
    S.agent = v; LS.set("agent", v);
    syncRunners();
  });
  $("#addCamBtn").addEventListener("click", () => openCam(null));
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
      src: type === "screen" || type === "image" ? { type }
        : type === "url" ? { type, url: f.url.value.trim() }
        : type === "webcam" ? { type, deviceId: f.deviceId.value || "" }
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
      frameW: +s.frameW.value || DEFAULTS.frameW
    };
    try { await set(R("config/settings"), v); $("#setDlg").close(); toast(t("saved")); }
    catch (err) { console.warn(err); toast(t("saveFail")); }
  });

  bindZoneEditor();
  bindAlertUi();
}

function syncSrcFields() {
  const f = $("#camForm"), ty = f.type.value;
  f.querySelector(".src-go2rtc").hidden = !(ty === "mp4" || ty === "jpeg");
  f.querySelector(".src-webcam").hidden = ty !== "webcam";
  f.querySelector(".src-screen").hidden = ty !== "screen";
  f.querySelector(".src-image").hidden = ty !== "image";
  f.querySelector(".src-url").hidden = ty !== "url";
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
  $("#camDlg").showModal();
}
function openSettings() {
  const s = $("#setForm"), v = S.settings;
  s.analyzeMs.value = v.analyzeMs; s.pixThresh.value = v.pixThresh; s.skipPct.value = v.skipPct;
  s.frameMs.value = v.frameMs; s.frameW.value = v.frameW;
  $("#setDlg").showModal();
}

/* =========================================================
   감시 구역 편집기
   ========================================================= */
const Z = { cid: null, zid: null, draft: null, drag: null, timer: null };
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
  Z.draft = { eqId: "", name: "", area: S.cams[Z.cid]?.area || SITE.areas[0], windowMin: 5, minRatio: 30, sens: 5, eq: null };
  fillZoneForm();
}
function pickZone(zid) {
  const z = S.cams[Z.cid]?.zones?.[zid];
  if (!z) return;
  Z.zid = zid;
  Z.draft = { windowMin: 5, minRatio: 30, sens: 5, ...JSON.parse(JSON.stringify(z)) };
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
  let msg = t("boxStatus", { a: Z.draft.eq ? t("done") : t("missing") });
  const s = Z.zid && S.runners.get(Z.cid)?.states?.[Z.zid];
  if (s && s.r != null) msg += "  /  " + t("liveRatio", { r: s.r, m: Z.draft.windowMin });
  $("#zoneState").textContent = msg;
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
  const lw = Math.max(2, Math.round(W / 420));
  const box = (b, color, label, fill) => {
    if (!b) return;
    if (fill) { c.fillStyle = fill; c.fillRect(b[0] * W, b[1] * H, b[2] * W, b[3] * H); }
    c.strokeStyle = color; c.lineWidth = lw;
    c.strokeRect(b[0] * W, b[1] * H, b[2] * W, b[3] * H);
    if (label) {
      c.font = `600 ${Math.max(12, Math.round(W / 60))}px system-ui`;
      c.fillStyle = color; c.fillText(label, b[0] * W + 4, b[1] * H + Math.max(14, W / 50));
    }
  };
  for (const [zid, z] of Object.entries(S.cams[Z.cid]?.zones || {})) {
    if (zid !== Z.zid) box(z.eq, "rgba(255,255,255,.7)", z.eqId);
  }
  box(Z.draft.eq, COLORS.person, Z.draft.eqId || "", "rgba(31,165,196,.18)");
  if (Z.drag?.cur) box(Z.drag.cur, COLORS.person);
}
function bindZoneEditor() {
  const cv = zcv();
  const pt = e => {
    const b = cv.getBoundingClientRect();
    return [clamp01((e.clientX - b.left) / b.width), clamp01((e.clientY - b.top) / b.height)];
  };
  const rectOf = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])];
  cv.addEventListener("pointerdown", e => { cv.setPointerCapture(e.pointerId); Z.drag = { a: pt(e), cur: null }; });
  cv.addEventListener("pointermove", e => { if (Z.drag) { Z.drag.cur = rectOf(Z.drag.a, pt(e)); drawZone(); } });
  cv.addEventListener("pointerup", () => {
    const r = Z.drag?.cur;
    Z.drag = null;
    if (r && r[2] > 0.005 && r[3] > 0.005) Z.draft.eq = r.map(v => Math.round(v * 10000) / 10000);
    syncZoneState(); drawZone();
  });
  const f = $("#zoneForm");
  $("#zoneList").addEventListener("click", e => { const b = e.target.closest("[data-zid]"); if (b) pickZone(b.dataset.zid); });
  $("#zoneNew").addEventListener("click", () => { newDraft(); renderZoneList(); drawZone(); });
  f.eqId.addEventListener("input", e => { Z.draft.eqId = e.target.value; drawZone(); });
  f.sens.addEventListener("input", e => { $("#sensVal").textContent = e.target.value; });
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const d = {
      eqId: f.eqId.value.trim(), name: f.name.value.trim(), area: f.area.value, eq: Z.draft.eq,
      windowMin: Math.min(60, Math.max(1, +f.windowMin.value || 5)),
      minRatio: Math.min(95, Math.max(1, +f.minRatio.value || 30)),
      sens: Math.min(10, Math.max(1, +f.sens.value || 5))
    };
    if (!d.eqId) { toast(t("zoneNeedId")); return; }
    if (!d.eq) { toast(t("zoneNeedBox")); return; }
    const zid = Z.zid || "z" + Date.now().toString(36);
    try {
      await set(R(`config/cameras/${Z.cid}/zones/${zid}`), d);
      Z.zid = zid; Z.draft = d;
      fillZoneForm(); renderZoneList(); toast(t("saved"));
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
