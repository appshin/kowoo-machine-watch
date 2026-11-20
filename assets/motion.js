// 움직임 판정 로직 (화면 비교 + 최근 N분 빈도 + 가동/비가동 판정)
// 브라우저와 테스트에서 같이 쓰도록 DOM에 의존하지 않음.

// 민감도 1~10 → 박스 안 화소 중 몇 %가 바뀌면 "움직임 있음"으로 볼지
export const SENS_PCT = [8, 6, 4.5, 3.5, 2.5, 2, 1.5, 1, 0.7, 0.5];
export const sensPct = s => SENS_PCT[Math.min(10, Math.max(1, Math.round(+s || 5))) - 1];

// RGBA 화소 → 밝기(0~255) 배열
export function toGray(rgba) {
  const n = rgba.length >> 2, g = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return g;
}

// 두 화면 사이에 밝기가 th 이상 바뀐 화소의 비율 (0~1). 비교 불가면 null
export function diffFraction(a, b, th = 22) {
  if (!a || !b || a.length !== b.length || !a.length) return null;
  let c = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > th) c++;
  return c / a.length;
}

// 박스 하나의 판정 상태
export function newZoneState(t) {
  return { state: "run", since: t, hist: [], ratio: null, prev: null, motion: false };
}

// 최근 판단 시간(windowMin분) 동안 움직임 비율로 가동/비가동 판정
//  - 기준 미만이면 비가동, 비가동에서 돌아올 때는 기준+5%p 이상이어야 가동 (깜빡임 방지)
//  - 판단 시간의 절반(최대 1분)이 쌓이기 전에는 판정을 바꾸지 않음
export function judge(zs, t, motion, z) {
  const win = Math.max(1, +z.windowMin || 5) * 60000;
  zs.motion = !!motion;
  zs.hist.push([t, motion ? 1 : 0]);
  while (zs.hist.length && zs.hist[0][0] < t - win) zs.hist.shift();
  let s = 0;
  for (const h of zs.hist) s += h[1];
  zs.ratio = s / zs.hist.length;

  const thr = (z.minRatio ?? 30) / 100;
  const covered = t - zs.hist[0][0];
  const base = zs.state === "idle" ? "idle" : "run";
  if (covered < Math.min(win * 0.5, 60000)) return base;
  if (base === "idle") return zs.ratio >= thr + 0.05 ? "run" : "idle";
  return zs.ratio < thr ? "idle" : "run";
}

// 다각형 안쪽만 계산하기 위한 마스크 (sample 격자 w×h, bbox 기준)
export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function polyMask(poly, bbox, w, h) {
  const m = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    m[j * w + i] = pointInPoly(bbox[0] + (i + 0.5) / w * bbox[2], bbox[1] + (j + 0.5) / h * bbox[3], poly) ? 1 : 0;
  }
  return m;
}
// 마스크 안쪽 화소만 비교
export function diffFractionMasked(a, b, th, mask) {
  if (!mask) return diffFraction(a, b, th);
  if (!a || !b || a.length !== b.length || a.length !== mask.length) return null;
  let c = 0, n = 0;
  for (let i = 0; i < a.length; i++) if (mask[i]) { n++; if (Math.abs(a[i] - b[i]) > th) c++; }
  return n ? c / n : null;
}
