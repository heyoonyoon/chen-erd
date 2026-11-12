/**
 * IE(까마귀발) 그림의 선과 선 끝 기호 계산(순수 함수).
 *
 * 선 끝 기호는 테이블에 가까운 쪽이 최대 개수(막대 = 하나, 까마귀발 = 여럿),
 * 바깥쪽이 최소 개수(막대 = 반드시 하나, 동그라미 = 없어도 됨)를 나타낸다.
 * 최소 개수를 글과 설정으로 알 수 없으면(null) 그 기호는 그리지 않는다.
 */
import type { IeEnd } from '../../shared/relational/userSchema';

export interface Pt {
  x: number;
  y: number;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 선 끝의 종류. 최소 개수를 모르면 max-one, max-many */
export type EndKind = 'exactly-one' | 'zero-or-one' | 'one-or-many' | 'zero-or-many' | 'max-one' | 'max-many';

export function endKind(end: Pick<IeEnd, 'min' | 'max'>): EndKind {
  if (end.min === null) return end.max === '1' ? 'max-one' : 'max-many';
  if (end.max === '1') return end.min === 1 ? 'exactly-one' : 'zero-or-one';
  return end.min === 1 ? 'one-or-many' : 'zero-or-many';
}

export type Mark =
  | { type: 'bar'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'circle'; cx: number; cy: number; r: number }
  | { type: 'crow'; d: string };

/** 테이블 테두리에서 최대 개수 기호까지의 거리와 최소 개수 기호의 자리 */
const MAX_BAR_AT = 9;
const CROW_LEN = 14;
const CROW_HALF = 7;
const MIN_BAR_AT = 19;
const CIRCLE_AT = 23;
const CIRCLE_R = 4.5;
const BAR_HALF = 7;
/** 선 끝 기호가 차지하는 길이(선이 꺾이기 전에 이만큼은 곧게 나가야 한다) */
export const END_STUB = 32;

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * 테두리 위의 점 p에서 바깥쪽 방향 dir(단위 벡터)으로 나가는 선 끝의 기호.
 */
export function endMarks(end: Pick<IeEnd, 'min' | 'max'>, p: Pt, dir: Pt): Mark[] {
  const n = { x: -dir.y, y: dir.x };
  const at = (d: number, s = 0): Pt => ({ x: p.x + dir.x * d + n.x * s, y: p.y + dir.y * d + n.y * s });
  const bar = (d: number): Mark => {
    const a = at(d, BAR_HALF);
    const b = at(d, -BAR_HALF);
    return { type: 'bar', x1: r2(a.x), y1: r2(a.y), x2: r2(b.x), y2: r2(b.y) };
  };
  const marks: Mark[] = [];
  if (end.max === 'N') {
    const tip = at(CROW_LEN);
    const feet = [at(0, CROW_HALF), at(0), at(0, -CROW_HALF)];
    marks.push({ type: 'crow', d: feet.map((f) => `M${r2(tip.x)} ${r2(tip.y)}L${r2(f.x)} ${r2(f.y)}`).join('') });
  } else {
    marks.push(bar(MAX_BAR_AT));
  }
  if (end.min === null) return marks;
  if (end.min === 1) marks.push(bar(MIN_BAR_AT));
  else {
    const c = at(CIRCLE_AT);
    marks.push({ type: 'circle', cx: r2(c.x), cy: r2(c.y), r: CIRCLE_R });
  }
  return marks;
}

type Side = 'left' | 'right' | 'top' | 'bottom';

const DIRS: Record<Side, Pt> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };

export interface LinkInput {
  id: string;
  from: string;
  to: string;
}

export interface Route {
  /** 꺾은선의 점들. 첫 점은 from 테이블, 마지막 점은 to 테이블의 테두리 위에 있다 */
  points: Pt[];
  fromDir: Pt;
  toDir: Pt;
  /** 이름을 적을 자리 */
  label: Pt;
}

/** 두 상자 사이에서 선이 나갈 면. 가로로 떨어져 있으면 옆면, 아니면 위아래 면 */
function sidesBetween(a: Box, b: Box): [Side, Side] {
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  if (gapX >= gapY) return b.x + b.w / 2 >= a.x + a.w / 2 ? ['right', 'left'] : ['left', 'right'];
  return b.y + b.h / 2 >= a.y + a.h / 2 ? ['bottom', 'top'] : ['top', 'bottom'];
}

