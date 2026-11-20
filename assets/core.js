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
// 알림 설정(중계 주소·키)은 cctv 밖에 두어 admin·agent만 읽게 함
export const ALERT = () => ref(db, `${SITE.root}Alert`);

/* ---------- 설비 상태 목록 (대시보드·상황실 공용) ---------- */
export const STALE_MS = 30000;
export function camFreshOf(live, cid) {
  const lv = live?.[cid];
  return !!lv && lv.online !== false && now() - (lv.ts || 0) < STALE_MS;
}
export function buildItems(cams, live, plan) {
  const out = [];
  for (const [cid, cam] of Object.entries(cams || {})) {
    const fresh = camFreshOf(live, cid), lv = live?.[cid];
    for (const [zid, z] of Object.entries(cam.zones || {})) {
      let state, since, r = null, m = 0;
      const pl = plan?.[cid]?.[zid];
      if (pl) { state = "off"; since = pl.ts; }
      else if (!fresh) { state = "nosig"; since = lv?.ts; }
      else { const zs = lv.zones?.[zid]; state = zs?.state || "nosig"; since = zs?.since; r = zs?.r ?? null; m = zs?.m || 0; }
      out.push({ cid, zid, cam, z, state, since, r, m, area: z.area || cam.area || "ETC" });
    }
  }
  return out.sort((a, b) => (SITE.areas.indexOf(a.area) - SITE.areas.indexOf(b.area)) || natCmp(a.z.eqId, b.z.eqId));
}
let audioCtx = null;
export function beep(unlock = false) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (unlock) audioCtx.resume();
  } catch { return; }
  const a = audioCtx;
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
    allRunning: "모든 설비가 가동 중입니다", idleHeadline: "비가동 의심 설비 {n}대",
    noCameras: "등록된 카메라가 없습니다. 공장 분석 PC에서 카메라와 설비를 등록하세요.",
    run: "가동", idle: "비가동 의심", off: "계획정지", nosig: "신호없음",
    cameras: "카메라", waitingFrame: "영상을 기다리는 중입니다. 공장 분석 PC가 켜져 있는지 확인하세요.",
    frameStale: "최신 영상을 불러오는 중입니다…", camOffline: "연결 끊김",
    shiftStats: "근무조별 가동 현황", day: "주간", night: "야간",
    equipment: "설비", runTime: "가동", idleTime: "비가동", idleRate: "비가동률", total: "합계",
    noData: "이 근무조에 기록된 데이터가 없습니다.",
    idleNow: "지금 비가동 의심 설비", noIdle: "비가동 의심 설비가 없습니다.",
    planStop: "계획정지 처리", planResume: "감시 재개", planned: "계획정지 설비",
    events: "상태 변경 기록", noEvents: "아직 기록이 없습니다.",
    evIdleStart: "비가동 시작", evIdleEnd: "비가동 종료", evDur: "{d} 동안",
    area_F1: "F1", area_F2: "F2", area_F3: "F3", area_WH: "창고", area_ETC: "기타",
    agentName: "이 PC 이름", agentHint: "카메라마다 담당 PC를 지정합니다. 이 PC 이름이 지정된 카메라만 여기서 분석합니다.",
    start: "분석 시작", stop: "분석 중지", autoStart: "열면 자동 시작",
    loadingModel: "사람 인식 모델을 불러오는 중…", modelFail: "인식 모델을 불러오지 못했습니다. 인터넷 연결을 확인하세요.",
    modelReady: "인식 모델 준비됨",
    addCamera: "카메라 추가", editCamera: "카메라 설정", editZones: "감시 박스 편집", settings: "분석 설정",
    noLocalCams: "이 PC({pc})에 지정된 카메라가 없습니다. 카메라를 추가하거나 PC 이름을 확인하세요.",
    otherCams: "다른 PC에 지정된 카메라",
    camName: "카메라 이름", camArea: "기본 구역", assignPc: "담당 PC 이름", srcType: "영상 입력",
    srcMp4: "CCTV 영상 (go2rtc, 권장)", srcJpeg: "CCTV 스냅샷 (go2rtc)", srcWebcam: "USB 웹캠",
    streamName: "go2rtc 스트림 이름", baseUrl: "go2rtc 주소 (비우면 이 페이지 주소)",
    webcamDevice: "웹캠", loadWebcams: "웹캠 목록 불러오기",
    save: "저장", cancel: "취소", delete: "삭제", close: "닫기",
    confirmDelCam: "이 카메라와 등록된 설비 영역을 모두 삭제할까요?",
    zoneHelp: "설비번호를 입력하고 화면 위에 감시 박스를 드래그해 그린 뒤 저장하세요. 작업자가 서서 일하는 자리나 소재 투입부처럼 가동 중이면 움직임이 생기는 곳을 그리고, 경광등·시계 글자·통로는 빼세요.",
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
    analyzeMs: "확인 간격 (ms, 기본 1000)", minScore: "최소 신뢰도 (0~1)", cropMode: "설비 주변을 확대해서 인식 (멀리 있는 사람 인식 향상)",
    overlap: "작업자 위치 겹침 비율 (0~1)", frameMs: "원격 영상 전송 주기 (ms)", frameW: "원격 영상 가로 크기 (px)",
    srcImage: "시험용 CCTV (사진·영상 파일)", imageHint: "저장 후 카메라 칸의 [시험 파일 불러오기]로 공장 사진이나 영상 파일을 고르세요. 사진은 움직임이 없어 판단 시간의 절반(최대 1분) 뒤 모든 박스가 빨강이 되고, 영상은 반복 재생되며 움직이는 곳은 초록이 되는 것이 정상입니다. 사진은 이 PC에 저장되지만 영상은 페이지를 다시 열면 다시 골라야 합니다.",
    pickImage: "시험 파일 불러오기", repickImage: "시험 파일 바꾸기", needImage: "시험할 공장 사진이나 영상 파일을 불러오세요.", needImageShort: "시험 파일 필요", imageFail: "파일을 열지 못했습니다. 사진(JPG·PNG)이나 MP4·WEBM 영상을 쓰세요.",
    srcUrl: "시험용 웹 주소 (실시간 웹캠 사이트)", urlLabel: "웹캠 주소", urlHint: "직접 영상 주소(.m3u8, .mp4, .mjpg, 스냅샷 .jpg)는 바로 분석합니다. 유튜브 같은 일반 사이트 주소는 [사이트 열기]로 새 창을 연 뒤 [화면 선택]에서 그 창(탭)을 고르면 분석됩니다.",
    openSite: "사이트 열기", urlPageMsg: "[사이트 열기]로 새 창을 연 뒤, [화면 선택]을 눌러 그 창이나 탭을 고르세요. 사이트 창은 최소화하지 마세요.",
    urlBlocked: "이 주소는 영상을 직접 읽을 수 없습니다 (사이트 차단 또는 잘못된 주소). [사이트 열기] 후 [화면 선택]으로 시험하세요.",
    roomTitle: "코우타이 종합상황실", openRoom: "종합상황실", backDash: "대시보드", fullscreen: "전체 화면", roomIdleHead: "비가동 의심 설비", roomNosigHead: "영상 신호 없는 카메라", roomNoImage: "확대 화면을 불러오는 중입니다", roomAllOk: "모든 설비가 가동 중입니다",
    alertSettings: "LINE 알림 설정", alEnabled: "알림 보내기", alUrl: "중계 주소 (구글 앱스 스크립트 웹 앱 URL)", alKey: "중계 비밀키 (스크립트의 RELAY_KEY와 같게)",
    alDelay: "비가동 의심이 이 시간(분) 이상 계속되면 알림", alRepeat: "계속 비가동이면 다시 알림 (분, 0 = 다시 안 보냄)", alResolved: "가동으로 돌아오면 알림 (메시지 수 늘어남)",
    alQuiet: "알림 쉬는 시간 (태국 시간, 점심·교대 시간)", alLangs: "메시지 언어", alRoomUrl: "메시지에 넣을 종합상황실 주소",
    alHint: "LINE 공식계정 메시지는 보낸 횟수 × 받는 사람 수로 계산됩니다. 여러 설비는 한 메시지로 묶어 보냅니다.", alTest: "시험 메시지 보내기",
    alTestSent: "보냈습니다. LINE에서 확인하세요.", alNeedUrl: "중계 주소를 입력하세요.", alTestText: "시험 메시지입니다",
    alertHead: "비가동 의심 {n}대", alertStill: "계속 비가동", alertNosig: "영상 신호 없음", alertBack: "가동 복귀",
    tileSize: "화면 크기", sizeS: "작게", sizeM: "보통", sizeL: "크게", sizeXL: "한 줄에 하나 (가장 크게)", bigView: "크게 보기",
    editZonesRemote: "감시 박스 편집", rzHelp: "코우타이 분석 PC가 보내 주는 최신 화면 위에 그립니다. 저장하면 분석 PC가 바로 새 박스로 분석합니다.", rzWait: "화면을 기다리는 중입니다. 분석 PC가 켜져 있고 CCTV 화면이 선택되어 있어야 합니다.",
    openAnalyzer: "분석 화면",
    dupTab: "이 PC에서 분석 화면이 이미 다른 탭에 열려 분석 중입니다. 그 탭을 쓰고 이 탭은 닫으세요.",
    srcScreen: "CCTV 프로그램 화면 (권장)", screenHint: "저장 후 카메라 칸의 [CCTV 화면 선택]을 눌러 CCTV 프로그램 창을 고르세요. CCTV 창은 최소화하지 말고 분할 화면을 고정해 두세요.",
    pickScreen: "CCTV 화면 선택", repickScreen: "화면 다시 선택", needPick: "CCTV 프로그램 창을 선택해야 분석할 수 있습니다.", needPickShort: "화면 선택 필요",
    skippedNow: "화면 전체 변화로 이번 회차 제외",
    windowMin: "판단 시간 (분)", minRatio: "가동 기준: 움직임 비율 (%)", sens: "민감도 (1~10)",
    boxStatus: "감시 박스: {a}", liveRatio: "최근 {m}분 움직임 {r}%", zoneNeedBox: "감시 박스를 그려야 합니다.",
    ratioShort: "최근 {m}분 움직임 {r}%",
    pixThresh: "화소 변화 기준 (밝기 차이, 기본 22)", skipPct: "화면 전체가 이 % 이상 바뀌면 그 회차 무시 (조명·야간 전환)",
  },
  en: {
    appTitle: "KOWOO Thai machine watch", analyzerTitle: "KOWOO Thai analysis PC",
    email: "Email", password: "Password", login: "Sign in", logout: "Sign out",
    loginFail: "Sign-in failed. Check your email and password.",
    noRole: "This account has no access yet. Ask an admin to register this UID: {uid}",
    notConfigured: "Enter your Firebase settings in assets/firebase-config.js, then reload. See step 1 in the README.",
    siteTime: "Thailand", krTime: "Korea", sound: "Alert sound",
    allRunning: "Every machine is running", idleHeadline: "{n} machines suspected idle",
    noCameras: "No cameras yet. Register cameras and machines on the factory analysis PC.",
    run: "Running", idle: "Suspected idle", off: "Planned stop", nosig: "No signal",
    cameras: "Cameras", waitingFrame: "Waiting for video. Check that the factory analysis PC is on.",
    frameStale: "Loading the latest frame…", camOffline: "Offline",
    shiftStats: "Utilization by shift", day: "Day shift", night: "Night shift",
    equipment: "Machine", runTime: "Running", idleTime: "Idle", idleRate: "Idle rate", total: "Total",
    noData: "No data recorded for this shift.",
    idleNow: "Machines suspected idle", noIdle: "No machine is suspected idle.",
    planStop: "Mark planned stop", planResume: "Resume watching", planned: "Planned stops",
    events: "Status log", noEvents: "No records yet.",
    evIdleStart: "Went idle", evIdleEnd: "Idle ended", evDur: "for {d}",
    area_F1: "F1", area_F2: "F2", area_F3: "F3", area_WH: "Warehouse", area_ETC: "Other",
    agentName: "This PC", agentHint: "Each camera is assigned to one PC. Only cameras assigned to this PC name are analyzed here.",
    start: "Start analysis", stop: "Stop analysis", autoStart: "Start automatically",
    loadingModel: "Loading the person detection model…", modelFail: "Could not load the detection model. Check the internet connection.",
    modelReady: "Detection model ready",
    addCamera: "Add camera", editCamera: "Camera settings", editZones: "Edit watch boxes", settings: "Analysis settings",
    noLocalCams: "No cameras are assigned to this PC ({pc}). Add a camera or check the PC name.",
    otherCams: "Cameras on other PCs",
    camName: "Camera name", camArea: "Default area", assignPc: "Assigned PC", srcType: "Video input",
    srcMp4: "CCTV video via go2rtc (recommended)", srcJpeg: "CCTV snapshots via go2rtc", srcWebcam: "USB webcam",
    streamName: "go2rtc stream name", baseUrl: "go2rtc address (blank = this page)",
    webcamDevice: "Webcam", loadWebcams: "Find webcams",
    save: "Save", cancel: "Cancel", delete: "Delete", close: "Close",
    confirmDelCam: "Delete this camera and all its machine areas?",
    zoneHelp: "Enter the machine number, drag a watch box on the screen, then save. Draw it where something moves while the machine runs, such as the operator spot or the loading area. Leave out stack lights, clock text and aisles.",
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
    analyzeMs: "Check interval (ms, default 1000)", minScore: "Minimum confidence (0–1)", cropMode: "Zoom in around machines (better for distant people)",
    overlap: "Operator spot overlap ratio (0–1)", frameMs: "Remote video interval (ms)", frameW: "Remote video width (px)",
    srcImage: "Test CCTV (photo or video file)", imageHint: "After saving, press [Load test file] on the camera tile and pick a factory photo or video. A photo never moves, so every box should turn red after half the judgment window (max 1 min); a video loops and moving areas should stay green. Photos are kept on this PC; a video must be chosen again after reopening the page.",
    pickImage: "Load test file", repickImage: "Change test file", needImage: "Load a factory photo or video to test.", needImageShort: "Test file needed", imageFail: "Could not open the file. Use a JPG/PNG photo or an MP4/WEBM video.",
    srcUrl: "Test web address (live webcam site)", urlLabel: "Webcam address", urlHint: "Direct stream addresses (.m3u8, .mp4, .mjpg, snapshot .jpg) are analyzed directly. For ordinary sites such as YouTube, press [Open site], then [Choose CCTV screen] and pick that window or tab.",
    openSite: "Open site", urlPageMsg: "Press [Open site] to open a new window, then [Choose CCTV screen] and pick that window or tab. Do not minimize the site window.",
    urlBlocked: "This address cannot be read directly (blocked by the site or wrong address). Use [Open site] and then [Choose CCTV screen].",
    roomTitle: "KOWOO Thai situation room", openRoom: "Situation room", backDash: "Dashboard", fullscreen: "Full screen", roomIdleHead: "Machines suspected idle", roomNosigHead: "Cameras without video", roomNoImage: "Loading the close-up view", roomAllOk: "Every machine is running",
    alertSettings: "LINE alerts", alEnabled: "Send alerts", alUrl: "Relay address (Google Apps Script web app URL)", alKey: "Relay secret (same as RELAY_KEY in the script)",
    alDelay: "Alert when suspected idle lasts this long (min)", alRepeat: "Remind if still idle every (min, 0 = never)", alResolved: "Alert when a machine runs again (more messages)",
    alQuiet: "Quiet times (Thailand time, breaks and shift change)", alLangs: "Message languages", alRoomUrl: "Situation room address in messages",
    alHint: "LINE Official Account messages are counted as sends × recipients. Several machines are grouped into one message.", alTest: "Send test message",
    alTestSent: "Sent. Check LINE.", alNeedUrl: "Enter the relay address.", alTestText: "This is a test message",
    alertHead: "{n} machines suspected idle", alertStill: "Still idle", alertNosig: "No video signal", alertBack: "Running again",
    tileSize: "View size", sizeS: "Small", sizeM: "Medium", sizeL: "Large", sizeXL: "One per row (largest)", bigView: "Full screen",
    editZonesRemote: "Edit watch boxes", rzHelp: "You draw on the latest frame sent by the KOWOO Thai analysis PC. Once saved, the analysis PC uses the new boxes right away.", rzWait: "Waiting for a frame. The analysis PC must be on with the CCTV screen selected.",
    openAnalyzer: "Analysis PC page",
    dupTab: "This PC already has the analysis page running in another tab. Use that tab and close this one.",
    srcScreen: "CCTV program screen (recommended)", screenHint: "After saving, press [Choose CCTV screen] on the camera tile and pick the CCTV program window. Do not minimize it, and keep the split layout fixed.",
    pickScreen: "Choose CCTV screen", repickScreen: "Choose again", needPick: "Choose the CCTV program window to start analysis.", needPickShort: "Choose a screen",
    skippedNow: "whole screen changed, sample skipped",
    windowMin: "Judgment window (min)", minRatio: "Running if motion ratio ≥ (%)", sens: "Sensitivity (1–10)",
    boxStatus: "Watch box: {a}", liveRatio: "Motion {r}% in last {m} min", zoneNeedBox: "Draw the watch box.",
    ratioShort: "Motion {r}% in last {m} min",
    pixThresh: "Pixel change threshold (brightness, default 22)", skipPct: "Skip a sample when this % of the whole screen changes (lights, night mode)",
  },
  th: {
    appTitle: "KOWOO Thai ตรวจการเดินเครื่อง", analyzerTitle: "KOWOO Thai เครื่องวิเคราะห์ภาพ",
    email: "อีเมล", password: "รหัสผ่าน", login: "เข้าสู่ระบบ", logout: "ออกจากระบบ",
    loginFail: "เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบอีเมลและรหัสผ่าน",
    noRole: "บัญชีนี้ยังไม่มีสิทธิ์ โปรดให้ผู้ดูแลระบบลงทะเบียน UID นี้: {uid}",
    notConfigured: "กรุณาใส่ค่า Firebase ใน assets/firebase-config.js แล้วเปิดใหม่ ดูขั้นตอนที่ 1 ใน README",
    siteTime: "ไทย", krTime: "เกาหลี", sound: "เสียงเตือน",
    allRunning: "ทุกเครื่องกำลังเดิน", idleHeadline: "เครื่องที่สงสัยว่าหยุด {n} เครื่อง",
    noCameras: "ยังไม่มีกล้อง กรุณาลงทะเบียนกล้องและเครื่องจักรที่ PC วิเคราะห์ในโรงงาน",
    run: "เดินเครื่อง", idle: "สงสัยว่าหยุด", off: "หยุดตามแผน", nosig: "ไม่มีสัญญาณ",
    cameras: "กล้อง", waitingFrame: "กำลังรอภาพ โปรดตรวจสอบว่า PC วิเคราะห์ในโรงงานเปิดอยู่",
    frameStale: "กำลังโหลดภาพล่าสุด…", camOffline: "ขาดการเชื่อมต่อ",
    shiftStats: "การเดินเครื่องตามกะ", day: "กะกลางวัน", night: "กะกลางคืน",
    equipment: "เครื่องจักร", runTime: "เดิน", idleTime: "หยุด", idleRate: "อัตราหยุด", total: "รวม",
    noData: "ไม่มีข้อมูลของกะนี้",
    idleNow: "เครื่องที่สงสัยว่าหยุด", noIdle: "ไม่มีเครื่องที่สงสัยว่าหยุด",
    planStop: "ตั้งเป็นหยุดตามแผน", planResume: "กลับมาตรวจ", planned: "เครื่องหยุดตามแผน",
    events: "บันทึกสถานะ", noEvents: "ยังไม่มีบันทึก",
    evIdleStart: "เริ่มหยุด", evIdleEnd: "สิ้นสุดการหยุด", evDur: "นาน {d}",
    area_F1: "F1", area_F2: "F2", area_F3: "F3", area_WH: "คลังสินค้า", area_ETC: "อื่นๆ",
    agentName: "ชื่อเครื่องนี้", agentHint: "กล้องแต่ละตัวกำหนดให้ PC หนึ่งเครื่อง เครื่องนี้จะวิเคราะห์เฉพาะกล้องที่กำหนดชื่อเครื่องนี้",
    start: "เริ่มวิเคราะห์", stop: "หยุดวิเคราะห์", autoStart: "เริ่มอัตโนมัติเมื่อเปิด",
    loadingModel: "กำลังโหลดโมเดลตรวจจับคน…", modelFail: "โหลดโมเดลไม่สำเร็จ โปรดตรวจสอบอินเทอร์เน็ต",
    modelReady: "โมเดลพร้อมแล้ว",
    addCamera: "เพิ่มกล้อง", editCamera: "ตั้งค่ากล้อง", editZones: "แก้ไขกรอบตรวจ", settings: "ตั้งค่าการวิเคราะห์",
    noLocalCams: "ยังไม่มีกล้องที่กำหนดให้เครื่องนี้ ({pc}) กรุณาเพิ่มกล้องหรือตรวจสอบชื่อเครื่อง",
    otherCams: "กล้องที่ใช้เครื่องอื่น",
    camName: "ชื่อกล้อง", camArea: "พื้นที่หลัก", assignPc: "เครื่องที่รับผิดชอบ", srcType: "แหล่งภาพ",
    srcMp4: "วิดีโอ CCTV ผ่าน go2rtc (แนะนำ)", srcJpeg: "ภาพนิ่ง CCTV ผ่าน go2rtc", srcWebcam: "เว็บแคม USB",
    streamName: "ชื่อสตรีม go2rtc", baseUrl: "ที่อยู่ go2rtc (เว้นว่าง = หน้านี้)",
    webcamDevice: "เว็บแคม", loadWebcams: "ค้นหาเว็บแคม",
    save: "บันทึก", cancel: "ยกเลิก", delete: "ลบ", close: "ปิด",
    confirmDelCam: "ลบกล้องนี้และพื้นที่เครื่องทั้งหมดหรือไม่?",
    zoneHelp: "ใส่หมายเลขเครื่อง ลากกรอบตรวจบนหน้าจอ แล้วกดบันทึก ให้วาดตรงจุดที่มีการเคลื่อนไหวเมื่อเครื่องเดิน เช่น จุดยืนพนักงานหรือจุดป้อนชิ้นงาน ไม่รวมไฟสัญญาณ ตัวเลขนาฬิกา และทางเดิน",
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
    analyzeMs: "รอบการตรวจ (ms ค่าเริ่มต้น 1000)", minScore: "ความมั่นใจขั้นต่ำ (0–1)", cropMode: "ขยายบริเวณรอบเครื่อง (ตรวจจับคนที่อยู่ไกลได้ดีขึ้น)",
    overlap: "สัดส่วนการทับจุดยืน (0–1)", frameMs: "รอบส่งภาพระยะไกล (ms)", frameW: "ความกว้างภาพระยะไกล (px)",
    srcImage: "CCTV ทดสอบ (ไฟล์รูปหรือวิดีโอ)", imageHint: "บันทึกแล้วกด [โหลดไฟล์ทดสอบ] ที่ช่องกล้องแล้วเลือกรูปหรือวิดีโอโรงงาน รูปไม่มีการเคลื่อนไหว เมื่อผ่านครึ่งหนึ่งของช่วงเวลาตัดสิน (สูงสุด 1 นาที) ทุกกรอบควรเป็นสีแดง ส่วนวิดีโอจะเล่นวนและจุดที่เคลื่อนไหวควรเป็นสีเขียว รูปเก็บไว้ในเครื่องนี้ แต่วิดีโอต้องเลือกใหม่เมื่อเปิดหน้าใหม่",
    pickImage: "โหลดไฟล์ทดสอบ", repickImage: "เปลี่ยนไฟล์ทดสอบ", needImage: "กรุณาโหลดรูปหรือวิดีโอโรงงานเพื่อทดสอบ", needImageShort: "ต้องมีไฟล์ทดสอบ", imageFail: "เปิดไฟล์ไม่สำเร็จ ใช้รูป JPG/PNG หรือวิดีโอ MP4/WEBM",
    srcUrl: "ที่อยู่เว็บทดสอบ (เว็บกล้องสด)", urlLabel: "ที่อยู่เว็บแคม", urlHint: "ที่อยู่สตรีมโดยตรง (.m3u8, .mp4, .mjpg, ภาพนิ่ง .jpg) จะวิเคราะห์ได้ทันที สำหรับเว็บทั่วไปเช่น YouTube ให้กด [เปิดเว็บ] แล้วกด [เลือกหน้าจอ CCTV] และเลือกหน้าต่างหรือแท็บนั้น",
    openSite: "เปิดเว็บ", urlPageMsg: "กด [เปิดเว็บ] เพื่อเปิดหน้าต่างใหม่ แล้วกด [เลือกหน้าจอ CCTV] และเลือกหน้าต่างหรือแท็บนั้น อย่าย่อหน้าต่างเว็บ",
    urlBlocked: "อ่านภาพจากที่อยู่นี้โดยตรงไม่ได้ (เว็บบล็อกหรือที่อยู่ผิด) กรุณากด [เปิดเว็บ] แล้ว [เลือกหน้าจอ CCTV]",
    roomTitle: "ห้องควบคุม KOWOO Thai", openRoom: "ห้องควบคุม", backDash: "แดชบอร์ด", fullscreen: "เต็มจอ", roomIdleHead: "เครื่องที่สงสัยว่าหยุด", roomNosigHead: "กล้องที่ไม่มีภาพ", roomNoImage: "กำลังโหลดภาพขยาย", roomAllOk: "ทุกเครื่องกำลังเดิน",
    alertSettings: "ตั้งค่าแจ้งเตือน LINE", alEnabled: "ส่งการแจ้งเตือน", alUrl: "ที่อยู่ตัวกลาง (URL เว็บแอป Google Apps Script)", alKey: "รหัสลับตัวกลาง (ตรงกับ RELAY_KEY ในสคริปต์)",
    alDelay: "แจ้งเตือนเมื่อสงสัยว่าหยุดนานเกิน (นาที)", alRepeat: "แจ้งซ้ำถ้ายังหยุดอยู่ทุก (นาที, 0 = ไม่แจ้งซ้ำ)", alResolved: "แจ้งเมื่อเครื่องกลับมาเดิน (ข้อความเพิ่มขึ้น)",
    alQuiet: "ช่วงเวลาไม่แจ้งเตือน (เวลาไทย พักเที่ยง เปลี่ยนกะ)", alLangs: "ภาษาข้อความ", alRoomUrl: "ที่อยู่ห้องควบคุมในข้อความ",
    alHint: "ข้อความ LINE OA นับเป็นจำนวนครั้งที่ส่ง × จำนวนผู้รับ เครื่องหลายเครื่องจะรวมเป็นข้อความเดียว", alTest: "ส่งข้อความทดสอบ",
    alTestSent: "ส่งแล้ว กรุณาตรวจสอบใน LINE", alNeedUrl: "กรุณาใส่ที่อยู่ตัวกลาง", alTestText: "นี่คือข้อความทดสอบ",
    alertHead: "สงสัยว่าหยุด {n} เครื่อง", alertStill: "ยังหยุดอยู่", alertNosig: "ไม่มีสัญญาณภาพ", alertBack: "กลับมาเดิน",
    tileSize: "ขนาดภาพ", sizeS: "เล็ก", sizeM: "กลาง", sizeL: "ใหญ่", sizeXL: "แถวละหนึ่ง (ใหญ่สุด)", bigView: "เต็มจอ",
    editZonesRemote: "แก้ไขกรอบตรวจ", rzHelp: "วาดบนภาพล่าสุดที่ PC วิเคราะห์ของ KOWOO Thai ส่งมา เมื่อบันทึกแล้ว PC วิเคราะห์จะใช้กรอบใหม่ทันที", rzWait: "กำลังรอภาพ PC วิเคราะห์ต้องเปิดอยู่และเลือกหน้าจอ CCTV แล้ว",
    openAnalyzer: "หน้าวิเคราะห์",
    dupTab: "เครื่องนี้เปิดหน้าวิเคราะห์อยู่แล้วในแท็บอื่น กรุณาใช้แท็บนั้นและปิดแท็บนี้",
    srcScreen: "หน้าจอโปรแกรม CCTV (แนะนำ)", screenHint: "บันทึกแล้วกด [เลือกหน้าจอ CCTV] ที่ช่องกล้อง แล้วเลือกหน้าต่างโปรแกรม CCTV อย่าย่อหน้าต่าง และอย่าเปลี่ยนรูปแบบการแบ่งจอ",
    pickScreen: "เลือกหน้าจอ CCTV", repickScreen: "เลือกใหม่", needPick: "ต้องเลือกหน้าต่างโปรแกรม CCTV ก่อนจึงจะวิเคราะห์ได้", needPickShort: "ต้องเลือกหน้าจอ",
    skippedNow: "ทั้งจอเปลี่ยน ข้ามรอบนี้",
    windowMin: "ช่วงเวลาตัดสิน (นาที)", minRatio: "ถือว่าเดินเครื่องเมื่อมีการเคลื่อนไหว ≥ (%)", sens: "ความไว (1–10)",
    boxStatus: "กรอบตรวจ: {a}", liveRatio: "เคลื่อนไหว {r}% ใน {m} นาทีล่าสุด", zoneNeedBox: "กรุณาวาดกรอบตรวจ",
    ratioShort: "เคลื่อนไหว {r}% ใน {m} นาทีล่าสุด",
    pixThresh: "เกณฑ์การเปลี่ยนแปลงพิกเซล (ความสว่าง ค่าเริ่มต้น 22)", skipPct: "ข้ามรอบเมื่อทั้งจอเปลี่ยนเกิน % นี้ (ไฟ, โหมดกลางคืน)",
  }
};
const LANGS = ["ko", "en", "th"];
let LANG = (() => {
  try { const v = localStorage.getItem("kcw.lang"); if (LANGS.includes(v)) return v; } catch {}
  const n = (navigator.language || "").slice(0, 2);
  return LANGS.includes(n) ? n : "ko";
})();
export const getLang = () => LANG;
export function tl(lang, k, vars) {
  let s = DICT[lang]?.[k] ?? DICT.en[k] ?? k;
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.replaceAll(`{${a}}`, b);
  return s;
}
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
export const FILL = { run: "rgba(30,132,73,.5)", idle: "rgba(210,32,26,.5)", off: "rgba(139,148,158,.5)", nosig: "rgba(217,154,0,.35)" };
export function drawOverlay(ctx, W, H, zones, states, persons, opt = {}) {
  const lw = Math.max(2, Math.round(W / 420));
  const fs = Math.max(12, Math.round(W / 58));
  const rect = r => [r[0] * W, r[1] * H, r[2] * W, r[3] * H];
  ctx.save();
  ctx.font = `600 ${fs}px ${FONT}`;
  ctx.textBaseline = "top";

  for (const [zid, z] of Object.entries(zones || {})) {
    if (!z.eq) continue;
    const s = states?.[zid];
    const st = s?.state || "nosig";
    const [x, y, w, h] = rect(z.eq);
    // 판정 결과: 가동 = 초록 50%, 비가동 의심 = 빨강 50%
    ctx.fillStyle = FILL[st];
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = COLORS[st];
    ctx.lineWidth = st === "idle" ? lw * 2 : lw;
    ctx.strokeRect(x, y, w, h);
    if (opt.highlight === zid) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = lw;
      ctx.strokeRect(x - lw * 3, y - lw * 3, w + lw * 6, h + lw * 6);
    }
    // 지금 이 순간 움직임이 잡혔으면 박스 오른쪽 위에 흰 점
    if (s?.m) {
      const r = Math.max(4, lw * 2);
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(x + w - r * 2, y + r * 2, r, 0, Math.PI * 2); ctx.fill();
    }
    let label = z.eqId || "?";
    if (s?.r != null && (st === "run" || st === "idle")) label += `  ${s.r}%`;
    if (st === "idle" && s?.since) label += "  " + fmtDur((now() - s.since) / 1000);
    else if (st === "off" || st === "nosig") label += "  " + stateLabel(st);
    const p = Math.round(fs / 3), tw = ctx.measureText(label).width;
    let ly = y - fs - p * 2;
    if (ly < 0) ly = y;
    ctx.fillStyle = COLORS[st];
    ctx.fillRect(x, ly, tw + p * 2, fs + p * 2);
    ctx.fillStyle = st === "nosig" ? "#2A1F00" : "#fff";
    ctx.fillText(label, x + p, ly + p);
  }
  ctx.restore();
}
