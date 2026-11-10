/**
 * 캔버스 조작에 쓰는 순수 계산. DOM과 store를 건드리지 않는다. [담당: canvas 에이전트]
 */
import { nodeRect, pointInNode, rectsIntersect } from '../../../shared/geometry';
import { CARDINALITY_OPTIONS, MIN_NODE_SIZE, type ErdEdge, type ErdNode, type Point, type Rect } from '../../../shared/types';

/** 드래그로 인정하는 최소 이동 거리(화면 px) */
export const DRAG_THRESHOLD = 3;
/** 크기 조절 손잡이 한 변(화면 px) */
export const HANDLE_SIZE = 8;
/** 연결 점 반지름(화면 px) */
export const CONNECT_DOT_RADIUS = 5;
/** 도형 테두리에서 연결 점 중심까지 거리(화면 px) */
export const CONNECT_DOT_OFFSET = 16;
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

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** 도형 상하좌우 바깥에 띄우는 연결 점의 중심. offset은 월드 단위. */
export function connectDotPoints(r: Rect, offset: number): Array<{ side: Side; x: number; y: number }> {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return [
    { side: 'top', x: cx, y: r.y - offset },
    { side: 'right', x: r.x + r.w + offset, y: cy },
    { side: 'bottom', x: cx, y: r.y + r.h + offset },
    { side: 'left', x: r.x - offset, y: cy },
  ];
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
