/**
 * 접속자 표시에 쓰는 순수 계산. DOM이나 React에 기대지 않는다. [담당: presence 에이전트]
 */
import type { Point } from '../../shared/types';

// ───────────────────────── 전송 간격 제한 ─────────────────────────

export interface ThrottleClock {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

const realClock: ThrottleClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface Throttled<A extends unknown[]> {
  (...args: A): void;
  /** 예약된 마지막 호출을 버린다. */
  cancel(): void;
  /** 예약된 마지막 호출이 있으면 지금 바로 실행한다. */
  flush(): void;
  /** 예약된 호출이 있는지 */
  pending(): boolean;
}

/**
 * fn을 intervalMs에 한 번만 부른다. 첫 호출은 바로 실행하고(leading),
 * 간격 안에 들어온 호출은 마지막 인자만 기억했다가 간격이 끝나면 실행한다(trailing).
 */
export function createThrottle<A extends unknown[]>(
  fn: (...args: A) => void,
  intervalMs: number,
  clock: ThrottleClock = realClock,
): Throttled<A> {
  let lastRun = -Infinity;
  let timer: unknown = null;
  let waiting: A | null = null;

  const run = (args: A) => {
    lastRun = clock.now();
    fn(...args);
  };
  const fire = () => {
    timer = null;
    const args = waiting;
    waiting = null;
    if (args) run(args);
  };

  const throttled = ((...args: A) => {
    const elapsed = clock.now() - lastRun;
    if (timer === null && elapsed >= intervalMs) {
      run(args);
      return;
    }
    waiting = args;
    if (timer === null) timer = clock.setTimer(fire, Math.max(0, intervalMs - elapsed));
  }) as Throttled<A>;

  throttled.cancel = () => {
    if (timer !== null) clock.clearTimer(timer);
    timer = null;
    waiting = null;
  };
  throttled.flush = () => {
    if (timer === null) return;
    clock.clearTimer(timer);
    fire();
  };
  throttled.pending = () => waiting !== null;
  return throttled;
}

// ───────────────────────── 사용자 표시 ─────────────────────────

export const ANONYMOUS = '익명';
export const NAME_MAX = 20;
const FALLBACK_COLOR = '#6b7280';

/** 화면에 보여 줄 이름. 비어 있으면 "익명". 다른 접속자가 보낸 값이라 형식을 믿지 않는다. */
export function displayName(name: unknown): string {
  if (typeof name !== 'string') return ANONYMOUS;
  const trimmed = name.trim();
  if (!trimmed) return ANONYMOUS;
  return Array.from(trimmed).slice(0, NAME_MAX).join('');
}

/** 아바타 원 안에 넣을 한 글자. 이름이 없으면 "?" */
export function initialOf(name: unknown): string {
  if (typeof name !== 'string') return '?';
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : '?';
}

/** 입력한 이름을 저장할 형태로 다듬는다(앞뒤 공백 제거, 최대 20자). */
export function normalizeName(raw: string): string {
  return Array.from(raw.trim()).slice(0, NAME_MAX).join('').trim();
}

/** #rgb, #rrggbb 형태만 받아들이고 나머지는 회색으로 바꾼다. */
export function safeColor(color: unknown): string {
  return typeof color === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) ? color : FALLBACK_COLOR;
}

export function isPoint(p: unknown): p is Point {
  if (!p || typeof p !== 'object') return false;
  const q = p as { x?: unknown; y?: unknown };
  return typeof q.x === 'number' && typeof q.y === 'number' && Number.isFinite(q.x) && Number.isFinite(q.y);
}

/** 커서 좌표를 소수 첫째 자리까지만 남긴다(전송량을 줄이고 같은 위치를 다시 보내지 않기 위해). */
export function roundPoint(p: Point): Point {
  return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
}

// ───────────────────────── 화면 밖 커서 ─────────────────────────

export type EdgeAnchor = 'start' | 'center' | 'end';

export interface CursorPlacement {
  /** 캔버스 영역 밖이면 true. 이때 x, y는 가장자리 표시를 놓을 자리다. */
  offscreen: boolean;
  x: number;
  y: number;
  /** 가장자리 표시가 놓인 점에서 어느 쪽으로 펼쳐질지. start = 오른쪽/아래로, end = 왼쪽/위로 */
  ax: EdgeAnchor;
  ay: EdgeAnchor;
}

export interface EdgeInsets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 가장자리 표시가 다른 패널에 가리지 않게 띄우는 여백. 왼쪽은 도구 모음, 아래는 확대 버튼 자리다(RoomPage.css의 slot 위치 기준). */
export const EDGE_INSETS: EdgeInsets = { left: 84, top: 12, right: 12, bottom: 56 };
/** 가장자리 표시의 대략적인 크기 절반. 가운데 정렬일 때 화면 밖으로 삐져나가지 않게 한다. */
const EDGE_HALF_W = 64;
const EDGE_HALF_H = 11;

