/**
 * 다른 pane이 가리킨 도형(state/highlight.ts의 useErdHighlight)을 화면 안으로 데려온다. [담당: canvas 에이전트]
 *
 * revealToken이 바뀌었을 때만 움직인다. 강조한 도형이 이미 다 보이면 움직이지 않는다.
 * 지금 배율로 다 들어가면 배율은 그대로 두고 가운데로 민다. 안 들어가면 들어갈 만큼만 줄인다(확대는 하지 않는다).
 * 움직임은 부드럽게 옮기고, 움직임 줄이기 설정이면 바로 옮긴다. 선택, 문서, 실행 취소 기록은 건드리지 않는다.
 */
import { useEffect, useRef } from 'react';
import { nodeRect, unionBounds } from '../../shared/geometry';
import { MIN_ZOOM } from '../../shared/types';
import type { ErdEdge, ErdNode, Rect, Viewport } from '../../shared/types';
import type { Room } from '../collab/room';
import { useSynced } from '../collab/hooks';
import { useErdHighlight } from '../state/highlight';
import { ui, useUi } from '../state/ui';
import { isErdCanvasShown } from './paneScope';
import type { Size } from './viewportMath';

/** 화면 가장자리에서 띄우는 여백(px). 왼쪽은 도구 팔레트가 가리는 폭을 더한다 */
export interface Insets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 도구 팔레트(왼쪽), 확대 버튼(아래)이 가리는 자리를 피한 기본 여백 */
export function revealInsets(size: Size): Insets {
  const pad = 40;
  // 좁은 pane에서는 여백이 그림 자리를 다 먹지 않게 줄인다
  const left = size.w > 400 ? 72 + pad : Math.min(72, size.w / 4);
  const bottom = size.h > 300 ? 48 + pad : Math.min(48, size.h / 4);
  const other = Math.min(pad, size.w / 8, size.h / 8);
  return { left, top: other, right: other, bottom };
}

/** 강조한 노드와 엣지를 감싸는 월드 사각형. 엣지는 양 끝 노드를 넣는다. 없는 id는 건너뛴다 */
/** id로 찾을 수 있는 것(Map이나 ElementStore) */
interface Lookup<T> {
  get(id: string): T | undefined;
}

export function highlightBounds(ids: readonly string[], nodes: Lookup<ErdNode>, edges: Lookup<ErdEdge>): Rect | null {
  const rects: Rect[] = [];
  for (const id of ids) {
    const n = nodes.get(id);
    if (n) {
      rects.push(nodeRect(n));
      continue;
    }
    const e = edges.get(id);
    if (!e) continue;
    const a = nodes.get(e.source);
    const b = nodes.get(e.target);
    if (a) rects.push(nodeRect(a));
    if (b) rects.push(nodeRect(b));
  }
  return unionBounds(rects);
}

/**
 * rect를 화면 안(insets를 뺀 영역)으로 데려오는 뷰포트. 이미 다 보이면 null.
 * 배율은 지금 배율 이하로만 바꾼다(MIN_ZOOM 아래로는 줄이지 않는다).
 */
export function revealViewport(v: Viewport, size: Size, rect: Rect, insets: Insets = revealInsets(size)): Viewport | null {
  if (!(size.w > 0 && size.h > 0)) return null;
  let { left, top, right, bottom } = insets;
  // 여백을 빼면 남는 자리가 없을 만큼 좁으면 여백 없이 본다
  if (size.w - left - right < 40) left = right = 0;
  if (size.h - top - bottom < 40) top = bottom = 0;
  const area = { x: left, y: top, w: size.w - left - right, h: size.h - top - bottom };

  const sx = rect.x * v.zoom + v.x;
  const sy = rect.y * v.zoom + v.y;
  const sw = rect.w * v.zoom;
  const sh = rect.h * v.zoom;
  const inside = sx >= area.x - 0.5 && sy >= area.y - 0.5 && sx + sw <= area.x + area.w + 0.5 && sy + sh <= area.y + area.h + 0.5;
  if (inside) return null;

  let zoom = v.zoom;
  if (sw > area.w || sh > area.h) {
    const fit = Math.min(area.w / Math.max(rect.w, 1e-6), area.h / Math.max(rect.h, 1e-6));
    zoom = Math.min(v.zoom, Math.max(MIN_ZOOM, fit));
  }
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return { x: area.x + area.w / 2 - cx * zoom, y: area.y + area.h / 2 - cy * zoom, zoom };
}

