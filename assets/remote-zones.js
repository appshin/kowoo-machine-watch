// 원격 감시 박스 편집 (대시보드용)
// 분석 PC가 올려 주는 최신 CCTV 화면 위에 박스를 그려 Firebase에 저장한다.
// 분석 PC는 설정 변경을 실시간으로 받아 바로 새 박스로 분석한다.
import { R, set, remove, SITE, t, areaLabel, esc, natCmp, $, COLORS } from "./core.js";

const Z = { cid: null, zid: null, draft: null, drag: null, timer: null };
let ctxFns = null;

const clamp01 = v => Math.min(1, Math.max(0, v));
function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

// fns: { cams(), img(), live() }
export function initRemoteZones(fns) {
  ctxFns = fns;
  document.querySelectorAll("#rzDlg .area-select").forEach(sel => {
    sel.innerHTML = SITE.areas.map(a => `<option value="${a}">${esc(areaLabel(a))}</option>`).join("");
  });
  bind();
}

export function openRemoteZones(cid) {
  if (!cid || !ctxFns.cams()[cid]) return;
  Z.cid = cid;
  $("#rzCamName").textContent = ctxFns.cams()[cid].name || "";
  newDraft();
  renderList();
  $("#rzDlg").showModal();
  clearInterval(Z.timer);
  Z.timer = setInterval(() => { draw(); syncState(); }, 500);
  draw();
}
export function refreshRemoteZones() {
  if ($("#rzDlg").open) renderList();
}

const cam = () => ctxFns.cams()[Z.cid] || {};
function newDraft() {
  Z.zid = null;
  Z.draft = { eqId: "", name: "", area: cam().area || SITE.areas[0], windowMin: 5, minRatio: 30, sens: 5, eq: null };
  fill();
}
function pick(zid) {
  const z = cam().zones?.[zid];
  if (!z) return;
  Z.zid = zid;
  Z.draft = { windowMin: 5, minRatio: 30, sens: 5, ...JSON.parse(JSON.stringify(z)) };
  fill(); renderList();
}
function fill() {
  const f = $("#rzForm"), d = Z.draft;
  f.eqId.value = d.eqId || ""; f.name.value = d.name || "";
  f.area.value = d.area || SITE.areas[0];
  f.windowMin.value = d.windowMin; f.minRatio.value = d.minRatio; f.sens.value = d.sens;
  $("#rzSensVal").textContent = d.sens;
  $("#rzDel").hidden = !Z.zid;
  syncState();
}
function syncState() {
  const img = ctxFns.img();
  let msg = t("boxStatus", { a: Z.draft.eq ? t("done") : t("missing") });
  const s = Z.zid && ctxFns.live()?.[Z.cid]?.zones?.[Z.zid];
  if (s && s.r != null) msg += "  /  " + t("liveRatio", { r: s.r, m: Z.draft.windowMin });
  $("#rzState").textContent = msg;
  $("#rzWait").hidden = !!(img && img.naturalWidth);
}
function renderList() {
  const zones = cam().zones || {};
  $("#rzList").innerHTML = Object.entries(zones).sort((a, b) => natCmp(a[1].eqId, b[1].eqId))
    .map(([zid, z]) => `<li><button type="button" data-zid="${esc(zid)}" class="${zid === Z.zid ? "sel" : ""}">${esc(z.eqId)}</button></li>`).join("");
}
function draw() {
  const img = ctxFns.img(), cv = $("#rzCanvas");
  const W = img?.naturalWidth || 1280, H = img?.naturalHeight || 720;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const c = cv.getContext("2d");
  c.fillStyle = "#10171F"; c.fillRect(0, 0, W, H);
  if (img?.naturalWidth) c.drawImage(img, 0, 0, W, H);
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
  for (const [zid, z] of Object.entries(cam().zones || {})) {
    if (zid !== Z.zid) box(z.eq, "rgba(255,255,255,.75)", z.eqId);
  }
  box(Z.draft.eq, COLORS.person, Z.draft.eqId || "", "rgba(31,165,196,.2)");
  if (Z.drag?.cur) box(Z.drag.cur, COLORS.person);
}
function bind() {
  const cv = $("#rzCanvas");
  const pt = e => {
    const b = cv.getBoundingClientRect();
    return [clamp01((e.clientX - b.left) / b.width), clamp01((e.clientY - b.top) / b.height)];
  };
  const rectOf = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])];
  cv.addEventListener("pointerdown", e => { cv.setPointerCapture(e.pointerId); Z.drag = { a: pt(e), cur: null }; });
  cv.addEventListener("pointermove", e => { if (Z.drag) { Z.drag.cur = rectOf(Z.drag.a, pt(e)); draw(); } });
  cv.addEventListener("pointerup", () => {
    const r = Z.drag?.cur;
    Z.drag = null;
    if (r && r[2] > 0.005 && r[3] > 0.005) Z.draft.eq = r.map(v => Math.round(v * 10000) / 10000);
    syncState(); draw();
  });
  const f = $("#rzForm");
  $("#rzList").addEventListener("click", e => { const b = e.target.closest("[data-zid]"); if (b) pick(b.dataset.zid); });
  $("#rzNew").addEventListener("click", () => { newDraft(); renderList(); draw(); });
  f.eqId.addEventListener("input", e => { Z.draft.eqId = e.target.value; draw(); });
  f.sens.addEventListener("input", e => { $("#rzSensVal").textContent = e.target.value; });
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
      fill(); renderList(); toast(t("saved"));
    } catch (err) { console.warn(err); toast(t("saveFail")); }
  });
  $("#rzDel").addEventListener("click", async () => {
    if (!Z.zid || !confirm(t("confirmDelZone"))) return;
    try {
      await remove(R(`config/cameras/${Z.cid}/zones/${Z.zid}`));
      await remove(R(`plan/${Z.cid}/${Z.zid}`)).catch(() => {});
      newDraft(); renderList(); draw();
    } catch (err) { console.warn(err); toast(t("saveFail")); }
  });
  $("#rzClose").addEventListener("click", () => $("#rzDlg").close());
  $("#rzDlg").addEventListener("close", () => { clearInterval(Z.timer); Z.timer = null; });
}
