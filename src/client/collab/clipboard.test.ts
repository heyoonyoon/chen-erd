import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { ErdEdge, ErdNode } from '../../shared/types';
import { useUi } from '../state/ui';
import {
  CLIP_TYPE,
  clipFromSelection,
  copySelection,
  cutSelection,
  duplicateSelection,
  hasClipboard,
  instantiateClip,
  parseClip,
  paste,
  pasteText,
  resetClipboardForTest,
  serializeSelection,
} from './clipboard';
import { LOCAL_ORIGIN, addEdges, addNodes, getEdgesMap, getMetaMap, getNodesMap, readEdge, readNode } from './docOps';
import { ElementStore, type Room } from './room';

function node(id: string, x: number, y: number, extra: Partial<ErdNode> = {}): ErdNode {
  return { id, kind: 'entity', x, y, w: 100, h: 50, text: id, ...extra };
}
function edge(id: string, source: string, target: string, extra: Partial<ErdEdge> = {}): ErdEdge {
  return { id, source, target, double: false, label: '', role: '', ...extra };
}

const NODES: ErdNode[] = [
  node('a', 0, 0, { text: '학생' }),
  node('b', 200, 0, { kind: 'relationship', identifying: true, text: '수강' }),
  node('c', 400, 100, { kind: 'attribute', keyType: 'key', multivalued: true, text: '학번' }),
  node('d', 600, 0, { kind: 'spec', specType: 'o', text: '' }),
];
const EDGES: ErdEdge[] = [
  edge('ab', 'a', 'b', { double: true, label: 'N', role: '수강생' }),
  edge('bc', 'b', 'c'),
  edge('cd', 'c', 'd'),
];

/** 순서대로 id를 내주는 생성기 */
function counter(prefix = 'new'): () => string {
  let i = 0;
  return () => `${prefix}${++i}`;
}

