/**
 * 연결 점(또는 연결 도구에서 도형 몸통)에서 끌어 선을 잇는다. [담당: canvas 에이전트]
 */
import { pointInNode } from '../../../shared/geometry';
import { canConnect, defaultEdgeProps, edgeCanBeDouble } from '../../../shared/rules';
import type { ErdNode, Point, Side } from '../../../shared/types';
import { addEdge, addNode, createEdge, createNodeFromPreset, transact } from '../../collab/docOps';
import { growToFit } from '../../text/measure';
import { ui } from '../../state/ui';
import { isAdditive, worldOf, type Gesture, type GestureCtx, type PointerSnap } from './gesture';
import { ANCHOR_SNAP_DISTANCE, edgeSideProps, exceedsThreshold, pickConnectTarget, shouldStoreSides } from './logic';
import { setCanvasLocal } from './store';

/** 빈 곳에 놓았을 때 새 속성을 달아 줄 수 있는 출발 도형 */
const QUICK_ATTRIBUTE_SOURCES: ReadonlyArray<ErdNode['kind']> = ['entity', 'relationship', 'attribute'];

export interface ConnectOptions {
  /** 이중선으로 만들지(이중선 연결 도구) */
  double: boolean;
  /** 연결 점에서 끌기 시작했으면 그 면(몸통에서 끌었으면 없음) */
  sourceSide?: Side | null;
}

/** 연결 도구로 선을 하나 이은 뒤에는 선택 도구로 돌아간다(도구 잠금이면 유지). */
function leaveConnectTool(): void {
  const u = ui();
  if ((u.tool === 'connect' || u.tool === 'connect-double') && !u.toolLocked) u.setTool('select');
}

export function startConnect(ctx: GestureCtx, down: PointerSnap, sourceId: string, opts: ConnectOptions): Gesture {
  const { room } = ctx;
  const sourceSide = opts.sourceSide ?? null;
  let started = false;

  const clearDraft = (): void => {
    ui().setConnectDraft(null);
    setCanvasLocal({ connectReason: null, connectSourceSide: null, connectShowAnchors: false, connectTargetSide: null });
  };

  interface DraftState {
    source: ErdNode;
    target: ErdNode | null;
    /** 대상의 고정점에 달라붙었으면 그 면 */
    targetSide: Side | null;
    valid: boolean;
    to: Point;
  }

  /** 마우스 아래 후보를 찾아 임시 선 상태를 갱신한다. source가 사라졌으면 null */
  const update = (p: PointerSnap): DraftState | null => {
    const source = room.nodes.get(sourceId);
    if (!source) return null;
    const to = worldOf(ctx, p);
    const nodes = room.nodes.getSnapshot();
    const picked = pickConnectTarget(nodes, to, sourceId, ANCHOR_SNAP_DISTANCE / ui().viewport.zoom);
    const target = picked?.node ?? null;
    let valid = false;
    let reason: string | null = null;
    if (target) {
      const check = canConnect(source, target, room.edges.getSnapshot(), nodes);
      valid = check.ok;
      if (!check.ok) reason = check.reason ?? '연결할 수 없습니다';
    }
    // 고정점은 면을 저장하는 선(엔티티와 관계, 엔티티와 특수화 원)에서만 보여 주고 달라붙는다
    const showAnchors = target != null && valid && shouldStoreSides(source, target);
    const targetSide = showAnchors ? (picked?.side ?? null) : null;
    ui().setConnectDraft({ sourceId, to, targetId: target?.id ?? null, valid, double: opts.double });
    setCanvasLocal({ connectReason: reason, connectSourceSide: sourceSide, connectShowAnchors: showAnchors, connectTargetSide: targetSide });
    return { source, target, targetSide, valid, to };
  };

  const connectTo = (source: ErdNode, target: ErdNode, targetSide: Side | null): void => {
    const defaults = defaultEdgeProps(source, target);
    const double = defaults.double || (opts.double && edgeCanBeDouble(source, target));
    const edge = createEdge(source.id, target.id, { ...defaults, double, ...edgeSideProps(source, target, sourceSide, targetSide) });
    room.undo.stopCapturing();
    addEdge(room.doc, edge);
    ui().setSelection([edge.id]);
    leaveConnectTool();
  };

  /** 빈 곳에 놓으면 그 자리에 새 속성을 만들고 잇는다(속성을 빠르게 다는 용도). */
  const createAttributeAt = (source: ErdNode, at: Point): void => {
    if (!QUICK_ATTRIBUTE_SOURCES.includes(source.kind)) return;
    const node = createNodeFromPreset('attribute', at);
    Object.assign(node, growToFit(node, node.text) ?? {});
    if (!canConnect(source, node, room.edges.getSnapshot(), [...room.nodes.getSnapshot(), node]).ok) return;
    // 속성 선은 면을 저장하지 않는다(비스듬한 직선으로 둔다)
    const edge = createEdge(source.id, node.id, { ...defaultEdgeProps(source, node) });
    room.undo.stopCapturing();
    transact(room.doc, () => {
      addNode(room.doc, node);
      addEdge(room.doc, edge);
    });
    leaveConnectTool();
    ui().setSelection([node.id]);
    ui().setEditing(node.id);
  };

  return {
    move(p) {
      if (!started) {
        if (!exceedsThreshold(down.clientX, down.clientY, p.clientX, p.clientY)) return;
        started = true;
        setCanvasLocal({ mode: 'connect', hostId: null });
      }
      update(p);
    },
    end(p) {
      if (!started) {
        // 끌지 않고 눌렀다 뗀 경우는 그 도형을 선택한다
        if (isAdditive(p)) ui().toggleSelection(sourceId);
        else ui().setSelection([sourceId]);
        return;
      }
      const state = update(p);
      clearDraft();
      if (!state) return;
      const { source, target, targetSide, valid, to } = state;
      if (target) {
        if (valid) connectTo(source, target, targetSide);
        return;
      }
      // 출발 도형 위에서 놓은 것은 취소로 본다
      if (pointInNode(source, to)) return;
      createAttributeAt(source, to);
    },
    cancel() {
      clearDraft();
    },
  };
}
