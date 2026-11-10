// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErdEdge, ErdNode } from '../../shared/types';
import { addEdges, addNodes, deleteElements, getEdgesMap, getNodesMap, readEdge, readNode, updateEdge } from '../collab/docOps';
import { RoomContext } from '../collab/hooks';
import { ElementStore, type Room } from '../collab/room';
import { useUi } from '../state/ui';

// 화면 이동은 viewport 담당의 모듈이므로 호출만 확인한다
const mocks = vi.hoisted(() => ({ centerOn: vi.fn() }));
vi.mock('../canvas/ViewportControls', () => ({ centerOn: mocks.centerOn }));

import { IssuesPanel, elementCenter, useIssueCount } from './IssuesPanel';

function makeRoom(): Room {
  const doc = new Y.Doc();
  return {
    id: 'testroom',
    doc,
    nodes: new ElementStore<ErdNode>(getNodesMap(doc), readNode),
    edges: new ElementStore<ErdEdge>(getEdgesMap(doc), readEdge),
  } as unknown as Room;
}

function n(id: string, kind: ErdNode['kind'], extra: Partial<ErdNode> = {}): ErdNode {
  return { id, kind, x: 0, y: 0, w: 100, h: 50, text: id, ...extra };
}
function e(id: string, source: string, target: string, extra: Partial<ErdEdge> = {}): ErdEdge {
  return { id, source, target, double: false, label: '', role: '', ...extra };
}

/** TEAM 1 —has— M PLAYER (문제 없음) */
function seedValid(room: Room) {
  addNodes(room.doc, [
    n('TEAM', 'entity', { x: 0, y: 0 }),
    n('tid', 'attribute', { keyType: 'key', x: 0, y: -100 }),
    n('has', 'relationship', { x: 300, y: 0 }),
    n('PLAYER', 'entity', { x: 600, y: 0 }),
    n('pid', 'attribute', { keyType: 'key', x: 600, y: -100 }),
  ]);
  addEdges(room.doc, [
    e('e1', 'TEAM', 'tid'),
    e('e2', 'PLAYER', 'pid'),
    e('e3', 'TEAM', 'has', { label: '1' }),
    e('e4', 'has', 'PLAYER', { label: 'M' }),
  ]);
}

let room: Room;
const wrapper = ({ children }: { children: ReactNode }) => <RoomContext.Provider value={room}>{children}</RoomContext.Provider>;
const items = () => screen.queryAllByTestId('issue-item');