describe('serializeSelection / parseClip', () => {
  it('선택한 노드와 그 사이의 엣지를 담아 왕복한다', () => {
    const text = serializeSelection(NODES, EDGES, ['a', 'b', 'c']);
    expect(text).not.toBeNull();
    const clip = parseClip(text);
    expect(clip).toEqual({
      type: CLIP_TYPE,
      nodes: [NODES[0], NODES[1], NODES[2]],
      edges: [EDGES[0], EDGES[1]],
    });
  });

  it('노드의 플래그와 엣지 속성이 그대로 남는다', () => {
    const clip = parseClip(serializeSelection(NODES, EDGES, ['a', 'b', 'c', 'd']))!;
    expect(clip.nodes.find((n) => n.id === 'b')).toMatchObject({ kind: 'relationship', identifying: true });
    expect(clip.nodes.find((n) => n.id === 'c')).toMatchObject({ keyType: 'key', multivalued: true });
    expect(clip.nodes.find((n) => n.id === 'd')).toMatchObject({ kind: 'spec', specType: 'o' });
    expect(clip.edges.find((e) => e.id === 'ab')).toEqual(EDGES[0]);
  });

  it('한쪽 끝이 선택 밖에 있는 엣지는 뺀다', () => {
    // bc는 선택했더라도 c가 선택되지 않았으므로 담기지 않는다
    const clip = clipFromSelection(NODES, EDGES, ['a', 'b', 'bc'])!;
    expect(clip.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(clip.edges.map((e) => e.id)).toEqual(['ab']);
  });

  it('엣지를 따로 고르지 않아도 선택한 노드 사이의 엣지는 따라온다', () => {
    const clip = clipFromSelection(NODES, EDGES, ['b', 'c'])!;
    expect(clip.edges.map((e) => e.id)).toEqual(['bc']);
  });

  it('노드가 없으면 복사할 것이 없다', () => {
    expect(serializeSelection(NODES, EDGES, [])).toBeNull();
    expect(serializeSelection(NODES, EDGES, ['ab'])).toBeNull();
    expect(serializeSelection(NODES, EDGES, ['없는 id'])).toBeNull();
  });

  it('원본을 바꿔도 클립은 바뀌지 않는다', () => {
    const nodes = [node('a', 0, 0)];
    const clip = clipFromSelection(nodes, [], ['a'])!;
    nodes[0].x = 999;
    expect(clip.nodes[0].x).toBe(0);
  });

  it('다른 글자나 깨진 JSON은 null', () => {
    expect(parseClip('')).toBeNull();
    expect(parseClip(null)).toBeNull();
    expect(parseClip('안녕하세요')).toBeNull();
    expect(parseClip('{"type":"chen-erd/clip"')).toBeNull();
    expect(parseClip('{"type":"other","nodes":[]}')).toBeNull();
    expect(parseClip(JSON.stringify({ type: CLIP_TYPE, nodes: [] }))).toBeNull();
    expect(parseClip(JSON.stringify({ type: CLIP_TYPE, nodes: 'x' }))).toBeNull();
  });

  it('형식이 틀린 요소와 끝점이 없는 엣지는 버리고, 모르는 필드는 담지 않는다', () => {
    const text = JSON.stringify({
      type: CLIP_TYPE,
      nodes: [
        { ...node('a', 0, 0), evil: '<script>' },
        node('b', 10, 10),
        { id: 'c', kind: '???', x: 0, y: 0, w: 1, h: 1, text: '' },
        { id: 'e', kind: 'entity', x: 'NaN', y: 0, w: 1, h: 1, text: '' },
        null,
      ],
      edges: [edge('ab', 'a', 'b'), edge('ax', 'a', 'x'), { id: 1 }, 'x'],
    });
    const clip = parseClip(text)!;
    expect(clip.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(clip.nodes[0]).not.toHaveProperty('evil');
    expect(clip.edges.map((e) => e.id)).toEqual(['ab']);
  });
});

describe('instantiateClip', () => {
  const clip = clipFromSelection(NODES, EDGES, ['a', 'b', 'c'])!;

  it('모든 요소에 새 id를 주고 엣지 끝점을 새 노드로 잇는다', () => {
    const out = instantiateClip(clip, { offset: { x: 0, y: 0 } }, counter());
    expect(out.nodes.map((n) => n.id)).toEqual(['new1', 'new2', 'new3']);
    expect(out.edges.map((e) => e.id)).toEqual(['new4', 'new5']);
    expect(out.edges[0]).toMatchObject({ source: 'new1', target: 'new2', double: true, label: 'N', role: '수강생' });
    expect(out.edges[1]).toMatchObject({ source: 'new2', target: 'new3' });

    const oldIds = new Set([...NODES.map((n) => n.id), ...EDGES.map((e) => e.id)]);
    for (const el of [...out.nodes, ...out.edges]) expect(oldIds.has(el.id)).toBe(false);
  });

  it('기본 id 생성기로도 겹치지 않는 id를 만든다', () => {
    const out = instantiateClip(clip, { offset: { x: 0, y: 0 } });
    const ids = [...out.nodes, ...out.edges].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    const nodeIds = new Set(out.nodes.map((n) => n.id));
    for (const e of out.edges) {
      expect(nodeIds.has(e.source)).toBe(true);
      expect(nodeIds.has(e.target)).toBe(true);
    }
  });

  it('offset만큼 옮기고 나머지 속성은 유지한다', () => {
    const out = instantiateClip(clip, { offset: { x: 20, y: 30 } }, counter());
    expect(out.nodes.map((n) => [n.x, n.y])).toEqual([[20, 30], [220, 30], [420, 130]]);
    expect(out.nodes[1]).toMatchObject({ kind: 'relationship', identifying: true, text: '수강', w: 100, h: 50 });
  });

  it('at을 주면 묶음의 중심이 그 자리에 온다', () => {
    // 묶음 범위: x 0~500, y 0~150 → 중심 (250, 75)
    const out = instantiateClip(clip, { at: { x: 1000, y: 1000 } }, counter());
    expect(out.nodes.map((n) => [n.x, n.y])).toEqual([[750, 925], [950, 925], [1150, 1025]]);
  });

  it('원본 클립은 바꾸지 않는다', () => {
    const before = JSON.stringify(clip);
    instantiateClip(clip, { offset: { x: 5, y: 5 } });
    expect(JSON.stringify(clip)).toBe(before);
  });

  it('끝점이 클립에 없는 엣지는 만들지 않는다', () => {
    const out = instantiateClip({ nodes: [NODES[0]], edges: [EDGES[0]] }, { offset: { x: 0, y: 0 } }, counter());
    expect(out.edges).toEqual([]);
  });
});

// ───────────────────────── 방에 적용 ─────────────────────────

/** 웹소켓 없이 문서와 실행 취소만 가진 방 */
function makeRoom(id = 'room'): Room {
  const doc = new Y.Doc();
  const nodesMap = getNodesMap(doc);
  const edgesMap = getEdgesMap(doc);
  const undo = new Y.UndoManager([nodesMap, edgesMap, getMetaMap(doc)], {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: 400,
  });
  return {
    id,
    doc,
    undo,
    nodes: new ElementStore<ErdNode>(nodesMap, readNode),
    edges: new ElementStore<ErdEdge>(edgesMap, readEdge),
    setPresence() {},
    destroy() {},
  } as unknown as Room;
}

function seed(room: Room): void {
  addNodes(room.doc, NODES);
  addEdges(room.doc, EDGES);
  room.undo.clear();
}

const select = (ids: string[]) => useUi.getState().setSelection(ids);
const selection = () => useUi.getState().selection;
/** 선택된 노드의 좌표 */
const selectedPositions = (room: Room) =>
  selection()
    .map((id) => room.nodes.get(id))
    .filter((n): n is ErdNode => Boolean(n))
    .map((n) => [n.x, n.y]);

describe('복사, 붙여넣기, 복제', () => {
  let room: Room;
  beforeEach(() => {
    resetClipboardForTest();
    useUi.getState().reset();
    room = makeRoom();
    seed(room);
  });

  it('복사한 것이 없으면 붙여넣지 않는다', () => {
    expect(hasClipboard()).toBe(false);
    expect(paste(room)).toBe(false);
    expect(copySelection(room)).toBe(false);
    expect(hasClipboard()).toBe(false);
  });

  it('붙여넣으면 20씩 비껴 놓고, 연달아 붙이면 계속 비껴 간다', () => {
    select(['a', 'b']);
    expect(copySelection(room)).toBe(true);
    expect(hasClipboard()).toBe(true);

    expect(paste(room)).toBe(true);
    expect(selectedPositions(room)).toEqual([[20, 20], [220, 20]]);
    expect(paste(room)).toBe(true);
    expect(selectedPositions(room)).toEqual([[40, 40], [240, 40]]);
    expect(paste(room)).toBe(true);
    expect(selectedPositions(room)).toEqual([[60, 60], [260, 60]]);

    expect(room.nodes.getSnapshot()).toHaveLength(NODES.length + 6);
    expect(room.edges.getSnapshot()).toHaveLength(EDGES.length + 3);
  });

  it('다시 복사하면 비껴 놓는 거리가 처음으로 돌아간다', () => {
    select(['a']);
    copySelection(room);
    paste(room);
    paste(room);
    select(['a']);
    copySelection(room);
    paste(room);
    expect(selectedPositions(room)).toEqual([[20, 20]]);
  });

  it('붙여넣은 새 노드와 새 엣지를 선택하고 엣지는 새 노드끼리 잇는다', () => {
    select(['a', 'b']);
    copySelection(room);
    paste(room);
    const sel = selection();
    expect(sel).toHaveLength(3);
    const newNodes = sel.filter((id) => room.nodes.has(id));
    const newEdges = sel.filter((id) => room.edges.has(id));
    expect(newNodes).toHaveLength(2);
    expect(newEdges).toHaveLength(1);
    expect(newNodes).not.toContain('a');
    const e = room.edges.get(newEdges[0])!;
    expect(newNodes).toContain(e.source);
    expect(newNodes).toContain(e.target);
    expect(e).toMatchObject({ double: true, label: 'N', role: '수강생' });
    // 원본은 그대로다
    expect(room.edges.get('ab')).toEqual(EDGES[0]);
  });

  it('at을 주면 묶음의 중심이 그 자리에 온다', () => {
    select(['a', 'b']);
    copySelection(room);
    // 묶음 범위: x 0~300, y 0~50 → 중심 (150, 25)
    paste(room, { x: 1000, y: 500 });
    expect(selectedPositions(room)).toEqual([[850, 475], [1050, 475]]);
  });

  it('붙여넣기는 실행 취소 한 번으로 모두 사라진다', () => {
    select(['a', 'b', 'c']);
    copySelection(room);
    paste(room);
    expect(room.nodes.getSnapshot()).toHaveLength(NODES.length + 3);
    room.undo.undo();
    expect(room.nodes.getSnapshot()).toHaveLength(NODES.length);
    expect(room.edges.getSnapshot()).toHaveLength(EDGES.length);
  });

  it('다른 방에서 복사한 것도 붙여넣는다', () => {
    select(['a', 'b']);
    copySelection(room);
    const other = makeRoom('other');
    expect(paste(other)).toBe(true);
    expect(other.nodes.getSnapshot()).toHaveLength(2);
    expect(other.edges.getSnapshot()).toHaveLength(1);
    const e = other.edges.getSnapshot()[0];
    expect(other.nodes.has(e.source)).toBe(true);
    expect(other.nodes.has(e.target)).toBe(true);
  });

  it('시스템 클립보드에서 온 글자를 붙여넣고, 이후 메뉴 붙여넣기에도 쓴다', () => {
    const text = serializeSelection(NODES, EDGES, ['a', 'b'])!;
    const other = makeRoom('other');
    expect(pasteText(other, '그냥 글자')).toBe(false);
    expect(hasClipboard()).toBe(false);
    expect(pasteText(other, text)).toBe(true);
    expect(hasClipboard()).toBe(true);
    expect(paste(other, { x: 0, y: 0 })).toBe(true);
    expect(other.nodes.getSnapshot()).toHaveLength(4);
  });

  it('놓일 자리가 화면 밖이면 화면 가운데에 놓는다', () => {
    useUi.getState().setCanvasSize({ w: 800, h: 600 });
    useUi.getState().setViewport({ x: -5000, y: -5000, zoom: 1 });
    select(['a']);
    copySelection(room);
    paste(room);
    // 보이는 영역 5000~5800, 5000~5600 → 가운데 (5400, 5300), 노드 크기 100x50
    expect(selectedPositions(room)).toEqual([[5350, 5275]]);
  });

  it('잘라내면 원본이 지워지고 첫 붙여넣기는 제자리에 놓인다', () => {
    select(['a', 'b']);
    expect(cutSelection(room)).toBe(true);
    expect(room.nodes.has('a')).toBe(false);
    expect(room.nodes.has('b')).toBe(false);
    // a, b에 붙어 있던 선도 함께 지워진다
    expect(room.edges.getSnapshot().map((e) => e.id)).toEqual(['cd']);
    expect(selection()).toEqual([]);

    paste(room);
    expect(selectedPositions(room)).toEqual([[0, 0], [200, 0]]);
    paste(room);
    expect(selectedPositions(room)).toEqual([[20, 20], [220, 20]]);
  });

  it('복제는 바로 옆에 놓고 복제본을 선택하며 클립보드는 건드리지 않는다', () => {
    select(['a', 'b']);
    expect(duplicateSelection(room)).toBe(true);
    expect(hasClipboard()).toBe(false);
    expect(selectedPositions(room)).toEqual([[20, 20], [220, 20]]);
    expect(selection()).not.toContain('a');
    // 복제본이 선택되어 있으므로 다시 복제하면 한 번 더 비낀다
    expect(duplicateSelection(room)).toBe(true);
    expect(selectedPositions(room)).toEqual([[40, 40], [240, 40]]);
    expect(room.edges.getSnapshot()).toHaveLength(EDGES.length + 2);

    room.undo.undo();
    expect(room.nodes.getSnapshot()).toHaveLength(NODES.length + 2);
  });

  it('선택이 엣지뿐이면 복제하지 않는다', () => {
    select(['ab']);
    expect(duplicateSelection(room)).toBe(false);
    expect(room.edges.getSnapshot()).toHaveLength(EDGES.length);
  });
});
