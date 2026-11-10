/**
 * 도형과 연결선의 기하 계산(순수 함수). [담당: geometry 에이전트]
 * 아래 export의 이름과 시그니처는 다른 모듈이 쓰는 계약이므로 바꾸지 않는다. 내부 구현과 추가 export는 자유.
 */
import { STYLE } from './types';
import type { ErdEdge, ErdNode, Point, Rect } from './types';

const EPS = 1e-9;
/** 같은 두 노드 사이의 선들을 벌리는 간격(제어점 기준) */
export const SIBLING_SPREAD = 40;
/** 선에서 카디널리티 글자까지의 거리 */
export const LABEL_OFFSET = 12;
/** 휜 선에서 역할 이름을 카디널리티 글자 바깥에 쌓을 때의 추가 거리 */
export const ROLE_STACK_OFFSET = 16;
/** 곡선을 꺾은선으로 근사할 때의 구간 수 */
const CURVE_SAMPLES = 24;

export function nodeRect(n: ErdNode): Rect {
  return { x: n.x, y: n.y, w: n.w, h: n.h };
}
export function nodeCenter(n: ErdNode): Point {
  return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
}
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
/** 여러 사각형을 모두 감싸는 사각형. 비어 있으면 null */
export function unionBounds(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
/** 다이어그램 전체 범위(여백 포함). 노드가 없으면 null */
export function diagramBounds(nodes: ErdNode[], padding = 0): Rect | null {
  const b = unionBounds(nodes.map(nodeRect));
  if (!b) return null;
  return { x: b.x - padding, y: b.y - padding, w: b.w + padding * 2, h: b.h + padding * 2 };
}

// ───────────────────────── 벡터 보조 ─────────────────────────

function unit(dx: number, dy: number): Point | null {
  const len = Math.hypot(dx, dy);
  if (!(len > EPS)) return null;
  return { x: dx / len, y: dy / len };
}
/** 진행 방향을 90도 돌린 방향 */
function perp(v: Point): Point {
  return { x: -v.y, y: v.x };
}
function add(p: Point, v: Point, k: number): Point {
  return { x: p.x + v.x * k, y: p.y + v.y * k };
}
/** 선의 수직 방향 둘 중 항상 같은 쪽(위쪽, 세로선이면 왼쪽)을 고른다 */
function upLeftNormal(tangent: Point): Point {
  const n = { x: tangent.y, y: -tangent.x };
  if (n.y < -1e-6) return n;
  if (n.y > 1e-6) return { x: -n.x, y: -n.y };
  return n.x <= 0 ? n : { x: -n.x, y: -n.y };
}
/** 좌표를 소수 둘째 자리까지만 적는다(SVG 내보내기 크기를 줄인다) */
function fmt(v: number): string {
  const r = Math.round(v * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
}
function linePath(a: Point, b: Point): string {
  return `M ${fmt(a.x)} ${fmt(a.y)} L ${fmt(b.x)} ${fmt(b.y)}`;
}
function quadPath(a: Point, c: Point, b: Point): string {
  return `M ${fmt(a.x)} ${fmt(a.y)} Q ${fmt(c.x)} ${fmt(c.y)} ${fmt(b.x)} ${fmt(b.y)}`;
}
/** 점 o에서 d 방향으로 뻗은 직선과 점 p에서 e 방향으로 뻗은 직선의 교점. 거의 평행하면 null */
function lineIntersection(o: Point, d: Point, p: Point, e: Point): Point | null {
  const cross = d.x * e.y - d.y * e.x;
  if (Math.abs(cross) < 1e-6) return null;
  const t = ((p.x - o.x) * e.y - (p.y - o.y) * e.x) / cross;
  return { x: o.x + d.x * t, y: o.y + d.y * t };
}

// ───────────────────────── 도형 외곽선 ─────────────────────────

/**
 * 도형 안의 점(중심 기준 좌표 ox, oy)에서 (dx, dy) 방향으로 나갈 때 외곽선에 닿는 t.
 * 점이 도형 밖이거나 도형 크기가 0이면 null.
 */
function exitParam(node: ErdNode, ox: number, oy: number, dx: number, dy: number): number | null {
  const hw = node.w / 2;
  const hh = node.h / 2;
  if (!(hw > 0) || !(hh > 0)) return null;
  if (!(Math.hypot(dx, dy) > EPS)) return null;
  const tol = 1e-6;

  if (node.kind === 'relationship') {
    // 마름모: |x|/hw + |y|/hh <= 1 인 네 반평면의 교집합
    if (Math.abs(ox) / hw + Math.abs(oy) / hh > 1 + tol) return null;
    let t = Infinity;
    for (const sx of [1, -1]) {
      for (const sy of [1, -1]) {
        const denom = (sx * dx) / hw + (sy * dy) / hh;
        if (denom > 1e-12) t = Math.min(t, (1 - ((sx * ox) / hw + (sy * oy) / hh)) / denom);
      }
    }
    return Number.isFinite(t) ? Math.max(0, t) : null;
  }

  if (node.kind === 'attribute' || node.kind === 'spec') {
    // 타원(spec은 원): 정규화 좌표에서 단위원과의 교점 중 진행 방향 쪽
    const rx = node.kind === 'spec' ? Math.min(hw, hh) : hw;
    const ry = node.kind === 'spec' ? Math.min(hw, hh) : hh;
    const px = ox / rx, py = oy / ry;
    const qx = dx / rx, qy = dy / ry;
    const a = qx * qx + qy * qy;
    const b = 2 * (px * qx + py * qy);
    const c = px * px + py * py - 1;
    if (c > tol || !(a > 0)) return null;
    const disc = Math.max(0, b * b - 4 * a * c);
    return Math.max(0, (-b + Math.sqrt(disc)) / (2 * a));
  }

  // 직사각형(entity, note)
  if (Math.abs(ox) > hw + tol || Math.abs(oy) > hh + tol) return null;
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (hw - ox) / dx);
  else if (dx < 0) t = Math.min(t, (-hw - ox) / dx);
  if (dy > 0) t = Math.min(t, (hh - oy) / dy);
  else if (dy < 0) t = Math.min(t, (-hh - oy) / dy);
  return Number.isFinite(t) ? Math.max(0, t) : null;
}

/**
 * 노드 중심에서 toward 쪽으로 나간 반직선이 도형 외곽선과 만나는 점.
 * 도형 모양(직사각형, 마름모, 타원, 원)에 맞춰 계산한다.
 */
export function boundaryPoint(node: ErdNode, toward: Point): Point {
  const c = nodeCenter(node);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const t = exitParam(node, 0, 0, dx, dy);
  if (t === null) return c;
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/**
 * 중심에서 normal 방향으로 shift만큼 옮긴 점을 지나고 dir 방향으로 나가는 선이 외곽선과 만나는 점.
 * 이중선의 각 줄이 도형 외곽선에 정확히 닿게 하려고 쓴다. 옮긴 점이 도형 밖이면 null.
 */
function offsetExit(node: ErdNode, normal: Point, shift: number, dir: Point): Point | null {
  const ox = normal.x * shift;
  const oy = normal.y * shift;
  const t = exitParam(node, ox, oy, dir.x, dir.y);
  if (t === null) return null;
  const c = nodeCenter(node);
  return { x: c.x + ox + dir.x * t, y: c.y + oy + dir.y * t };
}

/** 점 p가 도형 안에 있는지(도형 모양 기준) */
export function pointInNode(node: ErdNode, p: Point): boolean {
  const hw = node.w / 2;
  const hh = node.h / 2;
  if (!(hw > 0) || !(hh > 0)) return false;
  const dx = p.x - (node.x + hw);
  const dy = p.y - (node.y + hh);
  switch (node.kind) {
    case 'relationship':
      return Math.abs(dx) / hw + Math.abs(dy) / hh <= 1;
    case 'attribute':
      return (dx * dx) / (hw * hw) + (dy * dy) / (hh * hh) <= 1;
    case 'spec': {
      const r = Math.min(hw, hh);
      return dx * dx + dy * dy <= r * r;
    }
    default:
      return Math.abs(dx) <= hw && Math.abs(dy) <= hh;
  }
}

// ───────────────────────── 연결선 ─────────────────────────

export interface EdgeGeometry {
  /** 선이 source 도형 외곽에서 시작하는 점 */
  start: Point;
  /** 선이 target 도형 외곽에서 끝나는 점 */
  end: Point;
  /** 같은 두 노드 사이에 선이 여러 개일 때 휘어 그리기 위한 2차 베지어 제어점. 직선이면 null */
  control: Point | null;
  /** 실제로 그릴 선의 SVG path d. 단선이면 1개, 이중선이면 2개(STYLE.doubleGap만큼 떨어진 평행선) */
  paths: string[];
  /** 클릭 판정용 중심선 path d */
  hitPath: string;
  /** 선의 가운데 점 */
  mid: Point;
  /** 카디널리티 글자를 놓을 위치(선에서 수직으로 조금 떨어진 곳) */
  labelPos: Point;
  /** 역할 이름을 놓을 위치(카디널리티 글자의 반대편) */
  rolePos: Point;
}

/**
 * 엣지 하나를 그리는 데 필요한 좌표를 계산한다.
 * siblingIndex/siblingCount: 같은 두 노드를 잇는 엣지가 여러 개일 때(재귀 관계) 몇 번째인지. 기본은 0/1.
 */
export function computeEdgeGeometry(
  edge: ErdEdge,
  source: ErdNode,
  target: ErdNode,
  siblingIndex = 0,
  siblingCount = 1,
): EdgeGeometry {
  const a = nodeCenter(source);
  const b = nodeCenter(target);
  const along = unit(b.x - a.x, b.y - a.y);
  // 두 중심이 겹치면 방향을 정할 수 없으므로 가로 방향으로 본다
  const u = along ?? { x: 1, y: 0 };
  const half = STYLE.doubleGap / 2;
  const labelDist = LABEL_OFFSET + (edge.double ? half : 0);
  const count = siblingCount > 1 ? siblingCount : 1;
  const bend = count > 1 ? (siblingIndex - (count - 1) / 2) * SIBLING_SPREAD : 0;

  if (!(Math.abs(bend) > EPS)) {
    // 직선
    const start = boundaryPoint(source, b);
    const end = boundaryPoint(target, a);
    const n = perp(u);
    const hitPath = linePath(start, end);
    let paths = [hitPath];
    if (edge.double) {
      paths = [1, -1].map((side) => {
        const shift = side * half;
        // 중심이 겹친 퇴화 사례에서는 외곽선까지 늘이지 않는다
        const p0 = (along && offsetExit(source, n, shift, u)) || add(start, n, shift);
        const p1 = (along && offsetExit(target, n, shift, { x: -u.x, y: -u.y })) || add(end, n, shift);
        return linePath(p0, p1);
      });
    }
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const side = upLeftNormal(u);
    return {
      start,
      end,
      control: null,
      paths,
      hitPath,
      mid,
      labelPos: add(mid, side, labelDist),
      rolePos: add(mid, side, -labelDist),
    };
  }

  // 곡선: source/target이 뒤집혀 저장된 형제도 같은 기준으로 벌어지도록 id 순서로 수직 방향을 정한다
  const canon = source.id > target.id ? { x: -u.x, y: -u.y } : u;
  const spread = perp(canon);
  const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const control = add(center, spread, bend);
  const start = boundaryPoint(source, control);
  const end = boundaryPoint(target, control);
  const hitPath = quadPath(start, control, end);
  let paths = [hitPath];
  if (edge.double) {
    const d0 = unit(control.x - a.x, control.y - a.y) ?? u;
    const d2 = unit(b.x - control.x, b.y - control.y) ?? u;
    const n0 = perp(d0);
    const n2 = perp(d2);
    const back = { x: -d2.x, y: -d2.y };
    paths = [1, -1].map((side) => {
      const shift = side * half;
      const p0 = offsetExit(source, n0, shift, d0) ?? add(start, n0, shift);
      const p2 = offsetExit(target, n2, shift, back) ?? add(end, n2, shift);
      // 양 끝 접선을 평행 이동한 두 직선의 교점을 제어점으로 쓰면 간격이 거의 일정하게 유지된다
      const avg = unit(n0.x + n2.x, n0.y + n2.y) ?? n0;
      const c = lineIntersection(p0, d0, p2, d2) ?? add(control, avg, shift);
      return quadPath(p0, c, p2);
    });
  }
  const mid = {
    x: (start.x + 2 * control.x + end.x) / 4,
    y: (start.y + 2 * control.y + end.y) / 4,
  };
  // 휜 선은 형제 선과 마주 보는 안쪽이 좁아서 글자를 모두 바깥쪽(휘어 나간 쪽)에 둔다
  const outward = bend > 0 ? spread : { x: -spread.x, y: -spread.y };
  return {
    start,
    end,
    control,
    paths,
    hitPath,
    mid,
    labelPos: add(mid, outward, labelDist),
    rolePos: add(mid, outward, labelDist + ROLE_STACK_OFFSET),
  };
}

/** 같은 두 노드를 잇는 엣지끼리 묶어 각 엣지의 순번을 알려 준다. key는 edge.id */
export function siblingInfo(edges: ErdEdge[]): Map<string, { index: number; count: number }> {
  const groups = new Map<string, string[]>();
  for (const e of edges) {
    const key = e.source < e.target ? `${e.source}\u0000${e.target}` : `${e.target}\u0000${e.source}`;
    const group = groups.get(key);
    if (group) group.push(e.id);
    else groups.set(key, [e.id]);
  }
  const result = new Map<string, { index: number; count: number }>();
  for (const ids of groups.values()) {
    // 접속자마다 같은 결과가 나오도록 로캘과 무관한 단순 비교로 정렬한다
    ids.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    ids.forEach((id, index) => result.set(id, { index, count: ids.length }));
  }
  return result;
}

/** 중심선 위의 점. t는 0(start)부터 1(end)까지 */
export function edgePointAt(geom: EdgeGeometry, t: number): Point {
  const { start: s, end: e, control: c } = geom;
  if (!c) return { x: s.x + (e.x - s.x) * t, y: s.y + (e.y - s.y) * t };
  const k = 1 - t;
  return {
    x: k * k * s.x + 2 * k * t * c.x + t * t * e.x,
    y: k * k * s.y + 2 * k * t * c.y + t * t * e.y,
  };
}

/** 중심선을 꺾은선으로 바꾼 점 목록. 직선이면 양 끝 2개 */
export function edgePolyline(geom: EdgeGeometry, samples = CURVE_SAMPLES): Point[] {
  if (!geom.control) return [geom.start, geom.end];
  const n = Math.max(1, Math.floor(samples));
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) pts.push(edgePointAt(geom, i / n));
  return pts;
}

/** 점 p에서 선분 ab까지의 최단 거리 */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!(len2 > EPS)) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** 점 p에서 엣지 선까지의 최단 거리(월드 단위) */
export function distanceToEdge(geom: EdgeGeometry, p: Point): number {
  const pts = edgePolyline(geom);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    best = Math.min(best, distanceToSegment(p, pts[i - 1], pts[i]));
  }
  return best;
}

/** 선분 ab가 사각형과 닿거나 겹치는지(Liang-Barsky 클리핑) */
export function segmentIntersectsRect(a: Point, b: Point, rect: Rect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, a.x - rect.x) &&
    clip(dx, rect.x + rect.w - a.x) &&
    clip(-dy, a.y - rect.y) &&
    clip(dy, rect.y + rect.h - a.y)
  );
}

/** 엣지 중심선의 일부라도 사각형 안에 들어오는지(상자 선택용) */
export function edgeInRect(geom: EdgeGeometry, rect: Rect): boolean {
  const pts = edgePolyline(geom);
  for (let i = 1; i < pts.length; i++) {
    if (segmentIntersectsRect(pts[i - 1], pts[i], rect)) return true;
  }
  return false;
}
