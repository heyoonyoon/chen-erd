// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { ErdEdge, ErdNode } from '../../shared/types';
import { copySelection, resetClipboardForTest } from '../collab/clipboard';
import { LOCAL_ORIGIN, addEdges, addNodes, getEdgesMap, getMetaMap, getNodesMap, readEdge, readNode } from '../collab/docOps';
import { RoomContext } from '../collab/hooks';
import { ElementStore, type Room } from '../collab/room';
import { useUi } from '../state/ui';
import { ContextMenu, clampMenuPosition } from './ContextMenu';
import { HelpOverlay } from './HelpOverlay';

function makeRoom(): Room {
  const doc = new Y.Doc();
  const nodesMap = getNodesMap(doc);
  const edgesMap = getEdgesMap(doc);
  const undo = new Y.UndoManager([nodesMap, edgesMap, getMetaMap(doc)], { trackedOrigins: new Set([LOCAL_ORIGIN]) });
  return {
    id: 'room',
    doc,
    undo,
    nodes: new ElementStore<ErdNode>(nodesMap, readNode),
    edges: new ElementStore<ErdEdge>(edgesMap, readEdge),
    setPresence() {},
    destroy() {},
  } as unknown as Room;
}

const NODES: ErdNode[] = [
  { id: 'e', kind: 'entity', x: 0, y: 0, w: 100, h: 50, text: '학생' },
  { id: 'r', kind: 'relationship', x: 200, y: 0, w: 100, h: 50, text: '수강' },
  { id: 'at', kind: 'attribute', x: 0, y: 200, w: 100, h: 50, text: '학번', keyType: 'key' },
  { id: 's', kind: 'spec', x: 400, y: 0, w: 34, h: 34, text: '', specType: 'd' },
];
const EDGES: ErdEdge[] = [
  { id: 'er', source: 'e', target: 'r', double: false, label: 'N', role: '' },
  { id: 'ea', source: 'e', target: 'at', double: false, label: '', role: '' },
];

const ui = () => useUi.getState();
let room: Room;

function openMenu(targetId: string | null, selection: string[] = targetId ? [targetId] : []) {
  ui().setSelection(selection);
  ui().openContextMenu({ x: 100, y: 100, world: { x: 500, y: 300 }, targetId });
  return render(
    <RoomContext.Provider value={room}>
      <ContextMenu />
    </RoomContext.Provider>,
  );
}
const item = (id: string) => screen.getByTestId(`menu-${id}`) as HTMLButtonElement;
const hasItem = (id: string) => screen.queryByTestId(`menu-${id}`) !== null;

beforeEach(() => {
  resetClipboardForTest();
  ui().reset();
  room = makeRoom();
  addNodes(room.doc, NODES);
  addEdges(room.doc, EDGES);
  room.undo.clear();
});
afterEach(cleanup);

