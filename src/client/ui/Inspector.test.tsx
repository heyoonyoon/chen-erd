// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErdEdge, ErdNode } from '../../shared/types';
import { RoomContext } from '../collab/hooks';
import { LOCAL_ORIGIN, addEdges, addNodes, getEdgesMap, getMetaMap, getNodesMap, readEdge, readNode } from '../collab/docOps';
import { ElementStore, type Room } from '../collab/room';
import { useUi } from '../state/ui';

// 다른 담당의 모듈은 계약(시그니처)만 흉내 낸다
const mocks = vi.hoisted(() => ({
  fitNodeSize: vi.fn((..._a: unknown[]) => ({ w: 200, h: 80 })),
  growToFit: vi.fn((..._a: unknown[]): { x: number; y: number; w: number; h: number } | null => null),
}));
vi.mock('../text/measure', () => ({ fitNodeSize: mocks.fitNodeSize, growToFit: mocks.growToFit }));
vi.mock('../canvas/PresetIcon', () => ({ PresetIcon: ({ presetId }: { presetId: string }) => <svg data-preset={presetId} /> }));
vi.mock('../../shared/rules', () => {
  const pair = (a: ErdNode, b: ErdNode, x: string, y: string) => (a.kind === x && b.kind === y) || (a.kind === y && b.kind === x);
  return {
    edgeHasCardinality: (a: ErdNode, b: ErdNode) => pair(a, b, 'entity', 'relationship'),
    edgeCanBeDouble: (a: ErdNode, b: ErdNode) => pair(a, b, 'entity', 'relationship') || pair(a, b, 'entity', 'spec'),
  };
});

import { Inspector } from './Inspector';

function makeRoom(): Room {
  const doc = new Y.Doc();
  const nodesMap = getNodesMap(doc);
  const edgesMap = getEdgesMap(doc);
  return {
    id: 'testroom',
    doc,
    undo: new Y.UndoManager([nodesMap, edgesMap, getMetaMap(doc)], { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 0 }),
    nodes: new ElementStore<ErdNode>(nodesMap, readNode),
    edges: new ElementStore<ErdEdge>(edgesMap, readEdge),
  } as unknown as Room;
}

function n(id: string, kind: ErdNode['kind'], extra: Partial<ErdNode> = {}): ErdNode {
  return { id, kind, x: 0, y: 0, w: 100, h: 50, text: id, ...extra };
}
function e(id: string, source: string, target: string, extra: Partial<ErdEdge> = {}): ErdEdge {
  return { id, source, target, double: false, label: '', role: '', ...extra };
}

let room: Room;

function setup(nodes: ErdNode[], edges: ErdEdge[], selection: string[]) {
  addNodes(room.doc, nodes);
  addEdges(room.doc, edges);
  room.undo.clear();
  useUi.getState().setSelection(selection);
  return render(
    <RoomContext.Provider value={room}>
      <Inspector />
    </RoomContext.Provider>,
  );
}
/** 다른 접속자가 고친 것처럼 문서를 바꾼다 */
function remote(fn: () => void) {
  act(() => room.doc.transact(fn, 'remote'));
}
const yNode = (id: string) => getNodesMap(room.doc).get(id)!;
const yEdge = (id: string) => getEdgesMap(room.doc).get(id)!;
const field = (testId: string) => screen.getByTestId(testId) as HTMLInputElement | HTMLTextAreaElement;
function type(testId: string, value: string) {
  const el = field(testId);
  act(() => el.focus());
  fireEvent.change(el, { target: { value } });
  return el;
}

beforeEach(() => {
  useUi.getState().reset();
  room = makeRoom();
  mocks.fitNodeSize.mockClear();
  mocks.growToFit.mockReset();
  mocks.growToFit.mockReturnValue(null);
});
afterEach(() => cleanup());