function pointOnSide(box: Box, side: Side, t: number): Pt {
  switch (side) {
    case 'left':
      return { x: box.x, y: box.y + box.h * t };
    case 'right':
      return { x: box.x + box.w, y: box.y + box.h * t };
    case 'top':
      return { x: box.x + box.w * t, y: box.y };
    case 'bottom':
      return { x: box.x + box.w * t, y: box.y + box.h };
  }
}

const SELF_LOOP = 36;
/** 꺾는 자리를 옮겨 볼 때 상자 면에서 띄우는 거리 */
const JOG_NEAR = 40;

/** 가로 또는 세로 선분이 상자(여백 포함)를 지나는지 */
function segmentHitsBox(a: Pt, b: Pt, box: Box, margin = 4): boolean {
  const x1 = Math.min(a.x, b.x);
  const x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const y2 = Math.max(a.y, b.y);
  return x2 > box.x - margin && x1 < box.x + box.w + margin && y2 > box.y - margin && y1 < box.y + box.h + margin;
}

function collisions(points: readonly Pt[], boxes: Record<string, Box>, skip: readonly string[]): number {
  let n = 0;
  for (const [id, box] of Object.entries(boxes)) {
    if (skip.includes(id)) continue;
    for (let i = 0; i < points.length - 1; i++) if (segmentHitsBox(points[i], points[i + 1], box)) n++;
  }
  return n;
}

/**
 * 모든 선의 경로. 한 면에 선이 여럿 붙으면 그 면을 고르게 나눠 서로 겹치지 않게 한다.
 * 같은 테이블을 가리키는 선(재귀 관계)은 오른쪽으로 고리를 그린다.
 */
export function routeLinks(links: readonly LinkInput[], boxes: Record<string, Box>): Map<string, Route> {
  interface Slot {
    link: string;
    end: 'from' | 'to';
    other: Pt;
  }
  const plan = new Map<string, { fromSide: Side; toSide: Side }>();
  const slots = new Map<string, Slot[]>();
  const addSlot = (table: string, side: Side, slot: Slot) => {
    const k = `${table}|${side}`;
    const list = slots.get(k) ?? [];
    list.push(slot);
    slots.set(k, list);
  };
  const center = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

  for (const l of links) {
    const a = boxes[l.from];
    const b = boxes[l.to];
    if (!a || !b) continue;
    if (l.from === l.to) {
      plan.set(l.id, { fromSide: 'right', toSide: 'right' });
      addSlot(l.from, 'right', { link: l.id, end: 'from', other: { x: 0, y: -1e6 } });
      addSlot(l.to, 'right', { link: l.id, end: 'to', other: { x: 0, y: 1e6 } });
      continue;
    }
    const [fromSide, toSide] = sidesBetween(a, b);
    plan.set(l.id, { fromSide, toSide });
    addSlot(l.from, fromSide, { link: l.id, end: 'from', other: center(b) });
    addSlot(l.to, toSide, { link: l.id, end: 'to', other: center(a) });
  }

  const anchor = new Map<string, Pt>();
  for (const [k, list] of slots) {
    const [table, side] = k.split('|') as [string, Side];
    const box = boxes[table];
    const vertical = side === 'left' || side === 'right';
    list.sort((p, q) => (vertical ? p.other.y - q.other.y : p.other.x - q.other.x));
    list.forEach((s, i) => anchor.set(`${s.link}|${s.end}`, pointOnSide(box, side, (i + 1) / (list.length + 1))));
  }

  const out = new Map<string, Route>();
  for (const l of links) {
    const p = plan.get(l.id);
    if (!p) continue;
    const s = anchor.get(`${l.id}|from`)!;
    const e = anchor.get(`${l.id}|to`)!;
    const fromDir = DIRS[p.fromSide];
    const toDir = DIRS[p.toSide];
    let route: Candidate;
    if (l.from === l.to) {
      const x = s.x + SELF_LOOP;
      route = { points: [s, { x, y: s.y }, { x, y: e.y }, e], fromDir, toDir };
    } else {
      const horizontal = p.fromSide === 'left' || p.fromSide === 'right';
      const straight = horizontal ? Math.abs(s.y - e.y) < 0.5 : Math.abs(s.x - e.x) < 0.5;
      const candidates: Candidate[] = [];
      if (straight) candidates.push({ points: [s, e], fromDir, toDir });
      else if (horizontal) {
        // 가운데에서 꺾는 것이 기본이고, 그 길이 다른 상자를 지나면 양 끝 가까이에서 꺾어 본다
        for (const mx of [(s.x + e.x) / 2, s.x + fromDir.x * JOG_NEAR, e.x + toDir.x * JOG_NEAR])
          candidates.push({ points: [s, { x: mx, y: s.y }, { x: mx, y: e.y }, e], fromDir, toDir });
      } else {
        for (const my of [(s.y + e.y) / 2, s.y + fromDir.y * JOG_NEAR, e.y + toDir.y * JOG_NEAR])
          candidates.push({ points: [s, { x: s.x, y: my }, { x: e.x, y: my }, e], fromDir, toDir });
      }
      // 그래도 다른 상자를 지나면 상자들을 바깥으로 돌아가는 길도 본다
      candidates.push(...aroundRoutes(boxes[l.from], boxes[l.to], boxes, horizontal));
      route = pickLeast(candidates, boxes, [l.from, l.to]);
    }
    const pts = route.points;
    const label =
      pts.length === 4 ? { x: (pts[1].x + pts[2].x) / 2, y: (pts[1].y + pts[2].y) / 2 } : { x: (pts[0].x + pts[pts.length - 1].x) / 2, y: (pts[0].y + pts[pts.length - 1].y) / 2 };
    out.set(l.id, { ...route, label });
  }
  return out;
}

