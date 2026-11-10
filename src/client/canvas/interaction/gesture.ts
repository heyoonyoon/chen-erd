/**
 * 포인터 조작(gesture)의 공통 틀. 포인터를 누르면 조작 하나가 만들어지고, 뗄 때까지 그 조작만 이벤트를 받는다.
 * [담당: canvas 에이전트]
 */
import type { Point } from '../../../shared/types';
import type { Room } from '../../collab/room';
import { ui } from '../../state/ui';
import { clientToWorld } from '../coords';

/** 포인터 이벤트에서 조작에 필요한 값만 뽑은 것(React 이벤트 객체를 붙들지 않기 위해) */
export interface PointerSnap {
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

export function snapOf(e: {
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): PointerSnap {
  return {
    clientX: e.clientX,
    clientY: e.clientY,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    ctrlKey: e.ctrlKey,
  };
}

export interface GestureCtx {
  room: Room;
  /** 캔버스 영역 요소(화면 좌표의 기준) */
  root: Element;
}

export interface Gesture {
  /** 포인터가 움직였다 */
  move(p: PointerSnap): void;
  /** 포인터를 뗐다(정상 종료) */
  end(p: PointerSnap): void;
  /** Esc 등으로 취소. 문서에 반영한 것이 있으면 되돌린다 */
  cancel(): void;
}

/** 선택에 더하거나 빼는 클릭인지(Shift, Cmd, Ctrl) */
export function isAdditive(p: PointerSnap): boolean {
  return p.shiftKey || p.metaKey || p.ctrlKey;
}

/** 지금 뷰포트 기준으로 포인터의 월드 좌표를 구한다(조작 중 화면이 움직여도 맞게 따라간다). */
export function worldOf(ctx: GestureCtx, p: PointerSnap): Point {
  return clientToWorld(ctx.root, ui().viewport, p.clientX, p.clientY);
}

/**
 * 실행 취소 묶음을 연다. 닫을 때까지 생긴 변경은 시간 간격과 무관하게 실행 취소 한 단계가 된다.
 * (드래그 도중 잠깐 멈췄다 움직여도 단계가 갈라지지 않게 captureTimeout을 잠시 늘린다.)
 */
export function beginUndoGroup(room: Room): () => void {
  const um = room.undo;
  um.stopCapturing();
  const prev = um.captureTimeout;
  um.captureTimeout = Number.MAX_SAFE_INTEGER;
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    um.captureTimeout = prev;
    um.stopCapturing();
  };
}

/** 화면을 그릴 때마다 한 번만 실행되도록 묶는다. flush는 밀린 호출이 있으면 바로 실행한다. */
export function frameThrottle(fn: () => void): { schedule(): void; cancel(): void } {
  const raf: (cb: () => void) => number =
    typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 16) as unknown as number;
  const caf: (id: number) => void = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : (id) => clearTimeout(id);
  let handle: number | null = null;
  return {
    schedule() {
      if (handle != null) return;
      handle = raf(() => {
        handle = null;
        fn();
      });
    },
    cancel() {
      if (handle != null) caf(handle);
      handle = null;
    },
  };
}
