/**
 * 캔버스 조작에 쓰는 순수 계산. DOM과 store를 건드리지 않는다. [담당: canvas 에이전트]
 */
import { anchorPoint, nearestSide, nodeRect, pointInNode, rectsIntersect, sideDirection } from '../../../shared/geometry';
import { CARDINALITY_OPTIONS, MIN_NODE_SIZE, SIDES, type ErdEdge, type ErdNode, type Point, type Rect, type Side } from '../../../shared/types';

/** 드래그로 인정하는 최소 이동 거리(화면 px) */
export const DRAG_THRESHOLD = 3;
/** 크기 조절 손잡이 한 변(화면 px) */
export const HANDLE_SIZE = 8;
/** 연결 점 반지름(화면 px) */
export const CONNECT_DOT_RADIUS = 5;
/** 도형의 고정점(변 가운데, 마름모 꼭짓점)에서 연결 점 중심까지 거리(화면 px) */
export const CONNECT_DOT_OFFSET = 14;
/** 고정점에 달라붙는 거리(화면 px) */
export const ANCHOR_SNAP_DISTANCE = 14;
/** 선 끝점 손잡이 지름(화면 px) */
export const EDGE_END_SIZE = 9;
/** 정렬 맞춤이 걸리는 거리(화면 px) */
export const SNAP_DISTANCE = 6;

export function exceedsThreshold(ax: number, ay: number, bx: number, by: number, threshold = DRAG_THRESHOLD): boolean {
  return Math.hypot(bx - ax, by - ay) >= threshold;
}

/** 두 점을 대각선으로 하는 사각형(w, h는 항상 0 이상) */
export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/**
 * 상자 선택 결과. 사각형과 겹치는 노드, 그리고 양 끝 노드가 모두 선택된 엣지를 고른다.
 * base는 Shift를 누른 채 끌 때 유지할 기존 선택이다(순서를 지키고 중복 없이 합친다).
 */
export function marqueeSelection(rect: Rect, nodes: ErdNode[], edges: ErdEdge[], base: string[] = []): string[] {
  const out = new Set<string>(base);
  const picked = new Set<string>();
  const baseSet = new Set(base);
  for (const n of nodes) {
    if (baseSet.has(n.id) || rectsIntersect(rect, nodeRect(n))) {
      picked.add(n.id);
      out.add(n.id);
    }
  }
  for (const e of edges) {
    if (picked.has(e.source) && picked.has(e.target)) out.add(e.id);
  }
  return Array.from(out);
}

// ───────────────────────── 크기 조절 ─────────────────────────

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const CORNER_HANDLES: Handle[] = ['nw', 'ne', 'se', 'sw'];
export const SIDE_HANDLES: Handle[] = ['n', 'e', 's', 'w'];

export const HANDLE_CURSOR: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

export function isHandle(v: string | null | undefined): v is Handle {
  return v != null && v in HANDLE_CURSOR;
}

/** 손잡이의 중심 좌표 */
export function handlePoint(r: Rect, handle: Handle): Point {
  const x = handle.includes('w') ? r.x : handle.includes('e') ? r.x + r.w : r.x + r.w / 2;
  const y = handle.includes('n') ? r.y : handle.includes('s') ? r.y + r.h : r.y + r.h / 2;
  return { x, y };
}

/**
 * 손잡이를 (dx, dy)만큼 끌었을 때의 새 사각형. 반대쪽 변은 제자리에 두고 최소 크기 아래로는 줄지 않는다.
 */
