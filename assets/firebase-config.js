// Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹) 의 설정값을 그대로 붙여 넣으세요.
// 이 값은 공개되어도 괜찮습니다. 데이터 보호는 로그인 + database.rules.json 규칙이 담당합니다.
export const firebaseConfig = {
  apiKey: "AIzaSyA1J7M-cxJOKrnURa7y48HMxzKF7rhtEyI",
  authDomain: "kowoo-status.firebaseapp.com",
  databaseURL: "https://kowoo-status-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "kowoo-status",
  storageBucket: "kowoo-status.firebasestorage.app",
  messagingSenderId: "346048949388",
  appId: "1:346048949388:web:24c3ca4b148e2128a09fa9"
};
export const SITE = {
  root: "cctv",                 // DB 안의 최상위 경로 (기존 kowoo-status 프로젝트와 같이 써도 겹치지 않음)
  timezone: "Asia/Bangkok",     // 공장 현지 시간
  homeTimezone: "Asia/Seoul",   // 본사 시간 (상단 시계)
  dayShiftStart: 8,             // 주간 시작 시각 (현지)
  nightShiftStart: 20,          // 야간 시작 시각 (현지)
  areas: ["F1", "F2", "F3", "WH", "ETC"]  // WH = 창고, ETC = 기타
};
