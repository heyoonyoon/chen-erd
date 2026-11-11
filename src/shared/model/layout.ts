/**
 * 자동 배치. 위치가 없는 도형에 좌표를 준다(순수 함수, 같은 입력이면 같은 결과).
 *
 * 전체 배치(layoutFull)
 *   1. 연결된 덩어리마다 엔티티를 성긴 격자의 짝수 칸에 놓는다. 이웃이 가깝고, 선이 다른 엔티티를 지나지 않고,
 *      서브타입이 슈퍼타입 아래로 가도록 비용을 매겨 탐욕 배치한 뒤 옮기기와 맞바꾸기로 다듬는다.
 *   2. 특수화 원은 슈퍼타입 바로 아래 칸에, 관계는 참여 엔티티들의 가운데에 가장 가까운 빈칸에 놓는다.
 *   3. 속성은 소유자 둘레의 타원 위에 부채꼴로 놓는다. 소유자에서 관계나 엔티티로 나가는 선의 방향은 비워 둔다.
 *   4. 열 너비와 행 높이는 그 칸의 묶음(소유자와 속성) 크기에서 나오고, 그다음 겹치지 않는 한도까지 열과 행을
 *      당겨 붙이고 관계를 참여 엔티티들 가운데로 옮긴다.
 *   5. 덩어리와 메모를 상자로 쌓아 전체가 가로로 긴 모양이 되게 한다.
 *
 * 부분 배치(layoutIncremental)
 *   이미 자리가 있는 도형은 그대로 두고, 새 도형만 기존 도형과 선을 피해 가까운 빈자리에 놓는다.
 *
 * Chen 표기법은 속성 하나하나가 타원이라 엔티티 10개면 도형이 60개를 넘는다. 그래서 묶음 단위로 자리를 잡는다.
 */
import { computeEdgeGeometry, rectsIntersect, segmentIntersectsRect, unionBounds } from '../geometry';
import type { ErdEdge, ErdNode, Point, Rect } from '../types';
import { fanOrderKey } from './extract';

// ───────────────────────── 입력과 출력 ─────────────────────────

export interface Size {
  w: number;
  h: number;
}

export interface LayoutAttr {
  id: string;
  parts: LayoutAttr[];
}

export interface LayoutOwner {
  id: string;
  attrs: LayoutAttr[];
}

export interface LayoutRelationship extends LayoutOwner {
  /** 참여 엔티티 id. 재귀 관계면 같은 id가 두 번 나온다 */
  participants: string[];
}

export interface LayoutSpec {
  id: string;
  parent: string;
  children: string[];
}

/** 배치할 그림의 뼈대. 좌표 없이 크기와 연결만 담는다 */
export interface LayoutGraph {
  sizes: Map<string, Size>;
  entities: LayoutOwner[];
  relationships: LayoutRelationship[];
  specs: LayoutSpec[];
  notes: string[];
}

/** id → 왼쪽 위 좌표(정수) */
export type Positions = Map<string, Point>;

// ───────────────────────── 상수 ─────────────────────────

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const UP = -Math.PI / 2;
const DOWN = Math.PI / 2;

/** 소유자와 속성 사이, 복합 속성과 하위 속성 사이에 보이는 선의 최소 길이 */
const OWNER_GAP = 28;
const PART_GAP = 20;
/** 속성끼리의 간격 */
const ATTR_GAP = 14;
/** 묶음 사이 간격. 엔티티와 관계 사이에는 카디널리티 글자가 들어간다 */
const CELL_GAP_X = 64;
const CELL_GAP_Y = 54;
/** 당겨 붙일 때 속성이 낀 쌍의 간격 */
const PACK_GAP = 22;
/** 연결 방향 둘레로 속성을 놓지 않는 각도. 자리가 모자라면 뒤의 값으로 줄인다 */
const BLOCK_MARGINS = [40, 32, 24, 16, 9, 4].map((d) => d * DEG);
/** 속성 사이의 기본 각도(타원 매개각) */
const STEP_PREFERRED = 46 * DEG;
const STEP_MIN = 20 * DEG;
const ARC_MIN = 12 * DEG;
/** 덩어리 사이, 메모 사이 간격 */
const BOX_GAP = 90;
const NOTE_GAP = 30;
/** 처음 그리는 그림의 왼쪽 위 */
const ORIGIN: Point = { x: 100, y: 100 };

// ───────────────────────── 작은 도우미 ─────────────────────────

function mod(a: number): number {
  const m = a % TAU;
  return m < 0 ? m + TAU : m;
}

function angleDistance(a: number, b: number): number {
  const d = mod(a - b);
  return Math.min(d, TAU - d);
}

function expand(r: Rect, gx: number, gy: number = gx): Rect {
  return { x: r.x - gx, y: r.y - gy, w: r.w + gx * 2, h: r.h + gy * 2 };
}