describe('노드 하나', () => {
  it('종류 격자에 12개가 있고 현재 종류를 강조한다', () => {
    setup([n('학생', 'entity', { weak: true })], [], ['학생']);
    expect(screen.getByTestId('inspector')).toBeTruthy();
    expect(screen.getAllByTestId(/^inspector-preset-/)).toHaveLength(12);
    expect(screen.getByTestId('inspector-preset-weak-entity').className).toContain('is-active');
    expect(screen.getByTestId('inspector-preset-entity').className).not.toContain('is-active');
  });

  it('종류를 바꾸면 옛 플래그를 지우고 글자와 중심을 유지한다', () => {
    setup([n('a', 'attribute', { keyType: 'key', multivalued: true, text: '학번', x: 100, y: 100, w: 120, h: 50 })], [e('e1', 'a', 'b')], ['a']);
    fireEvent.click(screen.getByTestId('inspector-preset-identifying-relationship'));
    const m = yNode('a');
    expect(m.toJSON()).toEqual({ id: 'a', kind: 'relationship', identifying: true, text: '학번', x: 60, y: 85, w: 200, h: 80 });
    expect(mocks.fitNodeSize).toHaveBeenCalledWith({ kind: 'relationship', identifying: true }, '학번');
    expect(getEdgesMap(room.doc).has('e1')).toBe(true);
    // 실행 취소 한 번으로 되돌아간다
    act(() => room.undo.undo());
    expect(yNode('a').toJSON()).toMatchObject({ kind: 'attribute', keyType: 'key', multivalued: true, w: 120 });
  });

  it('토글을 끄면 false가 아니라 키를 지운다', () => {
    setup([n('a', 'entity')], [], ['a']);
    const toggle = screen.getByTestId('inspector-weak');
    fireEvent.click(toggle);
    expect(yNode('a').get('weak')).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(yNode('a').has('weak')).toBe(false);
  });

  it('속성 옵션: 식별자 표시, 다중값, 유도', () => {
    setup([n('a', 'attribute')], [], ['a']);
    fireEvent.click(screen.getByTestId('inspector-key-partial'));
    expect(yNode('a').get('keyType')).toBe('partial');
    fireEvent.click(screen.getByTestId('inspector-key-none'));
    expect(yNode('a').has('keyType')).toBe(false);
    fireEvent.click(screen.getByTestId('inspector-multivalued'));
    fireEvent.click(screen.getByTestId('inspector-derived'));
    expect(yNode('a').toJSON()).toMatchObject({ multivalued: true, derived: true });
    fireEvent.click(screen.getByTestId('inspector-derived'));
    expect(yNode('a').has('derived')).toBe(false);
  });

  it('관계는 식별 관계 토글, 특수화 원은 글자 대신 d / o 선택', () => {
    const view = setup([n('r', 'relationship'), n('s', 'spec', { specType: 'd', text: '' })], [], ['r']);
    fireEvent.click(screen.getByTestId('inspector-identifying'));
    expect(yNode('r').get('identifying')).toBe(true);

    act(() => useUi.getState().setSelection(['s']));
    expect(screen.queryByTestId('inspector-text')).toBeNull();
    expect(screen.queryByTestId('inspector-width')).toBeNull();
    fireEvent.click(screen.getByTestId('inspector-spec-o'));
    expect(yNode('s').get('specType')).toBe('o');
    view.unmount();
  });

  it('글자는 blur에서 확정하고 growToFit 결과를 한 번에 적용한다', () => {
    setup([n('a', 'entity', { text: '학생' })], [], ['a']);
    mocks.growToFit.mockReturnValue({ x: -20, y: 0, w: 140, h: 50 });
    const el = type('inspector-text', '학생\n(재학생)\n');
    expect(yNode('a').get('text')).toBe('학생');
    act(() => el.blur());
    expect(yNode('a').toJSON()).toMatchObject({ text: '학생\n(재학생)', x: -20, w: 140 });
    expect(room.undo.undoStack).toHaveLength(1);
    expect(field('inspector-text').value).toBe('학생\n(재학생)');
  });

  it('Cmd/Ctrl+Enter로 확정하고 그냥 Enter와 조합 중 Enter는 확정하지 않는다', () => {
    setup([n('a', 'entity', { text: '학생' })], [], ['a']);
    const el = type('inspector-text', '교수');
    fireEvent.keyDown(el, { key: 'Enter', code: 'Enter' });
    expect(yNode('a').get('text')).toBe('학생');
    fireEvent.keyDown(el, { key: 'Enter', code: 'Enter', ctrlKey: true, isComposing: true });
    expect(yNode('a').get('text')).toBe('학생');
    fireEvent.keyDown(el, { key: 'Enter', code: 'Enter', metaKey: true });
    expect(yNode('a').get('text')).toBe('교수');
    expect(document.activeElement).not.toBe(el);
  });

  it('Esc는 입력을 취소하고 포커스를 뺀다', () => {
    setup([n('a', 'entity', { text: '학생' })], [], ['a']);
    const el = type('inspector-text', '지울 글자');
    fireEvent.keyDown(el, { key: 'Escape', code: 'Escape' });
    expect(document.activeElement).not.toBe(el);
    expect(yNode('a').get('text')).toBe('학생');
    expect(field('inspector-text').value).toBe('학생');
  });

  it('입력 칸의 키 입력은 전역 단축키로 새지 않는다', () => {
    setup([n('a', 'entity')], [], ['a']);
    const onKey = vi.fn();
    window.addEventListener('keydown', onKey);
    try {
      const el = field('inspector-text');
      act(() => el.focus());
      fireEvent.keyDown(el, { key: 'Backspace', code: 'Backspace' });
      fireEvent.keyDown(el, { key: 'v', code: 'KeyV' });
      fireEvent.keyDown(el, { key: 'Escape', code: 'Escape' });
      expect(onKey).not.toHaveBeenCalled();
      expect(useUi.getState().selection).toEqual(['a']);
    } finally {
      window.removeEventListener('keydown', onKey);
    }
  });

  it('다른 사람이 바꾼 값은 내가 입력 중이 아닐 때만 화면에 반영한다', () => {
    setup([n('a', 'entity', { text: '학생' })], [], ['a']);
    remote(() => yNode('a').set('text', '교수'));
    expect(field('inspector-text').value).toBe('교수');

    const el = type('inspector-text', '교수님');
    remote(() => yNode('a').set('text', '직원'));
    expect(field('inspector-text').value).toBe('교수님');
    act(() => el.blur());
    expect(yNode('a').get('text')).toBe('교수님');
  });

  it('포커스만 두고 고치지 않았으면 다른 사람의 값을 덮어쓰지 않는다', () => {
    setup([n('a', 'entity', { text: '학생' })], [], ['a']);
    const el = field('inspector-text');
    act(() => el.focus());
    remote(() => yNode('a').set('text', '직원'));
    act(() => el.blur());
    expect(yNode('a').get('text')).toBe('직원');
    expect(field('inspector-text').value).toBe('직원');
  });

  it('입력 중에 선택이 바뀌면 원래 도형에 확정한다', () => {
    setup([n('a', 'entity', { text: '학생' }), n('b', 'entity', { text: '과목' })], [], ['a']);
    type('inspector-text', '학생2');
    act(() => useUi.getState().setSelection(['b']));
    expect(yNode('a').get('text')).toBe('학생2');
    expect(yNode('b').get('text')).toBe('과목');
    expect(field('inspector-text').value).toBe('과목');
  });

  it('크기는 최소 크기 이상으로, 중심을 유지한 채 바꾼다', () => {
    setup([n('a', 'entity', { x: 100, y: 100, w: 100, h: 50 })], [], ['a']);
    const w = type('inspector-width', '200');
    fireEvent.keyDown(w, { key: 'Enter', code: 'Enter' });
    expect(yNode('a').toJSON()).toMatchObject({ x: 50, y: 100, w: 200, h: 50 });
    const h = type('inspector-height', '3');
    act(() => h.blur());
    expect(yNode('a').toJSON()).toMatchObject({ x: 50, y: 111, w: 200, h: 28 });
    expect(field('inspector-height').value).toBe('28');
    // 수가 아니면 무시한다
    const w2 = type('inspector-width', '');
    act(() => w2.blur());
    expect(yNode('a').get('w')).toBe(200);
  });

  it('글자에 맞추기', () => {
    setup([n('a', 'entity', { x: 100, y: 100, w: 100, h: 50 })], [], ['a']);
    fireEvent.click(screen.getByTestId('inspector-fit'));
    expect(yNode('a').toJSON()).toMatchObject({ x: 50, y: 85, w: 200, h: 80 });
  });

  it('삭제하면 붙은 선도 지워지고 선택이 비워진다', () => {
    setup([n('a', 'entity'), n('b', 'relationship')], [e('e1', 'a', 'b')], ['a']);
    fireEvent.click(screen.getByTestId('inspector-delete'));
    expect(getNodesMap(room.doc).has('a')).toBe(false);
    expect(getEdgesMap(room.doc).has('e1')).toBe(false);
    expect(useUi.getState().selection).toEqual([]);
    expect(screen.queryByTestId('inspector')).toBeNull();
  });
});

