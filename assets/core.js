import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, onValue, get, set, update, push, remove, onDisconnect,
  serverTimestamp, increment, query, orderByChild, limitToLast
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig, SITE } from "./firebase-config.js";

export { SITE, onValue, get, set, update, push, remove, onDisconnect, serverTimestamp, increment, query, orderByChild, limitToLast };

/* ---------- Firebase ---------- */
export const isConfigured = () => !!firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("YOUR");
let auth = null, db = null;
if (isConfigured()) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app);
}
export { auth, db };
export const R = (p = "") => ref(db, p ? `${SITE.root}/${p}` : SITE.root);

// 서버 기준 시간 (태국 PC와 한국 PC의 시계 차이를 없앰)
let offset = 0;
if (db) onValue(ref(db, ".info/serverTimeOffset"), s => { offset = s.val() || 0; });
export const now = () => Date.now() + offset;

/* ---------- small helpers ---------- */
export const $ = (s, el = document) => el.querySelector(s);
export const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const natCmp = (a, b) => String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true });
export const COLORS = { run: "#1E8449", idle: "#D2201A", off: "#8B949E", nosig: "#D99A00", person: "#1FA5C4" };
const FONT = '"IBM Plex Sans KR","IBM Plex Sans Thai",system-ui,sans-serif';

