/**
 * 화면 좌표와 월드 좌표 변환. (CORE 파일)
 * screen = world * zoom + (viewport.x, viewport.y). screen은 캔버스 영역의 왼쪽 위가 (0,0)이다.
 */
import type { Point, Rect, Viewport } from '../../shared/types';

export function screenToWorld(v: Viewport, p: Point): Point {
  return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
}
export function worldToScreen(v: Viewport, p: Point): Point {
  return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
}
/** 마우스 이벤트의 clientX/clientY를 캔버스 영역 기준 화면 좌표로 바꾼다. */
export function clientToScreen(el: Element, clientX: number, clientY: number): Point {
  const r = el.getBoundingClientRect();
  return { x: clientX - r.left, y: clientY - r.top };
}
export function clientToWorld(el: Element, v: Viewport, clientX: number, clientY: number): Point {
  return screenToWorld(v, clientToScreen(el, clientX, clientY));
}
/** 지금 화면에 보이는 월드 영역 */
export function visibleWorldRect(v: Viewport, size: { w: number; h: number }): Rect {
  return { x: -v.x / v.zoom, y: -v.y / v.zoom, w: size.w / v.zoom, h: size.h / v.zoom };
}
/** SVG <g>에 넣을 transform 문자열 */
export function viewportTransform(v: Viewport): string {
  return `translate(${v.x} ${v.y}) scale(${v.zoom})`;
}
