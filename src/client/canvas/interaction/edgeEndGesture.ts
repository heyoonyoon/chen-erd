/**
 * 선의 끝점 손잡이를 끌어 그 끝이 붙는 면(고정점)을 바꾼다. 다른 도형으로 옮겨 붙이지는 않는다.
 * [담당: canvas 에이전트]
 */
import { nearestSide } from '../../../shared/geometry';
import { updateEdge } from '../../collab/docOps';
import { ui } from '../../state/ui';
import { worldOf, type Gesture, type GestureCtx, type PointerSnap } from './gesture';
import { ANCHOR_SNAP_DISTANCE, exceedsThreshold, resolveEndDrop } from './logic';
import { setCanvasLocal } from './store';

export type EdgeEnd = 'source' | 'target';

export function startEdgeEnd(ctx: GestureCtx, down: PointerSnap, edgeId: string, end: EdgeEnd): Gesture | null {
  const { room } = ctx;
  const edge = room.edges.get(edgeId);
  if (!edge) return null;
  const nodeId = end === 'source' ? edge.source : edge.target;
  if (!room.nodes.has(nodeId)) return null;
  const key = end === 'source' ? 'sourceSide' : 'targetSide';
  let started = false;

  const snapDist = (): number => ANCHOR_SNAP_DISTANCE / ui().viewport.zoom;
  const clear = (): void => setCanvasLocal({ edgeEndDrag: null });

  return {
    move(p) {
      if (!started) {
        if (!exceedsThreshold(down.clientX, down.clientY, p.clientX, p.clientY)) return;
        started = true;
        setCanvasLocal({ mode: 'edge-end', hostId: null });
      }
      const node = room.nodes.get(nodeId);
      if (!node) return;
      const to = worldOf(ctx, p);
      setCanvasLocal({ edgeEndDrag: { edgeId, end, nodeId, to, side: nearestSide(node, to, snapDist()) } });
    },
    end(p) {
      if (!started) return;
      clear();
      const node = room.nodes.get(nodeId);
      const current = room.edges.get(edgeId);
      if (!node || !current) return;
      const drop = resolveEndDrop(node, worldOf(ctx, p), snapDist());
      if (drop.kind === 'none') return;
      const next = drop.kind === 'side' ? drop.side : undefined;
      if (current[key] === next) return;
      // 앞뒤 작업과 섞이지 않게 실행 취소 한 단계로 끊는다
      room.undo.stopCapturing();
      updateEdge(room.doc, edgeId, { [key]: next });
      room.undo.stopCapturing();
    },
    cancel() {
      // 놓기 전에는 문서를 건드리지 않으므로 표시만 지우면 된다
      clear();
    },
  };
}