export function resizeRect(orig: Rect, handle: Handle, dx: number, dy: number, min: { w: number; h: number } = MIN_NODE_SIZE): Rect {
  let left = orig.x;
  let top = orig.y;
  let right = orig.x + orig.w;
  let bottom = orig.y + orig.h;
  if (handle.includes('w')) left = Math.min(left + dx, right - min.w);
  if (handle.includes('e')) right = Math.max(right + dx, left + min.w);
  if (handle.includes('n')) top = Math.min(top + dy, bottom - min.h);
  if (handle.includes('s')) bottom = Math.max(bottom + dy, top + min.h);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** 좌표와 크기를 정수로 맞춘다(오른쪽/아래 변의 위치가 흔들리지 않게 변 기준으로 반올림). */
export function roundRect(r: Rect): Rect {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  return { x, y, w: Math.round(r.x + r.w) - x, h: Math.round(r.y + r.h) - y };
}

// ───────────────────────── 연결 ─────────────────────────

export function isSide(v: unknown): v is Side {
  return typeof v === 'string' && (SIDES as readonly string[]).includes(v);
}

/** 도형 상하좌우 고정점의 바로 바깥에 띄우는 연결 점의 중심. offset은 월드 단위. */
export function connectDotPoints(node: ErdNode, offset: number): Array<{ side: Side; x: number; y: number }> {
  return SIDES.map((side) => {
    const a = anchorPoint(node, side);
    const d = sideDirection(side);
    return { side, x: a.x + d.x * offset, y: a.y + d.y * offset };
  });
}

/** p가 사각형을 margin만큼 넓힌 범위 안에 있는지(연결 점으로 마우스를 옮기는 동안 점을 유지하는 데 쓴다) */
export function inExpandedRect(r: Rect, p: Point, margin: number): boolean {
  return p.x >= r.x - margin && p.x <= r.x + r.w + margin && p.y >= r.y - margin && p.y <= r.y + r.h + margin;
}

/** p 아래에 있는 노드 중 가장 위에 그려진 것(배열의 뒤쪽이 위). excludeId는 건너뛴다. */
export function topNodeAt(nodes: ErdNode[], p: Point, excludeId?: string): ErdNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.id === excludeId) continue;
    if (pointInNode(n, p)) return n;
  }
  return null;
}

/** 더블클릭으로 카디널리티를 돌린다: '' → 1 → M → N → ''. 직접 입력한 글자는 ''로 돌아간다. */
export function nextCardinality(label: string): string {
  const i = (CARDINALITY_OPTIONS as readonly string[]).indexOf(label);
  if (i < 0) return '';
  return CARDINALITY_OPTIONS[(i + 1) % CARDINALITY_OPTIONS.length];
}

// ───────────────────────── 선이 붙는 면 ─────────────────────────

/**
 * 이 두 도형을 잇는 선에 붙는 면을 저장할지. 엔티티와 관계, 엔티티와 특수화 원 사이의 선만 저장한다.
 * 속성이 낀 선은 면 없이 비스듬한 직선으로 둔다.
 */
export function shouldStoreSides(source: ErdNode, target: ErdNode): boolean {
  const pair = (a: ErdNode['kind'], b: ErdNode['kind']) =>
    (source.kind === a && target.kind === b) || (source.kind === b && target.kind === a);
  return pair('entity', 'relationship') || pair('entity', 'spec');
}

/** 새 선에 넣을 면 필드. 저장 조건에 맞지 않거나 면이 정해지지 않은 끝은 넣지 않는다(자동). */
export function edgeSideProps(
  source: ErdNode,
  target: ErdNode,
  sourceSide: Side | null | undefined,
  targetSide: Side | null | undefined,
): Pick<ErdEdge, 'sourceSide' | 'targetSide'> {
  const out: Pick<ErdEdge, 'sourceSide' | 'targetSide'> = {};
  if (!shouldStoreSides(source, target)) return out;
  if (sourceSide) out.sourceSide = sourceSide;
  if (targetSide) out.targetSide = targetSide;
  return out;
}

/**
 * 연결 중 마우스 아래의 대상 도형과, 달라붙을 고정점의 면.
 * 도형 안이면 그 도형이고, 도형 밖이라도 고정점에서 snapDist 안이면(마름모 꼭짓점 바로 바깥 등) 그 도형으로 본다.
 */
export function pickConnectTarget(
  nodes: ErdNode[],
  p: Point,
  excludeId: string | undefined,
  snapDist: number,
): { node: ErdNode; side: Side | null } | null {
  const inside = topNodeAt(nodes, p, excludeId);
  if (inside) return { node: inside, side: nearestSide(inside, p, snapDist) };
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.id === excludeId) continue;
    const side = nearestSide(n, p, snapDist);
    if (side) return { node: n, side };
  }
  return null;
}

export type EndDrop =
  /** 고정점에 붙인다 */
  | { kind: 'side'; side: Side }
  /** 면 지정을 지워 자동으로 되돌린다 */
  | { kind: 'auto' }
  /** 아무것도 바꾸지 않는다 */
  | { kind: 'none' };

/**
 * 선의 끝점 손잡이를 p에 놓았을 때 할 일. 고정점에서 snapDist 안이면 그 면에 붙이고,
 * 고정점 근처가 아닌 몸통 위면 자동으로 되돌리고, 도형 밖이면 그대로 둔다.
 */
export function resolveEndDrop(node: ErdNode, p: Point, snapDist: number): EndDrop {
  const side = nearestSide(node, p, snapDist);
  if (side) return { kind: 'side', side };
  if (pointInNode(node, p)) return { kind: 'auto' };
  return { kind: 'none' };
}
