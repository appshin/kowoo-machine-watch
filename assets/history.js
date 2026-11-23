import {
  authGate, isConfigured, showSetup, R, onValue, get, query, orderByChild, startAt, endAt,
  now, SITE, t, applyI18n, bindLangSelects, shiftOf, tzParts, siteEpoch, fmtHM, areaLabel, stateLabel,
  esc, natCmp, $
} from "./core.js?v=20261120n";

// 가동 이력: 하루(주간 08~20시 + 야간 20~다음날 08시) 동안 설비별로
// 몇 시부터 몇 시까지 가동/비가동이었는지를 막대 그래프와 시간 목록으로 보여 줌
const ORDER = ["run", "idle", "wait", "off", "nosig", "none"];
const S = { cams: {}, events: [], from: 0, to: 0, rows: [], open: new Set(), timer: null };

applyI18n();
bindLangSelects();
if (!isConfigured()) showSetup();
else authGate({ onReady });

function onReady() {
  const cur = shiftOf(now());
  $("#hDate").value = cur.date;
  $("#hArea").innerHTML = `<option value="">${esc(t("histAllAreas"))}</option>` +
    SITE.areas.map(a => `<option value="${a}">${esc(areaLabel(a))}</option>`).join("");
  onValue(R("config/cameras"), s => { S.cams = s.val() || {}; render(); });
  ["#hDate", "#hRange"].forEach(id => $(id).addEventListener("change", load));
  $("#hArea").addEventListener("change", render);
  $("#hPrev").addEventListener("click", () => shiftDate(-1));
  $("#hNext").addEventListener("click", () => shiftDate(1));
  $("#hCsv").addEventListener("click", downloadCsv);
  $("#hChart").addEventListener("click", e => {
    const row = e.target.closest(".hrow[data-key]");
    if (!row) return;
    const k = row.dataset.key;
    if (S.open.has(k)) S.open.delete(k); else S.open.add(k);
    render();
  });
  window.addEventListener("langchange", render);
  load();
}

