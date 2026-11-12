/**
 * 캔버스가 뜰 때 한 번 걸어 두는 것들: 영역 크기 추적, 처음 전체 보기, 스페이스 키 상태, 커서 모양.
 * [담당: canvas 에이전트]
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { diagramBounds } from '../../../shared/geometry';
import { presetOfTool, type Viewport } from '../../../shared/types';
import { useRoom, useSynced } from '../../collab/hooks';
import { ui, useUi } from '../../state/ui';
import { isInErdScope, registerCanvasRoot } from '../paneScope';
import { zoomToRect } from '../ViewportControls';
import type { Size } from '../viewportMath';
import { HANDLE_CURSOR } from './logic';
import { setCanvasLocal, useCanvasLocal } from './store';

/** 처음 전체 보기를 할 때 둘레에 두는 여백(화면 px) */
const INITIAL_FIT_PADDING = 80;

/**
 * 크기가 바뀔 때 화면 가운데의 월드 점이 그대로 있도록 뷰포트를 옮긴다(배율은 그대로).
 * prev나 next가 0이면(숨겨진 동안) 옮기지 않는다.
 */
export function keepCenterOnResize(v: Viewport, prev: Size, next: Size): Viewport {
  if (!(prev.w > 0 && prev.h > 0 && next.w > 0 && next.h > 0)) return v;
  const dx = (next.w - prev.w) / 2;
  const dy = (next.h - prev.h) / 2;
  if (dx === 0 && dy === 0) return v;
  return { x: v.x + dx, y: v.y + dy, zoom: v.zoom };
}

/**
 * 캔버스 영역의 화면 크기를 ui.canvasSize에 맞춰 둔다.
 * 캔버스는 어떤 컨테이너에든 들어가 그 크기를 채운다(pane 나누기, 창 크기 바꾸기, 비활성 탭, 다른 그룹으로 옮기기).
 * - 크기가 바뀌면 화면 가운데의 월드 점을 유지한다.
 * - 숨겨지면(0×0) 크기를 0으로 두고, 다시 보이면 마지막으로 보이던 크기와 비교해 옮긴다(튀지 않는다).
 * - 크기가 바뀌면 떠 있는 우클릭 메뉴를 닫는다(메뉴가 가리키던 자리가 움직였다).
 */
export function useCanvasSize(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const unregister = registerCanvasRoot(el);
    /** 마지막으로 보이던(0이 아닌) 크기 */
    // StrictMode에서 다시 걸릴 때도 마지막 크기를 잃지 않게 store의 값에서 시작한다
    const initial = ui().canvasSize;
    let lastShown: Size | null = initial.w > 0 && initial.h > 0 ? initial : null;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = { w: Math.round(r.width), h: Math.round(r.height) };
      const s = ui();
      const cur = s.canvasSize;
      if (cur.w === next.w && cur.h === next.h) return;
      const shown = next.w > 0 && next.h > 0;
      if (shown && lastShown) {
        const moved = keepCenterOnResize(s.viewport, lastShown, next);
        if (moved !== s.viewport) s.setViewport(moved);
      }
      if (shown) lastShown = next;
      s.setCanvasSize(next);
      s.closeContextMenu();
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return unregister;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      unregister();
    };
  }, [ref]);
}

/**
 * 서버의 문서를 처음 다 받았을 때 한 번, 그려진 것이 있으면 전체가 보이게 맞춘다.
 * 처음 뜰 때 캔버스 크기가 0이면(비활성 탭 등) 실제 크기를 얻을 때까지 기다렸다가 맞춘다.
 */
export function useInitialFit(): void {
  const room = useRoom();
  const synced = useSynced();
  const sized = useUi((s) => s.canvasSize.w > 0 && s.canvasSize.h > 0);
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !synced || !sized) return;
    done.current = true;
    const nodes = room.nodes.getSnapshot();
    if (nodes.length > 0) zoomToRect(diagramBounds(nodes), INITIAL_FIT_PADDING);
  }, [room, synced, sized]);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  return (target as Element).closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], dialog, [role="dialog"]') != null;
}

/** 스페이스를 누르고 있는 동안 spaceHeld를 켠다. 입력창에 포커스가 있거나 다른 pane에서 누른 키는 건드리지 않는다. */
export function useSpaceKey(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTypingTarget(e.target) || !isInErdScope(e.target)) return;
      // 페이지 스크롤과 포커스가 남아 있는 버튼이 눌리는 것을 막는다
      e.preventDefault();
      if (!e.repeat) setCanvasLocal({ spaceHeld: true });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (useCanvasLocal.getState().spaceHeld) e.preventDefault();
      setCanvasLocal({ spaceHeld: false });
    };
    const release = () => setCanvasLocal({ spaceHeld: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
      release();
    };
  }, []);
}

export interface CanvasCursor {
  /** 'select'면 대상마다 커서가 다르고(도형은 move, 선은 pointer), 그 밖에는 캔버스 전체가 한 가지 커서다 */
  kind: 'select' | 'forced';
  cursor: string;
}

/** 도구와 진행 중인 조작에 맞는 커서 */
export function useCanvasCursor(): CanvasCursor {
  const tool = useUi((s) => s.tool);
  const mode = useCanvasLocal((s) => s.mode);
  const spaceHeld = useCanvasLocal((s) => s.spaceHeld);
  const activeHandle = useCanvasLocal((s) => s.activeHandle);

  if (mode === 'pan') return { kind: 'forced', cursor: 'grabbing' };
  if (mode === 'move') return { kind: 'forced', cursor: 'move' };
  if (mode === 'resize') return { kind: 'forced', cursor: activeHandle ? HANDLE_CURSOR[activeHandle] : 'default' };
  if (mode === 'connect' || mode === 'edge-end') return { kind: 'forced', cursor: 'crosshair' };
  if (mode === 'marquee') return { kind: 'forced', cursor: 'default' };
  if (spaceHeld || tool === 'pan') return { kind: 'forced', cursor: 'grab' };
  if (tool === 'connect' || tool === 'connect-double') return { kind: 'forced', cursor: 'crosshair' };
  if (presetOfTool(tool)) return { kind: 'forced', cursor: 'crosshair' };
  return { kind: 'select', cursor: 'default' };
}