function centerOf(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** 선이 도형을 지난다고 볼 때 쓰는 안쪽 사각형(타원과 마름모는 모서리가 비어 있다) */
function core(r: Rect): Rect {
  return expand(r, -Math.min(r.w * 0.07, 8), -Math.min(r.h * 0.07, 4));
}

function sizeOf(sizes: Map<string, Size>, id: string): Size {
  return sizes.get(id) ?? { w: 120, h: 50 };
}

// ───────────────────────── 속성 부채꼴 ─────────────────────────

/** 소유자 중심을 원점으로 한 상자(왼쪽 위 기준) */
interface Box extends Rect {
  id: string;
}

interface Arc {
  start: number;
  width: number;
}

/** 막힌 구간(시작, 너비)을 뺀 나머지 호. 반 도 단위로 센다 */
function freeArcs(blocked: Array<[number, number]>): Arc[] {
  const N = 720;
  const flags = new Uint8Array(N);
  for (const [start, width] of blocked) {
    const from = Math.floor((mod(start) / TAU) * N);
    const count = Math.min(N, Math.ceil((width / TAU) * N) + 1);
    for (let i = 0; i < count; i++) flags[(from + i) % N] = 1;
  }
  let first = -1;
  for (let i = 0; i < N; i++) {
    if (flags[i]) {
      first = i;
      break;
    }
  }
  if (first < 0) return [{ start: 0, width: TAU }];
  const arcs: Arc[] = [];
  let run = 0;
  for (let k = 1; k <= N; k++) {
    const i = (first + k) % N;
    if (!flags[i]) {
      run++;
    } else if (run > 0) {
      arcs.push({ start: (((first + k - run) % N) / N) * TAU, width: (run / N) * TAU });
      run = 0;
    }
  }
  return arcs;
}

/**
 * n개의 속성을 놓을 매개각을 호별로 정한다.
 * 기본 간격으로 한 호에 다 들어가면 prefer 방향에 가장 가까운 호에 모아 놓고, 아니면 모든 호에 너비 비례로 나눈다.
 */
function chooseSlots(n: number, arcs: Arc[], prefer: number): number[][] {
  const full = arcs.length === 1 && arcs[0].width >= TAU - 1e-9;
  const list = full ? [{ start: prefer - Math.PI, width: TAU }] : arcs;
  if (list.length === 0) {
    return [Array.from({ length: n }, (_, j) => prefer - Math.PI + (TAU * (j + 0.5)) / n)];
  }
  const span = n * STEP_PREFERRED;
  let best: { center: number; dist: number; width: number } | null = null;
  for (const arc of list) {
    if (arc.width < span - 1e-9) continue;
    const o = mod(prefer - arc.start);
    let offset: number;
    let dist: number;
    if (o <= arc.width) {
      offset = Math.min(Math.max(o, span / 2), arc.width - span / 2);
      dist = Math.abs(o - offset);
    } else if (o - arc.width <= TAU - o) {
      offset = arc.width - span / 2;
      dist = o - offset;
    } else {
      offset = span / 2;
      dist = TAU - o + offset;
    }
    if (!best || dist < best.dist - 1e-9 || (Math.abs(dist - best.dist) <= 1e-9 && arc.width > best.width)) {
      best = { center: arc.start + offset, dist, width: arc.width };
    }
  }
  if (best) {
    const c = best.center;
    return [Array.from({ length: n }, (_, j) => c - span / 2 + STEP_PREFERRED * (j + 0.5))];
  }

  // 모든 호에 너비 비례로 나눈다(너무 좁은 호는 쓸 수 있는 호가 따로 있으면 뺀다)
  const wide = list.filter((a) => a.width >= ARC_MIN);
  const usable = wide.length > 0 ? wide : list;
  const total = usable.reduce((sum, a) => sum + a.width, 0);
  const counts = usable.map((a) => Math.floor((n * a.width) / total));
  let rest = n - counts.reduce((sum, c) => sum + c, 0);
  const byRemainder = usable
    .map((a, i) => ({ i, frac: (n * a.width) / total - counts[i], dist: angleDistance(a.start + a.width / 2, prefer) }))
    .sort((p, q) => q.frac - p.frac || p.dist - q.dist || p.i - q.i);
  for (let k = 0; rest > 0; k = (k + 1) % byRemainder.length, rest--) counts[byRemainder[k].i]++;
  const groups: number[][] = [];
  usable.forEach((arc, i) => {
    const k = counts[i];
    if (k > 0) groups.push(Array.from({ length: k }, (_, j) => arc.start + (arc.width * (j + 0.5)) / k));
  });
  return groups;
}

function boxesBounds(owner: Size, boxes: Box[]): Rect {
  return unionBounds([{ x: -owner.w / 2, y: -owner.h / 2, w: owner.w, h: owner.h }, ...boxes])!;
}

/** 비워 둘 반직선. 시작점은 소유자 중심을 원점으로 한 좌표다(소유자에서 나가는 선이면 원점) */
interface Ray {
  x: number;
  y: number;
  dir: number;
}

/** 하위 속성 부채꼴이 닿을 만한 거리. 이보다 먼 선은 신경 쓰지 않는다 */
const RAY_REACH = 320;
/** 연결 방향을 좁게 비울수록 붙는 벌점(BLOCK_MARGINS와 같은 순서) */
const MARGIN_PENALTY = [0, 0.04, 0.1, 0.2, 0.4, 0.8];

/** 반직선을 피하려면 비워야 하는 방향 구간(시작 방향, 너비). 닿지 않으면 null */
function rayInterval(ray: Ray, margin: number): [number, number] | null {
  const ux = Math.cos(ray.dir);
  const uy = Math.sin(ray.dir);
  if (Math.hypot(ray.x, ray.y) < 1) return [ray.dir - margin, margin * 2];
  // 중심에서 RAY_REACH 안에 들어오는 반직선 구간의 양 끝을 본다
  const bq = ray.x * ux + ray.y * uy;
  const cq = ray.x * ray.x + ray.y * ray.y - RAY_REACH * RAY_REACH;
  const disc = bq * bq - cq;
  if (disc <= 0) return null;
  const t2 = -bq + Math.sqrt(disc);
  if (t2 <= 0) return null;
  const t1 = Math.max(0, -bq - Math.sqrt(disc));
  const a1 = Math.atan2(ray.y + uy * t1, ray.x + ux * t1);
  const a2 = Math.atan2(ray.y + uy * t2, ray.x + ux * t2);
  const m = Math.min(margin, 14 * DEG);
  const sweep = mod(a2 - a1);
  return sweep <= Math.PI ? [a1 - m, sweep + m * 2] : [a2 - m, TAU - sweep + m * 2];
}

/**
 * 소유자 둘레에 속성을 놓는다. 돌려주는 상자는 소유자 중심이 원점이다.
 * rays는 비워 둘 선들(소유자에서 관계나 엔티티로 나가는 선), prefer는 속성이 적을 때 모아 둘 방향.
 * 모델의 속성 순서는 서쪽에서 시작하는 시계 방향 순서와 같게 놓는다(extract가 같은 순서로 읽는다).
 */
function fanCluster(owner: Size, attrs: LayoutAttr[], sizes: Map<string, Size>, rays: Ray[], prefer: number, depth: number): Box[] {
  const n = attrs.length;
  if (n === 0) return [];
  const gapOwner = depth === 0 ? OWNER_GAP : PART_GAP;
  let maxW = 0;
  let maxH = 0;
  for (const a of attrs) {
    const s = sizeOf(sizes, a.id);
    maxW = Math.max(maxW, s.w);
    maxH = Math.max(maxH, s.h);
  }
  const rx = owner.w / 2 + maxW / 2 + gapOwner;
  const ry = owner.h / 2 + maxH / 2 + gapOwner;
  // 실제 방향을 타원의 매개각으로. 타원이 납작해도 매개각으로 고르게 나누면 위쪽 속성들이 서로 덜 붙는다
  const toParam = (dir: number) => Math.atan2(rx * Math.sin(dir), ry * Math.cos(dir));
  const ownerRect: Rect = { x: -owner.w / 2, y: -owner.h / 2, w: owner.w, h: owner.h };
  const ownerNear = expand(ownerRect, gapOwner - 1);
  const ownerFar = expand(ownerRect, ATTR_GAP);
  const rayEnds = rays.map((r) => ({ from: { x: r.x, y: r.y }, to: { x: r.x + Math.cos(r.dir) * 1500, y: r.y + Math.sin(r.dir) * 1500 } }));

  const arcsFor = (margin: number): Arc[] => {
    const blocked: Array<[number, number]> = [];
    for (const ray of rays) {
      const iv = rayInterval(ray, margin);
      if (!iv) continue;
      const from = toParam(iv[0]);
      blocked.push([from, iv[1] >= TAU ? TAU : mod(toParam(iv[0] + iv[1]) - from)]);
    }
    return blocked.length > 0 ? freeArcs(blocked) : [{ start: 0, width: TAU }];
  };

  interface Slot {
    t: number;
    group: number;
    outer: boolean;
    key: number;
  }
  interface Built {
    boxes: Box[];
    ordered: boolean;
  }
  /** stagger: 0이면 한 겹, 아니면 바깥 겹을 속성 너비의 그 비율만큼 더 내보내 두 겹으로 번갈아 놓는다 */
  const build = (groups: number[][], stagger: number): Built => {
    const outX = maxW * stagger + ATTR_GAP;
    const outY = maxH + ATTR_GAP;
    const position = (slot: Slot, s: number): Point => {
      const x = Math.round((rx * s + (slot.outer ? outX : 0)) * Math.cos(slot.t));
      let y = Math.round((ry * s + (slot.outer ? outY : 0)) * Math.sin(slot.t));
      if (x < 0 && Math.abs(y) <= 1) y = 0;
      return { x, y };
    };
    const slots: Slot[] = [];
    groups.forEach((group, g) => {
      group.forEach((raw, j) => {
        // 정서쪽 가까이는 정확히 서쪽으로 붙인다(순서 값이 처음과 끝 사이에서 흔들리지 않게)
        const t = Math.cos(raw) < 0 && Math.abs(Math.sin(raw)) < 0.04 ? Math.PI : raw;
        const slot: Slot = { t, group: g, outer: stagger > 0 && group.length >= 3 && j % 2 === 1, key: 0 };
        const p = position(slot, 1);
        slot.key = fanOrderKey(p.x, p.y);
        slots.push(slot);
      });
    });
    slots.sort((a, b) => a.key - b.key);

    let placed: Box[][] = [];
    let centers: Point[] = [];
    // 배율은 호마다 따로 키운다. 붐비는 호만 바깥으로 밀려나고 넉넉한 호의 속성은 소유자 가까이 남는다
    const scales = groups.map(() => 1);
    // 하위 속성은 바깥쪽으로 편다. 어림한 배율의 자리에서 한 번 만들고, 실제 배율이 많이 다르면 한 번 더 만든다
    for (let round = 0; round < 2; round++) {
      const at = [...scales];
      const petals: Box[][] = slots.map((slot, i) => {
        const a = attrs[i];
        const size = sizeOf(sizes, a.id);
        const own: Box = { id: a.id, x: -size.w / 2, y: -size.h / 2, w: size.w, h: size.h };
        if (a.parts.length === 0) return [own];
        const p = position(slot, at[slot.group]);
        const dir = Math.atan2(p.y, p.x);
        const inner: Ray[] = [{ x: 0, y: 0, dir: dir + Math.PI }, ...rays.map((r) => ({ x: r.x - p.x, y: r.y - p.y, dir: r.dir }))];
        return [own, ...fanCluster(size, a.parts, sizes, inner, dir, depth + 1)];
      });
      for (let iter = 0; iter < 140; iter++) {
        centers = slots.map((slot) => position(slot, scales[slot.group]));
        placed = petals.map((petal, i) => petal.map((b) => ({ ...b, x: b.x + centers[i].x, y: b.y + centers[i].y })));
        const bump = new Set<number>();
        for (let i = 0; i < placed.length; i++) {
          const gi = slots[i].group;
          for (let k = 0; k < placed[i].length; k++) {
            const box = placed[i][k];
            if (rectsIntersect(k === 0 ? ownerNear : ownerFar, box)) bump.add(gi);
            // 소유자에서 나가는 다른 선 위에 놓이면 안 된다(끝없이 밀어내지는 않는다)
            if (iter < 16) {
              const grown = expand(box, 4);
              for (const ray of rayEnds) if (segmentIntersectsRect(ray.from, ray.to, grown)) bump.add(gi);
            }
          }
          for (let j = 0; j < placed.length; j++) {
            if (j === i) continue;
            const gj = slots[j].group;
            for (const b of placed[j]) {
              // 소유자에서 i번째 속성으로 가는 선이 다른 속성을 지나면 안 된다
              if (segmentIntersectsRect({ x: 0, y: 0 }, centers[i], expand(b, 3))) {
                bump.add(gi);
                bump.add(gj);
              }
              if (j < i) continue;
              const grown = expand(b, ATTR_GAP);
              for (const a of placed[i]) {
                if (rectsIntersect(grown, a)) {
                  bump.add(gi);
                  bump.add(gj);
                }
              }
            }
          }
        }
        if (bump.size === 0) break;
        for (const g of bump) scales[g] *= 1.05;
      }
      if (!attrs.some((a) => a.parts.length > 0) || scales.every((v, g) => Math.abs(v - at[g]) < 0.15 * at[g])) break;
    }
    let ordered = true;
    for (let i = 1; i < centers.length; i++) {
      if (fanOrderKey(centers[i].x, centers[i].y) <= fanOrderKey(centers[i - 1].x, centers[i - 1].y)) ordered = false;
    }
    return { boxes: placed.flat(), ordered };
  };

  /** 묶음이 얼마나 퍼졌는지: 묶음의 크기에 소유자에서 속성까지의 평균 거리를 더한다(작을수록 좋다) */
  const topIds = new Set(attrs.map((a) => a.id));
  const spread = (boxes: Box[]): number => {
    const bb = boxesBounds(owner, boxes);
    let reach = 0;
    for (const box of boxes) if (topIds.has(box.id)) reach += Math.hypot(box.x + box.w / 2, box.y + box.h / 2);
    return Math.sqrt(bb.w * bb.h) + (reach / n) * 1.2;
  };

  const preferParam = toParam(prefer);
  if (depth > 0 || rays.length === 0) {
    // 하위 속성이나 연결이 없는 소유자: 자리가 넉넉한 첫 여백으로 한 번만 만든다
    let arcs: Arc[] = [{ start: 0, width: TAU }];
    const need = Math.min(n * STEP_MIN, TAU * 0.8);
    for (const margin of BLOCK_MARGINS) {
      arcs = arcsFor(margin);
      if (arcs.reduce((sum, a) => sum + a.width, 0) >= need) break;
    }
    const groups = chooseSlots(n, arcs, preferParam);
    const plain = build(groups, 0);
    if (depth > 0 || !groups.some((g) => g.length >= 4)) return plain.boxes;
    const staggered = build(groups, 0.55);
    return staggered.ordered && spread(staggered.boxes) < spread(plain.boxes) * 0.9 ? staggered.boxes : plain.boxes;
  }

  // 연결이 있는 소유자: 비우는 각도와 한 겹/두 겹을 바꿔 가며 만들어 보고 묶음이 가장 작은 것을 고른다.
  // 각도를 좁게 비울수록, 두 겹일수록 벌점을 줘서 차이가 뚜렷할 때만 고른다
  let best: Box[] | null = null;
  let bestScore = Infinity;
  BLOCK_MARGINS.forEach((margin, mi) => {
    const arcs = arcsFor(margin);
    const free = arcs.reduce((sum, a) => sum + a.width, 0);
    const last = mi === BLOCK_MARGINS.length - 1;
    if (free < n * 9 * DEG && !(last && best === null)) return;
    const groups = chooseSlots(n, arcs, preferParam);
    const variants = groups.some((g) => g.length >= 3) ? [0, 0.55, 1] : [0];
    for (const stagger of variants) {
      const built = build(groups, stagger);
      if (stagger > 0 && !built.ordered) continue;
      const score = spread(built.boxes) * (1 + MARGIN_PENALTY[mi]) * (stagger > 0 ? 1.06 : 1);
      if (score < bestScore - 1e-6) {
        bestScore = score;
        best = built.boxes;
      }
    }
  });
  return best ?? build(chooseSlots(n, [], preferParam), 0).boxes;
}

// ───────────────────────── 격자 배치 ─────────────────────────

interface Cell {
  c: number;
  r: number;
}

/** 좌표가 정해지기 전에 방향을 어림할 때 쓰는 칸 간격 */
const NOMINAL_X = 230;
const NOMINAL_Y = 170;
const VERTICAL_WEIGHT = 1.25;
const BLOCK_COST = 2.5;
const CROSS_COST = 2.5;

function cellKey(c: number, r: number): string {
  return `${c},${r}`;
}

/** a에서 b로 가는 선이 가까이 지나는 다른 칸의 수 */
function blockedCells(a: Cell, b: Cell, occupied: Cell[], skip: (i: number) => boolean): number {
  const dc = b.c - a.c;
  const dr = b.r - a.r;
  const len2 = dc * dc + dr * dr;
  if (len2 === 0) return 0;
  let count = 0;
  for (let i = 0; i < occupied.length; i++) {
    if (skip(i)) continue;
    const q = occupied[i];
    const t = ((q.c - a.c) * dc + (q.r - a.r) * dr) / len2;
    if (t <= 0.02 || t >= 0.98) continue;
    const px = a.c + dc * t - q.c;
    const py = a.r + dr * t - q.r;
    if (px * px + py * py < 0.45 * 0.45) count++;
  }
  return count;
}

function orient(a: Cell, b: Cell, c: Cell): number {
  return Math.sign((b.c - a.c) * (c.r - a.r) - (b.r - a.r) * (c.c - a.c));
}

function segmentsCross(a: Cell, b: Cell, c: Cell, d: Cell): boolean {
  return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
}

interface EntityLinks {
  /** 관계로 이어진 엔티티 쌍(a < b)과 무게 */
  pairs: Array<{ a: number; b: number; w: number }>;
  /** 특수화의 슈퍼타입과 서브타입 */
  specs: Array<{ parent: number; child: number }>;
}

/** 놓인 엔티티들의 배치 비용(작을수록 좋다). cells[i]가 null이면 아직 안 놓인 것 */
function placementCost(cells: Array<Cell | null>, links: EntityLinks): number {
  let cost = 0;
  const placed: Cell[] = [];
  const index: number[] = [];
  let minC = Infinity;
  let maxC = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;
  cells.forEach((cell, i) => {
    if (!cell) return;
    placed.push(cell);
    index.push(i);
    minC = Math.min(minC, cell.c);
    maxC = Math.max(maxC, cell.c);
    minR = Math.min(minR, cell.r);
    maxR = Math.max(maxR, cell.r);
  });
  if (placed.length === 0) return 0;

  const segments: Array<[number, number]> = [];
  for (const p of links.pairs) {
    const a = cells[p.a];
    const b = cells[p.b];
    if (!a || !b) continue;
    cost += p.w * Math.hypot((a.c - b.c) / 2, ((a.r - b.r) / 2) * VERTICAL_WEIGHT);
    cost += BLOCK_COST * blockedCells(a, b, placed, (i) => index[i] === p.a || index[i] === p.b);
    segments.push([p.a, p.b]);
  }
  for (const s of links.specs) {
    const parent = cells[s.parent];
    const child = cells[s.child];
    if (!parent || !child) continue;
    // 서브타입은 슈퍼타입보다 아래 행에 있어야 한다(원이 그 사이에 들어간다)
    if (child.r < parent.r + 2) cost += 1000 + 50 * (parent.r + 2 - child.r);
    cost += 1.2 * Math.hypot(((child.c - parent.c) / 2) * 0.8, ((child.r - parent.r - 2) / 2) * VERTICAL_WEIGHT * 1.5);
    cost += BLOCK_COST * blockedCells(parent, child, placed, (i) => index[i] === s.parent || index[i] === s.child);
    segments.push([s.parent, s.child]);
  }
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const [a, b] = segments[i];
      const [c, d] = segments[j];
      if (a === c || a === d || b === c || b === d) continue;
      if (segmentsCross(cells[a]!, cells[b]!, cells[c]!, cells[d]!)) cost += CROSS_COST;
    }
  }
  // 가로로 조금 긴 덩어리를 좋아하되 한 줄로 길게 늘어서지는 않게
  const w = (maxC - minC) / 2 + 1;
  const h = (maxR - minR) / 2 + 1;
  cost += 0.08 * w * w + 0.11 * h * h;
  return cost;
}

