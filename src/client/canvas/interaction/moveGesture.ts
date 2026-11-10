/**
 * 도형 클릭 선택과 이동. 선택된 노드를 함께 옮기고 정렬 안내선에 붙인다. [담당: canvas 에이전트]
 */
import { nodeRect, rectsIntersect, unionBounds } from '../../../shared/geometry';
import type { Point, Rect } from '../../../shared/types';
import { updateNodes } from '../../collab/docOps';
import { ui } from '../../state/ui';
import { visibleWorldRect } from '../coords';
import { computeSnap } from '../snap';
import { beginUndoGroup, frameThrottle, isAdditive, worldOf, type Gesture, type GestureCtx, type PointerSnap } from './gesture';
import { SNAP_DISTANCE, exceedsThreshold } from './logic';
import { setCanvasLocal } from './store';

interface DragState {
  /** 이동 시작 때의 위치 */
  origins: Map<string, Rect>;
  /** 이동하는 도형 전체를 감싼 사각형(시작 위치) */
  bounds: Rect;
  /** 붙을 대상이 되는 나머지 도형들 */
  others: Rect[];
  closeUndo: () => void;
}

/**
 * 노드를 누른 순간 호출한다. 선택을 정리하고, 끌 수 있는 상태면 조작을 돌려준다.
 * (Shift 클릭으로 선택에서 빠진 경우에는 null)
 */
export function startMove(ctx: GestureCtx, down: PointerSnap, nodeId: string): Gesture | null {
  const { room } = ctx;
  // 여러 개가 선택된 상태에서 그중 하나를 그냥 클릭하면(끌지 않으면) 그것만 남긴다
  let collapseOnClick = false;
  if (isAdditive(down)) {
    ui().toggleSelection(nodeId);
    if (!ui().selection.includes(nodeId)) return null;
  } else if (!ui().selection.includes(nodeId)) {
    ui().setSelection([nodeId]);
  } else {
    collapseOnClick = ui().selection.length > 1;
  }

  const startWorld = worldOf(ctx, down);
  let last = down;
  let drag: DragState | null = null;

  const begin = (): boolean => {
    const origins = new Map<string, Rect>();
    for (const id of ui().selection) {
      const n = room.nodes.get(id);
      if (n) origins.set(id, nodeRect(n));
    }
    const bounds = unionBounds(Array.from(origins.values()));
    if (!bounds) return false;
    // 화면에 보이는 도형에만 붙는다(멀리 있는 도형에 붙으면 이유를 알 수 없다)
    const u = ui();
    const visible = u.canvasSize.w > 0 ? visibleWorldRect(u.viewport, u.canvasSize) : null;
    const others: Rect[] = [];
    for (const n of room.nodes.getSnapshot()) {
      if (origins.has(n.id)) continue;
      const r = nodeRect(n);
      if (!visible || rectsIntersect(visible, r)) others.push(r);
    }
    drag = { origins, bounds, others, closeUndo: beginUndoGroup(room) };
    setCanvasLocal({ mode: 'move', hostId: null });
    return true;
  };

  /** 지금 포인터 위치에 해당하는 이동량(맞춤 보정 포함) */
  const delta = (d: DragState): Point => {
    const w = worldOf(ctx, last);
    let dx = w.x - startWorld.x;
    let dy = w.y - startWorld.y;
    if (ui().snapEnabled && !last.altKey) {
      const moved = { x: d.bounds.x + dx, y: d.bounds.y + dy, w: d.bounds.w, h: d.bounds.h };
      const snap = computeSnap(moved, d.others, SNAP_DISTANCE / ui().viewport.zoom);
      dx += snap.dx;
      dy += snap.dy;
      ui().setGuides(snap.guides);
    } else {
      ui().setGuides([]);
    }
    return { x: dx, y: dy };
  };

  const write = (d: DragState, dx: number, dy: number, round: boolean): void => {
    const patches = Array.from(d.origins, ([id, o]) => ({
      id,
      patch: round ? { x: Math.round(o.x + dx), y: Math.round(o.y + dy) } : { x: o.x + dx, y: o.y + dy },
    }));
    updateNodes(room.doc, patches);
  };

  const frame = frameThrottle(() => {
    if (!drag) return;
    const { x, y } = delta(drag);
    write(drag, x, y, false);
  });

  const finish = (d: DragState): void => {
    frame.cancel();
    ui().setGuides([]);
    d.closeUndo();
    drag = null;
  };

  return {
    move(p) {
      last = p;
      if (!drag) {
        if (!exceedsThreshold(down.clientX, down.clientY, p.clientX, p.clientY)) return;
        if (!begin()) return;
      }
      frame.schedule();
    },
    end(p) {
      last = p;
      if (drag) {
        const { x, y } = delta(drag);
        write(drag, x, y, true);
        finish(drag);
      } else if (collapseOnClick) {
        ui().setSelection([nodeId]);
      }
    },
    cancel() {
      if (!drag) return;
      write(drag, 0, 0, false);
      finish(drag);
    },
  };
}
