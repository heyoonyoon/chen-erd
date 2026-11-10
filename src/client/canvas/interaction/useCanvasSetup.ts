/**
 * 캔버스가 뜰 때 한 번 걸어 두는 것들: 영역 크기 추적, 처음 전체 보기, 스페이스 키 상태, 커서 모양.
 * [담당: canvas 에이전트]
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { diagramBounds } from '../../../shared/geometry';
import { presetOfTool } from '../../../shared/types';
import { useRoom, useSynced } from '../../collab/hooks';
import { ui, useUi } from '../../state/ui';
import { zoomToRect } from '../ViewportControls';
import { HANDLE_CURSOR } from './logic';
import { setCanvasLocal, useCanvasLocal } from './store';

/** 처음 전체 보기를 할 때 둘레에 두는 여백(화면 px) */
const INITIAL_FIT_PADDING = 80;

/** 캔버스 영역의 화면 크기를 ui.canvasSize에 맞춰 둔다. */
export function useCanvasSize(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      ui().setCanvasSize({ w: Math.round(r.width), h: Math.round(r.height) });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
}

/** 서버의 문서를 처음 다 받았을 때 한 번, 그려진 것이 있으면 전체가 보이게 맞춘다. */
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

/** 스페이스를 누르고 있는 동안 spaceHeld를 켠다. 입력창에 포커스가 있으면 건드리지 않는다. */
export function useSpaceKey(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTypingTarget(e.target)) return;
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
