/**
 * KOWOO Thai 설비 감시 → LINE 알림 중계 (Google Apps Script)
 *
 * 하는 일
 *  1) 분석 PC가 보낸 알림 문장을, 등록된 LINE 단체방/개인에게 보냄 (push)
 *  2) LINE 공식계정 웹훅을 받아서, 등록 코드를 입력한 단체방/개인을 수신 대상으로 등록
 *
 * 설정 (프로젝트 설정 > 스크립트 속성)
 *  LINE_TOKEN     : LINE Developers > Messaging API > Channel access token (long-lived)
 *  RELAY_KEY      : 아무 긴 문자열. 분석 화면 [LINE 알림 설정]의 "중계 비밀키"와 같게
 *  REGISTER_CODE  : 단체방/개인 등록용 문구 (예: KOWOO-ALERT-7391)
 *  (TARGETS 는 자동으로 만들어짐)
 *
 * 등록 방법
 *  - 단체방: 공식계정을 단체방에 초대 → 단체방에서 REGISTER_CODE 를 그대로 입력
 *  - 개인:   공식계정을 친구 추가 → 1:1 대화에서 REGISTER_CODE 입력
 *  - 해제:   같은 곳에서 STOP 입력
 *  등록·해제 답장은 reply 메시지라 월 발송 수에 포함되지 않음
 */

function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || "{}"); } catch (err) {}

  // LINE 웹훅
  if (body.events) {
    body.events.forEach(function (ev) { handleEvent_(ev, props); });
    return ContentService.createTextOutput("OK");
  }

  // 분석 PC → 알림 보내기
  if (!body.key || body.key !== props.getProperty("RELAY_KEY")) {
    return ContentService.createTextOutput("DENIED");
  }
  var text = String(body.text || "").slice(0, 4900);
  var targets = getTargets_(props);
  targets.forEach(function (to) { pushText_(to, text, props); });
  return ContentService.createTextOutput("SENT " + targets.length);
}

function handleEvent_(ev, props) {
  var src = ev.source || {};
  var id = src.groupId || src.roomId || src.userId;
  if (!id) return;
  if (ev.type === "leave" || ev.type === "unfollow") { removeTarget_(id, props); return; }
  if (ev.type !== "message" || !ev.message || ev.message.type !== "text") return;

  var text = String(ev.message.text || "").trim();
  var code = String(props.getProperty("REGISTER_CODE") || "").trim();
  if (code && text === code) {
    addTarget_(id, props);
    reply_(ev.replyToken, "✅ KOWOO THAI 설비 감시 알림이 등록되었습니다.\nลงทะเบียนรับการแจ้งเตือนแล้ว", props);
  } else if (text.toUpperCase() === "STOP") {
    removeTarget_(id, props);
    reply_(ev.replyToken, "알림이 해제되었습니다.\nยกเลิกการแจ้งเตือนแล้ว", props);
  }
}

function getTargets_(props) {
  try { return JSON.parse(props.getProperty("TARGETS") || "[]"); } catch (err) { return []; }
}
function addTarget_(id, props) {
  var lock = LockService.getScriptLock(); lock.waitLock(5000);
  try {
    var t = getTargets_(props);
    if (t.indexOf(id) < 0) t.push(id);
    props.setProperty("TARGETS", JSON.stringify(t));
  } finally { lock.releaseLock(); }
}
function removeTarget_(id, props) {
  var lock = LockService.getScriptLock(); lock.waitLock(5000);
  try {
    props.setProperty("TARGETS", JSON.stringify(getTargets_(props).filter(function (x) { return x !== id; })));
  } finally { lock.releaseLock(); }
}

function pushText_(to, text, props) {
  return UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + props.getProperty("LINE_TOKEN") },
    payload: JSON.stringify({ to: to, messages: [{ type: "text", text: text }] })
  });
}
function reply_(token, text, props) {
  if (!token) return;
  UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply", {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + props.getProperty("LINE_TOKEN") },
    payload: JSON.stringify({ replyToken: token, messages: [{ type: "text", text: text }] })
  });
}

/** 스크립트 편집기에서 직접 실행해 보는 시험 함수: 등록된 곳에 시험 메시지 1건 */
function testPush() {
  var props = PropertiesService.getScriptProperties();
  var targets = getTargets_(props);
  targets.forEach(function (to) { Logger.log(pushText_(to, "[KOWOO THAI] test", props).getContentText()); });
  Logger.log("targets: " + targets.length);
}