interface Candidate {
  points: Pt[];
  fromDir: Pt;
  toDir: Pt;
}

const AROUND_GAP = 40;

/**
 * 두 상자를 같은 쪽 면(위아래로 놓였으면 왼쪽이나 오른쪽, 옆으로 놓였으면 위나 아래)에서 내보내
 * 사이에 있는 상자들의 바깥으로 돌아가는 길.
 */
function aroundRoutes(a: Box, b: Box, boxes: Record<string, Box>, horizontal: boolean): Candidate[] {
  const all = Object.values(boxes);
  if (!horizontal) {
    const y1 = Math.min(a.y, b.y);
    const y2 = Math.max(a.y + a.h, b.y + b.h);
    const band = all.filter((x) => x.y < y2 && x.y + x.h > y1);
    const left = Math.min(...band.map((x) => x.x)) - AROUND_GAP;
    const right = Math.max(...band.map((x) => x.x + x.w)) + AROUND_GAP;
    const sa = { x: a.x, y: a.y + a.h / 2 };
    const sb = { x: b.x, y: b.y + b.h / 2 };
    const ra = { x: a.x + a.w, y: sa.y };
    const rb = { x: b.x + b.w, y: sb.y };
    return [
      { points: [sa, { x: left, y: sa.y }, { x: left, y: sb.y }, sb], fromDir: DIRS.left, toDir: DIRS.left },
      { points: [ra, { x: right, y: ra.y }, { x: right, y: rb.y }, rb], fromDir: DIRS.right, toDir: DIRS.right },
    ];
  }
  const x1 = Math.min(a.x, b.x);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const band = all.filter((x) => x.x < x2 && x.x + x.w > x1);
  const top = Math.min(...band.map((x) => x.y)) - AROUND_GAP;
  const bottom = Math.max(...band.map((x) => x.y + x.h)) + AROUND_GAP;
  const ta = { x: a.x + a.w / 2, y: a.y };
  const tb = { x: b.x + b.w / 2, y: b.y };
  const ba = { x: ta.x, y: a.y + a.h };
  const bb = { x: tb.x, y: b.y + b.h };
  return [
    { points: [ta, { x: ta.x, y: top }, { x: tb.x, y: top }, tb], fromDir: DIRS.top, toDir: DIRS.top },
    { points: [ba, { x: ba.x, y: bottom }, { x: bb.x, y: bottom }, bb], fromDir: DIRS.bottom, toDir: DIRS.bottom },
  ];
}

function pathLength(points: readonly Pt[]): number {
  let n = 0;
  for (let i = 0; i < points.length - 1; i++) n += Math.abs(points[i + 1].x - points[i].x) + Math.abs(points[i + 1].y - points[i].y);
  return n;
}

/** 다른 상자를 가장 적게 지나는 길. 처음 후보(가운데에서 꺾기)가 막히지 않으면 그것을 쓰고, 막혔으면 짧은 쪽을 고른다 */
function pickLeast(candidates: Candidate[], boxes: Record<string, Box>, skip: readonly string[]): Candidate {
  let best = candidates[0];
  let bestHits = Infinity;
  let bestLength = Infinity;
  for (const c of candidates) {
    const hits = collisions(c.points, boxes, skip);
    const length = pathLength(c.points);
    if (hits < bestHits || (hits === bestHits && hits > 0 && length < bestLength)) {
      best = c;
      bestHits = hits;
      bestLength = length;
    }
    if (hits === 0 && c === candidates[0]) break;
  }
  return best;
}

export function polylinePath(points: readonly Pt[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${r2(p.x)} ${r2(p.y)}`).join('');
}