describe('ContextMenu', () => {
  it('메뉴 상태가 없으면 아무것도 그리지 않는다', () => {
    render(
      <RoomContext.Provider value={room}>
        <ContextMenu />
      </RoomContext.Provider>,
    );
    expect(screen.queryByTestId('context-menu')).toBeNull();
  });

  it('빈 곳: 복사한 것이 없으면 붙여넣기는 꺼져 있고, 엔티티를 추가하면 선택하고 글자 편집으로 들어간다', () => {
    openMenu(null);
    expect(item('paste').disabled).toBe(true);
    expect(item('select-all').disabled).toBe(false);

    fireEvent.click(item('add-entity'));
    expect(ui().contextMenu).toBeNull();
    const added = room.nodes.getSnapshot().find((n) => !NODES.some((o) => o.id === n.id))!;
    expect(added).toMatchObject({ kind: 'entity', x: 500 - added.w / 2, y: 300 - added.h / 2 });
    expect(ui().selection).toEqual([added.id]);
    expect(ui().editingId).toBe(added.id);
  });

  it('빈 곳: 붙여넣기는 우클릭한 자리가 중심이 되게 놓는다', () => {
    ui().setSelection(['e']);
    copySelection(room);
    openMenu(null);
    expect(item('paste').disabled).toBe(false);
    fireEvent.click(item('paste'));
    const pasted = room.nodes.get(ui().selection[0])!;
    expect(pasted).toMatchObject({ x: 450, y: 275, text: '학생' });
  });

  it('빈 곳: 모두 선택', () => {
    openMenu(null);
    fireEvent.click(item('select-all'));
    expect(ui().selection).toHaveLength(NODES.length + EDGES.length);
  });

  it('엔티티: 약한 엔티티로 바꾸고 다시 되돌린다', () => {
    const first = openMenu('e');
    expect(item('toggle-weak').textContent).toContain('약한 엔티티로 바꾸기');
    fireEvent.click(item('toggle-weak'));
    expect(room.nodes.get('e')!.weak).toBe(true);
    first.unmount();

    openMenu('e');
    expect(item('toggle-weak').textContent).toContain('일반 엔티티로 바꾸기');
    fireEvent.click(item('toggle-weak'));
    expect(room.nodes.get('e')!.weak).toBeUndefined();
  });

  it('관계: 식별 관계 전환', () => {
    openMenu('r');
    fireEvent.click(item('toggle-identifying'));
    expect(room.nodes.get('r')!.identifying).toBe(true);
  });

  it('속성: 체크 항목으로 식별자, 부분 키, 다중값을 켜고 끈다', () => {
    const first = openMenu('at');
    expect(item('attr-key').getAttribute('aria-checked')).toBe('true');
    expect(item('attr-partial').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(item('attr-partial'));
    expect(room.nodes.get('at')!.keyType).toBe('partial');
    first.unmount();

    const second = openMenu('at');
    fireEvent.click(item('attr-partial'));
    expect(room.nodes.get('at')!.keyType).toBeUndefined();
    second.unmount();

    const third = openMenu('at');
    fireEvent.click(item('attr-multivalued'));
    third.unmount();
    openMenu('at');
    expect(room.nodes.get('at')).toMatchObject({ multivalued: true });
    expect(item('attr-multivalued').getAttribute('aria-checked')).toBe('true');
    // 유도 속성은 메뉴에 없다
    expect(screen.queryByTestId('menu-attr-derived')).toBeNull();
  });

  it('특수화 원: d와 o를 바꾸고 글자 편집은 꺼져 있다', () => {
    openMenu('s');
    expect(item('edit-text').disabled).toBe(true);
    fireEvent.click(item('toggle-spec'));
    expect(room.nodes.get('s')!.specType).toBe('o');
  });

  it('노드: 글자 편집', () => {
    openMenu('e', ['e', 'r']);
    fireEvent.click(item('edit-text'));
    expect(ui().selection).toEqual(['e']);
    expect(ui().editingId).toBe('e');
  });

  it('여러 개가 선택된 상태에서 그중 하나를 우클릭하면 복제와 삭제는 선택 전체에 적용한다', () => {
    const first = openMenu('e', ['e', 'r']);
    fireEvent.click(item('duplicate'));
    expect(room.nodes.getSnapshot()).toHaveLength(NODES.length + 2);
    expect(room.edges.getSnapshot()).toHaveLength(EDGES.length + 1);
    first.unmount();

    openMenu('e', ['e', 'r']);
    fireEvent.click(item('delete'));
    expect(room.nodes.has('e')).toBe(false);
    expect(room.nodes.has('r')).toBe(false);
  });

  it('선택 밖의 노드를 우클릭했으면 그 노드에만 적용한다', () => {
    openMenu('e', ['r']);
    fireEvent.click(item('delete'));
    expect(room.nodes.has('e')).toBe(false);
    expect(room.nodes.has('r')).toBe(true);
  });

  it('엣지: 카디널리티와 선 종류를 바꾼다', () => {
    const first = openMenu('er');
    expect(item('card-N').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(item('card-1'));
    expect(room.edges.get('er')!.label).toBe('1');
    first.unmount();

    const second = openMenu('er');
    fireEvent.click(item('card-none'));
    expect(room.edges.get('er')!.label).toBe('');
    second.unmount();

    const third = openMenu('er');
    expect(item('line-single').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(item('line-double'));
    expect(room.edges.get('er')!.double).toBe(true);
    third.unmount();

    openMenu('er');
    fireEvent.click(item('delete'));
    expect(room.edges.has('er')).toBe(false);
  });

  it('엣지: 엔티티와 속성 사이의 선에는 카디널리티 항목이 없다', () => {
    openMenu('ea');
    expect(hasItem('card-1')).toBe(false);
    expect(hasItem('delete')).toBe(true);
  });

  it('바깥을 누르거나 Esc, 스크롤, 창 크기 변경에서 닫는다', () => {
    // 다시 그려지고 닫기 처리기가 걸릴 때까지 기다리도록 act로 감싼다
    const reopen = () => act(() => ui().openContextMenu({ x: 100, y: 100, world: { x: 0, y: 0 }, targetId: null }));
    openMenu(null);

    fireEvent.pointerDown(screen.getByTestId('context-menu'));
    expect(ui().contextMenu).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(ui().contextMenu).toBeNull();

    reopen();
    const esc = new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(esc);
    expect(ui().contextMenu).toBeNull();
    // 전역 단축키가 같은 Esc를 또 처리하지 않도록 기본 동작을 막아 둔다
    expect(esc.defaultPrevented).toBe(true);

    reopen();
    fireEvent.wheel(document.body);
    expect(ui().contextMenu).toBeNull();

    reopen();
    fireEvent(window, new Event('resize'));
    expect(ui().contextMenu).toBeNull();
  });

  it('메뉴가 떠 있는 동안 대상이 지워지면 닫는다', () => {
    openMenu('e');
    expect(screen.queryByTestId('context-menu')).not.toBeNull();
    act(() => room.doc.transact(() => getNodesMap(room.doc).delete('e')));
    expect(ui().contextMenu).toBeNull();
    expect(screen.queryByTestId('context-menu')).toBeNull();
  });
});

describe('clampMenuPosition', () => {
  const viewport = { w: 1000, h: 800 };
  const size = { w: 200, h: 300 };

  it('자리가 넉넉하면 그대로 둔다', () => {
    expect(clampMenuPosition({ x: 100, y: 100 }, size, viewport)).toEqual({ x: 100, y: 100 });
  });
  it('오른쪽이나 아래로 넘치면 반대쪽으로 펼친다', () => {
    expect(clampMenuPosition({ x: 950, y: 700 }, size, viewport)).toEqual({ x: 750, y: 400 });
  });
  it('어느 쪽으로도 안 들어가면 가장자리에 붙인다', () => {
    expect(clampMenuPosition({ x: 100, y: 100 }, { w: 200, h: 900 }, viewport)).toEqual({ x: 100, y: 8 });
    expect(clampMenuPosition({ x: 150, y: 10 }, size, { w: 300, h: 800 })).toEqual({ x: 8, y: 10 });
  });
});

describe('HelpOverlay', () => {
  beforeEach(() => ui().togglePanel('help', true));

  it('묶음별 단축키와 마우스 조작을 보여 준다', () => {
    render(<HelpOverlay />);
    const text = screen.getByTestId('help-overlay').textContent ?? '';
    for (const word of ['도구', '편집', '화면', '기타', '마우스', '실행 취소', '약한 엔티티', '전체 보기', '카디널리티']) {
      expect(text).toContain(word);
    }
    expect(document.querySelectorAll('.kbd').length).toBeGreaterThan(20);
  });

  it('닫기 버튼과 바깥 클릭으로 닫고, 창 안을 눌러서는 닫지 않는다', () => {
    render(<HelpOverlay />);
    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(ui().panels.help).toBe(true);
    fireEvent.click(screen.getByTestId('help-close'));
    expect(ui().panels.help).toBe(false);

    ui().togglePanel('help', true);
    fireEvent.pointerDown(screen.getByTestId('help-overlay'));
    expect(ui().panels.help).toBe(false);
  });
});