/** 엔티티 n개를 짝수 칸에 놓는다. 탐욕으로 하나씩 놓은 뒤 옮기기와 맞바꾸기로 다듬는다 */
function placeEntities(n: number, links: EntityLinks): Cell[] {
  const neighbors: Array<Set<number>> = Array.from({ length: n }, () => new Set<number>());
  for (const p of links.pairs) {
    neighbors[p.a].add(p.b);
    neighbors[p.b].add(p.a);
  }
  for (const s of links.specs) {
    neighbors[s.parent].add(s.child);
    neighbors[s.child].add(s.parent);
  }
  const cells: Array<Cell | null> = Array.from({ length: n }, () => null);
  const taken = new Set<string>();

  const candidates = (): Cell[] => {
    let minC = Infinity;
    let maxC = -Infinity;
    let minR = Infinity;
    let maxR = -Infinity;
    for (const cell of cells) {
      if (!cell) continue;
      minC = Math.min(minC, cell.c);
      maxC = Math.max(maxC, cell.c);
      minR = Math.min(minR, cell.r);
      maxR = Math.max(maxR, cell.r);
    }
    const out: Cell[] = [];
    // 비용이 같으면 오른쪽, 그다음 아래쪽을 먼저 고르게 큰 값부터 훑는다
    for (let c = maxC + 2; c >= minC - 2; c -= 2) {
      for (let r = maxR + 2; r >= minR - 2; r -= 2) {
        if (!taken.has(cellKey(c, r))) out.push({ c, r });
      }
    }
    return out;
  };

  let start = 0;
  for (let i = 1; i < n; i++) if (neighbors[i].size > neighbors[start].size) start = i;
  cells[start] = { c: 0, r: 0 };
  taken.add(cellKey(0, 0));
  for (let done = 1; done < n; done++) {
    let pick = -1;
    let pickPlaced = -1;
    for (let i = 0; i < n; i++) {
      if (cells[i]) continue;
      let placedNeighbors = 0;
      for (const j of neighbors[i]) if (cells[j]) placedNeighbors++;
      if (placedNeighbors > pickPlaced || (placedNeighbors === pickPlaced && neighbors[i].size > neighbors[pick].size)) {
        pick = i;
        pickPlaced = placedNeighbors;
      }
    }
    let bestCell: Cell | null = null;
    let bestCost = Infinity;
    for (const cand of candidates()) {
      cells[pick] = cand;
      const cost = placementCost(cells, links);
      if (cost < bestCost - 1e-9) {
        bestCost = cost;
        bestCell = cand;
      }
    }
    cells[pick] = bestCell!;
    taken.add(cellKey(bestCell!.c, bestCell!.r));
  }

  // 다듬기: 한 엔티티를 빈칸으로 옮기거나 다른 엔티티와 맞바꿔 비용이 줄면 받아들인다
  const segments = links.pairs.length + links.specs.length;
  let budget = Math.floor(2e7 / (segments * segments + segments * n + 1));
  let current = placementCost(cells, links);
  for (let sweep = 0; sweep < 12 && budget > 0; sweep++) {
    let improved = false;
    for (let i = 0; i < n && budget > 0; i++) {
      const from = cells[i]!;
      let best: { cost: number; cell: Cell; swap: number } | null = null;
      for (const cand of candidates()) {
        cells[i] = cand;
        const cost = placementCost(cells, links);
        budget--;
        if (cost < (best ? best.cost : current) - 1e-9) best = { cost, cell: cand, swap: -1 };
      }
      cells[i] = from;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const other = cells[j]!;
        cells[i] = other;
        cells[j] = from;
        const cost = placementCost(cells, links);
        budget--;
        if (cost < (best ? best.cost : current) - 1e-9) best = { cost, cell: other, swap: j };
        cells[i] = from;
        cells[j] = other;
      }
      if (!best) continue;
      taken.delete(cellKey(from.c, from.r));
      if (best.swap >= 0) cells[best.swap] = from;
      cells[i] = best.cell;
      taken.add(cellKey(best.cell.c, best.cell.r));
      if (best.swap >= 0) taken.add(cellKey(from.c, from.r));
      current = best.cost;
      improved = true;
    }
    if (!improved) break;
  }
  return cells as Cell[];
}

// ───────────────────────── 덩어리 하나 배치 ─────────────────────────

interface CellNode {
  id: string;
  kind: 'entity' | 'relationship' | 'spec';
  cell: Cell;
  attrs: LayoutAttr[];
}

/** 당겨 붙이기에 쓰는 도형 하나 */
interface PackItem {
  id: string;
  rect: Rect;
  col: number;
  row: number;
  owner: boolean;
}

function crossingsBetween(items: PackItem[], byId: Map<string, PackItem>, lines: Array<[string, string]>, moving: Set<string>): number {
  let count = 0;
  for (const [a, b] of lines) {
    const ia = byId.get(a);
    const ib = byId.get(b);
    if (!ia || !ib) continue;
    const ma = moving.has(a);
    const mb = moving.has(b);
    const p = centerOf(ia.rect);
    const q = centerOf(ib.rect);
    for (const item of items) {
      if (item.id === a || item.id === b) continue;
      // 선의 양 끝과 도형이 모두 같은 쪽이면 옮겨도 달라지지 않는다
      const mc = moving.has(item.id);
      if (ma === mb && mb === mc) continue;
      if (segmentIntersectsRect(p, q, core(item.rect))) count++;
    }
  }
  return count;
}

/**
 * 열(axis 'x') 또는 행(axis 'y') 경계마다, 그 뒤쪽 전체를 앞쪽으로 겹치지 않는 한도까지 당긴다.
 * 같은 열(행)의 도형은 함께 움직이므로 소유자들의 줄 맞춤은 그대로다.
 */