function shiftDate(n) {
  const d = new Date($("#hDate").value + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  $("#hDate").value = d.toISOString().slice(0, 10);
  load();
}

// 선택한 날짜·범위의 시작/끝 (공장 현지 시간 기준)
function windowOf(date, range) {
  const d0 = siteEpoch(date, SITE.dayShiftStart), n0 = siteEpoch(date, SITE.nightShiftStart);
  const next = new Date(date + "T00:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
  const d1 = siteEpoch(next.toISOString().slice(0, 10), SITE.dayShiftStart);
  if (range === "D") return [d0, n0];
  if (range === "N") return [n0, d1];
  return [d0, d1];
}

async function load() {
  [S.from, S.to] = windowOf($("#hDate").value, $("#hRange").value);
  $("#hChart").innerHTML = `<p class="empty">${esc(t("histLoading"))}</p>`;
  try {
    // 시작 시점의 상태를 알기 위해 하루 전부터 가져옴
    const snap = await get(query(R("events"), orderByChild("ts"), startAt(S.from - 24 * 3600e3), endAt(S.to)));
    const a = [];
    snap.forEach(c => { a.push(c.val()); });
    S.events = a.filter(e => e && e.cam && e.zone && e.ts).sort((x, y) => x.ts - y.ts);
  } catch (e) {
    console.warn(e);
    S.events = [];
  }
  render();
  // 지금 진행 중인 날이면 1분마다 새로고침
  clearTimeout(S.timer);
  if (now() < S.to) S.timer = setTimeout(load, 60000);
}

// 이벤트 → 구간 [{s, e, st}]
function buildSegments(evs, from, to) {
  const end = Math.min(to, now());
  let st = "none", cur = from;
  const segs = [];
  for (const e of evs) {
    if (e.ts <= from) { st = e.to || "none"; continue; }
    if (e.ts >= end) break;
    segs.push({ s: cur, e: e.ts, st });
    st = e.to || "none"; cur = e.ts;
  }
  if (cur < end) segs.push({ s: cur, e: end, st });
  const out = [];
  for (const g of segs) {
    if (g.e <= g.s) continue;
    const last = out[out.length - 1];
    if (last && last.st === g.st) last.e = g.e; else out.push({ ...g });
  }
  return out;
}

function collectRows() {
  const byKey = {};
  for (const e of S.events) (byKey[`${e.cam}__${e.zone}`] ||= []).push(e);
  const rows = [];
  const seen = new Set();
  for (const [cid, cam] of Object.entries(S.cams)) {
    for (const [zid, z] of Object.entries(cam.zones || {})) {
      const key = `${cid}__${zid}`;
      seen.add(key);
      rows.push({ key, eqId: z.eqId, name: z.name || "", area: z.area || cam.area || "ETC", camName: cam.name, evs: byKey[key] || [] });
    }
  }
  // 지금은 지워진 설비라도 그날 기록이 있으면 보여 줌
  for (const [key, evs] of Object.entries(byKey)) {
    if (seen.has(key) || !evs.some(e => e.ts >= S.from && e.ts < S.to)) continue;
    const e = evs[evs.length - 1];
    rows.push({ key, eqId: e.eqId, name: e.name || "", area: e.area || "ETC", camName: t("histDeleted"), evs });
  }
  const area = $("#hArea").value;
  return rows
    .filter(r => !area || r.area === area)
    .map(r => {
      const segs = buildSegments(r.evs, S.from, S.to);
      const sum = st => segs.filter(g => g.st === st).reduce((a, g) => a + (g.e - g.s), 0) / 1000;
      return { ...r, segs, run: sum("run"), idle: sum("idle"), idleN: segs.filter(g => g.st === "idle").length };
    })
    .sort((a, b) => (SITE.areas.indexOf(a.area) - SITE.areas.indexOf(b.area)) || natCmp(a.eqId, b.eqId));
}

const hm = ts => { const p = tzParts(ts); return `${p.hour}:${p.minute}`; };
const pct = (x, a, b) => ((x - a) / (b - a)) * 100;
const segLabel = st => st === "none" ? t("histNone") : stateLabel(st);

function render() {
  if (!S.from) return;
  S.rows = collectRows();
  const { from, to } = S;

  // 요약
  const run = S.rows.reduce((a, r) => a + r.run, 0), idle = S.rows.reduce((a, r) => a + r.idle, 0);
  const rate = run + idle ? Math.round(idle / (run + idle) * 100) : 0;
  $("#hSummary").innerHTML = `
    <div><span class="meta">${esc(t("histPeriod"))}</span><b>${esc(tzDate(from))} ${hm(from)} – ${esc(tzDate(to))} ${hm(to)}</b> <span class="meta">(${esc(t("siteTime"))})</span></div>
    <div><span class="meta">${esc(t("runTime"))}</span><b class="c-run">${fmtHM(run)}</b></div>
    <div><span class="meta">${esc(t("idleTime"))}</span><b class="c-idle">${fmtHM(idle)}</b></div>
    <div><span class="meta">${esc(t("idleRate"))}</span><b>${rate}%</b></div>`;
  $("#hLegend").innerHTML = ORDER.map(k => `<span style="--c:var(--h-${k})">${esc(segLabel(k))}</span>`).join("");

  if (!S.rows.length) { $("#hChart").innerHTML = `<p class="empty">${esc(t("noData"))}</p>`; return; }

  // 시간 눈금 (2시간 간격, 근무조 경계 강조)
  const ticks = [];
  for (let x = from; x <= to + 1; x += 3600e3) {
    const h = +tzParts(x).hour;
    if (h % 2 === 0 || x === from) ticks.push({ x, h, shift: h === SITE.nightShiftStart || h === SITE.dayShiftStart });
  }
  const axis = `<div class="haxis">${ticks.map(k =>
    `<span class="${k.shift ? "shift" : ""}" style="left:${pct(k.x, from, to)}%">${String(k.h).padStart(2, "0")}</span>`).join("")}</div>`;
  const grid = ticks.map(k => `<i class="${k.shift ? "shift" : ""}" style="left:${pct(k.x, from, to)}%"></i>`).join("");
  const nowLine = now() > from && now() < to ? `<b class="hnow" style="left:${pct(now(), from, to)}%"></b>` : "";

  $("#hChart").innerHTML = `
    <div class="hrow hhead"><div class="hlabel"></div><div class="htrack-wrap">${axis}</div><div class="hsum"><span>${esc(t("runTime"))}</span><span>${esc(t("idleTime"))}</span></div></div>
    ${S.rows.map(r => `
      <div class="hrow" data-key="${esc(r.key)}" tabindex="0">
        <div class="hlabel"><b>${esc(r.eqId)}</b> ${esc(r.name)}<small>${esc(areaLabel(r.area))} / ${esc(r.camName)}</small></div>
        <div class="htrack-wrap"><div class="htrack">${grid}
          ${r.segs.map(g => `<span class="hseg h-${g.st}" style="left:${pct(g.s, from, to)}%;width:${Math.max(0.15, pct(g.e, from, to) - pct(g.s, from, to))}%"
            title="${esc(segLabel(g.st))}  ${hm(g.s)}–${hm(g.e)}  (${fmtHM((g.e - g.s) / 1000)})"></span>`).join("")}
          ${nowLine}</div></div>
        <div class="hsum"><span class="c-run">${fmtHM(r.run)}</span><span class="c-idle">${fmtHM(r.idle)}</span></div>
      </div>
      ${S.open.has(r.key) ? `<div class="hdetail">${detailTable(r)}</div>` : ""}`).join("")}`;
}

function tzDate(ts) { const p = tzParts(ts); return `${p.month}/${p.day}`; }

function detailTable(r) {
  if (!r.segs.length) return `<p class="empty">${esc(t("noData"))}</p>`;
  return `<table class="stat-table hdet">
    <thead><tr><th>${esc(t("histFrom"))}</th><th>${esc(t("histTo"))}</th><th>${esc(t("histState"))}</th><th class="num">${esc(t("histLen"))}</th></tr></thead>
    <tbody>${r.segs.map(g => `<tr>
      <td>${esc(tzDate(g.s))} ${hm(g.s)}</td><td>${esc(tzDate(g.e))} ${hm(g.e)}</td>
      <td><span class="st-badge ${g.st === "none" ? "" : g.st}">${esc(segLabel(g.st))}</span></td>
      <td class="num">${fmtHM((g.e - g.s) / 1000)}</td></tr>`).join("")}</tbody></table>`;
}

function downloadCsv() {
  const fmt = ts => { const p = tzParts(ts); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; };
  const lines = [[t("eqId"), t("eqName"), t("camArea"), t("camName"), t("histFrom"), t("histTo"), t("histState"), t("histMinutes")]];
  for (const r of S.rows) for (const g of r.segs) {
    lines.push([r.eqId, r.name, areaLabel(r.area), r.camName, fmt(g.s), fmt(g.e), segLabel(g.st), Math.round((g.e - g.s) / 60000)]);
  }
  const csv = "﻿" + lines.map(l => l.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `KOWOO_THAI_${$("#hDate").value}_${$("#hRange").value}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
