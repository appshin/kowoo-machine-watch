// 원격 감시 박스 편집 (대시보드용)
// 분석 PC가 올려 주는 최신 CCTV 화면 위에 박스를 그려 Firebase에 저장한다.
// 분석 PC는 설정 변경을 실시간으로 받아 바로 새 박스로 분석한다.
import { R, set, remove, SITE, t, areaLabel, esc, natCmp, $, COLORS } from "./core.js";
import { createShapeEditor, polyBBox, zonePoly, strokePoly } from "./shape-editor.js";

const Z = { cid: null, zid: null, draft: null, timer: null, ed: null };
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
  Z.draft = { eqId: "", name: "", area: cam().area || SITE.areas[0], windowMin: 5, minRatio: 30, sens: 5 };
  Z.ed.set(null);
  fill();
}
function pick(zid) {
  const z = cam().zones?.[zid];
  if (!z) return;
  Z.zid = zid;
  Z.draft = { windowMin: 5, minRatio: 30, sens: 5, ...JSON.parse(JSON.stringify(z)) };
  Z.ed.set(zonePoly(z));
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
  let msg = t("boxStatus", { a: Z.ed.poly ? t("done") : t("missing") });
  document.querySelectorAll("#rzMode button").forEach(b => b.classList.toggle("on", b.dataset.mode === Z.ed.mode));
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
  for (const [zid, z] of Object.entries(cam().zones || {})) {
    if (zid !== Z.zid) strokePoly(c, W, H, zonePoly(z), "rgba(255,255,255,.75)", z.eqId);
  }
  Z.ed.draw(c, W, H, COLORS.person, Z.draft.eqId || "");
}
function bind() {
  Z.ed = createShapeEditor($("#rzCanvas"), () => { draw(); syncState(); });
  document.querySelectorAll("#rzMode button").forEach(b => b.addEventListener("click", () => { Z.ed.setMode(b.dataset.mode); syncState(); }));
  const f = $("#rzForm");
  $("#rzList").addEventListener("click", e => { const b = e.target.closest("[data-zid]"); if (b) pick(b.dataset.zid); });
  $("#rzNew").addEventListener("click", () => { newDraft(); renderList(); draw(); });
  f.eqId.addEventListener("input", e => { Z.draft.eqId = e.target.value; draw(); });
  f.sens.addEventListener("input", e => { $("#rzSensVal").textContent = e.target.value; });
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const d = {
      eqId: f.eqId.value.trim(), name: f.name.value.trim(), area: f.area.value,
      windowMin: Math.min(60, Math.max(1, +f.windowMin.value || 5)),
      minRatio: Math.min(95, Math.max(1, +f.minRatio.value || 30)),
      sens: Math.min(10, Math.max(1, +f.sens.value || 5))
    };
    if (!d.eqId) { toast(t("zoneNeedId")); return; }
    const poly = Z.ed.poly;
    if (!poly) { toast(t("zoneNeedBox")); return; }
    d.poly = poly;
    d.eq = polyBBox(poly).map(v => Math.round(v * 10000) / 10000);
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