describe('엣지 하나', () => {
  const er = () => [n('학생', 'entity'), n('r', 'relationship', { text: '' }), n('나이', 'attribute'), n('s', 'spec', { specType: 'd', text: '' })];

  it('양 끝 이름을 보여 주고 글자가 비면 종류 이름을 쓴다', () => {
    setup(er(), [e('e1', '학생', 'r')], ['e1']);
    expect(screen.getByTestId('inspector-edge-name').textContent).toBe('학생 — 관계');
  });

  it('카디널리티: 선택 칸과 직접 입력', () => {
    setup(er(), [e('e1', '학생', 'r')], ['e1']);
    expect(screen.getByTestId('inspector-cardinality-none').className).toContain('is-active');
    fireEvent.click(screen.getByTestId('inspector-cardinality-N'));
    expect(yEdge('e1').get('label')).toBe('N');
    expect(screen.getByTestId('inspector-cardinality-N').className).toContain('is-active');
    expect(field('inspector-cardinality-input').value).toBe('N');

    const input = type('inspector-cardinality-input', ' 0..1 ');
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(yEdge('e1').get('label')).toBe('0..1');
    expect(screen.getByTestId('inspector').querySelectorAll('[data-testid^="inspector-cardinality-"].is-active')).toHaveLength(0);

    fireEvent.click(screen.getByTestId('inspector-cardinality-none'));
    expect(yEdge('e1').get('label')).toBe('');
  });

  it('선 종류와 역할 이름, 전체 참여 안내', () => {
    setup(er(), [e('e1', '학생', 'r')], ['e1']);
    expect(screen.getByTestId('inspector').textContent).toContain('이중선은 전체 참여');
    fireEvent.click(screen.getByTestId('inspector-line-double'));
    expect(yEdge('e1').get('double')).toBe(true);
    fireEvent.click(screen.getByTestId('inspector-line-single'));
    expect(yEdge('e1').get('double')).toBe(false);

    const role = type('inspector-role', '수강생');
    act(() => role.blur());
    expect(yEdge('e1').get('role')).toBe('수강생');
  });

  it('엔티티와 특수화 원 사이: 전체 특수화 안내, 카디널리티와 역할은 쓰지 않는다', () => {
    setup(er(), [e('e1', '학생', 's')], ['e1']);
    const text = screen.getByTestId('inspector').textContent ?? '';
    expect(text).toContain('이중선은 전체 특수화');
    expect(text).toContain('엔티티와 관계 사이의 선에만 적습니다');
    expect((screen.getByTestId('inspector-cardinality-1') as HTMLButtonElement).disabled).toBe(true);
    expect(field('inspector-cardinality-input').disabled).toBe(true);
    expect(screen.queryByTestId('inspector-role')).toBeNull();
    expect((screen.getByTestId('inspector-line-double') as HTMLButtonElement).disabled).toBe(false);
  });

  it('속성에 붙은 선은 이중선을 고를 수 없지만, 이미 들어 있는 값은 지울 수 있다', () => {
    setup(er(), [e('e1', '학생', '나이', { double: true, label: 'N' })], ['e1']);
    expect((screen.getByTestId('inspector-line-double') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('inspector-cardinality-M') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('inspector-line-single'));
    fireEvent.click(screen.getByTestId('inspector-cardinality-none'));
    expect(yEdge('e1').toJSON()).toMatchObject({ double: false, label: '' });
    expect((screen.getByTestId('inspector-line-single') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('inspector-cardinality-none') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('여러 개 선택', () => {
  it('요약과 정렬, 3개부터 간격 균등', () => {
    setup([n('a', 'entity', { x: 0 }), n('b', 'relationship', { x: 30, y: 80 }), n('c', 'entity', { x: 400, y: 160 })], [e('e1', 'a', 'b')], ['a', 'b', 'e1']);
    expect(screen.getByTestId('inspector-summary').textContent).toBe('도형 2개, 선 1개');
    expect(screen.getAllByTestId(/^inspector-align-/)).toHaveLength(6);
    expect(screen.getByTestId('inspector-align-left').getAttribute('title')).toBe('왼쪽 맞춤');
    expect(screen.queryByTestId('inspector-distribute-h')).toBeNull();

    fireEvent.click(screen.getByTestId('inspector-align-left'));
    expect(yNode('b').get('x')).toBe(0);
    expect(room.undo.undoStack).toHaveLength(1);

    act(() => useUi.getState().setSelection(['a', 'b', 'c']));
    expect(screen.getByTestId('inspector-summary').textContent).toBe('도형 3개, 선 0개');
    fireEvent.click(screen.getByTestId('inspector-distribute-h'));
    expect(yNode('b').get('x')).toBe(200);
    fireEvent.click(screen.getByTestId('inspector-distribute-v'));
    expect(yNode('b').get('y')).toBe(80);
  });

  it('같은 성격의 선은 한꺼번에 바꾼다', () => {
    setup(
      [n('a', 'entity'), n('r', 'relationship'), n('b', 'entity'), n('x', 'attribute')],
      [e('e1', 'a', 'r', { label: '1' }), e('e2', 'r', 'b', { label: 'N' }), e('e3', 'a', 'x')],
      ['e1', 'e2'],
    );
    // 값이 섞여 있으면 아무것도 강조하지 않는다
    expect(screen.getByTestId('inspector').querySelectorAll('[data-testid^="inspector-cardinality-"].is-active')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('inspector-cardinality-M'));
    fireEvent.click(screen.getByTestId('inspector-line-double'));
    expect(yEdge('e1').toJSON()).toMatchObject({ label: 'M', double: true });
    expect(yEdge('e2').toJSON()).toMatchObject({ label: 'M', double: true });
    expect(screen.queryByTestId('inspector-role')).toBeNull();

    // 성격이 다른 선이 섞이면 일괄 변경을 보여 주지 않는다
    act(() => useUi.getState().setSelection(['e1', 'e2', 'e3']));
    expect(screen.getByTestId('inspector-summary').textContent).toBe('도형 0개, 선 3개');
    expect(screen.queryByTestId('inspector-line-double')).toBeNull();
  });

  it('모두 속성이면 한꺼번에 켜고 끈다', () => {
    setup([n('a', 'attribute', { multivalued: true }), n('b', 'attribute'), n('c', 'entity')], [], ['a', 'b']);
    const toggle = screen.getByTestId('inspector-multivalued');
    expect(toggle.getAttribute('aria-checked')).toBe('mixed');
    fireEvent.click(toggle);
    expect([yNode('a').get('multivalued'), yNode('b').get('multivalued')]).toEqual([true, true]);
    fireEvent.click(toggle);
    expect([yNode('a').has('multivalued'), yNode('b').has('multivalued')]).toEqual([false, false]);
    fireEvent.click(screen.getByTestId('inspector-key-key'));
    expect([yNode('a').get('keyType'), yNode('b').get('keyType')]).toEqual(['key', 'key']);

    act(() => useUi.getState().setSelection(['a', 'b', 'c']));
    expect(screen.queryByTestId('inspector-multivalued')).toBeNull();
  });

  it('삭제', () => {
    setup([n('a', 'entity'), n('b', 'entity'), n('c', 'entity')], [], ['a', 'b']);
    fireEvent.click(screen.getByTestId('inspector-delete'));
    expect(Array.from(getNodesMap(room.doc).keys())).toEqual(['c']);
  });
});