/** v를 lo~hi로 당긴다. 영역이 너무 좁아 lo > hi가 되면 fallback을 쓴다. */
function clampTo(v: number, lo: number, hi: number, fallback: number): number {
  if (lo > hi) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 화면 좌표 p의 커서를 어디에 그릴지 정한다.
 * 캔버스 영역(0,0)~(w,h) 안이면 그 자리에, 밖이면 그 방향의 가장자리에 놓는다.
 * 크기를 아직 모르면(0) 안에 있는 것으로 본다.
 */
export function locateCursor(p: Point, size: { w: number; h: number }, insets: EdgeInsets = EDGE_INSETS): CursorPlacement {
  if (size.w <= 0 || size.h <= 0) return { offscreen: false, x: p.x, y: p.y, ax: 'center', ay: 'center' };
  const ax: EdgeAnchor = p.x < 0 ? 'start' : p.x > size.w ? 'end' : 'center';
  const ay: EdgeAnchor = p.y < 0 ? 'start' : p.y > size.h ? 'end' : 'center';
  if (ax === 'center' && ay === 'center') return { offscreen: false, x: p.x, y: p.y, ax, ay };

  const left = insets.left;
  const right = size.w - insets.right;
  const top = insets.top;
  const bottom = size.h - insets.bottom;
  const x = ax === 'start' ? Math.min(left, size.w / 2) : ax === 'end' ? Math.max(right, size.w / 2) : clampTo(p.x, left + EDGE_HALF_W, right - EDGE_HALF_W, size.w / 2);
  const y = ay === 'start' ? Math.min(top, size.h / 2) : ay === 'end' ? Math.max(bottom, size.h / 2) : clampTo(p.y, top + EDGE_HALF_H, bottom - EDGE_HALF_H, size.h / 2);
  return { offscreen: true, x, y, ax, ay };
}

/** 가장자리 표시의 정렬을 CSS translate 값으로 */
export function anchorOffset(a: EdgeAnchor): string {
  return a === 'start' ? '0' : a === 'end' ? '-100%' : '-50%';
}

// ───────────────────────── 다른 사람의 선택 표시 ─────────────────────────

/** 노드 사각형에서 바깥으로 띄우는 거리(월드 단위) */
export const RING_PAD = 4;
/** 같은 노드를 여러 명이 선택했을 때 테두리끼리 띄우는 최소 화면 거리(px) */
const RING_STEP_SCREEN = 3;

export interface RemoteRing {
  key: string;
  nodeId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  /** 이 사람이 이 노드의 글자를 편집 중인지 */
  editing: boolean;
  /** 편집 중일 때의 이름표 글 */
  label: string | null;
  /** 같은 노드에서 몇 번째 테두리인지(0이 가장 안쪽) */
  stack: number;
}

interface RingPeer {
  clientId: number;
  user: { name: string; color: string };
  selection: string[];
  editing: string | null;
}
interface RingNode {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 접속자들의 선택/편집 상태를 그릴 테두리 목록으로 바꾼다. 노드가 아닌 id(엣지, 지워진 요소)는 건너뛴다. */
export function buildRemoteRings(peers: readonly RingPeer[], nodes: ReadonlyMap<string, RingNode>, zoom: number): RemoteRing[] {
  const z = zoom > 0 && Number.isFinite(zoom) ? zoom : 1;
  const step = Math.max(RING_PAD, RING_STEP_SCREEN / z);
  const count = new Map<string, number>();
  const rings: RemoteRing[] = [];

  for (const peer of peers) {
    const ids = new Set<string>();
    for (const id of peer.selection) if (typeof id === 'string') ids.add(id);
    if (typeof peer.editing === 'string') ids.add(peer.editing);

    for (const id of ids) {
      const node = nodes.get(id);
      if (!node) continue;
      const stack = count.get(id) ?? 0;
      count.set(id, stack + 1);
      const pad = RING_PAD + stack * step;
      const editing = peer.editing === id;
      rings.push({
        key: `${peer.clientId}:${id}`,
        nodeId: id,
        x: node.x - pad,
        y: node.y - pad,
        w: node.w + pad * 2,
        h: node.h + pad * 2,
        color: safeColor(peer.user?.color),
        editing,
        label: editing ? `${displayName(peer.user?.name)} 편집 중` : null,
        stack,
      });
    }
  }
  return rings;
}

/** 이름표 배경 너비를 잡기 위한 글자 너비 어림값(px). 한글 같은 전각 글자는 넓게 본다. */
export function estimateTextWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    em += code >= 0x1100 ? 0.95 : code === 0x20 ? 0.3 : 0.62;
  }
  return Math.ceil(em * fontSize);
}