/* ---------- i18n ---------- */
const DICT = {
  ko: {
    appTitle: "코우타이 설비 가동 감시", analyzerTitle: "코우타이 분석 PC",
    email: "이메일", password: "비밀번호", login: "로그인", logout: "로그아웃",
    loginFail: "로그인하지 못했습니다. 이메일과 비밀번호를 확인하세요.",
    noRole: "이 계정은 아직 권한이 없습니다. 관리자에게 다음 UID 등록을 요청하세요: {uid}",
    notConfigured: "assets/firebase-config.js에 Firebase 설정값을 넣은 뒤 다시 여세요. README 1단계를 참고하세요.",
    siteTime: "태국", krTime: "한국", sound: "알림음",
    allRunning: "모든 설비에 작업자가 있습니다", idleHeadline: "작업자 없는 설비 {n}대",
    noCameras: "등록된 카메라가 없습니다. 공장 분석 PC에서 카메라와 설비를 등록하세요.",
    run: "가동", idle: "비가동", off: "계획정지", nosig: "신호없음",
    cameras: "카메라", waitingFrame: "영상을 기다리는 중입니다. 공장 분석 PC가 켜져 있는지 확인하세요.",
    frameStale: "최신 영상을 불러오는 중입니다…", camOffline: "연결 끊김",
    shiftStats: "근무조별 가동 현황", day: "주간", night: "야간",
    equipment: "설비", runTime: "가동", idleTime: "비가동", idleRate: "비가동률", total: "합계",
    noData: "이 근무조에 기록된 데이터가 없습니다.",
    idleNow: "지금 작업자 없는 설비", noIdle: "작업자 없는 설비가 없습니다.",
    planStop: "계획정지 처리", planResume: "감시 재개", planned: "계획정지 설비",
    events: "상태 변경 기록", noEvents: "아직 기록이 없습니다.",
    evIdleStart: "비가동 시작", evIdleEnd: "비가동 종료", evDur: "{d} 동안",
    area_F1: "F1", area_F2: "F2", area_F3: "F3", area_WH: "창고", area_ETC: "기타",
    agentName: "이 PC 이름", agentHint: "카메라마다 담당 PC를 지정합니다. 이 PC 이름이 지정된 카메라만 여기서 분석합니다.",
    start: "분석 시작", stop: "분석 중지", autoStart: "열면 자동 시작",
    loadingModel: "사람 인식 모델을 불러오는 중…", modelFail: "인식 모델을 불러오지 못했습니다. 인터넷 연결을 확인하세요.",
    modelReady: "인식 모델 준비됨",
    addCamera: "카메라 추가", editCamera: "카메라 설정", editZones: "설비 영역 편집", settings: "분석 설정",
    noLocalCams: "이 PC({pc})에 지정된 카메라가 없습니다. 카메라를 추가하거나 PC 이름을 확인하세요.",
    otherCams: "다른 PC에 지정된 카메라",
    camName: "카메라 이름", camArea: "기본 구역", assignPc: "담당 PC 이름", srcType: "영상 입력",
    srcMp4: "CCTV 영상 (go2rtc, 권장)", srcJpeg: "CCTV 스냅샷 (go2rtc)", srcWebcam: "USB 웹캠",
    streamName: "go2rtc 스트림 이름", baseUrl: "go2rtc 주소 (비우면 이 페이지 주소)",
    webcamDevice: "웹캠", loadWebcams: "웹캠 목록 불러오기",
    save: "저장", cancel: "취소", delete: "삭제", close: "닫기",
    confirmDelCam: "이 카메라와 등록된 설비 영역을 모두 삭제할까요?",
    zoneHelp: "설비번호를 입력하고, 영상 위에 설비 박스와 작업자가 서는 위치를 각각 드래그해 그린 뒤 저장하세요. 작업자 위치는 사람 몸 전체가 들어가게 그리세요.",
    addZone: "새 설비", eqId: "설비번호", eqName: "설비명", idleSec: "작업자 부재 판정 시간(초)",
    drawEq: "설비 박스 그리기", drawOp: "작업자 위치 그리기", saveZone: "설비 저장",
    zoneStatus: "설비 박스: {a} / 작업자 위치: {b}", done: "그림", missing: "없음",
    zoneNeedId: "설비번호를 입력하세요.", zoneNeedBoth: "설비 박스와 작업자 위치를 모두 그려야 합니다.",
    saved: "저장했습니다", saveFail: "저장하지 못했습니다. 관리자 계정으로 로그인했는지 확인하세요.",
    confirmDelZone: "이 설비를 삭제할까요?", zoneNeedLocal: "설비 영역은 이 카메라를 담당하는 PC에서 편집하세요.",
    httpsWarn: "이 주소(https)에서는 CCTV 영상을 읽을 수 없습니다. 공장 PC에서 start-kowoo-cctv.bat로 여는 http://localhost:1984/analyzer.html 을 사용하세요. USB 웹캠은 이 주소에서도 됩니다.",
    stOnline: "분석 중", stPreview: "미리보기 (분석 중지됨)", stOffline: "영상 없음",
    persons: "사람 {n}", watching: "원격 시청 {n}",
    model: "인식 모델", modelFast: "빠름 (EfficientDet Lite0)", modelAccurate: "정확 (EfficientDet Lite2, 그래픽카드 권장)",
    analyzeMs: "분석 주기 (ms)", minScore: "최소 신뢰도 (0~1)", cropMode: "설비 주변을 확대해서 인식 (멀리 있는 사람 인식 향상)",
    overlap: "작업자 위치 겹침 비율 (0~1)", frameMs: "원격 영상 전송 주기 (ms)", frameW: "원격 영상 가로 크기 (px)"
  },
  en: {
    appTitle: "KOWOO Thai machine watch", analyzerTitle: "KOWOO Thai analysis PC",
    email: "Email", password: "Password", login: "Sign in", logout: "Sign out",
    loginFail: "Sign-in failed. Check your email and password.",
    noRole: "This account has no access yet. Ask an admin to register this UID: {uid}",
    notConfigured: "Enter your Firebase settings in assets/firebase-config.js, then reload. See step 1 in the README.",
    siteTime: "Thailand", krTime: "Korea", sound: "Alert sound",
    allRunning: "Every machine has an operator", idleHeadline: "{n} machines without an operator",
    noCameras: "No cameras yet. Register cameras and machines on the factory analysis PC.",
    run: "Running", idle: "Idle", off: "Planned stop", nosig: "No signal",
    cameras: "Cameras", waitingFrame: "Waiting for video. Check that the factory analysis PC is on.",
    frameStale: "Loading the latest frame…", camOffline: "Offline",
    shiftStats: "Utilization by shift", day: "Day shift", night: "Night shift",
    equipment: "Machine", runTime: "Running", idleTime: "Idle", idleRate: "Idle rate", total: "Total",
    noData: "No data recorded for this shift.",
    idleNow: "Machines without an operator", noIdle: "Every machine has an operator.",
    planStop: "Mark planned stop", planResume: "Resume watching", planned: "Planned stops",
    events: "Status log", noEvents: "No records yet.",
    evIdleStart: "Went idle", evIdleEnd: "Idle ended", evDur: "for {d}",
    area_F1: "F1", area_F2: "F2", area_F3: "F3", area_WH: "Warehouse", area_ETC: "Other",
    agentName: "This PC", agentHint: "Each camera is assigned to one PC. Only cameras assigned to this PC name are analyzed here.",
    start: "Start analysis", stop: "Stop analysis", autoStart: "Start automatically",
    loadingModel: "Loading the person detection model…", modelFail: "Could not load the detection model. Check the internet connection.",
    modelReady: "Detection model ready",
    addCamera: "Add camera", editCamera: "Camera settings", editZones: "Edit machine areas", settings: "Analysis settings",
    noLocalCams: "No cameras are assigned to this PC ({pc}). Add a camera or check the PC name.",
    otherCams: "Cameras on other PCs",
    camName: "Camera name", camArea: "Default area", assignPc: "Assigned PC", srcType: "Video input",
    srcMp4: "CCTV video via go2rtc (recommended)", srcJpeg: "CCTV snapshots via go2rtc", srcWebcam: "USB webcam",
    streamName: "go2rtc stream name", baseUrl: "go2rtc address (blank = this page)",
    webcamDevice: "Webcam", loadWebcams: "Find webcams",
    save: "Save", cancel: "Cancel", delete: "Delete", close: "Close",
    confirmDelCam: "Delete this camera and all its machine areas?",
    zoneHelp: "Enter the machine number, drag a box around the machine and another where the operator stands, then save. Draw the operator spot large enough to hold a whole person.",
    addZone: "New machine", eqId: "Machine no.", eqName: "Machine name", idleSec: "Idle after no operator for (sec)",
    drawEq: "Draw machine box", drawOp: "Draw operator spot", saveZone: "Save machine",
    zoneStatus: "Machine box: {a} / Operator spot: {b}", done: "drawn", missing: "missing",
    zoneNeedId: "Enter the machine number.", zoneNeedBoth: "Draw both the machine box and the operator spot.",
    saved: "Saved", saveFail: "Could not save. Check that you are signed in as an admin.",
    confirmDelZone: "Delete this machine?", zoneNeedLocal: "Edit machine areas on the PC assigned to this camera.",
    httpsWarn: "CCTV video cannot be read from this https address. On the factory PC, use http://localhost:1984/analyzer.html opened by start-kowoo-cctv.bat. USB webcams work here too.",
    stOnline: "Analyzing", stPreview: "Preview (analysis stopped)", stOffline: "No video",
    persons: "{n} people", watching: "{n} watching",
    model: "Detection model", modelFast: "Fast (EfficientDet Lite0)", modelAccurate: "Accurate (EfficientDet Lite2, GPU recommended)",
    analyzeMs: "Analysis interval (ms)", minScore: "Minimum confidence (0–1)", cropMode: "Zoom in around machines (better for distant people)",
    overlap: "Operator spot overlap ratio (0–1)", frameMs: "Remote video interval (ms)", frameW: "Remote video width (px)"
  },
  th: {
    appTitle: "KOWOO Thai ตรวจการเดินเครื่อง", analyzerTitle: "KOWOO Thai เครื่องวิเคราะห์ภาพ",
    email: "อีเมล", password: "รหัสผ่าน", login: "เข้าสู่ระบบ", logout: "ออกจากระบบ",
    loginFail: "เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบอีเมลและรหัสผ่าน",
    noRole: "บัญชีนี้ยังไม่มีสิทธิ์ โปรดให้ผู้ดูแลระบบลงทะเบียน UID นี้: {uid}",
    notConfigured: "กรุณาใส่ค่า Firebase ใน assets/firebase-config.js แล้วเปิดใหม่ ดูขั้นตอนที่ 1 ใน README",
    siteTime: "ไทย", krTime: "เกาหลี", sound: "เสียงเตือน",
    allRunning: "ทุกเครื่องมีพนักงานประจำ", idleHeadline: "เครื่องไม่มีพนักงาน {n} เครื่อง",
    noCameras: "ยังไม่มีกล้อง กรุณาลงทะเบียนกล้องและเครื่องจักรที่ PC วิเคราะห์ในโรงงาน",
    run: "เดินเครื่อง", idle: "หยุด", off: "หยุดตามแผน", nosig: "ไม่มีสัญญาณ",
    cameras: "กล้อง", waitingFrame: "กำลังรอภาพ โปรดตรวจสอบว่า PC วิเคราะห์ในโรงงานเปิดอยู่",
    frameStale: "กำลังโหลดภาพล่าสุด…", camOffline: "ขาดการเชื่อมต่อ",
    shiftStats: "การเดินเครื่องตามกะ", day: "กะกลางวัน", night: "กะกลางคืน",
    equipment: "เครื่องจักร", runTime: "เดิน", idleTime: "หยุด", idleRate: "อัตราหยุด", total: "รวม",
    noData: "ไม่มีข้อมูลของกะนี้",
    idleNow: "เครื่องที่ไม่มีพนักงานตอนนี้", noIdle: "ทุกเครื่องมีพนักงาน",
    planStop: "ตั้งเป็นหยุดตามแผน", planResume: "กลับมาตรวจ", planned: "เครื่องหยุดตามแผน",
    events: "บันทึกสถานะ", noEvents: "ยังไม่มีบันทึก",
    evIdleStart: "เริ่มหยุด", evIdleEnd: "สิ้นสุดการหยุด", evDur: "นาน {d}",
    area_F1: "F1", area_F2: "F2", area_F3: "F3", area_WH: "คลังสินค้า", area_ETC: "อื่นๆ",
    agentName: "ชื่อเครื่องนี้", agentHint: "กล้องแต่ละตัวกำหนดให้ PC หนึ่งเครื่อง เครื่องนี้จะวิเคราะห์เฉพาะกล้องที่กำหนดชื่อเครื่องนี้",
    start: "เริ่มวิเคราะห์", stop: "หยุดวิเคราะห์", autoStart: "เริ่มอัตโนมัติเมื่อเปิด",
    loadingModel: "กำลังโหลดโมเดลตรวจจับคน…", modelFail: "โหลดโมเดลไม่สำเร็จ โปรดตรวจสอบอินเทอร์เน็ต",
    modelReady: "โมเดลพร้อมแล้ว",
    addCamera: "เพิ่มกล้อง", editCamera: "ตั้งค่ากล้อง", editZones: "แก้ไขพื้นที่เครื่อง", settings: "ตั้งค่าการวิเคราะห์",
    noLocalCams: "ยังไม่มีกล้องที่กำหนดให้เครื่องนี้ ({pc}) กรุณาเพิ่มกล้องหรือตรวจสอบชื่อเครื่อง",
    otherCams: "กล้องที่ใช้เครื่องอื่น",
    camName: "ชื่อกล้อง", camArea: "พื้นที่หลัก", assignPc: "เครื่องที่รับผิดชอบ", srcType: "แหล่งภาพ",
    srcMp4: "วิดีโอ CCTV ผ่าน go2rtc (แนะนำ)", srcJpeg: "ภาพนิ่ง CCTV ผ่าน go2rtc", srcWebcam: "เว็บแคม USB",
    streamName: "ชื่อสตรีม go2rtc", baseUrl: "ที่อยู่ go2rtc (เว้นว่าง = หน้านี้)",
    webcamDevice: "เว็บแคม", loadWebcams: "ค้นหาเว็บแคม",
    save: "บันทึก", cancel: "ยกเลิก", delete: "ลบ", close: "ปิด",
    confirmDelCam: "ลบกล้องนี้และพื้นที่เครื่องทั้งหมดหรือไม่?",
    zoneHelp: "ใส่หมายเลขเครื่อง ลากกรอบรอบเครื่องจักร และลากกรอบจุดที่พนักงานยืน แล้วกดบันทึก กรอบจุดยืนต้องใหญ่พอให้ทั้งตัวคนอยู่ข้างใน",
    addZone: "เครื่องใหม่", eqId: "หมายเลขเครื่อง", eqName: "ชื่อเครื่อง", idleSec: "ถือว่าหยุดเมื่อไม่มีคน (วินาที)",
    drawEq: "วาดกรอบเครื่อง", drawOp: "วาดจุดยืนพนักงาน", saveZone: "บันทึกเครื่อง",
    zoneStatus: "กรอบเครื่อง: {a} / จุดยืน: {b}", done: "วาดแล้ว", missing: "ยังไม่มี",
    zoneNeedId: "กรุณาใส่หมายเลขเครื่อง", zoneNeedBoth: "ต้องวาดทั้งกรอบเครื่องและจุดยืนพนักงาน",
    saved: "บันทึกแล้ว", saveFail: "บันทึกไม่สำเร็จ โปรดตรวจสอบว่าเข้าสู่ระบบด้วยบัญชีผู้ดูแล",
    confirmDelZone: "ลบเครื่องนี้หรือไม่?", zoneNeedLocal: "กรุณาแก้ไขพื้นที่เครื่องที่ PC ที่รับผิดชอบกล้องนี้",
    httpsWarn: "ที่อยู่ https นี้อ่านภาพ CCTV ไม่ได้ ที่ PC โรงงานให้ใช้ http://localhost:1984/analyzer.html ที่เปิดด้วย start-kowoo-cctv.bat (เว็บแคม USB ใช้ที่นี่ได้)",
    stOnline: "กำลังวิเคราะห์", stPreview: "แสดงตัวอย่าง (หยุดวิเคราะห์)", stOffline: "ไม่มีภาพ",
    persons: "คน {n}", watching: "ดูอยู่ {n}",
    model: "โมเดลตรวจจับ", modelFast: "เร็ว (EfficientDet Lite0)", modelAccurate: "แม่นยำ (EfficientDet Lite2 แนะนำการ์ดจอ)",
    analyzeMs: "รอบการวิเคราะห์ (ms)", minScore: "ความมั่นใจขั้นต่ำ (0–1)", cropMode: "ขยายบริเวณรอบเครื่อง (ตรวจจับคนที่อยู่ไกลได้ดีขึ้น)",
    overlap: "สัดส่วนการทับจุดยืน (0–1)", frameMs: "รอบส่งภาพระยะไกล (ms)", frameW: "ความกว้างภาพระยะไกล (px)"
  }
};
const LANGS = ["ko", "en", "th"];
let LANG = (() => {
  try { const v = localStorage.getItem("kcw.lang"); if (LANGS.includes(v)) return v; } catch {}
  const n = (navigator.language || "").slice(0, 2);
  return LANGS.includes(n) ? n : "ko";
})();
export const getLang = () => LANG;
export function t(k, vars) {
  let s = DICT[LANG]?.[k] ?? DICT.en[k] ?? k;
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.replaceAll(`{${a}}`, b);
  return s;
}
export function applyI18n(root = document) {
  document.documentElement.lang = LANG;
  root.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-ph]").forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
}
export function bindLangSelects() {
  document.querySelectorAll(".lang-select").forEach(sel => {
    sel.value = LANG;
    sel.addEventListener("change", () => {
      LANG = sel.value;
      try { localStorage.setItem("kcw.lang", LANG); } catch {}
      document.querySelectorAll(".lang-select").forEach(s => { s.value = LANG; });
      applyI18n();
      window.dispatchEvent(new Event("langchange"));
    });
  });
}
export const areaLabel = a => t("area_" + a) === "area_" + a ? (a || "") : t("area_" + a);
export const stateLabel = s => t(s);