beforeEach(() => {
  room = makeRoom();
  useUi.getState().reset();
  mocks.centerOn.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('IssuesPanel', () => {
  it('문제가 없으면 안내문을 보여 준다', () => {
    seedValid(room);
    render(<IssuesPanel />, { wrapper });
    expect(screen.getByRole('heading', { name: '검증' })).toBeTruthy();
    expect(screen.getByText('표기법에 어긋난 부분이 없습니다')).toBeTruthy();
    expect(items()).toHaveLength(0);
    expect(screen.queryByTestId('issues-summary')).toBeNull();
  });

  it('오류와 경고의 개수와 목록을 보여 주고 문서가 바뀌면 따라 바뀐다', () => {
    seedValid(room);
    render(<IssuesPanel />, { wrapper });

    act(() => {
      addNodes(room.doc, [n('lonely', 'attribute')]);
      updateEdge(room.doc, 'e4', { label: '' });
    });
    expect(screen.getByTestId('issues-error-count').textContent).toBe('오류 1개');
    expect(screen.getByTestId('issues-warning-count').textContent).toBe('경고 1개');
    expect(items().map((el) => [el.dataset.severity, el.dataset.issueId])).toEqual([
      ['error', 'attribute-unconnected:lonely'],
      ['warning', 'edge-no-cardinality:e4'],
    ]);
    expect(items()[0].textContent).toContain("'lonely' 속성이 어디에도 연결되어 있지 않습니다");

    act(() => {
      deleteElements(room.doc, ['lonely']);
      updateEdge(room.doc, 'e4', { label: 'N' });
    });
    expect(screen.getByText('표기법에 어긋난 부분이 없습니다')).toBeTruthy();
  });

  it('항목을 누르면 요소를 선택하고 강조한 뒤 그 도형으로 화면을 옮기고, 2초 뒤 강조를 지운다', () => {
    vi.useFakeTimers();
    seedValid(room);
    addNodes(room.doc, [n('lonely', 'attribute', { x: 1000, y: 400, w: 120, h: 60 })]);
    render(<IssuesPanel />, { wrapper });

    fireEvent.click(items()[0]);
    expect(useUi.getState().selection).toEqual(['lonely']);
    expect(useUi.getState().highlightIds).toEqual(['lonely']);
    expect(mocks.centerOn).toHaveBeenCalledTimes(1);
    expect(mocks.centerOn).toHaveBeenCalledWith({ x: 1060, y: 430 });

    act(() => void vi.advanceTimersByTime(1999));
    expect(useUi.getState().highlightIds).toEqual(['lonely']);
    act(() => void vi.advanceTimersByTime(1));
    expect(useUi.getState().highlightIds).toEqual([]);
    // 선택은 그대로 둔다
    expect(useUi.getState().selection).toEqual(['lonely']);
  });

  it('선을 가리키는 항목은 양 끝 도형의 중점으로 화면을 옮긴다', () => {
    seedValid(room);
    updateEdge(room.doc, 'e4', { label: '' });
    render(<IssuesPanel />, { wrapper });

    fireEvent.click(items()[0]);
    expect(useUi.getState().selection).toEqual(['e4']);
    // has 중심 (350, 25), PLAYER 중심 (650, 25)
    expect(mocks.centerOn).toHaveBeenCalledWith({ x: 500, y: 25 });
  });

  it('2초 안에 다른 항목을 누르면 강조 시간을 새로 잰다', () => {
    vi.useFakeTimers();
    seedValid(room);
    addNodes(room.doc, [n('a1', 'attribute'), n('a2', 'attribute')]);
    render(<IssuesPanel />, { wrapper });

    fireEvent.click(items()[0]);
    act(() => void vi.advanceTimersByTime(1500));
    fireEvent.click(items()[1]);
    expect(useUi.getState().highlightIds).toEqual(['a2']);
    act(() => void vi.advanceTimersByTime(1500));
    expect(useUi.getState().highlightIds).toEqual(['a2']);
    act(() => void vi.advanceTimersByTime(500));
    expect(useUi.getState().highlightIds).toEqual([]);
  });

  it('닫기 버튼은 패널을 닫고, 닫힐 때 남은 강조를 지운다', () => {
    vi.useFakeTimers();
    seedValid(room);
    addNodes(room.doc, [n('lonely', 'attribute')]);
    useUi.getState().togglePanel('issues', true);
    const view = render(<IssuesPanel />, { wrapper });

    fireEvent.click(items()[0]);
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(useUi.getState().panels.issues).toBe(false);

    view.unmount();
    expect(useUi.getState().highlightIds).toEqual([]);
    // 지난 타이머가 나중에 다른 강조를 지우지 않는다
    useUi.getState().setHighlight(['other']);
    act(() => void vi.advanceTimersByTime(5000));
    expect(useUi.getState().highlightIds).toEqual(['other']);
  });
});

describe('useIssueCount', () => {
  it('패널과 같은 계산으로 개수를 돌려준다', () => {
    seedValid(room);
    const { result } = renderHook(() => useIssueCount(), { wrapper });
    expect(result.current).toEqual({ errors: 0, warnings: 0 });

    act(() => {
      addNodes(room.doc, [n('lonely', 'attribute'), n('solo', 'entity')]);
    });
    // lonely: 연결되지 않은 속성(오류) / solo: 식별자 없음, 고립(경고 2개)
    expect(result.current).toEqual({ errors: 1, warnings: 2 });
  });

  it('문서가 그대로면 같은 객체를 돌려준다', () => {
    seedValid(room);
    const { result, rerender } = renderHook(() => useIssueCount(), { wrapper });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe('elementCenter', () => {
  const nodes = [n('a', 'entity', { x: 0, y: 0, w: 100, h: 40 }), n('b', 'relationship', { x: 200, y: 100, w: 100, h: 60 })];
  const edges = [e('ab', 'a', 'b'), e('half', 'a', 'gone'), e('none', 'x', 'y')];

  it('노드는 중심, 엣지는 양 끝 노드 중심의 중점', () => {
    expect(elementCenter('a', nodes, edges)).toEqual({ x: 50, y: 20 });
    expect(elementCenter('ab', nodes, edges)).toEqual({ x: 150, y: 75 });
  });

  it('한쪽 끝이 없는 선은 남은 도형으로, 아무것도 없으면 null', () => {
    expect(elementCenter('half', nodes, edges)).toEqual({ x: 50, y: 20 });
    expect(elementCenter('none', nodes, edges)).toBeNull();
    expect(elementCenter('missing', nodes, edges)).toBeNull();
  });
});
