/**
 * 상자 선택, 화면 이동, 도형 놓기. [담당: canvas 에이전트]
 */
import { presetOfTool, type Point, type PresetId } from '../../../shared/types';
import { addNode, createNodeFromPreset } from '../../collab/docOps';
import { growToFit } from '../../text/measure';
import { ui } from '../../state/ui';
import { panBy } from '../ViewportControls';
import { isAdditive, worldOf, type Gesture, type GestureCtx, type PointerSnap } from './gesture';
import { exceedsThreshold, marqueeSelection, rectFromPoints } from './logic';
import { setCanvasLocal } from './store';

/** 빈 곳에서 끌어 상자로 선택한다. 끌지 않고 뗐으면 선택을 해제한다(Shift 클릭이면 유지). */
export function startMarquee(ctx: GestureCtx, down: PointerSnap): Gesture {
  const { room } = ctx;
  const additive = isAdditive(down);
  const original = ui().selection;
  const base = additive ? original : [];
  const startWorld = worldOf(ctx, down);
  let started = false;

  const update = (p: PointerSnap): void => {
    const rect = rectFromPoints(startWorld, worldOf(ctx, p));
    ui().setMarquee(rect);
    ui().setSelection(marqueeSelection(rect, room.nodes.getSnapshot(), room.edges.getSnapshot(), base));
  };

  return {
    move(p) {
      if (!started) {
        if (!exceedsThreshold(down.clientX, down.clientY, p.clientX, p.clientY)) return;
        started = true;
        setCanvasLocal({ mode: 'marquee', hostId: null });
      }
      update(p);
    },
    end(p) {
      if (started) {
        update(p);
        ui().setMarquee(null);
      } else if (!additive) {
        ui().clearSelection();
      }
    },
    cancel() {
      if (!started) return;
      ui().setMarquee(null);
      ui().setSelection(original);
    },
  };
}

/** 화면 이동(손 도구, 스페이스+드래그, 휠 버튼 드래그) */
export function startPan(down: PointerSnap): Gesture {
  let lastX = down.clientX;
  let lastY = down.clientY;
  setCanvasLocal({ mode: 'pan', hostId: null });
  const step = (p: PointerSnap): void => {
    const dx = p.clientX - lastX;
    const dy = p.clientY - lastY;
    lastX = p.clientX;
    lastY = p.clientY;
    if (dx !== 0 || dy !== 0) panBy(dx, dy);
  };
  return { move: step, end: step, cancel() {} };
}

/** center 자리에 프리셋 도형을 놓고 선택한 뒤 글자 편집으로 들어간다. 새 노드 id를 돌려준다. */
export function placeNode(ctx: GestureCtx, presetId: PresetId, center: Point): string {
  const { room } = ctx;
  const node = createNodeFromPreset(presetId, center);
  // 기본 글자가 프리셋 크기를 넘치면(글꼴 차이 등) 중심을 유지한 채 키운다
  if (node.kind !== 'spec') Object.assign(node, growToFit(node, node.text) ?? {});
  room.undo.stopCapturing();
  addNode(room.doc, node);
  const u = ui();
  if (!u.toolLocked) u.setTool('select');
  u.setSelection([node.id]);
  // 특수화 원은 글자가 없으므로 편집으로 들어가지 않는다
  if (node.kind !== 'spec') u.setEditing(node.id);
  return node.id;
}

/**
 * 도형 놓기 도구의 클릭. 포인터를 뗄 때 놓는다.
 * (누를 때 놓으면 뒤따르는 mousedown 기본 동작이 방금 띄운 입력창의 포커스를 빼앗는다.)
 */
export function startPlace(ctx: GestureCtx): Gesture {
  return {
    move() {},
    end(p) {
      const presetId = presetOfTool(ui().tool);
      if (presetId) placeNode(ctx, presetId, worldOf(ctx, p));
    },
    cancel() {},
  };
}