/* ---------- auth ---------- */
export function showSetup() {
  const el = $("#setupMsg");
  el.textContent = t("notConfigured");
  el.hidden = false;
}
export function authGate({ onReady }) {
  const loginEl = $("#login"), appEl = $("#app");
  const form = loginEl.querySelector("form"), msg = loginEl.querySelector(".login-msg");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    msg.textContent = "";
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    try { await signInWithEmailAndPassword(auth, form.email.value.trim(), form.password.value); }
    catch { msg.textContent = t("loginFail"); }
    finally { btn.disabled = false; }
  });
  document.querySelectorAll("[data-action=logout]").forEach(b => b.addEventListener("click", () => signOut(auth)));
  let started = false;
  onAuthStateChanged(auth, async user => {
    if (!user) {
      if (started) { location.reload(); return; }
      loginEl.hidden = false; appEl.hidden = true;
      return;
    }
    let role = null;
    try { role = (await get(R(`roles/${user.uid}`))).val(); } catch (e) { console.warn(e); }
    if (!role) {
      loginEl.hidden = false; appEl.hidden = true;
      msg.textContent = t("noRole", { uid: user.uid });
      await signOut(auth);
      return;
    }
    loginEl.hidden = true; appEl.hidden = false;
    document.body.classList.toggle("is-admin", role === "admin");
    document.body.dataset.role = role;
    if (!started) { started = true; onReady({ user, role }); }
  });
}

