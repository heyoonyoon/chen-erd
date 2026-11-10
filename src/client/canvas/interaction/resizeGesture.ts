/**
 * 손잡이를 끌어 도형 크기를 바꾼다. [담당: canvas 에이전트]
 */
import { nodeRect } from '../../../shared/geometry';
import { MIN_NODE_SIZE, type Rect } from '../../../shared/types';
import { updateNode } from '../../collab/docOps';
import { beginUndoGroup, frameThrottle, worldOf, type Gesture, type GestureCtx, type PointerSnap } from './gesture';
import { exceedsThreshold, resizeRect, roundRect, type Handle } from './logic';
import { setCanvasLocal } from './store';

export function startResize(ctx: GestureCtx, down: PointerSnap, nodeId: string, handle: Handle): Gesture | null {
  const { room } = ctx;
  const node = room.nodes.get(nodeId);
  if (!node || node.kind === 'spec') return null;

  const orig: Rect = nodeRect(node);
  const startWorld = worldOf(ctx, down);
  let last = down;
  let closeUndo: (() => void) | null = null;

  const current = (): Rect => {
    const w = worldOf(ctx, last);
    return resizeRect(orig, handle, w.x - startWorld.x, w.y - startWorld.y, MIN_NODE_SIZE);
  };
  const frame = frameThrottle(() => {
    if (closeUndo) updateNode(room.doc, nodeId, current());
  });
  const finish = (): void => {
    frame.cancel();
    closeUndo?.();
    closeUndo = null;
  };

  return {
    move(p) {
      last = p;
      if (!closeUndo) {
        if (!exceedsThreshold(down.clientX, down.clientY, p.clientX, p.clientY)) return;
        closeUndo = beginUndoGroup(room);
        setCanvasLocal({ mode: 'resize', activeHandle: handle, hostId: null });
      }
      frame.schedule();
    },
    end(p) {
      last = p;
      if (!closeUndo) return;
      updateNode(room.doc, nodeId, roundRect(current()));
      finish();
    },
    cancel() {
      if (!closeUndo) return;
      updateNode(room.doc, nodeId, orig);
      finish();
    },
  };
}
