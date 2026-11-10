/**
 * 캔버스 svg의 포인터 이벤트를 받아 조작 하나로 넘긴다. 포인터 하나에 조작 하나만 활성화된다.
 * [담당: canvas 에이전트]
 */
import { useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { nodeRect } from '../../../shared/geometry';
import { edgeCanBeDouble, edgeHasCardinality } from '../../../shared/rules';
import { presetOfTool, type Side } from '../../../shared/types';
import { updateEdge } from '../../collab/docOps';
import { useRoom } from '../../collab/hooks';
import type { Room } from '../../collab/room';
import { ui } from '../../state/ui';
import { clientToWorld } from '../coords';
import { startConnect } from './connectGesture';
import { startEdgeEnd, type EdgeEnd } from './edgeEndGesture';
import { isAdditive, snapOf, type Gesture, type GestureCtx, type PointerSnap } from './gesture';
import { CONNECT_DOT_OFFSET, CONNECT_DOT_RADIUS, inExpandedRect, isHandle, isSide, nextCardinality, type Handle } from './logic';
import { startMove } from './moveGesture';
import { startResize } from './resizeGesture';
import { startMarquee, startPan, startPlace } from './simpleGestures';
import { canvasLocal, resetCanvasLocal, setCanvasLocal } from './store';

/** 포인터 아래에 무엇이 있는지 */
export interface Hit {
  nodeId: string | null;
  edgeId: string | null;
  /** 크기 조절 손잡이 */
  handle: Handle | null;
  /** 연결 점이 붙어 있는 노드 id */
  connectFrom: string | null;
  /** 그 연결 점의 면 */
  connectSide: Side | null;
  /** 선의 끝점 손잡이(edgeId도 함께 채운다) */
  edgeEnd: EdgeEnd | null;
}

const NO_HIT: Hit = { nodeId: null, edgeId: null, handle: null, connectFrom: null, connectSide: null, edgeEnd: null };

export function hitOf(el: EventTarget | null): Hit {
  if (!el || typeof (el as Element).closest !== 'function') return NO_HIT;
  const target = el as Element;
  const endEl = target.closest('[data-edge-end]');
  if (endEl) {
    const end = endEl.getAttribute('data-edge-end');
    const edgeId = endEl.getAttribute('data-edge-end-of');
    if ((end === 'source' || end === 'target') && edgeId) return { ...NO_HIT, edgeEnd: end, edgeId };
  }
  const dot = target.closest('[data-connect-from]');
  if (dot) {
    const side = dot.getAttribute('data-side');
    return { ...NO_HIT, connectFrom: dot.getAttribute('data-connect-from'), connectSide: isSide(side) ? side : null };
  }
  const handleEl = target.closest('[data-handle]');
  if (handleEl) {
    const handle = handleEl.getAttribute('data-handle');
    if (isHandle(handle)) return { ...NO_HIT, handle, nodeId: handleEl.getAttribute('data-handle-node') };
  }
  const nodeEl = target.closest('[data-node-id]');
  if (nodeEl) return { ...NO_HIT, nodeId: nodeEl.getAttribute('data-node-id') };
  const edgeEl = target.closest('[data-edge-id]');
  if (edgeEl) return { ...NO_HIT, edgeId: edgeEl.getAttribute('data-edge-id') };
  return NO_HIT;
}

/**
 * 좌표로 대상을 찾는다. 포인터를 붙잡고(setPointerCapture) 있던 직후의 click/dblclick은
 * target이 svg 자체로 오기 때문에 event.target만으로는 대상을 알 수 없다.
 */
function hitAt(svg: Element, clientX: number, clientY: number, fallback: EventTarget | null): Hit {
  const el = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(clientX, clientY) : null;
  if (el && svg.contains(el)) return hitOf(el);
  return hitOf(fallback);
}

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** 연결 점이 떠 있는 동안 마우스가 도형과 점 사이의 빈틈을 지나도 점이 사라지지 않게 하는 여유(화면 px) */
const HOST_MARGIN = CONNECT_DOT_OFFSET + CONNECT_DOT_RADIUS + 8;

function onEdgeDoubleClick(room: Room, edgeId: string): void {
  const edge = room.edges.get(edgeId);
  if (!edge) return;
  const source = room.nodes.get(edge.source);
  const target = room.nodes.get(edge.target);
  if (!source || !target) return;
  if (edgeHasCardinality(source, target)) {
    updateEdge(room.doc, edgeId, { label: nextCardinality(edge.label) });
  } else if (edgeCanBeDouble(source, target)) {
    updateEdge(room.doc, edgeId, { double: !edge.double });
  }
}

export interface CanvasPointerHandlers {
  onPointerDown(e: ReactPointerEvent<SVGSVGElement>): void;
  onPointerMove(e: ReactPointerEvent<SVGSVGElement>): void;
  onPointerUp(e: ReactPointerEvent<SVGSVGElement>): void;
  onPointerCancel(e: ReactPointerEvent<SVGSVGElement>): void;
  onLostPointerCapture(e: ReactPointerEvent<SVGSVGElement>): void;
  onPointerLeave(e: ReactPointerEvent<SVGSVGElement>): void;
  onMouseDown(e: ReactMouseEvent<SVGSVGElement>): void;
  onDoubleClick(e: ReactMouseEvent<SVGSVGElement>): void;
  onContextMenu(e: ReactMouseEvent<SVGSVGElement>): void;
}

interface Active {
  gesture: Gesture;
  pointerId: number;
  svg: SVGSVGElement;
  last: PointerSnap;
}

export function usePointerInteractions(rootRef: RefObject<HTMLElement | null>): CanvasPointerHandlers {
  const room = useRoom();
  const activeRef = useRef<Active | null>(null);
  const stopRef = useRef<(how: 'end' | 'cancel', p?: PointerSnap) => void>(() => {});

  const handlers = useMemo<CanvasPointerHandlers>(() => {
    const ctx = (): GestureCtx | null => (rootRef.current ? { room, root: rootRef.current } : null);

    // 조작 중 Esc는 조작만 취소하고 전역 단축키(도구 바꾸기 등)로는 넘기지 않는다
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code !== 'Escape' || !activeRef.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      stop('cancel');
    };

    const start = (e: ReactPointerEvent<SVGSVGElement>, gesture: Gesture | null): void => {
      if (!gesture) return;
      const svg = e.currentTarget;
      activeRef.current = { gesture, pointerId: e.pointerId, svg, last: snapOf(e) };
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        // 포인터가 이미 사라진 경우 등. 붙잡지 못해도 조작은 계속할 수 있다
      }
      window.addEventListener('keydown', onKeyDown, true);
    };

    const stop = (how: 'end' | 'cancel', p?: PointerSnap): void => {
      const active = activeRef.current;
      if (!active) return;
      activeRef.current = null;
      window.removeEventListener('keydown', onKeyDown, true);
      try {
        if (how === 'end') active.gesture.end(p ?? active.last);
        else active.gesture.cancel();
      } finally {
        setCanvasLocal({ mode: 'idle', activeHandle: null });
        try {
          if (active.svg.hasPointerCapture(active.pointerId)) active.svg.releasePointerCapture(active.pointerId);
        } catch {
          // 이미 풀린 경우
        }
      }
    };
    stopRef.current = stop;

    /** 조작이 없을 때의 hover 갱신 */
    const hover = (e: ReactPointerEvent<SVGSVGElement>): void => {
      const root = rootRef.current;
      if (!root) return;
      const u = ui();
      const world = clientToWorld(root, u.viewport, e.clientX, e.clientY);
      const placing = presetOfTool(u.tool) != null;
      if (placing) {
        u.setHovered(null);
        setCanvasLocal({ placePos: world, hostId: null });
        return;
      }
      const hit = hitOf(e.target);
      u.setHovered(hit.connectFrom ?? hit.nodeId ?? hit.edgeId);

      // 연결 점을 띄울 노드: 마우스 아래 노드. 벗어나도 점까지 가는 길목에서는 유지한다
      let hostId = hit.connectFrom ?? hit.nodeId;
      if (!hostId) {
        const prev = canvasLocal().hostId;
        const prevNode = prev ? room.nodes.get(prev) : undefined;
        if (prevNode && inExpandedRect(nodeRect(prevNode), world, HOST_MARGIN / u.viewport.zoom)) hostId = prev;
      }
      setCanvasLocal({ hostId: hostId ?? null, placePos: null });
    };

    return {
      onPointerDown(e) {
        if (activeRef.current) return; // 이미 다른 포인터가 조작 중
        const c = ctx();
        if (!c) return;
        const u = ui();
        u.closeContextMenu();
        const p = snapOf(e);

        if (e.button === 1 || (e.button === 0 && (u.tool === 'pan' || canvasLocal().spaceHeld))) {
          start(e, startPan(p));
          return;
        }
        if (e.button !== 0) return;
        // macOS의 Ctrl+클릭은 우클릭이다(contextmenu 이벤트에서 처리)
        if (e.ctrlKey && isMac()) return;

        if (presetOfTool(u.tool)) {
          start(e, startPlace(c));
          return;
        }

        const hit = hitOf(e.target);
        const connectTool = u.tool === 'connect' || u.tool === 'connect-double';
        if (hit.edgeEnd && hit.edgeId) {
          start(e, startEdgeEnd(c, p, hit.edgeId, hit.edgeEnd));
          return;
        }
        if (hit.connectFrom) {
          start(e, startConnect(c, p, hit.connectFrom, { double: u.tool === 'connect-double', sourceSide: hit.connectSide }));
          return;
        }
        if (hit.handle && hit.nodeId) {
          start(e, startResize(c, p, hit.nodeId, hit.handle));
          return;
        }
        if (hit.nodeId) {
          if (connectTool) start(e, startConnect(c, p, hit.nodeId, { double: u.tool === 'connect-double' }));
          else start(e, startMove(c, p, hit.nodeId));
          return;
        }
        if (hit.edgeId) {
          if (isAdditive(p)) u.toggleSelection(hit.edgeId);
          else u.setSelection([hit.edgeId]);
          return;
        }
        start(e, startMarquee(c, p));
      },

      onPointerMove(e) {
        const active = activeRef.current;
        if (active) {
          if (e.pointerId !== active.pointerId) return;
          active.last = snapOf(e);
          active.gesture.move(active.last);
          // 도형 놓기 도구는 누르고 있는 동안에도 미리보기가 따라온다
          if (presetOfTool(ui().tool) && canvasLocal().mode === 'idle') hover(e);
          return;
        }
        if (e.buttons !== 0 && e.pointerType === 'mouse') return;
        hover(e);
      },

      onPointerUp(e) {
        const active = activeRef.current;
        if (!active || e.pointerId !== active.pointerId) return;
        stop('end', snapOf(e));
      },

      onPointerCancel(e) {
        const active = activeRef.current;
        if (!active || e.pointerId !== active.pointerId) return;
        stop('cancel');
      },

      onLostPointerCapture(e) {
        // 정상 종료라면 pointerup에서 이미 끝났다. 남아 있으면 붙잡기가 풀린 것이므로 취소한다
        const active = activeRef.current;
        if (!active || e.pointerId !== active.pointerId) return;
        stop('cancel');
      },

      onPointerLeave() {
        if (activeRef.current) return;
        ui().setHovered(null);
        setCanvasLocal({ hostId: null, placePos: null });
      },

      onMouseDown(e) {
        // 휠 버튼의 자동 스크롤을 막는다. 왼쪽 버튼은 막지 않는다(글자 입력창이 blur로 확정되어야 한다)
        if (e.button === 1) e.preventDefault();
      },

      onDoubleClick(e) {
        const u = ui();
        if (u.tool === 'pan' || presetOfTool(u.tool) || canvasLocal().spaceHeld) return;
        const hit = hitAt(e.currentTarget, e.clientX, e.clientY, e.target);
        if (hit.connectFrom || hit.handle || hit.edgeEnd) return;
        if (hit.nodeId) {
          if (!room.nodes.has(hit.nodeId)) return;
          u.setSelection([hit.nodeId]);
          u.setEditing(hit.nodeId);
        } else if (hit.edgeId) {
          onEdgeDoubleClick(room, hit.edgeId);
        }
      },

      onContextMenu(e) {
        e.preventDefault();
        stop('cancel');
        const root = rootRef.current;
        if (!root) return;
        const u = ui();
        const hit = hitAt(e.currentTarget, e.clientX, e.clientY, e.target);
        const targetId = hit.nodeId ?? hit.edgeId ?? hit.connectFrom;
        if (targetId) {
          if (!u.selection.includes(targetId)) u.setSelection([targetId]);
        } else {
          u.clearSelection();
        }
        u.openContextMenu({
          x: e.clientX,
          y: e.clientY,
          world: clientToWorld(root, u.viewport, e.clientX, e.clientY),
          targetId: targetId ?? null,
        });
      },
    };
  }, [room, rootRef]);

  // 화면을 떠날 때 진행 중인 조작을 정리한다
  useEffect(
    () => () => {
      stopRef.current('cancel');
      resetCanvasLocal();
    },
    [room],
  );

  return handlers;
}