function compact(items: PackItem[], lines: Array<[string, string]>, axis: 'x' | 'y'): void {
  const byId = new Map(items.map((i) => [i.id, i]));
  const bandOf = (i: PackItem) => (axis === 'x' ? i.col : i.row);
  const bands = [...new Set(items.map(bandOf))].sort((a, b) => a - b);
  const start = (r: Rect) => (axis === 'x' ? r.x : r.y);
  const length = (r: Rect) => (axis === 'x' ? r.w : r.h);
  const crossStart = (r: Rect) => (axis === 'x' ? r.y : r.x);
  const crossLength = (r: Rect) => (axis === 'x' ? r.h : r.w);
  const checkLines = lines.length * items.length <= 400000;

  for (let k = 1; k < bands.length; k++) {
    const moving = items.filter((i) => bandOf(i) >= bands[k]);
    const still = items.filter((i) => bandOf(i) < bands[k]);
    let room = Infinity;
    for (const m of moving) {
      for (const s of still) {
        const owners = m.owner && s.owner;
        const side = owners ? (axis === 'x' ? 30 : 40) : ATTR_GAP;
        if (crossStart(m.rect) >= crossStart(s.rect) + crossLength(s.rect) + side) continue;
        if (crossStart(s.rect) >= crossStart(m.rect) + crossLength(m.rect) + side) continue;
        const gap = owners ? (axis === 'x' ? CELL_GAP_X : CELL_GAP_Y) : PACK_GAP;
        room = Math.min(room, start(m.rect) - (start(s.rect) + length(s.rect)) - gap);
      }
    }
    // 소유자의 열(행) 순서는 지킨다. 중심 사이가 원래의 45% 아래로 줄지 않게 해서 선의 방향이 크게 틀어지지 않게 한다
    const centers = (list: PackItem[], band: number) => list.filter((i) => i.owner && bandOf(i) === band).map((i) => start(i.rect) + length(i.rect) / 2);
    const here = centers(moving, bands[k]);
    const before = centers(still, bands[k - 1]);
    if (here.length > 0 && before.length > 0) {
      const dist = Math.min(...here) - Math.max(...before);
      room = Math.min(room, dist - Math.max(40, dist * 0.45));
    }
    if (!Number.isFinite(room) || room < 1) continue;
    const movingIds = new Set(moving.map((i) => i.id));
    const baseline = checkLines ? crossingsBetween(items, byId, lines, movingIds) : 0;
    for (const factor of [1, 0.75, 0.5, 0.25]) {
      const shift = Math.floor(room * factor);
      if (shift < 1) break;
      for (const m of moving) {
        if (axis === 'x') m.rect.x -= shift;
        else m.rect.y -= shift;
      }
      if (!checkLines || crossingsBetween(items, byId, lines, movingIds) <= baseline) break;
      for (const m of moving) {
        if (axis === 'x') m.rect.x += shift;
        else m.rect.y += shift;
      }
    }
  }
}

/**
 * 당겨 붙인 뒤에도 참여 엔티티에서 멀리 남은 관계를 엔티티들의 가운데 쪽으로 옮긴다(재귀 관계는 엔티티 쪽으로).
 * 관계와 그 속성을 한 덩어리로 옮기고, 다른 도형과 간격이 유지되고 선이 도형을 새로 지나지 않는 데까지만 간다.
 */
function settleRelationships(relationships: LayoutRelationship[], items: PackItem[], lines: Array<[string, string]>): void {
  const byId = new Map(items.map((i) => [i.id, i]));
  const checkLines = lines.length * items.length <= 400000;
  for (const rel of relationships) {
    const self = byId.get(rel.id);
    if (!self) continue;
    const ids = new Set<string>([rel.id]);
    const gather = (attrs: LayoutAttr[]) => {
      for (const a of attrs) {
        ids.add(a.id);
        gather(a.parts);
      }
    };
    gather(rel.attrs);
    const parts = [...new Set(rel.participants)].map((id) => byId.get(id)).filter((i): i is PackItem => !!i);
    if (parts.length === 0) continue;
    const cur = centerOf(self.rect);
    let target: Point;
    if (parts.length === 1) {
      const e = parts[0].rect;
      const ec = centerOf(e);
      const dx = cur.x - ec.x;
      const dy = cur.y - ec.y;
      if (Math.abs(dx) <= Math.abs(dy) * 0.2) target = { x: cur.x, y: ec.y + Math.sign(dy) * (e.h / 2 + CELL_GAP_Y + self.rect.h / 2) };
      else if (Math.abs(dy) <= Math.abs(dx) * 0.2) target = { x: ec.x + Math.sign(dx) * (e.w / 2 + CELL_GAP_X + self.rect.w / 2), y: cur.y };
      else continue;
    } else {
      const cs = parts.map((p) => centerOf(p.rect));
      target = { x: cs.reduce((sum, c) => sum + c.x, 0) / cs.length, y: cs.reduce((sum, c) => sum + c.y, 0) / cs.length };
    }
    const cluster = items.filter((i) => ids.has(i.id));
    const others = items.filter((i) => !ids.has(i.id));
    const fits = () => {
      for (const a of cluster) {
        for (const b of others) {
          const grown = a.owner && b.owner ? expand(a.rect, CELL_GAP_X, CELL_GAP_Y) : expand(a.rect, PACK_GAP);
          if (rectsIntersect(grown, b.rect)) return false;
        }
      }
      return true;
    };
    const baseline = checkLines ? crossingsBetween(items, byId, lines, ids) : 0;
    for (const t of [1, 0.875, 0.75, 0.625, 0.5, 0.375, 0.25, 0.125]) {
      const dx = Math.round((target.x - cur.x) * t);
      const dy = Math.round((target.y - cur.y) * t);
      if (dx === 0 && dy === 0) break;
      for (const c of cluster) {
        c.rect.x += dx;
        c.rect.y += dy;
      }
      if (fits() && (!checkLines || crossingsBetween(items, byId, lines, ids) <= baseline)) break;
      for (const c of cluster) {
        c.rect.x -= dx;
        c.rect.y -= dy;
      }
    }
  }
}

/** 선 하나보다 넓게 비워야 하는 연결 */
interface LinkExtras {
  /** 재귀 관계의 '관계 id|엔티티 id'. 두 번째 선이 꺾여서 양옆으로 돌아 들어간다 */
  recursive: Set<string>;
  /** 특수화 원 id → 서브타입 id들. 원에서 다른 서브타입으로 가는 선이 위를 지난다 */
  subtypesOf: Map<string, Set<string>>;
  subtypes: Set<string>;
}

function linkExtras(relationships: LayoutRelationship[], specs: LayoutSpec[]): LinkExtras {
  const recursive = new Set<string>();
  for (const rel of relationships) {
    const seen = new Set<string>();
    for (const id of rel.participants) {
      if (seen.has(id)) recursive.add(`${rel.id}|${id}`);
      seen.add(id);
    }
  }
  const subtypesOf = new Map<string, Set<string>>();
  const subtypes = new Set<string>();
  for (const spec of specs) {
    subtypesOf.set(spec.id, new Set(spec.children));
    for (const id of spec.children) subtypes.add(id);
  }
  return { recursive, subtypesOf, subtypes };
}

/**
 * 재귀 관계의 두 선이 지나는 점들. 화면은 한 선을 곧게, 다른 선을 옆으로 돌아가는 꺾은선으로 그리므로
 * 화면과 같은 계산(computeEdgeGeometry)으로 경로를 구해 30px마다 점을 찍는다.
 */
function recursivePath(relId: string, rel: Rect, entityId: string, entity: Rect): Point[] {
  const relNode: ErdNode = { id: relId, kind: 'relationship', text: '', ...rel };
  const entityNode: ErdNode = { id: entityId, kind: 'entity', text: '', ...entity };
  const edge: ErdEdge = { id: 'recursive', source: relId, target: entityId, double: false, label: '', role: '' };
  const out: Point[] = [];
  for (const index of [0, 1]) {
    const g = computeEdgeGeometry(edge, relNode, entityNode, index, 2, 2);
    const pts = g.points && g.points.length >= 2 ? g.points : [g.start, g.end];
    for (let i = 1; i < pts.length; i++) {
      const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      const steps = Math.max(1, Math.ceil(len / 30));
      for (let k = 0; k <= steps; k++) {
        out.push({ x: pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * k) / steps, y: pts[i - 1].y + ((pts[i].y - pts[i - 1].y) * k) / steps });
      }
    }
  }
  return out.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

/** 소유자(id)에서 연결된 도형들로 나가는 선. 속성은 이 선들을 피해 놓는다 */
function raysFrom(id: string, others: string[], rectOfId: (id: string) => Rect | undefined, extras: LinkExtras): Ray[] {
  const self = rectOfId(id);
  if (!self) return [];
  const at = centerOf(self);
  const dirs: number[] = [];
  const add = (dir: number) => {
    if (!dirs.some((d) => angleDistance(d, dir) < 6 * DEG)) dirs.push(dir);
  };
  for (const other of others) {
    const rect = rectOfId(other);
    if (!rect) continue;
    const o = centerOf(rect);
    if (o.x === at.x && o.y === at.y) continue;
    const dir = Math.atan2(o.y - at.y, o.x - at.x);
    add(dir);
    const asRelationship = extras.recursive.has(`${id}|${other}`);
    if (asRelationship || extras.recursive.has(`${other}|${id}`)) {
      const path = asRelationship ? recursivePath(id, self, other, rect) : recursivePath(other, rect, id, self);
      for (const p of path) {
        // 자기 도형 안이나 바로 옆의 점은 방향이 뜻이 없다
        if (Math.abs(p.x - at.x) <= self.w / 2 + 4 && Math.abs(p.y - at.y) <= self.h / 2 + 4) continue;
        add(Math.atan2(p.y - at.y, p.x - at.x));
      }
    } else if (extras.subtypesOf.get(other)?.has(id)) {
      add(dir - 50 * DEG);
      add(dir + 50 * DEG);
    }
  }
  return dirs.map((dir) => ({ x: 0, y: 0, dir }));
}

interface Component {
  entities: LayoutOwner[];
  relationships: LayoutRelationship[];
  specs: LayoutSpec[];
}

