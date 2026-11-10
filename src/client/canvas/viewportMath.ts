/**
 * 화면 이동/확대 계산(순수 함수). ViewportControls.tsx가 쓴다. [담당: viewport 에이전트]
 * screen = world * zoom + (viewport.x, viewport.y)
 */
import { GRID_SIZE, MAX_ZOOM, MIN_ZOOM } from '../../shared/types';
import type { Point, Rect, Viewport } from '../../shared/types';

export interface Size {
  w: number;
  h: number;
}

/** 전체 보기에서 작은 그림이 과하게 커지지 않도록 하는 배율 상한 */
export const FIT_MAX_ZOOM = 1.5;
/** 전체 보기의 기본 여백(px) */
export const FIT_PADDING = 60;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** 화면을 dx, dy(px)만큼 민다(그림이 그만큼 따라 움직인다). */
export function panViewport(v: Viewport, dx: number, dy: number): Viewport {
  return { x: v.x + dx, y: v.y + dy, zoom: v.zoom };
}

/** 화면 점 screen 아래의 월드 좌표를 유지한 채 배율을 정확히 zoom으로 맞춘다. */
export function zoomViewportTo(v: Viewport, screen: Point, zoom: number): Viewport {
  const next = clampZoom(zoom);
  if (next === v.zoom) return v;
  const k = next / v.zoom;
  return { x: screen.x - (screen.x - v.x) * k, y: screen.y - (screen.y - v.y) * k, zoom: next };
}

/** 화면 점 screen을 고정한 채 factor배 확대/축소한다. */
export function zoomViewportAt(v: Viewport, screen: Point, factor: number): Viewport {
  if (!Number.isFinite(factor) || factor <= 0) return v;
  return zoomViewportTo(v, screen, v.zoom * factor);
}

export function sizeCenter(size: Size): Point {
  return { x: size.w / 2, y: size.h / 2 };
}

/** 월드의 한 점이 화면 가운데에 오게 한다(배율 유지). */
export function centerViewportOn(v: Viewport, size: Size, world: Point): Viewport {
  return { x: size.w / 2 - world.x * v.zoom, y: size.h / 2 - world.y * v.zoom, zoom: v.zoom };
}

/**
 * rect가 size 안에 여백을 두고 다 들어오는 변환(가운데 정렬). 배율 제한은 하지 않는다.
 * 미니맵처럼 MIN_ZOOM보다 훨씬 작게 줄여야 하는 곳에서도 쓴다.
 */
export function fitRect(rect: Rect, size: Size, padding: number): Viewport {
  // 화면이 작으면 여백이 그림 자리를 다 먹지 않게 줄인다
  const pad = Math.max(0, Math.min(padding, size.w / 4, size.h / 4));
  const availW = Math.max(size.w - pad * 2, 1);
  const availH = Math.max(size.h - pad * 2, 1);
  const zoom = Math.min(availW / Math.max(rect.w, 1e-6), availH / Math.max(rect.h, 1e-6));
  return {
    x: size.w / 2 - (rect.x + rect.w / 2) * zoom,
    y: size.h / 2 - (rect.y + rect.h / 2) * zoom,
    zoom,
  };
}

/**
 * 전체 보기. rect가 화면에 다 들어오는 배율(FIT_MAX_ZOOM 이하, MIN_ZOOM 이상)과 가운데 정렬.
 * rect가 null이면 배율 1에 월드 원점이 화면 가운데.
 */
export function fitViewport(rect: Rect | null, size: Size, padding = FIT_PADDING): Viewport {
  if (!rect) return { x: size.w / 2, y: size.h / 2, zoom: 1 };
  const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  // 캔버스 크기를 아직 모르면(0) 배율 1로 가운데만 맞춘다
  const raw = size.w > 0 && size.h > 0 ? fitRect(rect, size, padding).zoom : 1;
  const zoom = Math.max(MIN_ZOOM, Math.min(FIT_MAX_ZOOM, MAX_ZOOM, raw));
  return centerViewportOn({ x: 0, y: 0, zoom }, size, center);
}

/** 두 사각형을 모두 감싸는 사각형 */
export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

// ───────────────────────── 휠 ─────────────────────────

/** WheelEvent.deltaMode: 0 = px, 1 = 줄, 2 = 쪽 */
const LINE_PX = 16;
/** 한 번의 휠 이벤트가 확대에 쓰는 최대 이동량(px). 마우스 휠 한 칸(100~120)이 너무 크게 튀지 않게 한다. */
const MAX_ZOOM_DELTA = 25;

/** 휠 이동량을 px 단위로 맞춘다. */
export function wheelDeltaPx(delta: number, deltaMode: number, pagePx: number): number {
  if (deltaMode === 1) return delta * LINE_PX;
  if (deltaMode === 2) return delta * (pagePx > 0 ? pagePx : 800);
  return delta;
}

/** 휠 이동량(px)을 확대 배수로 바꾼다. 위로 굴리면(음수) 확대. */
export function wheelZoomFactor(deltaYPx: number): number {
  if (!Number.isFinite(deltaYPx)) return 1;
  const d = Math.max(-MAX_ZOOM_DELTA, Math.min(MAX_ZOOM_DELTA, deltaYPx));
  return Math.exp(-d * 0.01);
}

/**
 * 휠로 화면을 밀 때의 이동량. Shift+휠은 가로 이동.
 * (macOS는 Shift+휠을 이미 deltaX로 바꿔 주므로 deltaX가 없을 때만 바꾼다.)
 */
export function wheelPan(dxPx: number, dyPx: number, shiftKey: boolean): Point {
  if (shiftKey && dxPx === 0) return { x: -dyPx, y: 0 };
  return { x: -dxPx, y: -dyPx };
}

// ───────────────────────── 격자 ─────────────────────────

const GRID_MULTIPLIERS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
/** 화면에서 점 사이 간격의 하한(px). 배수 사이 비율이 최대 2.5이므로 간격은 16~40px에 든다. */
const GRID_MIN_SCREEN_STEP = 16;

export interface GridLayout {
  /** 점 사이 간격(월드 단위, GRID_SIZE의 배수) */
  worldStep: number;
  /** 점 사이 간격(화면 px) */
  step: number;
  /** 화면에서 가장 왼쪽 위(화면 안쪽 0 이상 step 미만)에 있는 점의 위치 */
  offsetX: number;
  offsetY: number;
}

function positiveMod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** 배율에 맞는 점 격자 배치. 점은 월드 좌표가 worldStep의 배수인 자리에 찍힌다. */
export function gridLayout(v: Viewport): GridLayout {
  const zoom = v.zoom > 0 ? v.zoom : 1;
  let mult = GRID_MULTIPLIERS[GRID_MULTIPLIERS.length - 1];
  for (const m of GRID_MULTIPLIERS) {
    if (GRID_SIZE * m * zoom >= GRID_MIN_SCREEN_STEP) {
      mult = m;
      break;
    }
  }
  const worldStep = GRID_SIZE * mult;
  const step = worldStep * zoom;
  return { worldStep, step, offsetX: positiveMod(v.x, step), offsetY: positiveMod(v.y, step) };
}
