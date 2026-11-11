/**
 * 도형과 연결선의 기하 계산(순수 함수). [담당: geometry 에이전트]
 * 아래 export의 이름과 시그니처는 다른 모듈이 쓰는 계약이므로 바꾸지 않는다. 내부 구현과 추가 export는 자유.
 */
import { SIDES, STYLE } from './types';
import type { EdgeShapeKind, ErdEdge, ErdNode, Point, Rect, Side } from './types';

const EPS = 1e-9;
/** 같은 두 노드 사이의 선들을 벌리는 간격(제어점 기준) */
export const SIBLING_SPREAD = 40;
/** 선에서 카디널리티 글자까지의 거리 */
export const LABEL_OFFSET = 12;
/** 휜 선에서 역할 이름을 카디널리티 글자 바깥에 쌓을 때의 추가 거리 */
export const ROLE_STACK_OFFSET = 16;
/** 곡선을 꺾은선으로 근사할 때의 구간 수 */
const CURVE_SAMPLES = 24;
/** 꺾은선이 도형에서 바깥으로 곧게 나가는 길이 */
export const ELBOW_STUB = 20;

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
function neg(v: Point): Point {
  return { x: -v.x, y: -v.y };
}
function add(p: Point, v: Point, k: number): Point {
  return { x: p.x + v.x * k, y: p.y + v.y * k };
}
/** 선의 수직 방향 둘 중 항상 같은 쪽(가로나 비스듬한 선은 위쪽, 세로선은 오른쪽)을 고른다 */
function labelNormal(tangent: Point): Point {
  const n = { x: tangent.y, y: -tangent.x };
  if (n.y < -1e-6) return n;
  if (n.y > 1e-6) return neg(n);
  return n.x >= 0 ? n : neg(n);
}
/** 좌표를 소수 둘째 자리까지만 적는다(SVG 내보내기 크기를 줄인다) */
function fmt(v: number): string {
  const r = Math.round(v * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
}
function polyPath(pts: Point[]): string {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${fmt(p.x)} ${fmt(p.y)}`).join(' ');
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
 * 직선 o + t·d 가 도형 안에 있는 t 구간 [들어가는 t, 나오는 t]. (ox, oy)는 중심 기준 좌표.
 * 도형과 만나지 않거나 도형 크기가 0이면 null.
 */
function lineSpan(node: ErdNode, ox: number, oy: number, dx: number, dy: number): [number, number] | null {
  const hw = node.w / 2;
  const hh = node.h / 2;
  if (!(hw > 0) || !(hh > 0)) return null;
  if (!(Math.hypot(dx, dy) > EPS)) return null;

  if (node.kind === 'attribute' || node.kind === 'spec') {
    // 타원(spec은 원): 정규화 좌표에서 단위원과의 교점
    const rx = node.kind === 'spec' ? Math.min(hw, hh) : hw;
    const ry = node.kind === 'spec' ? Math.min(hw, hh) : hh;
    const px = ox / rx, py = oy / ry;
    const qx = dx / rx, qy = dy / ry;
    const a = qx * qx + qy * qy;
    const b = 2 * (px * qx + py * qy);
    const c = px * px + py * py - 1;
    const disc = b * b - 4 * a * c;
    if (!(a > 0) || disc < 0) return null;
    const root = Math.sqrt(disc);
    return [(-b - root) / (2 * a), (-b + root) / (2 * a)];
  }

  let t0 = -Infinity;
  let t1 = Infinity;
  // 반평면 den·t <= num 으로 구간을 좁힌다
  const clip = (den: number, num: number): boolean => {
    if (den > 1e-12) t1 = Math.min(t1, num / den);
    else if (den < -1e-12) t0 = Math.max(t0, num / den);
    else if (num < 0) return false;
    return true;
  };
  if (node.kind === 'relationship') {
    // 마름모: |x|/hw + |y|/hh <= 1 인 네 반평면의 교집합
    for (const sx of [1, -1]) {
      for (const sy of [1, -1]) {
        if (!clip((sx * dx) / hw + (sy * dy) / hh, 1 - ((sx * ox) / hw + (sy * oy) / hh))) return null;
      }
    }
  } else {
    // 직사각형(entity, note)
    if (!clip(dx, hw - ox) || !clip(-dx, hw + ox) || !clip(dy, hh - oy) || !clip(-dy, hh + oy)) return null;
  }
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t0 > t1) return null;
  return [t0, t1];
}

/**
 * 노드 중심에서 toward 쪽으로 나간 반직선이 도형 외곽선과 만나는 점.
 * 도형 모양(직사각형, 마름모, 타원, 원)에 맞춰 계산한다.
 */
export function boundaryPoint(node: ErdNode, toward: Point): Point {
  const c = nodeCenter(node);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const span = lineSpan(node, 0, 0, dx, dy);
  if (!span || !(span[1] >= 0)) return c;
  return { x: c.x + dx * span[1], y: c.y + dy * span[1] };
}

/**
 * 이중선의 한 줄 끝을 도형 외곽선에 맞춘다.
 * end는 중심선의 끝점, shifted는 그 점을 평행 이동한 점, inward는 도형 안쪽으로 들어가는 진행 방향.
 * 중심선이 외곽선에서 끝나지 않는 경우(도형이 겹친 퇴화 사례)에는 건드리지 않는다.
 */
function snapToOutline(node: ErdNode, end: Point, shifted: Point, inward: Point): Point {
  const c = nodeCenter(node);
  const base = lineSpan(node, end.x - c.x, end.y - c.y, inward.x, inward.y);
  if (!base || Math.abs(base[0]) > 0.5) return shifted;
  const span = lineSpan(node, shifted.x - c.x, shifted.y - c.y, inward.x, inward.y);
  if (!span || Math.abs(span[0]) > Math.max(node.w, node.h)) return shifted;
  return add(shifted, inward, span[0]);
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
  /** 같은 두 노드 사이에 선이 여러 개일 때 휘어 그리기 위한 2차 베지어 제어점. 직선과 꺾은선이면 null */
  control: Point | null;
  /** 선이 지나는 꼭짓점 목록(start부터 end까지). 직선과 곡선은 [start, end] */
  points: Point[];
  /** 실제로 쓰인 source 쪽 면. 면 없이 중심 방향으로 붙는 직선과 곡선은 null */
  sourceSide: Side | null;
  /** 실제로 쓰인 target 쪽 면. 면 없이 중심 방향으로 붙는 직선과 곡선은 null */
  targetSide: Side | null;
  /** 실제로 그릴 선의 SVG path d. 단선이면 1개, 이중선이면 2개(STYLE.doubleGap만큼 떨어진 평행선) */
  paths: string[];
  /** 클릭 판정용 중심선 path d */
  hitPath: string;
  /** 선의 가운데 점(경로 길이의 중간) */
  mid: Point;
  /** 카디널리티 글자를 놓을 위치(선에서 수직으로 조금 떨어진 곳) */
  labelPos: Point;
  /** 역할 이름을 놓을 위치(카디널리티 글자의 반대편) */
  rolePos: Point;
}

/** 엔티티와 관계를 잇는 선인지 */
function joinsEntityAndRelationship(source: ErdNode | undefined, target: ErdNode | undefined): boolean {
  return (
    (source?.kind === 'entity' && target?.kind === 'relationship') ||
    (source?.kind === 'relationship' && target?.kind === 'entity')
  );
}

/**
 * 엣지가 실제로 그려지는 모양. 직접 고른 모양이 있으면 그 모양이고, 없으면 직선이다.
 * 단, 재귀 관계(같은 엔티티와 관계 사이에 선이 둘 이상, pairCount > 1)의 선은 고르지 않았을 때 꺾은선이다.
 */
export function edgeShapeOf(
  edge: Pick<ErdEdge, 'shape'>,
  source?: ErdNode,
  target?: ErdNode,
  pairCount = 1,
): EdgeShapeKind {
  if (edge.shape === 'straight' || edge.shape === 'elbow') return edge.shape;
  return pairCount > 1 && joinsEntityAndRelationship(source, target) ? 'elbow' : 'straight';
}

// ── 꺾은선 경로 찾기 ──

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
/** 꺾임 하나의 비용(길이 단위) */
const BEND_COST = 40;
/** 도형을 가로지르는 선분 하나의 벌점 */
const CROSS_PENALTY = 5000;
/** 되돌아가거나 면의 바깥 방향과 다르게 드나드는 경로의 벌점 */
const WRONG_WAY_PENALTY = 10000;
/** 꺾인 경로에서 도형에 붙는 첫/끝 선분이 이보다 짧으면 벌점 */
const MIN_END_SEGMENT = 8;
const SHORT_END_PENALTY = 200;
/** 곧은 연결이 직사각형 모서리에서 이만큼 안쪽에 닿아야 한다 */
const CORNER_MARGIN = 6;

interface Route {
  points: Point[];
  sideA: Side;
  sideB: Side;
}

function isBoxLike(node: ErdNode): boolean {
  return node.kind === 'entity' || node.kind === 'note';
}

/**
 * 점 p에서 d 방향(가로 또는 세로)으로 쏜 반직선이 other에 닿는 점.
 * 직사각형은 변의 어느 지점이든 받아 주고(모서리 근처 제외), 그 외 도형은 마주 보는 고정점과 일직선일 때만 받는다.
 */
function directHit(other: ErdNode, p: Point, d: Point, facing: Side): Point | null {
  if (isBoxLike(other)) {
    const c = nodeCenter(other);
    const span = lineSpan(other, p.x - c.x, p.y - c.y, d.x, d.y);
    if (!span || !(span[0] > 1)) return null;
    const q = add(p, d, span[0]);
    const off = d.x !== 0 ? Math.abs(q.y - c.y) : Math.abs(q.x - c.x);
    const halfFace = d.x !== 0 ? other.h / 2 : other.w / 2;
    if (off > halfFace - Math.min(CORNER_MARGIN, halfFace / 2)) return null;
    return q;
  }
  const q = anchorPoint(other, facing);
  const dist = (q.x - p.x) * d.x + (q.y - p.y) * d.y;
  const off = Math.abs((q.x - p.x) * d.y - (q.y - p.y) * d.x);
  return dist > 1 && off <= 0.5 ? q : null;
}

/** 꺾임 없이 곧게 이을 수 있으면 그 경로를 준다. 면이 지정된 끝은 그 면에서만 붙는다 */
function directRoute(
  a: ErdNode,
  b: ErdNode,
  sa: Side | undefined,
  sb: Side | undefined,
  banA: Side[],
  banB: Side[],
): Route | null {
  // 고정점을 내주는 쪽: 직사각형이 아닌 도형을 먼저 본다. 직사각형(엔티티)은 면이 지정돼 있어도
  // 그 변 위에서 미끄러져, 마름모 꼭짓점과 수직/수평으로 곧게 만난다(변의 가운데에 묶이지 않는다).
  const pivots: Array<'a' | 'b'> = isBoxLike(a) && !isBoxLike(b) ? ['b', 'a'] : ['a', 'b'];

  for (const pivot of pivots) {
    const from = pivot === 'a' ? a : b;
    const to = pivot === 'a' ? b : a;
    const fixed = pivot === 'a' ? sa : sb;
    const fixedTo = pivot === 'a' ? sb : sa;
    const banFrom = pivot === 'a' ? banA : banB;
    const banTo = pivot === 'a' ? banB : banA;
    let best: { side: Side; p: Point; q: Point; dist: number } | null = null;
    for (const side of fixed ? [fixed] : SIDES) {
      if (!fixed && banFrom.includes(side)) continue;
      // 상대 끝의 면이 지정돼 있으면 그 면에 닿는 경우만 곧은 연결로 인정한다
      if (fixedTo ? fixedTo !== OPPOSITE[side] : banTo.includes(OPPOSITE[side])) continue;
      const p = anchorPoint(from, side);
      const q = directHit(to, p, sideDirection(side), OPPOSITE[side]);
      if (!q) continue;
      const dist = Math.hypot(q.x - p.x, q.y - p.y);
      if (!best || dist < best.dist - 1e-6) best = { side, p, q, dist };
    }
    if (best) {
      return pivot === 'a'
        ? { points: [best.p, best.q], sideA: best.side, sideB: OPPOSITE[best.side] }
        : { points: [best.q, best.p], sideA: OPPOSITE[best.side], sideB: best.side };
    }
  }
  return null;
}

/** 중복 점과, 같은 방향으로 이어지는 선분 사이의 점을 없앤다. 되돌아가는 점은 남겨서 벌점을 받게 한다 */
function simplifyPath(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
    if (out.length >= 2) {
      const prev = out[out.length - 2];
      const ax = last.x - prev.x, ay = last.y - prev.y;
      const bx = p.x - last.x, by = p.y - last.y;
      if (Math.abs(ax * by - ay * bx) < 1e-6 && ax * bx + ay * by > 0) out.pop();
    }
    out.push(p);
  }
  return out;
}

function shrink(r: Rect, by: number): Rect {
  return { x: r.x + by, y: r.y + by, w: r.w - by * 2, h: r.h - by * 2 };
}

/** 경로 점수. 작을수록 좋다 */
function routeCost(pts: Point[], d1: Point, d2: Point, ra: Rect, rb: Rect): number {
  const n = pts.length - 1;
  if (n < 1) return Infinity;
  let cost = 0;
  let prev: Point | null = null;
  let firstLen = 0;
  let lastLen = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    const dir = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
    cost += len;
    if (i === 0) {
      firstLen = len;
      if (dir.x * d1.x + dir.y * d1.y < 0.99) cost += WRONG_WAY_PENALTY;
    }
    if (i === n - 1) {
      lastLen = len;
      if (dir.x * d2.x + dir.y * d2.y > -0.99) cost += WRONG_WAY_PENALTY;
    }
    if (prev) {
      cost += BEND_COST;
      if (prev.x * dir.x + prev.y * dir.y < -0.5) cost += WRONG_WAY_PENALTY;
    }
    if (ra.w > 0 && ra.h > 0 && segmentIntersectsRect(p, q, ra)) cost += CROSS_PENALTY;
    if (rb.w > 0 && rb.h > 0 && segmentIntersectsRect(p, q, rb)) cost += CROSS_PENALTY;
    prev = dir;
  }
  if (n > 1) {
    if (firstLen < MIN_END_SEGMENT) cost += SHORT_END_PENALTY;
    if (lastLen < MIN_END_SEGMENT) cost += SHORT_END_PENALTY;
  }
  return cost;
}

/** 면 조합마다 L자, Z자 경로를 만들어 가장 좋은 것을 고른다 */
function searchRoute(
  a: ErdNode,
  b: ErdNode,
  sa: Side | undefined,
  sb: Side | undefined,
  banA: Side[],
  banB: Side[],
): Route {
  const pick = (fixed: Side | undefined, ban: Side[]): readonly Side[] => {
    if (fixed) return [fixed];
    const free = SIDES.filter((s) => !ban.includes(s));
    return free.length > 0 ? free : SIDES;
  };
  const sidesA = pick(sa, banA);
  const sidesB = pick(sb, banB);
  const boxA = nodeRect(a);
  const boxB = nodeRect(b);
  const ra = shrink(boxA, 1);
  const rb = shrink(boxB, 1);
  // 두 도형을 바깥으로 돌아가는 Z자의 가운데 선 위치
  const left = Math.min(boxA.x, boxB.x) - ELBOW_STUB;
  const right = Math.max(boxA.x + boxA.w, boxB.x + boxB.w) + ELBOW_STUB;
  const top = Math.min(boxA.y, boxB.y) - ELBOW_STUB;
  const bottom = Math.max(boxA.y + boxA.h, boxB.y + boxB.h) + ELBOW_STUB;
  // 두 도형 사이에 틈이 있으면 그 한가운데
  const gapX =
    boxA.x + boxA.w < boxB.x ? (boxA.x + boxA.w + boxB.x) / 2 : boxB.x + boxB.w < boxA.x ? (boxB.x + boxB.w + boxA.x) / 2 : null;
  const gapY =
    boxA.y + boxA.h < boxB.y ? (boxA.y + boxA.h + boxB.y) / 2 : boxB.y + boxB.h < boxA.y ? (boxB.y + boxB.h + boxA.y) / 2 : null;

  let best: Route | null = null;
  let bestCost = Infinity;
  for (const s1 of sidesA) {
    const p1 = anchorPoint(a, s1);
    const d1 = sideDirection(s1);
    for (const s2 of sidesB) {
      const p2 = anchorPoint(b, s2);
      const d2 = sideDirection(s2);
      // 어떤 경로도 두 고정점 사이의 가로세로 거리보다 짧을 수 없으므로 가망 없는 조합은 건너뛴다
      if (Math.abs(p2.x - p1.x) + Math.abs(p2.y - p1.y) >= bestCost) continue;
      for (const stub1 of [0, ELBOW_STUB]) {
        const A = add(p1, d1, stub1);
        for (const stub2 of [0, ELBOW_STUB]) {
          const B = add(p2, d2, stub2);
          const middles: Point[][] = [[{ x: A.x, y: B.y }], [{ x: B.x, y: A.y }]];
          const xs = [(A.x + B.x) / 2, left, right];
          if (gapX !== null) xs.push(gapX);
          for (const mx of xs) middles.push([{ x: mx, y: A.y }, { x: mx, y: B.y }]);
          const ys = [(A.y + B.y) / 2, top, bottom];
          if (gapY !== null) ys.push(gapY);
          for (const my of ys) middles.push([{ x: A.x, y: my }, { x: B.x, y: my }]);
          for (const middle of middles) {
            const pts = simplifyPath([p1, A, ...middle, B, p2]);
            const cost = routeCost(pts, d1, d2, ra, rb);
            // 먼저 나온 후보가 동점에서 이긴다(도형을 조금 움직여도 경로가 뒤집히지 않게)
            if (cost < bestCost - 1e-6) {
              bestCost = cost;
              best = { points: pts, sideA: s1, sideB: s2 };
            }
          }
        }
      }
    }
  }
  if (best) return best;
  // 두 고정점이 같은 자리인 퇴화 사례
  return { points: [anchorPoint(a, sidesA[0]), anchorPoint(b, sidesB[0])], sideA: sidesA[0], sideB: sidesB[0] };
}

/**
 * a에서 b로 가는 꺾은선 경로. sa/sb는 지정된 면(없으면 자동).
 * skip > 0이면 같은 두 노드 사이의 앞 순번 선들이 쓴 면을 피해서 고른다(재귀 관계의 두 번째 선).
 */
function elbowRoute(a: ErdNode, b: ErdNode, sa: Side | undefined, sb: Side | undefined, skip: number): Route {
  let banA: Side[] = [];
  let banB: Side[] = [];
  for (let k = 0; ; k++) {
    const route = directRoute(a, b, sa, sb, banA, banB) ?? searchRoute(a, b, sa, sb, banA, banB);
    if (k >= skip) return route;
    banA.push(route.sideA);
    banB.push(route.sideB);
    if (banA.length >= SIDES.length) {
      banA = [];
      banB = [];
    }
  }
}

// ── 직선과 꺾은선의 공통 계산 ──

/**
 * 점 목록을 잇는 선(직선 또는 꺾은선)의 EdgeGeometry.
 * prefer: 글자를 놓을 선분이 애매할 때 어느 끝에 가까운 선분을 고를지.
 */
function polylineGeometry(
  edge: ErdEdge,
  source: ErdNode,
  target: ErdNode,
  pts: Point[],
  sourceSide: Side | null,
  targetSide: Side | null,
  prefer: 'start' | 'end' | null,
): EdgeGeometry {
  const half = STYLE.doubleGap / 2;
  const labelDist = LABEL_OFFSET + (edge.double ? half : 0);
  const n = pts.length - 1;
  const lens: number[] = [];
  const dirs: Array<Point | null> = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    lens.push(len);
    dirs.push(unit(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y));
    total += len;
  }
  // 길이가 0인 선분은 방향을 정할 수 없으므로 가로 방향으로 본다
  const fallback = dirs.find((d) => d !== null) ?? { x: 1, y: 0 };
  const dirOf = (i: number): Point => dirs[i] ?? fallback;

  const hitPath = polyPath(pts);
  let paths = [hitPath];
  if (edge.double) {
    paths = [1, -1].map((sign) => {
      const shift = sign * half;
      const out = pts.map((p, i) => {
        if (i === 0) return add(p, perp(dirOf(0)), shift);
        if (i === n) return add(p, perp(dirOf(n - 1)), shift);
        // 모서리에서는 평행 이동한 두 직선의 교점을 써서 두 줄 간격을 유지한다
        const d0 = dirOf(i - 1);
        const d1 = dirOf(i);
        const moved = add(p, perp(d1), shift);
        return lineIntersection(add(pts[i - 1], perp(d0), shift), d0, moved, d1) ?? moved;
      });
      // 마름모 꼭짓점이나 타원 끝점에서 줄 끝이 외곽선에 못 미치지 않게 맞춘다
      const first = dirs[0];
      const last = dirs[n - 1];
      if (first) out[0] = snapToOutline(source, pts[0], out[0], neg(first));
      if (last) out[n] = snapToOutline(target, pts[n], out[n], last);
      return polyPath(out);
    });
  }

  // 경로 길이의 중간점
  let mid = pts[0];
  let walked = 0;
  for (let i = 0; i < n; i++) {
    if (walked + lens[i] >= total / 2 && lens[i] > 0) {
      mid = add(pts[i], dirOf(i), total / 2 - walked);
      break;
    }
    walked += lens[i];
  }

  // 글자는 가장 긴 선분의 가운데에 둔다. 비슷하게 긴 선분이 여럿이면 prefer 쪽 끝에 가까운 것
  let longest = 0;
  for (let i = 1; i < n; i++) if (lens[i] > lens[longest] + 1e-6) longest = i;
  let seg = longest;
  if (prefer) {
    const close: number[] = [];
    for (let i = 0; i < n; i++) if (lens[i] >= lens[longest] * 0.75) close.push(i);
    if (close.length > 1) seg = prefer === 'start' ? close[0] : close[close.length - 1];
  }
  const segMid = { x: (pts[seg].x + pts[seg + 1].x) / 2, y: (pts[seg].y + pts[seg + 1].y) / 2 };
  const side = labelNormal(dirOf(seg));

  return {
    start: pts[0],
    end: pts[n],
    control: null,
    points: pts,
    sourceSide,
    targetSide,
    paths,
    hitPath,
    mid,
    labelPos: add(segMid, side, labelDist),
    rolePos: add(segMid, side, -labelDist),
  };
}

/**
 * 엣지 하나를 그리는 데 필요한 좌표를 계산한다.
 * siblingIndex/siblingCount: 같은 두 노드를 잇는 엣지가 여러 개일 때(재귀 관계) 몇 번째인지. 기본은 0/1.
 * pairCount: 붙는 면 지정과 상관없이 같은 두 노드를 잇는 엣지의 수. 기본 모양을 정하는 데 쓴다.
 */
export function computeEdgeGeometry(
  edge: ErdEdge,
  source: ErdNode,
  target: ErdNode,
  siblingIndex = 0,
  siblingCount = 1,
  pairCount = siblingCount,
): EdgeGeometry {
  const shape = edgeShapeOf(edge, source, target, pairCount);
  const pinned = !!(edge.sourceSide || edge.targetSide);

  if (shape === 'elbow') {
    // source/target이 뒤집혀 저장돼도 같은 그림이 나오도록 id 순서로 맞춰 계산한 뒤 되돌린다
    const flip = source.id > target.id;
    const a = flip ? target : source;
    const b = flip ? source : target;
    const sa = flip ? edge.targetSide : edge.sourceSide;
    const sb = flip ? edge.sourceSide : edge.targetSide;
    const skip = !pinned && siblingCount > 1 ? Math.max(0, Math.min(Math.floor(siblingIndex) || 0, 8)) : 0;
    const route = elbowRoute(a, b, sa, sb, skip);
    const pts = flip ? [...route.points].reverse() : route.points;
    const prefer = source.kind === target.kind ? null : source.kind === 'relationship' ? 'start' : target.kind === 'relationship' ? 'end' : null;
    return polylineGeometry(edge, source, target, pts, flip ? route.sideB : route.sideA, flip ? route.sideA : route.sideB, prefer);
  }

  if (pinned) {
    // 고정점에서 가로나 세로로 곧게 뻗어 상대 도형의 마주 보는 면에 닿으면 그 선을 쓴다.
    // 엔티티는 변 위에서 미끄러지므로, 마름모 꼭짓점과 조금 어긋나 있어도 선이 비스듬해지지 않는다.
    const flip = source.id > target.id;
    const direct = flip
      ? directRoute(target, source, edge.targetSide, edge.sourceSide, [], [])
      : directRoute(source, target, edge.sourceSide, edge.targetSide, [], []);
    if (direct) {
      const pts = flip ? [...direct.points].reverse() : direct.points;
      return polylineGeometry(edge, source, target, pts, flip ? direct.sideB : direct.sideA, flip ? direct.sideA : direct.sideB, null);
    }
    // 그렇게 만나지 못하면 면이 지정된 끝은 고정점에서, 지정 안 된 끝은 상대 끝점 방향의 외곽선에서 시작하는 직선
    let s: Point;
    let e: Point;
    if (edge.sourceSide && edge.targetSide) {
      s = anchorPoint(source, edge.sourceSide);
      e = anchorPoint(target, edge.targetSide);
    } else if (edge.sourceSide) {
      s = anchorPoint(source, edge.sourceSide);
      e = boundaryPoint(target, s);
    } else {
      e = anchorPoint(target, edge.targetSide as Side);
      s = boundaryPoint(source, e);
    }
    return polylineGeometry(edge, source, target, [s, e], edge.sourceSide ?? null, edge.targetSide ?? null, null);
  }

  const a = nodeCenter(source);
  const b = nodeCenter(target);
  const count = siblingCount > 1 ? siblingCount : 1;
  const bend = count > 1 ? (siblingIndex - (count - 1) / 2) * SIBLING_SPREAD : 0;

  if (!(Math.abs(bend) > EPS)) {
    // 두 중심을 잇는 직선
    return polylineGeometry(edge, source, target, [boundaryPoint(source, b), boundaryPoint(target, a)], null, null, null);
  }

  // 곡선: source/target이 뒤집혀 저장된 형제도 같은 기준으로 벌어지도록 id 순서로 수직 방향을 정한다
  // (두 중심이 겹치면 방향을 정할 수 없으므로 가로 방향으로 본다)
  const u = unit(b.x - a.x, b.y - a.y) ?? { x: 1, y: 0 };
  const half = STYLE.doubleGap / 2;
  const labelDist = LABEL_OFFSET + (edge.double ? half : 0);
  const canon = source.id > target.id ? neg(u) : u;
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
    paths = [1, -1].map((sign) => {
      const shift = sign * half;
      const p0 = snapToOutline(source, start, add(start, n0, shift), neg(d0));
      const p2 = snapToOutline(target, end, add(end, n2, shift), d2);
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
  const outward = bend > 0 ? spread : neg(spread);
  return {
    start,
    end,
    control,
    points: [start, end],
    sourceSide: null,
    targetSide: null,
    paths,
    hitPath,
    mid,
    labelPos: add(mid, outward, labelDist),
    rolePos: add(mid, outward, labelDist + ROLE_STACK_OFFSET),
  };
}

/**
 * 같은 두 노드를 잇는 엣지끼리 묶어 각 엣지의 순번을 알려 준다. key는 edge.id.
 * 면이 지정된 엣지는 자리가 정해져 있으므로 순번에서 빼고 { index: 0, count: 1 }을 준다.
 */
export function siblingInfo(edges: ErdEdge[]): Map<string, { index: number; count: number; pair: number }> {
  const groups = new Map<string, string[]>();
  const result = new Map<string, { index: number; count: number; pair: number }>();
  const keyOf = (e: ErdEdge) => (e.source < e.target ? `${e.source}\u0000${e.target}` : `${e.target}\u0000${e.source}`);
  // pair: 붙는 면이 지정된 선까지 포함해 같은 두 도형을 잇는 선의 수
  const pairs = new Map<string, number>();
  for (const e of edges) pairs.set(keyOf(e), (pairs.get(keyOf(e)) ?? 0) + 1);
  for (const e of edges) {
    const key = keyOf(e);
    if (e.sourceSide || e.targetSide) {
      result.set(e.id, { index: 0, count: 1, pair: pairs.get(key) ?? 1 });
      continue;
    }
    const group = groups.get(key);
    if (group) group.push(e.id);
    else groups.set(key, [e.id]);
  }
  for (const [key, ids] of groups) {
    // 접속자마다 같은 결과가 나오도록 로캘과 무관한 단순 비교로 정렬한다
    ids.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    ids.forEach((id, index) => result.set(id, { index, count: ids.length, pair: pairs.get(key) ?? ids.length }));
  }
  return result;
}

/** 중심선이 지나는 꼭짓점. points가 없는 값이 들어와도 양 끝으로 대신한다 */
function vertices(geom: EdgeGeometry): Point[] {
  return geom.points && geom.points.length >= 2 ? geom.points : [geom.start, geom.end];
}

/** 중심선 위의 점. t는 0(start)부터 1(end)까지. 꺾은선은 경로 길이 기준 */
export function edgePointAt(geom: EdgeGeometry, t: number): Point {
  const { start: s, end: e, control: c } = geom;
  if (c) {
    const k = 1 - t;
    return {
      x: k * k * s.x + 2 * k * t * c.x + t * t * e.x,
      y: k * k * s.y + 2 * k * t * c.y + t * t * e.y,
    };
  }
  const pts = vertices(geom);
  if (pts.length === 2) return { x: s.x + (e.x - s.x) * t, y: s.y + (e.y - s.y) * t };
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let remain = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (remain <= len && len > 0) {
      const f = remain / len;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f };
    }
    remain -= len;
  }
  return pts[pts.length - 1];
}

/** 중심선을 꺾은선으로 바꾼 점 목록. 직선과 꺾은선은 꼭짓점 그대로, 곡선은 샘플링 */
export function edgePolyline(geom: EdgeGeometry, samples = CURVE_SAMPLES): Point[] {
  if (!geom.control) return vertices(geom);
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

// ───────────────────────── 면(꼭짓점) 고정점 ─────────────────────────

/**
 * 도형의 한 면에서 선이 붙는 점. 직사각형은 그 변의 가운데, 마름모는 그 방향 꼭짓점,
 * 타원은 그 방향 끝점, 특수화 원은 원 위의 그 방향 점이다.
 */
export function anchorPoint(node: ErdNode, side: Side): Point {
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  const rx = node.kind === 'spec' ? Math.min(node.w, node.h) / 2 : node.w / 2;
  const ry = node.kind === 'spec' ? Math.min(node.w, node.h) / 2 : node.h / 2;
  switch (side) {
    case 'top':
      return { x: cx, y: cy - ry };
    case 'bottom':
      return { x: cx, y: cy + ry };
    case 'left':
      return { x: cx - rx, y: cy };
    case 'right':
      return { x: cx + rx, y: cy };
  }
}

/** 면에서 바깥으로 나가는 단위 방향 */
export function sideDirection(side: Side): Point {
  switch (side) {
    case 'top':
      return { x: 0, y: -1 };
    case 'bottom':
      return { x: 0, y: 1 };
    case 'left':
      return { x: -1, y: 0 };
    case 'right':
      return { x: 1, y: 0 };
  }
}

/** 점 p에서 가장 가까운 고정점의 면. maxDist(월드 단위)보다 멀면 null */
export function nearestSide(node: ErdNode, p: Point, maxDist = Infinity): Side | null {
  let best: Side | null = null;
  let bestD = maxDist;
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const a = anchorPoint(node, side);
    const d = Math.hypot(a.x - p.x, a.y - p.y);
    if (d <= bestD) {
      bestD = d;
      best = side;
    }
  }
  return best;
}
