import {
  authGate, isConfigured, showSetup, R, onValue, set, update, push, remove, onDisconnect,
  serverTimestamp, increment, now, SITE, t, applyI18n, bindLangSelects, shiftOf, drawOverlay,
  areaLabel, esc, natCmp, $, COLORS
} from "./core.js";
import { ObjectDetector, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODELS = {
  lite0: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
  lite2: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/latest/efficientdet_lite2.tflite"
};
const DEFAULTS = { model: "lite0", analyzeMs: 1000, minScore: 0.35, crop: true, overlap: 0.25, frameMs: 2000, frameW: 960 };
// 브라우저가 화면 밖 영상을 멈추지 않도록 1px 컨테이너에 붙여 둠
const vidHost = document.createElement("div");
vidHost.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:1px;overflow:hidden;opacity:.01;pointer-events:none";
document.body.appendChild(vidHost);

const THUMB_MS = 60000, LIVE_HEARTBEAT_MS = 5000, STATS_FLUSH_MS = 15000;

const LS = {
  get(k, d) { try { const v = localStorage.getItem("kcw." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("kcw." + k, JSON.stringify(v)); } catch {} }
};
const cleanKey = s => String(s || "").trim().replace(/[.#$\[\]\/\s]+/g, "-").slice(0, 24) || "PC-1";

const S = {
  user: null, role: null, agent: cleanKey(LS.get("agent", "PC-1")),
  cams: {}, plan: {}, settings: { ...DEFAULTS },
  runners: new Map(), det: null, detKey: "", loading: false, running: false, wake: null
};

applyI18n();
bindLangSelects();
if (!isConfigured()) showSetup();
else authGate({ onReady });

function onReady({ user, role }) {
  S.user = user; S.role = role;
  if (location.protocol === "https:") { const w = $("#warn"); w.textContent = t("httpsWarn"); w.hidden = false; }
  $("#agentName").value = S.agent;
  $("#autoStart").checked = LS.get("autostart", false);
  document.querySelectorAll(".area-select").forEach(sel => {
    sel.innerHTML = SITE.areas.map(a => `<option value="${a}">${esc(areaLabel(a))}</option>`).join("");
  });
  onValue(R("config/cameras"), s => { S.cams = s.val() || {}; syncRunners(); if ($("#zoneDlg").open) renderZoneList(); });
  onValue(R("config/settings"), s => { S.settings = { ...DEFAULTS, ...(s.val() || {}) }; if (S.running) ensureDetector(); });
  onValue(R("plan"), s => { S.plan = s.val() || {}; });
  bindUi();
  updateRunBtn();
  heartbeat();
  setInterval(heartbeat, 10000);
  window.addEventListener("langchange", () => { updateRunBtn(); syncRunners(true); });
  loop();
  if ($("#autoStart").checked) setRunning(true);
}

/* =========================================================
   사람 인식
   ========================================================= */
function setEngine(msg) { $("#engineStatus").textContent = msg; }

async function ensureDetector() {
  const st = S.settings, key = `${st.model}|${st.minScore}`;
  if (S.det && S.detKey === key) return S.det;
  if (S.loading) return null;
  S.loading = true;
  setEngine(t("loadingModel"));
  try {
    const files = await FilesetResolver.forVisionTasks(WASM);
    const mk = (delegate, url) => ObjectDetector.createFromOptions(files, {
      baseOptions: { modelAssetPath: url, delegate },
      runningMode: "IMAGE", scoreThreshold: +st.minScore, categoryAllowlist: ["person"], maxResults: 25
    });
    const url = MODELS[st.model] || MODELS.lite0;
    let d = null;
    for (const [dg, u] of [["GPU", url], ["CPU", url], ["CPU", MODELS.lite0]]) {
      try { d = await mk(dg, u); break; } catch (e) { console.warn("detector", dg, u, e); }
    }
    if (!d) throw new Error("no detector");
    try { S.det?.close(); } catch {}
    S.det = d; S.detKey = key;
    setEngine(t("modelReady"));
  } catch (e) {
    console.error(e);
    setEngine(t("modelFail"));
  } finally { S.loading = false; }
  return S.det;
}

const work = document.createElement("canvas");
const wctx = work.getContext("2d");

// src 캔버스의 픽셀 영역(rx,ry,rw,rh)에서 사람 찾기 → 0~1 좌표로 반환
function detectRegion(src, rx, ry, rw, rh) {
  rx = Math.round(rx); ry = Math.round(ry); rw = Math.round(rw); rh = Math.round(rh);
  if (rw < 8 || rh < 8) return [];
  const sc = Math.min(1, 640 / Math.max(rw, rh));
  const cw = Math.max(1, Math.round(rw * sc)), ch = Math.max(1, Math.round(rh * sc));
  if (work.width !== cw || work.height !== ch) { work.width = cw; work.height = ch; }
  wctx.drawImage(src, rx, ry, rw, rh, 0, 0, cw, ch);
  const res = S.det.detect(work);
  return res.detections.map(d => {
    const b = d.boundingBox;
    return {
      x: (rx + b.originX / sc) / src.width, y: (ry + b.originY / sc) / src.height,
      w: (b.width / sc) / src.width, h: (b.height / sc) / src.height,
      s: d.categories?.[0]?.score || 0
    };
  });
}
const clamp01 = v => Math.min(1, Math.max(0, v));
function expand(op) {
  const p = Math.max(op[2], op[3]) * 0.5;
  const x0 = clamp01(op[0] - p), y0 = clamp01(op[1] - p - op[3] * 0.5);
  const x1 = clamp01(op[0] + op[2] + p), y1 = clamp01(op[1] + op[3] + p);
  return [x0, y0, x1 - x0, y1 - y0];
}
const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
function mergeRegions(rs) {
  rs = rs.map(r => [...r]);
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      if (overlaps(rs[i], rs[j])) {
        const a = rs[i], b = rs[j];
        const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]);
        const x1 = Math.max(a[0] + a[2], b[0] + b[2]), y1 = Math.max(a[1] + a[3], b[1] + b[3]);
        rs[i] = [x0, y0, x1 - x0, y1 - y0];
        rs.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }
  return rs;
}
function inter(p, r) {
  const w = Math.min(p.x + p.w, r[0] + r[2]) - Math.max(p.x, r[0]);
  const h = Math.min(p.y + p.h, r[1] + r[3]) - Math.max(p.y, r[1]);
  return w > 0 && h > 0 ? w * h : 0;
}
function iou(a, b) {
  const i = inter(a, [b.x, b.y, b.w, b.h]);
  return i / (a.w * a.h + b.w * b.h - i || 1);
}
function nms(ds, th = 0.5) {
  const keep = [];
  for (const d of ds.sort((a, b) => b.s - a.s)) if (!keep.some(k => iou(k, d) > th)) keep.push(d);
  return keep;
}
function detectPersons(src, ops) {
  if (!S.settings.crop || !ops.length) return nms(detectRegion(src, 0, 0, src.width, src.height));
  const all = [];
  for (const r of mergeRegions(ops.map(expand))) {
    all.push(...detectRegion(src, r[0] * src.width, r[1] * src.height, r[2] * src.width, r[3] * src.height));
  }
  return nms(all);
}
// 사람이 작업자 위치 안에 있는지: 겹침 비율 또는 발 위치(박스 아래 중앙)
function inOpZone(op, p) {
  if (inter(p, op) / (p.w * p.h || 1) >= +S.settings.overlap) return true;
  const fx = p.x + p.w / 2, fy = p.y + p.h;
  return fx >= op[0] && fx <= op[0] + op[2] && fy >= op[1] && fy <= op[1] + op[3];
}

/* =========================================================
   카메라 1대 = Runner 1개
   ========================================================= */
class Runner {
  constructor(id, cam) {
    this.id = id; this.cam = cam;
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.zs = {}; this.acc = {}; this.persons = [];
    this.online = false; this.fail = 0; this.ms = 0; this.watchers = 0;
    this.lastLive = 0; this.lastFrame = 0; this.lastThumb = 0; this.lastAcc = 0; this.lastFlush = now();
    this.srcKey = JSON.stringify(cam.src || {});
    this.unwatch = onValue(R(`watch/${id}`), s => { this.watchers = Object.keys(s.val() || {}).length; });
    this.buildTile();
  }
  base() { return (this.cam.src?.base || location.origin).replace(/\/+$/, ""); }
  async open() {
    this.close();
    const src = this.cam.src || {};
    this.openedAt = Date.now(); this.lastT = -1; this.stallSince = Date.now();
    if (src.type === "jpeg") return;
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.autoplay = true;
    vidHost.appendChild(v);
    this.video = v;
    try {
      if (src.type === "webcam") {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: src.deviceId ? { deviceId: { exact: src.deviceId }, width: { ideal: 1280 } } : { width: { ideal: 1280 } }
        });
        v.srcObject = this.stream;
      } else {
        v.src = `${this.base()}/api/stream.mp4?src=${encodeURIComponent(src.stream || "")}`;
      }
      await v.play().catch(() => {});
    } catch (e) { console.warn("open", this.cam.name, e); }
  }
  close() {
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
    if (this.cam.src?.type === "jpeg") {
      const r = await fetch(`${this.base()}/api/frame.jpeg?src=${encodeURIComponent(this.cam.src.stream || "")}&t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error("http " + r.status);
      el = await createImageBitmap(await r.blob()); w = el.width; h = el.height;
    } else {
      const v = this.video;
      if (!v) { await this.open(); throw new Error("no video"); }
      if (v.readyState < 2) {
        if (Date.now() - this.openedAt > 15000) await this.open();
        throw new Error("video not ready");
      }
      if (v.currentTime !== this.lastT) { this.lastT = v.currentTime; this.stallSince = Date.now(); }
      else if (Date.now() - this.stallSince > 10000) { await this.open(); throw new Error("stalled"); }
      // 실시간과 벌어지면 따라잡기
      if (!this.stream && v.buffered.length) {
        const end = v.buffered.end(v.buffered.length - 1);
        if (end - v.currentTime > 3) v.currentTime = end - 0.3;
      }
      if (v.paused) v.play().catch(() => {});
      el = v; w = v.videoWidth; h = v.videoHeight;
    }
    if (!w || !h) throw new Error("empty frame");
    const sc = Math.min(1, 1280 / w), W = Math.round(w * sc), H = Math.round(h * sc);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    this.ctx.drawImage(el, 0, 0, W, H);
    if (el.close) el.close();
  }

  async step(analyze) {
    let grabbed = false;
    try { await this.grab(); grabbed = true; this.fail = 0; }
    catch { this.fail++; }
    const wasOnline = this.online;
    this.online = grabbed || (this.online && this.fail < 5);
    if (!analyze) { this.render(false); return; }

    const t0 = now();
    const zones = Object.entries(this.cam.zones || {}).filter(([, z]) => z.eq && z.op);
    if (grabbed && S.det) {
      const p0 = performance.now();
      try { this.persons = detectPersons(this.canvas, zones.map(([, z]) => z.op)); }
      catch (e) { console.warn("detect", e); this.persons = []; }
      this.ms = performance.now() - p0;
    }
    if (!this.online) this.persons = [];

    // 상태 판정
    let changed = wasOnline !== this.online;
    const states = {};
    for (const [zid, z] of zones) {
      const zs = this.zs[zid] ||= { state: "run", since: t0, lastSeen: t0, n: 0 };
      let ns;
      if (S.plan?.[this.id]?.[zid]) { ns = "off"; zs.lastSeen = t0; zs.n = 0; }
      else if (!this.online) { ns = "nosig"; zs.lastSeen = t0; zs.n = 0; }
      else {
        zs.n = this.persons.filter(p => inOpZone(z.op, p)).length;
        if (zs.n > 0) zs.lastSeen = t0;
        ns = (t0 - zs.lastSeen) <= (+z.idleSec || 60) * 1000 ? "run" : "idle";
      }
      if (ns !== zs.state) {
        if (ns === "idle" || zs.state === "idle") {
          push(R("events"), {
            ts: serverTimestamp(), cam: this.id, zone: zid, eqId: z.eqId || "", name: z.name || "",
            area: z.area || this.cam.area || "", from: zs.state, to: ns, dur: Math.round((t0 - zs.since) / 1000)
          }).catch(console.warn);
        }
        zs.state = ns; zs.since = t0; changed = true;
      }
      states[zid] = { state: zs.state, since: zs.since, n: zs.n };
    }
    for (const zid of Object.keys(this.zs)) if (!states[zid]) { delete this.zs[zid]; delete this.acc[zid]; changed = true; }

    // 근무조별 누적 시간
    const dt = this.lastAcc ? (t0 - this.lastAcc) / 1000 : 0;
    this.lastAcc = t0;
    if (dt > 0 && dt < 30) for (const [zid, s] of Object.entries(states)) {
      if (s.state !== "run" && s.state !== "idle") continue;
      const a = this.acc[zid] ||= { run: 0, idle: 0 };
      a[s.state] += dt;
    }
    if (t0 - this.lastFlush >= STATS_FLUSH_MS) this.flush();

    // 상태 게시
    if (changed || t0 - this.lastLive >= LIVE_HEARTBEAT_MS) {
      this.lastLive = t0;
      set(R(`live/${this.id}`), { ts: serverTimestamp(), online: this.online, agent: S.agent, ms: Math.round(this.ms), zones: states }).catch(console.warn);
    }
    // 원격 영상: 누군가 보고 있을 때만
    if (grabbed && this.watchers > 0 && t0 - this.lastFrame >= +S.settings.frameMs) {
      this.lastFrame = t0;
      const r4 = v => Math.round(v * 10000) / 10000;
      set(R(`frames/${this.id}`), {
        ts: serverTimestamp(), jpg: toJpeg(this.canvas, +S.settings.frameW, 0.6),
        p: this.persons.map(p => [r4(p.x), r4(p.y), r4(p.w), r4(p.h)])
      }).catch(console.warn);
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
    this.zs = {}; this.states = {}; this.persons = []; this.lastAcc = 0;
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
      <canvas class="tile-cv" width="640" height="360"></canvas>
      <footer class="tile-foot">
        <span class="tile-status"></span><span class="spacer"></span>
        <button type="button" class="btn small" data-act="zones"></button>
        <button type="button" class="btn small admin-only" data-act="cam"></button>
      </footer>`;
    el.querySelector(".tile-name").textContent = this.cam.name;
    el.querySelector("[data-act=zones]").addEventListener("click", () => openZones(this.id));
    el.querySelector("[data-act=cam]").addEventListener("click", () => openCam(this.id));
    this.tile = el;
    this.tileCv = el.querySelector(".tile-cv");
    this.labelTile();
  }
  labelTile() {
    this.tile.querySelector("[data-act=zones]").textContent = t("editZones");
    this.tile.querySelector("[data-act=cam]").textContent = t("editCamera");
  }
  render(analyzing) {
    const st = this.tile.querySelector(".tile-status");
    const zn = Object.keys(this.cam.zones || {}).length;
    this.tile.querySelector(".tile-meta").textContent = `${areaLabel(this.cam.area)} / ${zn}`;
    if (!this.canvas.width || !this.online) {
      st.textContent = t("stOffline"); st.className = "tile-status bad";
    } else if (analyzing) {
      st.textContent = `${t("stOnline")}  ${t("persons", { n: this.persons.length })}  ${Math.round(this.ms)}ms` + (this.watchers ? `  ${t("watching", { n: this.watchers })}` : "");
      st.className = "tile-status on";
    } else { st.textContent = t("stPreview"); st.className = "tile-status"; }
    if (!this.canvas.width) return;
    const cv = this.tileCv;
    if (cv.width !== this.canvas.width || cv.height !== this.canvas.height) { cv.width = this.canvas.width; cv.height = this.canvas.height; }
    const c = cv.getContext("2d");
    c.drawImage(this.canvas, 0, 0);
    drawOverlay(c, cv.width, cv.height, this.cam.zones, analyzing ? this.states : {}, analyzing ? this.persons : [], { blink: Math.floor(Date.now() / 1000) % 2 === 0 });
  }
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
    try { await r.step(S.running && !!S.det); } catch (e) { console.error(e); }
  }
  const spent = performance.now() - t0;
  setTimeout(loop, Math.max(100, (S.running ? +S.settings.analyzeMs : 1000) - spent));
}

async function setRunning(on) {
  if (on) {
    const d = await ensureDetector();
    if (!d) return;
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
    tiles.appendChild(r.tile);   // 정렬 순서 유지
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
  heartbeat();
}

/* =========================================================
   UI: 툴바, 카메라 설정, 분석 설정
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

  // 카메라 폼
  const f = $("#camForm");
  f.type.addEventListener("change", syncSrcFields);
  $("#loadCams").addEventListener("click", loadWebcams);
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const id = f.dataset.id || "c" + Date.now().toString(36);
    const old = S.cams[id] || {};
    const cam = {
      name: f.name.value.trim(), area: f.area.value, agent: cleanKey(f.agent.value),
      src: f.type.value === "webcam"
        ? { type: "webcam", deviceId: f.deviceId.value || "" }
        : { type: f.type.value, stream: f.stream.value.trim(), base: f.base.value.trim() },
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

  // 설정 폼
  $("#setForm").addEventListener("submit", async e => {
    e.preventDefault();
    const s = e.target;
    const v = {
      model: s.model.value, analyzeMs: +s.analyzeMs.value || DEFAULTS.analyzeMs,
      minScore: +s.minScore.value || DEFAULTS.minScore, crop: s.crop.checked,
      overlap: +s.overlap.value || DEFAULTS.overlap, frameMs: +s.frameMs.value || DEFAULTS.frameMs,
      frameW: +s.frameW.value || DEFAULTS.frameW
    };
    try { await set(R("config/settings"), v); $("#setDlg").close(); toast(t("saved")); }
    catch (err) { console.warn(err); toast(t("saveFail")); }
  });

  bindZoneEditor();
}

function syncSrcFields() {
  const f = $("#camForm"), web = f.type.value === "webcam";
  f.querySelector(".src-go2rtc").hidden = web;
  f.querySelector(".src-webcam").hidden = !web;
  f.stream.required = !web;
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
  f.type.value = c?.src?.type || "mp4";
  f.stream.value = c?.src?.stream || "";
  f.base.value = c?.src?.base || "";
  f.deviceId.innerHTML = c?.src?.deviceId ? `<option value="${esc(c.src.deviceId)}">${esc(c.src.deviceId.slice(0, 12))}…</option>` : "";
  $("#camDel").hidden = !id;
  syncSrcFields();
  if (f.type.value === "webcam") loadWebcams(c?.src?.deviceId || "");
  $("#camDlg").showModal();
}
function openSettings() {
  const s = $("#setForm"), v = S.settings;
  s.model.value = v.model; s.analyzeMs.value = v.analyzeMs; s.minScore.value = v.minScore;
  s.crop.checked = !!v.crop; s.overlap.value = v.overlap; s.frameMs.value = v.frameMs; s.frameW.value = v.frameW;
  $("#setDlg").showModal();
}

/* =========================================================
   설비 영역 편집기
   ========================================================= */
const Z = { cid: null, zid: null, draft: null, mode: "eq", drag: null, timer: null };
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
  Z.timer = setInterval(drawZone, 500);
  drawZone();
}
function newDraft() {
  Z.zid = null;
  Z.draft = { eqId: "", name: "", area: S.cams[Z.cid]?.area || SITE.areas[0], idleSec: 60, eq: null, op: null };
  Z.mode = "eq";
  fillZoneForm();
}
function pickZone(zid) {
  const z = S.cams[Z.cid]?.zones?.[zid];
  if (!z) return;
  Z.zid = zid;
  Z.draft = JSON.parse(JSON.stringify(z));
  fillZoneForm();
  renderZoneList();
}
function fillZoneForm() {
  const f = $("#zoneForm"), d = Z.draft;
  f.eqId.value = d.eqId || ""; f.name.value = d.name || "";
  f.area.value = d.area || SITE.areas[0]; f.idleSec.value = d.idleSec || 60;
  $("#zoneDel").hidden = !Z.zid;
  syncDrawUi();
}
function syncDrawUi() {
  document.querySelectorAll(".draw-toggle button").forEach(b => b.classList.toggle("on", b.dataset.draw === Z.mode));
  $("#zoneState").textContent = t("zoneStatus", { a: Z.draft.eq ? t("done") : t("missing"), b: Z.draft.op ? t("done") : t("missing") });
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
  const box = (b, color, dash, label) => {
    if (!b) return;
    c.setLineDash(dash ? [lw * 3, lw * 2] : []);
    c.strokeStyle = color; c.lineWidth = lw;
    c.strokeRect(b[0] * W, b[1] * H, b[2] * W, b[3] * H);
    if (label) {
      c.setLineDash([]);
      c.font = `600 ${Math.max(12, Math.round(W / 60))}px system-ui`;
      c.fillStyle = color; c.fillText(label, b[0] * W + 4, b[1] * H + Math.max(14, W / 50));
    }
  };
  for (const [zid, z] of Object.entries(S.cams[Z.cid]?.zones || {})) {
    if (zid === Z.zid) continue;
    box(z.eq, "rgba(255,255,255,.6)", false, z.eqId);
    box(z.op, "rgba(255,255,255,.4)", true);
  }
  box(Z.draft.eq, COLORS.person, false, Z.draft.eqId || "");
  box(Z.draft.op, COLORS.nosig, true);
  if (Z.drag?.cur) box(Z.drag.cur, Z.mode === "eq" ? COLORS.person : COLORS.nosig, Z.mode === "op");
  c.setLineDash([]);
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
    if (r && r[2] > 0.01 && r[3] > 0.01) {
      const r4 = v => Math.round(v * 10000) / 10000;
      Z.draft[Z.mode] = r.map(r4);
      if (Z.mode === "eq" && !Z.draft.op) Z.mode = "op";   // 다음 단계로 자동 전환
    }
    syncDrawUi(); drawZone();
  });
  document.querySelectorAll(".draw-toggle button").forEach(b => b.addEventListener("click", () => { Z.mode = b.dataset.draw; syncDrawUi(); }));
  $("#zoneList").addEventListener("click", e => { const b = e.target.closest("[data-zid]"); if (b) pickZone(b.dataset.zid); });
  $("#zoneNew").addEventListener("click", () => { newDraft(); renderZoneList(); drawZone(); });
  $("#zoneForm").eqId.addEventListener("input", e => { Z.draft.eqId = e.target.value; drawZone(); });
  $("#zoneForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target;
    const d = { ...Z.draft, eqId: f.eqId.value.trim(), name: f.name.value.trim(), area: f.area.value,
      idleSec: Math.min(3600, Math.max(10, +f.idleSec.value || 60)) };
    if (!d.eqId) { toast(t("zoneNeedId")); return; }
    if (!d.eq || !d.op) { toast(t("zoneNeedBoth")); return; }
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
