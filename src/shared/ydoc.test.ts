import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DiagramChange } from './model/types';
import type { ErdEdge, ErdNode } from './types';
import { applyChange, getEdges, getEdgesMap, getNodes, getNodesMap, getTitle } from './ydoc';

function node(id: string, extra: Partial<ErdNode> = {}): ErdNode {
  return { id, kind: 'entity', x: 0, y: 0, w: 120, h: 60, text: id, ...extra };
}

function edge(id: string, source: string, target: string, extra: Partial<ErdEdge> = {}): ErdEdge {
  return { id, source, target, double: false, label: '', role: '', ...extra };
}

function change(part: Partial<DiagramChange>): DiagramChange {
  return { addNodes: [], patchNodes: [], removeNodeIds: [], addEdges: [], patchEdges: [], removeEdgeIds: [], ...part };
}

function sorted<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

describe('applyChange', () => {
  it('도형과 선, 제목을 더한다', () => {
    const doc = new Y.Doc();
    applyChange(
      doc,
      change({
        addNodes: [node('e1', { text: '학생' }), node('r1', { kind: 'relationship', text: '수강', identifying: undefined })],
        addEdges: [edge('x1', 'e1', 'r1', { label: 'M', double: true })],
        title: '수강신청',
      }),
      'api',
    );
    expect(sorted(getNodes(doc))).toEqual([node('e1', { text: '학생' }), node('r1', { kind: 'relationship', text: '수강' })]);
    expect(getEdges(doc)).toEqual([edge('x1', 'e1', 'r1', { label: 'M', double: true })]);
    expect(getTitle(doc)).toBe('수강신청');
    // 값이 undefined인 필드는 문서에 넣지 않는다
    expect(getNodesMap(doc).get('r1')!.has('identifying')).toBe(false);
  });

  it('전체를 트랜잭션 하나로 적용하고 origin을 그대로 넘긴다', () => {
    const doc = new Y.Doc();
    applyChange(doc, change({ addNodes: [node('a'), node('b'), node('c')], addEdges: [edge('ab', 'a', 'b')] }), 'seed');

    const updates: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => updates.push(origin));
    applyChange(
      doc,
      change({
        removeEdgeIds: ['ab'],
        removeNodeIds: ['c'],
        addNodes: [node('d')],
        patchNodes: [{ id: 'a', patch: { x: 300, text: '바뀜' } }],
        addEdges: [edge('ad', 'a', 'd')],
        title: '새 제목',
      }),
      'api',
    );
    expect(updates).toEqual(['api']);
    expect(sorted(getNodes(doc)).map((n) => n.id)).toEqual(['a', 'b', 'd']);
    expect(getNodes(doc).find((n) => n.id === 'a')).toMatchObject({ x: 300, text: '바뀜' });
    expect(getEdges(doc).map((e) => e.id)).toEqual(['ad']);
    expect(getTitle(doc)).toBe('새 제목');
  });

  it('도형을 지우면 그 도형에 아직 붙어 있는 선도 지운다', () => {
    const doc = new Y.Doc();
    applyChange(
      doc,
      change({
        addNodes: [node('a'), node('b'), node('c')],
        addEdges: [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('ca', 'c', 'a')],
      }),
      'seed',
    );
    // 지울 선 목록에 없는 선이라도 끝이 사라지면 남기지 않는다
    applyChange(doc, change({ removeNodeIds: ['a'] }), 'api');
    expect(getNodes(doc).map((n) => n.id).sort()).toEqual(['b', 'c']);
    expect(getEdges(doc).map((e) => e.id)).toEqual(['bc']);
  });

  it('패치에서 값이 undefined인 키는 지우고 나머지 필드는 그대로 둔다', () => {
    const doc = new Y.Doc();
    applyChange(
      doc,
      change({
        addNodes: [node('w', { weak: true, x: 40, y: 50 }), node('k', { kind: 'attribute', keyType: 'key' })],
        addEdges: [edge('wk', 'w', 'k', { sourceSide: 'top', label: '1' })],
      }),
      'seed',
    );
    applyChange(
      doc,
      change({
        patchNodes: [
          { id: 'w', patch: { weak: undefined, text: '일반' } },
          { id: 'k', patch: { keyType: 'partial' } },
        ],
        patchEdges: [{ id: 'wk', patch: { sourceSide: undefined, double: true } }],
      }),
      'api',
    );
    const w = getNodesMap(doc).get('w')!;
    expect(w.has('weak')).toBe(false);
    expect(w.toJSON()).toEqual({ id: 'w', kind: 'entity', x: 40, y: 50, w: 120, h: 60, text: '일반' });
    expect(getNodesMap(doc).get('k')!.get('keyType')).toBe('partial');
    expect(getEdgesMap(doc).get('wk')!.toJSON()).toEqual({ id: 'wk', source: 'w', target: 'k', double: true, label: '1', role: '' });
  });

  it('없는 id를 지우거나 고치라는 항목은 무시한다', () => {
    const doc = new Y.Doc();
    applyChange(doc, change({ addNodes: [node('a')] }), 'seed');
    applyChange(
      doc,
      change({
        removeNodeIds: ['ghost'],
        removeEdgeIds: ['ghost-edge'],
        patchNodes: [{ id: 'ghost', patch: { x: 1 } }],
        patchEdges: [{ id: 'ghost-edge', patch: { label: 'N' } }],
      }),
      'api',
    );
    expect(getNodes(doc)).toEqual([node('a')]);
    expect(getEdges(doc)).toEqual([]);
  });

  it('바뀌는 것이 없으면 update를 내지 않고, 제목이 없으면 제목을 건드리지 않는다', () => {
    const doc = new Y.Doc();
    applyChange(doc, change({ addNodes: [node('a', { x: 10 })], title: '제목' }), 'seed');
    let updates = 0;
    doc.on('update', () => (updates += 1));
    applyChange(doc, change({ patchNodes: [{ id: 'a', patch: { x: 10 } }], title: '제목' }), 'api');
    applyChange(doc, change({}), 'api');
    expect(updates).toBe(0);
    expect(getTitle(doc)).toBe('제목');
  });

  it('다른 문서로 옮겨도 같은 내용이 된다', () => {
    const doc = new Y.Doc();
    const remote = new Y.Doc();
    doc.on('update', (update: Uint8Array) => Y.applyUpdate(remote, update));
    applyChange(doc, change({ addNodes: [node('a'), node('b')], addEdges: [edge('ab', 'a', 'b')], title: 't' }), 'api');
    applyChange(doc, change({ removeNodeIds: ['b'], patchNodes: [{ id: 'a', patch: { text: 'A' } }] }), 'api');
    expect(getNodes(remote)).toEqual([node('a', { text: 'A' })]);
    expect(getEdges(remote)).toEqual([]);
    expect(getTitle(remote)).toBe('t');
  });
});