/** 연결된 덩어리 하나를 배치한다. 돌려주는 좌표는 덩어리의 왼쪽 위가 (0, 0)이다 */
function layoutComponent(comp: Component, sizes: Map<string, Size>): Map<string, Rect> {
  const entityIndex = new Map(comp.entities.map((e, i) => [e.id, i]));

  // 1. 엔티티 칸
  const pairWeight = new Map<string, { a: number; b: number; w: number }>();
  for (const rel of comp.relationships) {
    const ids = [...new Set(rel.participants)].map((id) => entityIndex.get(id)!).sort((x, y) => x - y);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]},${ids[j]}`;
        const entry = pairWeight.get(key);
        if (entry) entry.w += 0.5;
        else pairWeight.set(key, { a: ids[i], b: ids[j], w: 1 });
      }
    }
  }
  const specLinks: EntityLinks['specs'] = [];
  for (const spec of comp.specs) {
    for (const child of spec.children) specLinks.push({ parent: entityIndex.get(spec.parent)!, child: entityIndex.get(child)! });
  }
  const entityLinks: EntityLinks = { pairs: [...pairWeight.values()], specs: specLinks };
  const entityCells = comp.entities.length > 0 ? placeEntities(comp.entities.length, entityLinks) : [];
  // 서브타입은 되도록 모델에 적힌 순서대로 왼쪽부터 놓는다(자리만 서로 바꾸고, 비용이 늘면 그만둔다)
  for (const spec of comp.specs) {
    const children = spec.children.map((id) => entityIndex.get(id)!);
    const sorted = children.map((i) => entityCells[i]).sort((a, b) => a.r - b.r || a.c - b.c);
    if (children.every((i, k) => entityCells[i] === sorted[k])) continue;
    const before = placementCost(entityCells, entityLinks);
    const saved = children.map((i) => entityCells[i]);
    children.forEach((i, k) => (entityCells[i] = sorted[k]));
    if (placementCost(entityCells, entityLinks) > before + 1e-9) children.forEach((i, k) => (entityCells[i] = saved[k]));
  }

  const nodes: CellNode[] = comp.entities.map((e, i) => ({ id: e.id, kind: 'entity', cell: entityCells[i], attrs: e.attrs }));
  const taken = new Set(nodes.map((n) => cellKey(n.cell.c, n.cell.r)));
  const cellOf = new Map(nodes.map((n) => [n.id, n.cell]));
  const occupied: Cell[] = nodes.map((n) => n.cell);
  /** 엔티티 id → 그 엔티티에 이어진 관계와 특수화 원이 놓인 칸 */
  const linkedCells = new Map<string, Cell[]>();
  const take = (id: string, kind: CellNode['kind'], cell: Cell, attrs: LayoutAttr[], entities: string[] = []) => {
    for (const e of new Set(entities)) linkedCells.set(e, [...(linkedCells.get(e) ?? []), cell]);
    nodes.push({ id, kind, cell, attrs });
    taken.add(cellKey(cell.c, cell.r));
    cellOf.set(id, cell);
    occupied.push(cell);
  };

  // 2. 특수화 원: 슈퍼타입 바로 아래 칸. 차 있으면 그 옆
  for (const spec of comp.specs) {
    const p = cellOf.get(spec.parent)!;
    const options: Cell[] = [];
    for (const dc of [0, -1, 1, -2, 2, -3, 3]) options.push({ c: p.c + dc, r: p.r + 1 });
    const cell = options.find((o) => !taken.has(cellKey(o.c, o.r))) ?? { c: p.c, r: p.r + 1 };
    take(spec.id, 'spec', cell, [], [spec.parent, ...spec.children]);
  }

  // 3. 관계: 참여 엔티티들의 가운데에 가장 가까운 빈칸. 가까운 쌍부터 자리를 잡는다
  const spanOf = (rel: LayoutRelationship) => {
    const cells = [...new Set(rel.participants)].map((id) => cellOf.get(id)!);
    let span = 0;
    for (const a of cells) for (const b of cells) span = Math.max(span, Math.hypot(a.c - b.c, a.r - b.r));
    return span;
  };
  // 재귀 관계는 어느 옆자리든 괜찮으므로 맨 나중에 놓는다(두 엔티티 사이의 가운데 칸을 먼저 차지하지 않게)
  // 같은 엔티티들 사이의 두 번째 관계도 위아래 어느 칸이든 되므로 뒤로 미룬다
  const seenSets = new Set<string>();
  const ordered = comp.relationships
    .map((rel, i) => {
      const distinct = [...new Set(rel.participants)].sort();
      const key = distinct.join('|');
      const repeat = seenSets.has(key);
      seenSets.add(key);
      return { rel, i, late: distinct.length === 1 ? 2 : repeat ? 1 : 0, span: spanOf(rel) };
    })
    .sort((x, y) => x.late - y.late || x.span - y.span || x.i - y.i);
  for (const { rel } of ordered) {
    const parts = [...new Set(rel.participants)].map((id) => cellOf.get(id)!);
    let cell: Cell | null = null;
    if (parts.length === 0) {
      cell = { c: 0, r: 0 };
    } else if (parts.length === 1) {
      // 재귀 관계: 엔티티 옆. 두 번째 선이 옆으로 돌아 들어가므로, 놓고 나서도 엔티티 둘레에
      // 속성을 놓을 빈 방향이 가장 넓게 남는 쪽을 고른다(같으면 위, 아래, 왼쪽, 오른쪽 순)
      const p = parts[0];
      const entityId = rel.participants[0];
      const nominalRect = (id: string, at: Cell): Rect => {
        const size = sizeOf(sizes, id);
        return { x: at.c * NOMINAL_X - size.w / 2, y: at.r * NOMINAL_Y - size.h / 2, w: size.w, h: size.h };
      };
      const entityRect = nominalRect(entityId, p);
      const ec = centerOf(entityRect);
      const linkedDirs = (linkedCells.get(entityId) ?? []).map((q) => Math.atan2((q.r - p.r) * NOMINAL_Y, (q.c - p.c) * NOMINAL_X));
      let widest = -1;
      for (const cand of [
        { c: p.c, r: p.r - 1 },
        { c: p.c, r: p.r + 1 },
        { c: p.c - 1, r: p.r },
        { c: p.c + 1, r: p.r },
      ]) {
        if (taken.has(cellKey(cand.c, cand.r))) continue;
        const pathDirs: number[] = [];
        for (const q of recursivePath(rel.id, nominalRect(rel.id, cand), entityId, entityRect)) {
          if (Math.abs(q.x - ec.x) <= entityRect.w / 2 + 4 && Math.abs(q.y - ec.y) <= entityRect.h / 2 + 4) continue;
          pathDirs.push(Math.atan2(q.y - ec.y, q.x - ec.x));
        }
        const widestGap = (dirs: number[]): { gap: number; after: number } => {
          const sorted = dirs.map(mod).sort((a, b) => a - b);
          let gap = 0;
          let after = 0;
          sorted.forEach((d, i) => {
            const g = i + 1 < sorted.length ? sorted[i + 1] - d : sorted[0] + TAU - d;
            if (g > gap) {
              gap = g;
              after = d;
            }
          });
          return { gap, after };
        };
        let { gap } = widestGap([...linkedDirs, ...pathDirs]);
        // 꺾은선이 쓸고 가는 방향 안에 다른 연결이 있으면 선끼리 엇갈린다
        if (pathDirs.length > 1) {
          const sweep = widestGap(pathDirs);
          const from = sweep.after + sweep.gap;
          const width = TAU - sweep.gap;
          for (const d of linkedDirs) if (mod(d - from) > 3 * DEG && mod(d - from) < width - 3 * DEG) gap -= 30 * DEG;
        }
        if (gap > widest + 1e-9) {
          widest = gap;
          cell = cand;
        }
      }
      for (let ring = 1; ring < 8 && !cell; ring++) {
        const around: Cell[] = [
          { c: p.c, r: p.r - ring },
          { c: p.c, r: p.r + ring },
          { c: p.c - ring, r: p.r },
          { c: p.c + ring, r: p.r },
          { c: p.c - ring, r: p.r - ring },
          { c: p.c + ring, r: p.r - ring },
          { c: p.c - ring, r: p.r + ring },
          { c: p.c + ring, r: p.r + ring },
        ];
        cell = around.find((o) => !taken.has(cellKey(o.c, o.r))) ?? null;
      }
      cell = cell ?? { c: p.c, r: p.r - 8 };
    } else {
      const minC = Math.min(...parts.map((p) => p.c));
      const maxC = Math.max(...parts.map((p) => p.c));
      const minR = Math.min(...parts.map((p) => p.r));
      const maxR = Math.max(...parts.map((p) => p.r));
      let bestCost = Infinity;
      for (let grow = 1; grow <= 6 && !cell; grow++) {
        for (let r = minR - grow; r <= maxR + grow; r++) {
          for (let c = minC - grow; c <= maxC + grow; c++) {
            if (taken.has(cellKey(c, r))) continue;
            const cand = { c, r };
            let cost = 0;
            for (const p of parts) {
              cost += Math.hypot(c - p.c, (r - p.r) * VERTICAL_WEIGHT);
              cost += 3 * blockedCells(cand, p, occupied, (i) => occupied[i] === p);
            }
            // 비용이 같으면 위쪽, 그다음 왼쪽
            if (cost < bestCost - 1e-9) {
              bestCost = cost;
              cell = cand;
            }
          }
        }
      }
      cell = cell ?? { c: maxC + 7, r: minR };
    }
    take(rel.id, 'relationship', cell, rel.attrs, rel.participants);
  }

  // 소유자 수준의 연결(속성을 비워 둘 방향과 선 검사에 쓴다)
  const ownerLinks: Array<[string, string]> = [];
  for (const rel of comp.relationships) for (const id of new Set(rel.participants)) ownerLinks.push([rel.id, id]);
  for (const spec of comp.specs) for (const id of new Set([spec.parent, ...spec.children])) ownerLinks.push([spec.id, id]);
  const linked = new Map<string, string[]>();
  for (const [a, b] of ownerLinks) {
    linked.set(a, [...(linked.get(a) ?? []), b]);
    linked.set(b, [...(linked.get(b) ?? []), a]);
  }
  const extras = linkExtras(comp.relationships, comp.specs);

  // 4. 속성 부채꼴과 좌표. 처음에는 칸 간격을 어림해 방향을 정하고, 한 번 더 실제 좌표로 다시 한다
  const assemble = (centers: Map<string, Point>): { rects: Map<string, Rect>; centers: Map<string, Point> } => {
    const fans = new Map<string, Box[]>();
    const extents = new Map<string, { l: number; r: number; t: number; b: number }>();
    const rectAround = (id: string): Rect | undefined => {
      const c = centers.get(id);
      if (!c) return undefined;
      const size = sizeOf(sizes, id);
      return { x: c.x - size.w / 2, y: c.y - size.h / 2, w: size.w, h: size.h };
    };
    for (const node of nodes) {
      const size = sizeOf(sizes, node.id);
      const rays = raysFrom(node.id, linked.get(node.id) ?? [], rectAround, extras);
      const boxes = fanCluster(size, node.attrs, sizes, rays, extras.subtypes.has(node.id) ? DOWN : UP, 0);
      fans.set(node.id, boxes);
      const b = boxesBounds(size, boxes);
      extents.set(node.id, { l: -b.x, r: b.x + b.w, t: -b.y, b: b.y + b.h });
    }
    const axis = (pick: (n: CellNode) => number, before: (id: string) => number, after: (id: string) => number, gap: number): Map<number, number> => {
      const bands = [...new Set(nodes.map(pick))].sort((a, b) => a - b);
      const pos = new Map<number, number>();
      let cursor = 0;
      bands.forEach((band, i) => {
        const inBand = nodes.filter((n) => pick(n) === band);
        const lead = Math.max(...inBand.map((n) => before(n.id)));
        const trail = Math.max(...inBand.map((n) => after(n.id)));
        const center = i === 0 ? lead : cursor + gap + lead;
        pos.set(band, center);
        cursor = center + trail;
      });
      return pos;
    };
    const xs = axis((n) => n.cell.c, (id) => extents.get(id)!.l, (id) => extents.get(id)!.r, CELL_GAP_X);
    const ys = axis((n) => n.cell.r, (id) => extents.get(id)!.t, (id) => extents.get(id)!.b, CELL_GAP_Y);
    const rects = new Map<string, Rect>();
    const out = new Map<string, Point>();
    for (const node of nodes) {
      const size = sizeOf(sizes, node.id);
      const x = Math.round(xs.get(node.cell.c)! - size.w / 2);
      const y = Math.round(ys.get(node.cell.r)! - size.h / 2);
      rects.set(node.id, { x, y, w: size.w, h: size.h });
      const cx = x + size.w / 2;
      const cy = y + size.h / 2;
      out.set(node.id, { x: cx, y: cy });
      for (const box of fans.get(node.id)!) rects.set(box.id, { x: Math.round(cx + box.x), y: Math.round(cy + box.y), w: box.w, h: box.h });
    }
    return { rects, centers: out };
  };
  const nominal = new Map(nodes.map((n) => [n.id, { x: n.cell.c * NOMINAL_X, y: n.cell.r * NOMINAL_Y }]));
  const first = assemble(nominal);
  const { rects } = assemble(first.centers);

  // 5. 당겨 붙이기
  const items: PackItem[] = [];
  const lines: Array<[string, string]> = [...ownerLinks];
  const addAttrs = (parentId: string, attrs: LayoutAttr[], col: number, row: number) => {
    for (const a of attrs) {
      items.push({ id: a.id, rect: rects.get(a.id)!, col, row, owner: false });
      lines.push([parentId, a.id]);
      addAttrs(a.id, a.parts, col, row);
    }
  };
  for (const node of nodes) {
    items.push({ id: node.id, rect: rects.get(node.id)!, col: node.cell.c, row: node.cell.r, owner: true });
    addAttrs(node.id, node.attrs, node.cell.c, node.cell.r);
  }
  compact(items, lines, 'x');
  compact(items, lines, 'y');
  settleRelationships(comp.relationships, items, lines);

  // 6. 옮기는 동안 선의 방향이 달라져 선이 속성을 지나게 된 소유자는, 마지막 좌표로 부채꼴을 다시 만들어 본다
  const itemById = new Map(items.map((i) => [i.id, i]));
  for (const node of nodes) {
    if (node.attrs.length === 0) continue;
    const ids = new Set<string>();
    const gather = (attrs: LayoutAttr[]) => {
      for (const a of attrs) {
        ids.add(a.id);
        gather(a.parts);
      }
    };
    gather(node.attrs);
    const baseline = crossingsBetween(items, itemById, lines, ids);
    if (baseline === 0) continue;
    const self = itemById.get(node.id)!;
    const at = centerOf(self.rect);
    const rays = raysFrom(node.id, linked.get(node.id) ?? [], (id) => itemById.get(id)?.rect, extras);
    const boxes = fanCluster(sizeOf(sizes, node.id), node.attrs, sizes, rays, extras.subtypes.has(node.id) ? DOWN : UP, 0);
    const saved = new Map<string, Rect>();
    for (const box of boxes) {
      const item = itemById.get(box.id)!;
      saved.set(box.id, item.rect);
      item.rect = { x: Math.round(at.x + box.x), y: Math.round(at.y + box.y), w: box.w, h: box.h };
    }
    const others = items.filter((i) => !ids.has(i.id) && i.id !== node.id);
    const fits = boxes.every((box) => {
      const grown = expand(itemById.get(box.id)!.rect, PACK_GAP);
      return !others.some((o) => rectsIntersect(grown, o.rect));
    });
    if (!fits || crossingsBetween(items, itemById, lines, ids) >= baseline) {
      for (const [id, rect] of saved) itemById.get(id)!.rect = rect;
    }
  }

  const bounds = unionBounds(items.map((i) => i.rect))!;
  const out = new Map<string, Rect>();
  for (const item of items) out.set(item.id, { x: item.rect.x - bounds.x, y: item.rect.y - bounds.y, w: item.rect.w, h: item.rect.h });
  return out;
}

// ───────────────────────── 전체 배치 ─────────────────────────

function splitComponents(graph: LayoutGraph): Component[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const e of graph.entities) parent.set(e.id, e.id);
  for (const rel of graph.relationships) {
    parent.set(rel.id, rel.id);
    for (const id of rel.participants) if (parent.has(id)) union(rel.id, id);
  }
  for (const spec of graph.specs) {
    parent.set(spec.id, spec.id);
    for (const id of [spec.parent, ...spec.children]) if (parent.has(id)) union(spec.id, id);
  }
  const comps = new Map<string, Component>();
  const compOf = (id: string): Component => {
    const root = find(id);
    let comp = comps.get(root);
    if (!comp) {
      comp = { entities: [], relationships: [], specs: [] };
      comps.set(root, comp);
    }
    return comp;
  };
  // 모델 순서대로 훑어서 덩어리의 순서도 모델 순서를 따른다
  for (const e of graph.entities) compOf(e.id).entities.push(e);
  for (const rel of graph.relationships) compOf(rel.id).relationships.push(rel);
  for (const spec of graph.specs) compOf(spec.id).specs.push(spec);
  return [...comps.values()];
}

/**
 * 그림 전체를 새로 배치한다. obstacles(건드리지 않는 도형)와는 겹치지 않게 놓는다.
 * origin을 주면 그 점을 왼쪽 위로 삼는다(다시 배치할 때 원래 있던 자리).
 */
export function layoutFull(graph: LayoutGraph, obstacles: Rect[] = [], origin?: Point): Positions {
  const boxes: Array<{ rects: Map<string, Rect>; w: number; h: number; note: boolean }> = [];
  for (const comp of splitComponents(graph)) {
    const rects = layoutComponent(comp, graph.sizes);
    const b = unionBounds([...rects.values()]);
    if (b) boxes.push({ rects, w: b.w, h: b.h, note: false });
  }
  // 큰 덩어리부터 놓는다(크기가 같으면 모델 순서)
  const order = boxes.map((b, i) => ({ b, i })).sort((p, q) => q.b.w * q.b.h - p.b.w * p.b.h || p.i - q.i).map((p) => p.b);
  for (const id of graph.notes) {
    const s = sizeOf(graph.sizes, id);
    order.push({ rects: new Map([[id, { x: 0, y: 0, w: s.w, h: s.h }]]), w: s.w, h: s.h, note: true });
  }

  // 쌓는 방법을 몇 가지 해 보고, 16:10 화면에 가장 크게 들어가는 것을 고른다
  type Spot = { x: number; y: number };
  const shelves = (limit: number): Spot[] => {
    const spots: Spot[] = [];
    let x = 0;
    let y = 0;
    let shelf = 0;
    for (const box of order) {
      const gap = box.note ? NOTE_GAP : BOX_GAP;
      if (x > 0 && x + gap + box.w > limit) {
        x = 0;
        y += shelf + gap;
        shelf = 0;
      }
      const left = x > 0 ? x + gap : 0;
      spots.push({ x: left, y });
      x = left + box.w;
      shelf = Math.max(shelf, box.h);
    }
    return spots;
  };
  /** 가장 큰 덩어리를 왼쪽에 두고 나머지를 그 오른쪽에 세로로 쌓는다 */
  const beside = (): Spot[] => {
    const spots: Spot[] = [{ x: 0, y: 0 }];
    const height = Math.max(...order.map((b) => b.h));
    let x = order[0].w + BOX_GAP;
    let y = 0;
    let column = 0;
    for (const box of order.slice(1)) {
      const gap = box.note ? NOTE_GAP : BOX_GAP;
      if (y > 0 && y + gap + box.h > height) {
        x += column + BOX_GAP;
        y = 0;
        column = 0;
      }
      const top = y > 0 ? y + gap : 0;
      spots.push({ x, y: top });
      y = top + box.h;
      column = Math.max(column, box.w);
    }
    return spots;
  };
  const placed = new Map<string, Rect>();
  if (order.length > 0) {
    const widest = Math.max(...order.map((b) => b.w));
    const total = order.reduce((sum, b) => sum + b.w + BOX_GAP, 0);
    const options = [...[1, 1.3, 1.7, 2.2, 3].map((k) => shelves(widest * k)), shelves(total), beside()];
    let best = options[0];
    let bestScore = Infinity;
    for (const spots of options) {
      let w = 0;
      let h = 0;
      spots.forEach((p, i) => {
        w = Math.max(w, p.x + order[i].w);
        h = Math.max(h, p.y + order[i].h);
      });
      const score = Math.max(w / 1.6, h) + (w * h) / 1e7;
      if (score < bestScore - 1e-9) {
        bestScore = score;
        best = spots;
      }
    }
    order.forEach((box, i) => {
      for (const [id, r] of box.rects) placed.set(id, { x: best[i].x + r.x, y: best[i].y + r.y, w: r.w, h: r.h });
    });
  }

  const out: Positions = new Map();
  const bounds = unionBounds([...placed.values()]);
  if (!bounds) return out;
  let at = origin ?? ORIGIN;
  const hits = (p: Point) => {
    const area2 = expand({ x: p.x, y: p.y, w: bounds.w, h: bounds.h }, BOX_GAP / 2);
    return obstacles.some((o) => rectsIntersect(area2, o));
  };
  if (obstacles.length > 0 && hits(at)) {
    const ob = unionBounds(obstacles)!;
    at = { x: ob.x + ob.w + BOX_GAP, y: ob.y };
  }
  for (const [id, r] of placed) out.set(id, { x: Math.round(at.x + r.x - bounds.x), y: Math.round(at.y + r.y - bounds.y) });
  return out;
}

// ───────────────────────── 부분 배치 ─────────────────────────

interface Occupant {
  id: string | null;
  rect: Rect;
}

class World {
  readonly occupants: Occupant[] = [];
  readonly rects = new Map<string, Rect>();
  /** 그림의 모든 선(양 끝 도형의 id). 양 끝이 다 놓인 선만 본다 */
  lines: Array<[string, string]> = [];

  /** 이미 그어진 선이 이 사각형 위를 지나는지 */
  onLine(rect: Rect): boolean {
    const grown = expand(rect, 4);
    for (const [a, b] of this.lines) {
      const ra = this.rects.get(a);
      const rb = this.rects.get(b);
      if (ra && rb && segmentIntersectsRect(centerOf(ra), centerOf(rb), grown)) return true;
    }
    return false;
  }

  add(id: string | null, rect: Rect): void {
    this.occupants.push({ id, rect });
    if (id !== null) this.rects.set(id, rect);
  }
  bounds(): Rect | null {
    return unionBounds(this.occupants.map((o) => o.rect));
  }
  free(rect: Rect, gap: number): boolean {
    const grown = expand(rect, gap);
    return !this.occupants.some((o) => rectsIntersect(grown, o.rect));
  }
  /** p에서 q로 가는 선이 지나는 도형 수(ignore에 든 id는 뺀다) */
  crossed(p: Point, q: Point, ignore: ReadonlySet<string>): number {
    let count = 0;
    for (const o of this.occupants) {
      if (o.id !== null && ignore.has(o.id)) continue;
      if (segmentIntersectsRect(p, q, core(o.rect))) count++;
    }
    return count;
  }
}

/**
 * 새 도형만 배치한다. placed는 자리가 정해진 관리 대상 도형, obstacles는 그 밖의 도형.
 * 돌려주는 값에는 새로 놓은 도형만 들어 있다.
 */
export function layoutIncremental(graph: LayoutGraph, placed: Map<string, Rect>, obstacles: Rect[] = []): Positions {
  const out: Positions = new Map();
  const world = new World();
  for (const [id, rect] of placed) world.add(id, rect);
  for (const rect of obstacles) world.add(null, rect);
  const sizes = graph.sizes;
  const has = (id: string) => world.rects.has(id);
  const centerOfId = (id: string) => centerOf(world.rects.get(id)!);
  const put = (id: string, center: Point) => {
    const s = sizeOf(sizes, id);
    const rect = { x: Math.round(center.x - s.w / 2), y: Math.round(center.y - s.h / 2), w: s.w, h: s.h };
    world.add(id, rect);
    out.set(id, { x: rect.x, y: rect.y });
  };

  /** 그림 전체의 오른쪽 빈 곳(관련된 것이 없는 새 도형이 가는 자리) */
  const besideDiagram = (bounds: Rect): Point => {
    const b = world.bounds();
    return b ? { x: b.x + b.w + BOX_GAP - bounds.x, y: b.y - bounds.y } : { x: ORIGIN.x - bounds.x, y: ORIGIN.y - bounds.y };
  };

  // 소유자에서 다른 소유자로 나가는 연결
  const linked = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    linked.set(a, [...(linked.get(a) ?? []), b]);
    linked.set(b, [...(linked.get(b) ?? []), a]);
  };
  for (const rel of graph.relationships) for (const id of new Set(rel.participants)) link(rel.id, id);
  for (const spec of graph.specs) for (const id of new Set([spec.parent, ...spec.children])) link(spec.id, id);
  const extras = linkExtras(graph.relationships, graph.specs);
  {
    const lines: Array<[string, string]> = [];
    const attrLines = (parentId: string, attrs: LayoutAttr[]) => {
      for (const a of attrs) {
        lines.push([parentId, a.id]);
        attrLines(a.id, a.parts);
      }
    };
    for (const owner of [...graph.entities, ...graph.relationships]) attrLines(owner.id, owner.attrs);
    for (const rel of graph.relationships) for (const id of new Set(rel.participants)) lines.push([rel.id, id]);
    for (const spec of graph.specs) for (const id of new Set([spec.parent, ...spec.children])) lines.push([spec.id, id]);
    world.lines = lines;
  }
  const directionsFrom = (at: Point, ids: string[]): number[] => {
    const dirs: number[] = [];
    for (const id of ids) {
      if (!has(id)) continue;
      const c = centerOfId(id);
      if (c.x !== at.x || c.y !== at.y) dirs.push(Math.atan2(c.y - at.y, c.x - at.x));
    }
    return dirs;
  };
  const raysAt = (at: Point, id: string, ids: string[]): Ray[] => {
    const s = sizeOf(sizes, id);
    const self = { x: at.x - s.w / 2, y: at.y - s.h / 2, w: s.w, h: s.h };
    return raysFrom(id, ids, (other) => (other === id ? self : world.rects.get(other)), extras);
  };

  // 0. 이미 있는 소유자(와 속성)에 새로 붙는 속성: 둘레의 고리를 안쪽부터 돌며 첫 빈자리에 놓는다
  const ringPlace = (id: string, parentId: string, blocked: number[], prefer: number) => {
    const parent = world.rects.get(parentId)!;
    const pc = centerOf(parent);
    const s = sizeOf(sizes, id);
    const rx = parent.w / 2 + s.w / 2 + OWNER_GAP;
    const ry = parent.h / 2 + s.h / 2 + OWNER_GAP;
    const toDir = (t: number) => Math.atan2(ry * Math.sin(t), rx * Math.cos(t));
    const angles = Array.from({ length: 24 }, (_, i) => prefer + (i * TAU) / 24)
      .map((t) => {
        const dir = toDir(t);
        const clearance = blocked.length > 0 ? Math.min(...blocked.map((b) => angleDistance(b, dir))) : Math.PI;
        return { t, open: clearance >= 35 * DEG ? 0 : 1, away: angleDistance(t, prefer) };
      })
      .sort((a, b) => a.open - b.open || a.away - b.away || a.t - b.t);
    const ignore = new Set([parentId]);
    for (const scale of [1, 1.3, 1.65, 2.05, 2.5, 3.1, 3.8, 4.8, 6]) {
      for (const { t } of angles) {
        const c = { x: Math.round(pc.x + rx * scale * Math.cos(t)), y: Math.round(pc.y + ry * scale * Math.sin(t)) };
        const rect = { x: c.x - s.w / 2, y: c.y - s.h / 2, w: s.w, h: s.h };
        if (!world.free(rect, ATTR_GAP - 2) || world.onLine(rect)) continue;
        if (world.crossed(pc, c, ignore) > 0) continue;
        put(id, c);
        return;
      }
    }
    const b = world.bounds()!;
    put(id, { x: b.x + b.w + BOX_GAP + s.w / 2, y: b.y + s.h / 2 });
  };
  const placeNewAttrs = (parentId: string, attrs: LayoutAttr[], blocked: number[], prefer: number) => {
    for (const a of attrs) {
      if (!has(a.id)) ringPlace(a.id, parentId, blocked, prefer);
      const pc = centerOfId(parentId);
      const ac = centerOfId(a.id);
      const outward = Math.atan2(ac.y - pc.y, ac.x - pc.x);
      placeNewAttrs(a.id, a.parts, [outward + Math.PI], outward);
    }
  };
  const existingOwners: LayoutOwner[] = [...graph.entities, ...graph.relationships].filter((o) => has(o.id));
  for (const owner of existingOwners) {
    placeNewAttrs(owner.id, owner.attrs, directionsFrom(centerOfId(owner.id), linked.get(owner.id) ?? []), UP);
  }

  /** 묶음(소유자와 속성)을 center에 놓았을 때의 상자들 */
  const clusterAt = (id: string, boxes: Box[], center: Point): Array<{ id: string; rect: Rect }> => {
    const s = sizeOf(sizes, id);
    return [
      { id, rect: { x: center.x - s.w / 2, y: center.y - s.h / 2, w: s.w, h: s.h } },
      ...boxes.map((b) => ({ id: b.id, rect: { x: center.x + b.x, y: center.y + b.y, w: b.w, h: b.h } })),
    ];
  };
  const clusterFree = (cluster: Array<{ rect: Rect }>, gap: number) => cluster.every((c, i) => world.free(c.rect, i === 0 ? gap + 14 : gap) && !world.onLine(c.rect));
  const commit = (cluster: Array<{ id: string; rect: Rect }>) => {
    for (const c of cluster) put(c.id, centerOf(c.rect));
  };

  /**
   * target 둘레에서 묶음이 들어갈 자리 중 비용이 가장 작은 곳. 없으면 null.
   * cost는 중심 좌표를 받아 비용을 돌려주고, 놓을 수 없는 자리면 Infinity를 돌려준다.
   */
  const search = (id: string, boxes: Box[], target: Point, reachX: number, reachY: number, step: number, cost: (p: Point) => number): Point | null => {
    let best: Point | null = null;
    let bestCost = Infinity;
    for (let dy = -reachY; dy <= reachY; dy += step) {
      for (let dx = -reachX; dx <= reachX; dx += step) {
        const p = { x: Math.round(target.x + dx), y: Math.round(target.y + dy) };
        const value = cost(p);
        if (!(value < bestCost - 1e-9)) continue;
        if (!clusterFree(clusterAt(id, boxes, p), 22)) continue;
        best = p;
        bestCost = value;
      }
    }
    return best;
  };

  // 1. 새 특수화 원: 슈퍼타입 아래. 슈퍼타입이 놓이는 대로 원부터 놓아야 서브타입이 원 아래로 갈 수 있다
  const placeCircle = (spec: LayoutSpec) => {
    const s = sizeOf(sizes, spec.id);
    const parent = world.rects.get(spec.parent)!;
    const pc = centerOf(parent);
    const children = spec.children.filter(has).map(centerOfId);
    const ideal = { x: pc.x, y: parent.y + parent.h + 50 + s.h / 2 };
    const ignore = new Set([spec.id, spec.parent, ...spec.children]);
    // 슈퍼타입의 속성들이 차지한 범위. 원이 그 한가운데 들어가면 서브타입으로 가는 선이 속성 사이를 헤집는다
    const fan: Rect[] = [];
    const gather = (attrs: LayoutAttr[]) => {
      for (const a of attrs) {
        const r = world.rects.get(a.id);
        if (r) fan.push(r);
        gather(a.parts);
      }
    };
    gather(graph.entities.find((e) => e.id === spec.parent)?.attrs ?? []);
    const fanBounds = unionBounds(fan);
    const crowded = fanBounds ? expand(fanBounds, 10) : null;
    // 슈퍼타입 아래가 속성으로 차 있으면 그 아래까지 내려가 찾는다
    const spot = search(spec.id, [], { x: ideal.x, y: ideal.y + 290 }, 420, 320, 10, (p) => {
      if (p.y < parent.y + parent.h + 24 + s.h / 2) return Infinity;
      // 서브타입보다 위에 있어야 한다
      if (children.some((c) => c.y <= p.y + s.h)) return Infinity;
      let value = Math.hypot(p.x - ideal.x, (p.y - ideal.y) * 1.2);
      if (crowded && p.x > crowded.x && p.x < crowded.x + crowded.w && p.y > crowded.y && p.y < crowded.y + crowded.h) value += 500;
      value += 200 * world.crossed(p, pc, ignore);
      for (const c of children) value += 100 * world.crossed(p, c, ignore);
      return value;
    });
    put(spec.id, spot ?? ideal);
  };
  const placeReadyCircles = () => {
    for (const spec of graph.specs) if (!has(spec.id) && has(spec.parent)) placeCircle(spec);
  };
  placeReadyCircles();

  // 2. 새 엔티티: 관련된 엔티티가 많이 놓인 것부터
  const related = new Map<string, Set<string>>();
  const relate = (map: Map<string, Set<string>>, a: string, b: string) => {
    if (a === b) return;
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(b);
  };
  /** 관계로 이어진 엔티티(사이에 마름모가 들어간다) */
  const viaRelationship = new Map<string, Set<string>>();
  for (const rel of graph.relationships) {
    for (const a of rel.participants) {
      for (const b of rel.participants) {
        relate(related, a, b);
        relate(viaRelationship, a, b);
      }
    }
  }
  for (const spec of graph.specs) {
    for (const child of spec.children) {
      relate(related, spec.parent, child);
      relate(related, child, spec.parent);
    }
  }
  const relationshipSize = { w: 180, h: 110 };
  const pending = graph.entities.filter((e) => !has(e.id));
  while (pending.length > 0) {
    let pick = 0;
    let pickCount = -1;
    pending.forEach((e, i) => {
      let count = 0;
      for (const other of related.get(e.id) ?? []) if (has(other)) count++;
      if (count > pickCount) {
        pick = i;
        pickCount = count;
      }
    });
    const entity = pending.splice(pick, 1)[0];
    const size = sizeOf(sizes, entity.id);
    const anchors = [...(viaRelationship.get(entity.id) ?? [])].filter(has);
    // 서브타입이면 원 아래로, 슈퍼타입이면 이미 놓인 서브타입들 위로
    const below: Array<{ x: number; y: number; minY: number; circle: string | null }> = [];
    const above: Array<{ x: number; maxY: number }> = [];
    for (const spec of graph.specs) {
      if (spec.children.includes(entity.id) && has(spec.parent)) {
        const parent = world.rects.get(spec.parent)!;
        const circle = world.rects.get(spec.id);
        const from = circle ? centerOf(circle) : { x: parent.x + parent.w / 2, y: parent.y + parent.h + 67 };
        below.push({ x: from.x, y: from.y, minY: from.y + 17 + 40 + size.h / 2, circle: circle ? spec.id : null });
      }
      if (spec.parent === entity.id) {
        const kids = spec.children.filter(has).map((id) => world.rects.get(id)!);
        if (kids.length > 0) {
          above.push({ x: kids.reduce((sum, k) => sum + k.x + k.w / 2, 0) / kids.length, maxY: Math.min(...kids.map((k) => k.y)) - 150 - size.h / 2 });
        }
      }
    }

    if (anchors.length === 0 && below.length === 0 && above.length === 0) {
      const boxes = fanCluster(size, entity.attrs, sizes, [], UP, 0);
      const b = boxesBounds(size, boxes);
      commit(clusterAt(entity.id, boxes, besideDiagram(b)));
      placeReadyCircles();
      continue;
    }
    const anchorCenters = anchors.map(centerOfId);
    const ignore = new Set([entity.id, ...anchors]);
    const cost = (p: Point): number => {
      let value = 0;
      for (const b of below) {
        if (p.y < b.minY) return Infinity;
        value += Math.hypot((p.x - b.x) * 0.5, p.y - b.minY) * 1.5;
        value += 250 * world.crossed(p, b, new Set([entity.id, ...(b.circle ? [b.circle] : [])]));
      }
      for (const a of above) {
        if (p.y > a.maxY) return Infinity;
        value += Math.hypot((p.x - a.x) * 0.5, p.y - a.maxY) * 1.5;
      }
      for (const a of anchorCenters) {
        // 관계 마름모가 사이에 들어갈 만큼 떨어진 자리가 가장 좋다
        const d = Math.hypot((p.x - a.x) / 420, (p.y - a.y) / 290);
        value += Math.abs(d - 1) * 400 + (d < 0.75 ? 600 : 0);
        // 가로나 세로로 나란하면 선이 곧다
        value += Math.min(Math.abs(p.x - a.x), Math.abs(p.y - a.y)) * 0.25;
        value += 250 * world.crossed(p, a, ignore);
        // 둘 사이 가운데에 마름모가 들어갈 자리가 비어 있어야 한다
        const mid = { x: (p.x + a.x) / 2 - relationshipSize.w / 2, y: (p.y + a.y) / 2 - relationshipSize.h / 2, ...relationshipSize };
        if (!world.free(mid, 0) || world.onLine(mid)) value += 300;
      }
      return value;
    };
    const targets = [...anchorCenters, ...below.map((b) => ({ x: b.x, y: b.minY })), ...above.map((a) => ({ x: a.x, y: a.maxY }))];
    const target = { x: targets.reduce((sum, c) => sum + c.x, 0) / targets.length, y: targets.reduce((sum, c) => sum + c.y, 0) / targets.length };
    const blockedAt = (p: Point): Ray[] => {
      const dirs = directionsFrom(p, anchors);
      for (const b of below) {
        const dir = Math.atan2(b.y - p.y, b.x - p.x);
        dirs.push(dir, dir - 50 * DEG, dir + 50 * DEG);
      }
      if (above.length > 0) dirs.push(DOWN);
      return dirs.map((dir) => ({ x: 0, y: 0, dir }));
    };
    const prefer = below.length > 0 ? DOWN : UP;
    let boxes = fanCluster(size, entity.attrs, sizes, below.length > 0 ? [{ x: 0, y: 0, dir: UP }] : [], prefer, 0);
    let spot: Point | null = null;
    for (const reach of [1, 2, 4]) {
      spot = search(entity.id, boxes, target, 720 * reach, 520 * reach, 40, cost);
      if (spot) break;
    }
    if (spot) {
      // 고른 자리에서 관련 엔티티 쪽을 비운 부채꼴로 다시 만들어 한 번 더 찾는다
      const refined = fanCluster(size, entity.attrs, sizes, blockedAt(spot), prefer, 0);
      let again: Point | null = null;
      for (const reach of [1, 2]) {
        again = search(entity.id, refined, target, 720 * reach, 520 * reach, 40, cost);
        if (again) break;
      }
      if (again) {
        spot = again;
        boxes = refined;
      }
      commit(clusterAt(entity.id, boxes, spot));
    } else {
      commit(clusterAt(entity.id, boxes, besideDiagram(boxesBounds(size, boxes))));
    }
    placeReadyCircles();
  }
  // 슈퍼타입이 없는 원은 있을 수 없지만, 그래도 남았으면 그림 옆에 둔다
  for (const spec of graph.specs) {
    if (has(spec.id)) continue;
    const s = sizeOf(sizes, spec.id);
    const b = world.bounds();
    put(spec.id, b ? { x: b.x + b.w + BOX_GAP + s.w / 2, y: b.y + s.h / 2 } : { x: ORIGIN.x, y: ORIGIN.y });
  }

  // 3. 새 관계: 참여 엔티티들의 가운데 가까이
  for (const rel of graph.relationships) {
    if (has(rel.id)) continue;
    const size = sizeOf(sizes, rel.id);
    const parts = [...new Set(rel.participants)].filter(has);
    if (parts.length === 0) {
      const boxes = fanCluster(size, rel.attrs, sizes, [], UP, 0);
      commit(clusterAt(rel.id, boxes, besideDiagram(boxesBounds(size, boxes))));
      continue;
    }
    const centers = parts.map(centerOfId);
    let target: Point;
    if (parts.length === 1) {
      // 재귀 관계: 엔티티 위
      const r = world.rects.get(parts[0])!;
      target = { x: centers[0].x, y: r.y - 60 - size.h / 2 };
    } else {
      target = { x: centers.reduce((s, c) => s + c.x, 0) / centers.length, y: centers.reduce((s, c) => s + c.y, 0) / centers.length };
    }
    const ignore = new Set([rel.id, ...parts]);
    const crossings = (p: Point): number => centers.reduce((sum, c) => sum + world.crossed(p, c, ignore), 0);
    const cost = (p: Point): number => Math.hypot(p.x - target.x, p.y - target.y) + 260 * crossings(p);
    let boxes = fanCluster(size, rel.attrs, sizes, raysAt(target, rel.id, parts), UP, 0);
    let spot: Point | null = null;
    // 가까운 데서 먼저 찾고, 선이 다른 도형을 지나는 자리밖에 없으면 더 넓게 찾아 본다
    for (const reach of [240, 480, 960]) {
      const found = search(rel.id, boxes, target, reach, reach, 20, cost);
      if (found && (!spot || cost(found) < cost(spot))) spot = found;
      if (spot && crossings(spot) === 0) break;
    }
    if (spot) {
      const refined = fanCluster(size, rel.attrs, sizes, raysAt(spot, rel.id, parts), UP, 0);
      if (clusterFree(clusterAt(rel.id, refined, spot), 22)) boxes = refined;
      commit(clusterAt(rel.id, boxes, spot));
    } else {
      commit(clusterAt(rel.id, boxes, besideDiagram(boxesBounds(size, boxes))));
    }
  }

  // 4. 새 메모: 그림 아래에 왼쪽부터
  let noteX: number | null = null;
  let noteY = 0;
  for (const id of graph.notes) {
    if (has(id)) continue;
    const s = sizeOf(sizes, id);
    if (noteX === null) {
      const b = world.bounds();
      noteX = b ? b.x : ORIGIN.x;
      noteY = b ? b.y + b.h + 60 : ORIGIN.y;
    }
    put(id, { x: noteX + s.w / 2, y: noteY + s.h / 2 });
    noteX += s.w + NOTE_GAP;
  }

  return out;
}

// ───────────────────────── 점검용 ─────────────────────────

/** 선(두 도형의 중심을 잇는 직선)이 양 끝이 아닌 다른 도형을 지나는 횟수. 배치 품질을 재는 데 쓴다 */
export function countLineCrossings(rects: Map<string, Rect>, lines: Array<[string, string]>): number {
  let count = 0;
  for (const [a, b] of lines) {
    const ra = rects.get(a);
    const rb = rects.get(b);
    if (!ra || !rb) continue;
    const p = centerOf(ra);
    const q = centerOf(rb);
    for (const [id, r] of rects) {
      if (id === a || id === b) continue;
      if (segmentIntersectsRect(p, q, core(r))) count++;
    }
  }
  return count;
}
