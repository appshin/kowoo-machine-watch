// 감시 구역 모양 편집기 (분석 화면·대시보드 공용)
// 구역은 0~1 좌표의 점 목록(poly). 사각형으로 그린 뒤 모서리를 끌어 조절하거나, 점을 찍어 자유 모양으로 그린다.
//  - 점 끌기: 모양 조절
//  - 선 위 더블클릭: 점 추가 / 점 더블클릭: 점 삭제 (3개 이상 남을 때)

export const rectToPoly = r => r ? [[r[0], r[1]], [r[0] + r[2], r[1]], [r[0] + r[2], r[1] + r[3]], [r[0], r[1] + r[3]]] : null;
export function polyBBox(p) {
  const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0];
}
export const zonePoly = z => (Array.isArray(z?.poly) && z.poly.length >= 3) ? z.poly : rectToPoly(z?.eq);
const r4 = v => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;

export function createShapeEditor(canvas, onChange) {
  const E = { poly: null, mode: "rect", drag: null, temp: [], cursor: null };
  const pt = e => {
    const b = canvas.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))];
  };
  // 화면상 거리(px)로 가까운 점·선 찾기
  const px = (a, b) => {
    const r = canvas.getBoundingClientRect();
    return Math.hypot((a[0] - b[0]) * r.width, (a[1] - b[1]) * r.height);
  };
  const nearVertex = p => E.poly ? E.poly.findIndex(q => px(p, q) < 12) : -1;
  function nearEdge(p) {
    if (!E.poly) return -1;
    const r = canvas.getBoundingClientRect();
    for (let i = 0; i < E.poly.length; i++) {
      const a = E.poly[i], b = E.poly[(i + 1) % E.poly.length];
      const ax = a[0] * r.width, ay = a[1] * r.height, bx = b[0] * r.width, by = b[1] * r.height, x = p[0] * r.width, y = p[1] * r.height;
      const L = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L));
      if (Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))) < 10) return i;
    }
    return -1;
  }
  const changed = () => onChange?.(E.poly);

  canvas.addEventListener("pointerdown", e => {
    const p = pt(e), vi = nearVertex(p);
    canvas.setPointerCapture(e.pointerId);
    if (vi >= 0 && !E.temp.length) { E.drag = { vertex: vi }; return; }
    if (E.mode === "rect") { E.drag = { a: p, cur: null }; return; }
    // 점 찍기: 첫 점 근처를 다시 누르면 닫힘
    if (E.temp.length >= 3 && px(p, E.temp[0]) < 12) { E.poly = E.temp.map(q => q.map(r4)); E.temp = []; changed(); return; }
    E.temp.push(p);
    changed();
  });
  canvas.addEventListener("pointermove", e => {
    const p = pt(e);
    E.cursor = p;
    if (E.drag?.vertex != null) { E.poly[E.drag.vertex] = p.map(r4); changed(); }
    else if (E.drag?.a) {
      const a = E.drag.a;
      E.drag.cur = [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.abs(a[0] - p[0]), Math.abs(a[1] - p[1])];
      changed();
    } else if (E.temp.length) changed();
    canvas.style.cursor = nearVertex(p) >= 0 ? "move" : "crosshair";
  });
  canvas.addEventListener("pointerup", () => {
    const r = E.drag?.cur;
    if (r && r[2] > 0.005 && r[3] > 0.005) { E.poly = rectToPoly(r).map(q => q.map(r4)); }
    E.drag = null;
    changed();
  });
  canvas.addEventListener("dblclick", e => {
    const p = pt(e);
    if (E.temp.length >= 3) { E.poly = E.temp.map(q => q.map(r4)); E.temp = []; changed(); return; }
    const vi = nearVertex(p);
    if (vi >= 0 && E.poly.length > 3) { E.poly.splice(vi, 1); changed(); return; }
    const ei = nearEdge(p);
    if (ei >= 0) { E.poly.splice(ei + 1, 0, p.map(r4)); changed(); }
  });

  return {
    get poly() { return E.poly; },
    set(poly) { E.poly = poly ? poly.map(q => [...q]) : null; E.temp = []; E.drag = null; },
    setMode(m) { E.mode = m; E.temp = []; changed(); },
    get mode() { return E.mode; },
    // 편집 중인 모양 그리기
    draw(c, W, H, color, label) {
      const lw = Math.max(2, Math.round(W / 420)), hs = Math.max(5, Math.round(W / 200));
      const path = p => { c.beginPath(); p.forEach((q, i) => i ? c.lineTo(q[0] * W, q[1] * H) : c.moveTo(q[0] * W, q[1] * H)); };
      if (E.drag?.cur) { const r = E.drag.cur; c.strokeStyle = color; c.lineWidth = lw; c.strokeRect(r[0] * W, r[1] * H, r[2] * W, r[3] * H); }
      if (E.poly) {
        path(E.poly); c.closePath();
        c.fillStyle = "rgba(31,165,196,.22)"; c.fill();
        c.strokeStyle = color; c.lineWidth = lw; c.stroke();
        c.fillStyle = "#fff";
        for (const q of E.poly) { c.fillRect(q[0] * W - hs, q[1] * H - hs, hs * 2, hs * 2); c.strokeRect(q[0] * W - hs, q[1] * H - hs, hs * 2, hs * 2); }
        if (label) {
          const b = polyBBox(E.poly);
          c.font = `600 ${Math.max(12, Math.round(W / 60))}px system-ui`;
          c.fillStyle = color; c.fillText(label, b[0] * W + 4, b[1] * H - 6);
        }
      }
      if (E.temp.length) {
        const p = E.cursor ? [...E.temp, E.cursor] : E.temp;
        path(p); c.strokeStyle = "#FFD23F"; c.lineWidth = lw; c.setLineDash([lw * 3, lw * 2]); c.stroke(); c.setLineDash([]);
        c.fillStyle = "#FFD23F";
        E.temp.forEach((q, i) => { c.beginPath(); c.arc(q[0] * W, q[1] * H, i ? hs : hs * 1.6, 0, Math.PI * 2); c.fill(); });
      }
    }
  };
}

// 구역 모양을 화면에 그리는 공용 함수 (편집 중이 아닌 다른 구역)
export function strokePoly(c, W, H, poly, color, label) {
  if (!poly) return;
  c.beginPath(); poly.forEach((q, i) => i ? c.lineTo(q[0] * W, q[1] * H) : c.moveTo(q[0] * W, q[1] * H)); c.closePath();
  c.strokeStyle = color; c.lineWidth = Math.max(2, Math.round(W / 420)); c.stroke();
  if (label) {
    const b = polyBBox(poly);
    c.font = `600 ${Math.max(12, Math.round(W / 60))}px system-ui`;
    c.fillStyle = color; c.fillText(label, b[0] * W + 4, b[1] * H - 6);
  }
}
