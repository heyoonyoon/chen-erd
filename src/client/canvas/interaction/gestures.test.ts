/**
 * 조작(gesture)이 문서와 화면 상태를 올바르게 바꾸는지 확인한다. 실제 Y.Doc과 UndoManager를 쓰고 웹소켓만 뺀다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { ErdEdge, ErdNode } from '../../../shared/types';
import { LOCAL_ORIGIN, addNodes, getEdgesMap, getMetaMap, getNodesMap, readEdge, readNode } from '../../collab/docOps';
import { ElementStore, type Room } from '../../collab/room';
import { ui, useUi } from '../../state/ui';
import { startConnect } from './connectGesture';
import type { GestureCtx, PointerSnap } from './gesture';
import { startMove } from './moveGesture';
import { startResize } from './resizeGesture';
import { placeNode, startMarquee } from './simpleGestures';
import { canvasLocal, resetCanvasLocal } from './store';

function makeRoom(): Room {
  const doc = new Y.Doc();
  const nodesMap = getNodesMap(doc);
  const edgesMap = getEdgesMap(doc);
  const undo = new Y.UndoManager([nodesMap, edgesMap, getMetaMap(doc)], {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: 400,
  });
  return {
    id: 'test',
    doc,
    undo,
    nodes: new ElementStore<ErdNode>(nodesMap, readNode),
    edges: new ElementStore<ErdEdge>(edgesMap, readEdge),
    setPresence() {},
    destroy() {},
  } as unknown as Room;
}

function makeCtx(room: Room): GestureCtx {
  // 캔버스 영역의 왼쪽 위가 화면 (0,0)이고 배율이 1이면 client 좌표가 곧 월드 좌표다
  const root = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }) } as unknown as Element;
  return { room, root };
}

function at(x: number, y: number, mods: Partial<PointerSnap> = {}): PointerSnap {
  return { clientX: x, clientY: y, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, ...mods };
}

function entity(id: string, x: number, y: number): ErdNode {
  return { id, kind: 'entity', x, y, w: 100, h: 50, text: id };
}
function relationship(id: string, x: number, y: number): ErdNode {
  return { id, kind: 'relationship', x, y, w: 100, h: 60, text: id };
}

let room: Room;
let ctx: GestureCtx;

beforeEach(() => {
  vi.useFakeTimers();
  useUi.getState().reset();
  resetCanvasLocal();
  ui().setSnapEnabled(false);
  room = makeRoom();
  ctx = makeCtx(room);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('이동', () => {
  beforeEach(() => {
    addNodes(room.doc, [entity('a', 0, 0), entity('b', 300, 0), entity('c', 600, 0)]);
    room.undo.stopCapturing();
  });

  it('선택되지 않은 노드를 누르면 그것만 선택한다', () => {
    ui().setSelection(['b']);
    startMove(ctx, at(10, 10), 'a');
    expect(ui().selection).toEqual(['a']);
  });

  it('Shift 클릭은 선택을 더하고, 이미 선택된 것은 뺀다(뺀 경우 조작이 없다)', () => {
    ui().setSelection(['b']);
    expect(startMove(ctx, at(10, 10, { shiftKey: true }), 'a')).not.toBeNull();
    expect(ui().selection).toEqual(['b', 'a']);
    expect(startMove(ctx, at(10, 10, { shiftKey: true }), 'a')).toBeNull();
    expect(ui().selection).toEqual(['b']);
  });

  it('여러 개가 선택된 상태에서 끌지 않고 떼면 누른 것만 남는다', () => {
    ui().setSelection(['a', 'b']);
    const g = startMove(ctx, at(10, 10), 'a')!;
    expect(ui().selection).toEqual(['a', 'b']);
    g.move(at(11, 11)); // 임계값 미만
    g.end(at(11, 11));
    expect(ui().selection).toEqual(['a']);
    expect(room.nodes.get('a')).toMatchObject({ x: 0, y: 0 });
  });

  it('선택된 노드를 함께 옮기고 좌표를 정수로 맞추며 실행 취소 한 단계가 된다', () => {
    ui().setSelection(['a', 'b']);
    const before = room.undo.undoStack.length;
    const g = startMove(ctx, at(10, 10), 'a')!;
    g.move(at(20, 10));
    expect(canvasLocal().mode).toBe('move');
    vi.advanceTimersByTime(20);
    expect(room.nodes.get('a')!.x).toBe(10); // 끄는 동안에도 문서에 반영된다
    // 드래그 도중 오래 멈췄다가 다시 움직여도 한 단계로 묶여야 한다
    vi.advanceTimersByTime(2000);
    g.move(at(40.4, 25.6));
    vi.advanceTimersByTime(20);
    g.end(at(40.4, 25.6));

    expect(room.nodes.get('a')).toMatchObject({ x: 30, y: 16 });
    expect(room.nodes.get('b')).toMatchObject({ x: 330, y: 16 });
    expect(room.nodes.get('c')).toMatchObject({ x: 600, y: 0 });
    expect(room.undo.undoStack.length).toBe(before + 1);
    expect(room.undo.captureTimeout).toBe(400);

    room.undo.undo();
    expect(room.nodes.get('a')).toMatchObject({ x: 0, y: 0 });
    expect(room.nodes.get('b')).toMatchObject({ x: 300, y: 0 });
  });

  it('취소하면 원래 위치로 돌아가고 안내선이 지워진다', () => {
    ui().setSelection(['a']);
    const g = startMove(ctx, at(10, 10), 'a')!;
    g.move(at(100, 100));
    vi.advanceTimersByTime(20);
    expect(room.nodes.get('a')!.x).toBe(90);
    g.cancel();
    expect(room.nodes.get('a')).toMatchObject({ x: 0, y: 0 });
    expect(ui().guides).toEqual([]);
    expect(room.undo.captureTimeout).toBe(400);
  });

  it('화면 배율을 반영해 월드 거리만큼 옮긴다', () => {
    ui().setViewport({ x: 0, y: 0, zoom: 2 });
    ui().setSelection(['a']);
    const g = startMove(ctx, at(10, 10), 'a')!;
    g.move(at(110, 10));
    g.end(at(110, 10));
    expect(room.nodes.get('a')!.x).toBe(50);
  });
});

describe('크기 조절', () => {
  beforeEach(() => {
    addNodes(room.doc, [entity('a', 0, 0), { id: 's', kind: 'spec', x: 300, y: 0, w: 34, h: 34, text: '', specType: 'd' }]);
    room.undo.stopCapturing();
  });

  it('손잡이를 끈 만큼 커지고 취소하면 되돌아간다', () => {
    const g = startResize(ctx, at(100, 50), 'a', 'se')!;
    g.move(at(140, 70));
    expect(canvasLocal()).toMatchObject({ mode: 'resize', activeHandle: 'se' });
    g.end(at(140.3, 70.2));
    expect(room.nodes.get('a')).toMatchObject({ x: 0, y: 0, w: 140, h: 70 });

    const g2 = startResize(ctx, at(0, 0), 'a', 'nw')!;
    g2.move(at(-50, -50));
    vi.advanceTimersByTime(20);
    expect(room.nodes.get('a')).toMatchObject({ x: -50, y: -50, w: 190, h: 120 });
    g2.cancel();
    expect(room.nodes.get('a')).toMatchObject({ x: 0, y: 0, w: 140, h: 70 });
  });

  it('특수화 원은 크기를 바꿀 수 없다', () => {
    expect(startResize(ctx, at(300, 0), 's', 'se')).toBeNull();
  });
});

describe('상자 선택', () => {
  beforeEach(() => {
    addNodes(room.doc, [entity('a', 0, 0), entity('b', 300, 0), entity('c', 600, 0)]);
  });

  it('끄는 동안 겹치는 노드를 선택하고 끝나면 사각형을 지운다', () => {
    const g = startMarquee(ctx, at(-20, -20));
    g.move(at(320, 30));
    expect(ui().marquee).toEqual({ x: -20, y: -20, w: 340, h: 50 });
    expect(ui().selection).toEqual(['a', 'b']);
    g.end(at(50, 30));
    expect(ui().selection).toEqual(['a']);
    expect(ui().marquee).toBeNull();
  });

  it('빈 곳을 그냥 클릭하면 선택을 해제하고, Shift 클릭이면 유지한다', () => {
    ui().setSelection(['a']);
    const g = startMarquee(ctx, at(900, 600));
    g.end(at(900, 600));
    expect(ui().selection).toEqual([]);

    ui().setSelection(['a']);
    const g2 = startMarquee(ctx, at(900, 600, { shiftKey: true }));
    g2.end(at(900, 600, { shiftKey: true }));
    expect(ui().selection).toEqual(['a']);
  });

  it('Shift를 누른 채 끌면 기존 선택에 더하고, 취소하면 원래 선택으로 돌아간다', () => {
    ui().setSelection(['c']);
    const g = startMarquee(ctx, at(-20, -20, { shiftKey: true }));
    g.move(at(50, 30, { shiftKey: true }));
    expect(ui().selection).toEqual(['c', 'a']);
    g.cancel();
    expect(ui().selection).toEqual(['c']);
    expect(ui().marquee).toBeNull();
  });
});

describe('연결', () => {
  beforeEach(() => {
    addNodes(room.doc, [entity('e', 0, 0), relationship('r', 300, 0)]);
    room.undo.stopCapturing();
  });

  it('다른 도형 위에 놓으면 선이 생기고 그 선이 선택된다', () => {
    const g = startConnect(ctx, at(50, 25), 'e', { double: false });
    g.move(at(200, 30));
    expect(ui().connectDraft).toMatchObject({ sourceId: 'e', targetId: null, double: false });
    g.move(at(350, 30));
    expect(ui().connectDraft).toMatchObject({ sourceId: 'e', targetId: 'r', valid: true });
    g.end(at(350, 30));

    expect(ui().connectDraft).toBeNull();
    const edges = room.edges.getSnapshot();
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: 'e', target: 'r' });
    expect(ui().selection).toEqual([edges[0].id]);
  });

  it('이중선 도구로 이으면 이중선이 된다', () => {
    const g = startConnect(ctx, at(50, 25), 'e', { double: true });
    g.move(at(350, 30));
    g.end(at(350, 30));
    expect(room.edges.getSnapshot()[0].double).toBe(true);
  });

  it('연결 도구로 이은 뒤에는 선택 도구로 돌아가고, 도구 잠금이면 유지한다', () => {
    ui().setTool('connect');
    const g = startConnect(ctx, at(50, 25), 'e', { double: false });
    g.move(at(350, 30));
    g.end(at(350, 30));
    expect(ui().tool).toBe('select');

    ui().setTool('connect', true);
    const g2 = startConnect(ctx, at(350, 30), 'r', { double: false });
    g2.move(at(700, 400));
    g2.end(at(700, 400));
    expect(ui().tool).toBe('connect');
  });

  it('빈 곳에 놓으면 그 자리에 속성을 만들어 잇고 글자 편집으로 들어간다(실행 취소 한 단계)', () => {
    const before = room.undo.undoStack.length;
    const g = startConnect(ctx, at(50, 25), 'e', { double: false });
    g.move(at(60, 200));
    g.end(at(60, 200));

    const nodes = room.nodes.getSnapshot();
    expect(nodes).toHaveLength(3);
    const attr = nodes.find((n) => n.kind === 'attribute')!;
    expect(attr.x + attr.w / 2).toBeCloseTo(60, 0);
    expect(attr.y + attr.h / 2).toBeCloseTo(200, 0);
    expect(room.edges.getSnapshot()).toMatchObject([{ source: 'e', target: attr.id, double: false }]);
    expect(ui().selection).toEqual([attr.id]);
    expect(ui().editingId).toBe(attr.id);
    expect(room.undo.undoStack.length).toBe(before + 1);

    room.undo.undo();
    expect(room.nodes.getSnapshot()).toHaveLength(2);
    expect(room.edges.getSnapshot()).toHaveLength(0);
  });

  it('출발 도형 위에서 놓거나 취소하면 아무것도 만들지 않는다', () => {
    const g = startConnect(ctx, at(50, 25), 'e', { double: false });
    g.move(at(60, 30));
    g.end(at(60, 30));
    expect(room.nodes.getSnapshot()).toHaveLength(2);
    expect(room.edges.getSnapshot()).toHaveLength(0);

    const g2 = startConnect(ctx, at(50, 25), 'e', { double: false });
    g2.move(at(350, 30));
    g2.cancel();
    expect(ui().connectDraft).toBeNull();
    expect(room.edges.getSnapshot()).toHaveLength(0);
  });

  it('끌지 않고 떼면 그 도형을 선택한다', () => {
    const g = startConnect(ctx, at(50, 25), 'e', { double: false });
    g.end(at(50, 25));
    expect(ui().selection).toEqual(['e']);
    expect(room.edges.getSnapshot()).toHaveLength(0);
  });
});

describe('도형 놓기', () => {
  it('놓은 도형을 선택하고 편집으로 들어가며 선택 도구로 돌아간다', () => {
    ui().setTool('place:entity');
    const id = placeNode(ctx, 'entity', { x: 200, y: 100 });
    const n = room.nodes.get(id)!;
    expect(n.kind).toBe('entity');
    expect(n.x + n.w / 2).toBeCloseTo(200, 0);
    expect(n.y + n.h / 2).toBeCloseTo(100, 0);
    expect(ui().selection).toEqual([id]);
    expect(ui().editingId).toBe(id);
    expect(ui().tool).toBe('select');
  });

  it('도구 잠금이면 도구를 유지하고, 특수화 원은 편집으로 들어가지 않는다', () => {
    ui().setTool('place:spec-d', true);
    const id = placeNode(ctx, 'spec-d', { x: 0, y: 0 });
    expect(room.nodes.get(id)).toMatchObject({ kind: 'spec', specType: 'd' });
    expect(ui().editingId).toBeNull();
    expect(ui().tool).toBe('place:spec-d');
  });
});