/* ---------- time ---------- */
const fmtCache = {};
const fmt = tz => (fmtCache[tz] ||= new Intl.DateTimeFormat("en-CA", {
  timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
}));
export function tzParts(ts, tz = SITE.timezone) {
  const o = {};
  for (const p of fmt(tz).formatToParts(new Date(ts))) o[p.type] = p.value;
  return o;
}
const ymd = p => `${p.year}-${p.month}-${p.day}`;
// 근무조: 주간 = dayShiftStart~nightShiftStart, 야간은 시작한 날짜로 묶음
export function shiftOf(ts) {
  const p = tzParts(ts), h = +p.hour;
  if (h >= SITE.dayShiftStart && h < SITE.nightShiftStart) return { date: ymd(p), shift: "D" };
  if (h >= SITE.nightShiftStart) return { date: ymd(p), shift: "N" };
  return { date: ymd(tzParts(ts - 12 * 3600e3)), shift: "N" };
}
export const fmtClock = (ts, tz = SITE.timezone, sec = false) => {
  const p = tzParts(ts, tz);
  return `${p.hour}:${p.minute}${sec ? ":" + p.second : ""}`;
};
export function fmtStamp(ts) {
  const p = tzParts(ts), n = tzParts(now());
  return (ymd(p) === ymd(n) ? "" : `${p.month}/${p.day} `) + `${p.hour}:${p.minute}`;
}
const pad = n => String(n).padStart(2, "0");
export function fmtDur(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
export function fmtHM(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(sec / 3600)}:${pad(Math.floor((sec % 3600) / 60))}`;
}

/* ---------- overlay ---------- */
// zones: {zid: {eqId, eq:[x,y,w,h], op:[x,y,w,h]}} (0~1 정규화 좌표)
// states: {zid: {state, since}}, persons: [[x,y,w,h], ...]
export function drawOverlay(ctx, W, H, zones, states, persons, opt = {}) {
  const lw = Math.max(2, Math.round(W / 420));
  const fs = Math.max(12, Math.round(W / 58));
  const rect = r => [r[0] * W, r[1] * H, r[2] * W, r[3] * H];
  ctx.save();
  ctx.font = `600 ${fs}px ${FONT}`;
  ctx.textBaseline = "top";

  ctx.strokeStyle = COLORS.person;
  ctx.lineWidth = Math.max(1, lw * 0.6);
  for (const p of persons || []) {
    const r = Array.isArray(p) ? p : [p.x, p.y, p.w, p.h];
    ctx.strokeRect(...rect(r));
  }

  for (const [zid, z] of Object.entries(zones || {})) {
    const st = states?.[zid]?.state || "nosig";
    const c = COLORS[st];
    if (z.op) {
      ctx.setLineDash([lw * 3, lw * 2]);
      ctx.strokeStyle = "rgba(255,255,255,.85)";
      ctx.lineWidth = Math.max(1, lw * 0.75);
      ctx.strokeRect(...rect(z.op));
      ctx.setLineDash([]);
    }
    if (!z.eq) continue;
    const [x, y, w, h] = rect(z.eq);
    if (st === "idle") {
      ctx.fillStyle = opt.blink ? "rgba(210,32,26,.32)" : "rgba(210,32,26,.12)";
      ctx.fillRect(x, y, w, h);
    }
    ctx.strokeStyle = c;
    ctx.lineWidth = st === "idle" ? lw * 2.2 : lw;
    ctx.strokeRect(x, y, w, h);
    if (opt.highlight === zid) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = lw;
      ctx.strokeRect(x - lw * 3, y - lw * 3, w + lw * 6, h + lw * 6);
    }
    let label = z.eqId || "?";
    const since = states?.[zid]?.since;
    if (st === "idle" && since) label += "  " + fmtDur((now() - since) / 1000);
    else if (st !== "run") label += "  " + stateLabel(st);
    const p = Math.round(fs / 3), tw = ctx.measureText(label).width;
    let ly = y - fs - p * 2;
    if (ly < 0) ly = y;
    ctx.fillStyle = c;
    ctx.fillRect(x, ly, tw + p * 2, fs + p * 2);
    ctx.fillStyle = st === "nosig" ? "#2A1F00" : "#fff";
    ctx.fillText(label, x + p, ly + p);
  }
  ctx.restore();
}