/** 움직임 줄이기 설정인지 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const REVEAL_MS = 320;

let cancelRunning: (() => void) | null = null;

/**
 * 뷰포트를 target으로 옮긴다. instant가 아니면 짧게 부드럽게 옮긴다.
 * 도중에 사용자가 화면을 움직이면(휠, 끌기 등) 그 자리에서 멈춘다.
 */
export function animateViewportTo(target: Viewport, instant = prefersReducedMotion()): void {
  cancelRunning?.();
  const from = ui().viewport;
  if (instant || typeof requestAnimationFrame !== 'function') {
    ui().setViewport(target);
    return;
  }
  let last: Viewport = from;
  let frame = 0;
  const start = performance.now();
  const stop = () => {
    cancelAnimationFrame(frame);
    unsubscribe();
    if (cancelRunning === stop) cancelRunning = null;
  };
  // 다른 곳에서 뷰포트를 바꾸면 사용자가 손을 댄 것이다
  const unsubscribe = useUi.subscribe((s) => {
    if (s.viewport !== last) stop();
  });
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / REVEAL_MS);
    const e = 1 - Math.pow(1 - t, 3);
    // 배율은 곱셈으로, 위치는 화면 가운데의 월드 점으로 이어 붙여야 옆으로 휘지 않는다
    const zoom = from.zoom * Math.pow(target.zoom / from.zoom, e);
    const size = ui().canvasSize;
    const c0 = { x: (size.w / 2 - from.x) / from.zoom, y: (size.h / 2 - from.y) / from.zoom };
    const c1 = { x: (size.w / 2 - target.x) / target.zoom, y: (size.h / 2 - target.y) / target.zoom };
    const cx = c0.x + (c1.x - c0.x) * e;
    const cy = c0.y + (c1.y - c0.y) * e;
    last = t >= 1 ? target : { x: size.w / 2 - cx * zoom, y: size.h / 2 - cy * zoom, zoom };
    ui().setViewport(last);
    if (t >= 1) stop();
    else frame = requestAnimationFrame(step);
  };
  cancelRunning = stop;
  frame = requestAnimationFrame(step);
}

/**
 * revealToken이 바뀌면 강조한 도형을 화면 안으로 데려온다.
 * 캔버스 크기를 아직 모르거나(0) 문서를 아직 다 받지 못했으면 알 때까지 미뤘다가 한 번 한다.
 * 비활성 탭이라 숨김 보관함에 있는 동안(크기는 그대로다) 온 요청은 미루지 않고 바로 옮겨 둔다:
 * 보이지 않는 움직임을 그릴 까닭이 없고, 탭을 다시 보이면 그 도형이 이미 화면 안에 있다(다시 붙일 때 크기가 같아서 튀지 않는다).
 * 처음 뜰 때 이미 있던 토큰은 무시한다(지난 요청으로 화면을 옮기지 않는다).
 */
export function useErdReveal(room: Room): void {
  const token = useErdHighlight((s) => s.revealToken);
  const sized = useUi((s) => s.canvasSize.w > 0 && s.canvasSize.h > 0);
  const synced = useSynced();
  const handled = useRef(token);
  useEffect(() => {
    if (token === handled.current || !sized || !synced) return;
    handled.current = token;
    const { ids } = useErdHighlight.getState();
    const rect = highlightBounds(ids, room.nodes, room.edges);
    if (!rect) return;
    const s = ui();
    const next = revealViewport(s.viewport, s.canvasSize, rect);
    if (next) animateViewportTo(next, prefersReducedMotion() || !isErdCanvasShown());
  }, [token, sized, synced, room]);
  useEffect(() => () => cancelRunning?.(), []);
}
