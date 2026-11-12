// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErdEdge, ErdNode } from '../../shared/types';
import { RoomContext } from '../collab/hooks';
import { getEdgesMap, getNodesMap, readEdge, readNode } from '../collab/docOps';
import { ElementStore, type Room } from '../collab/room';
import { setLocale } from '../i18n';
import { closePane, defaultLayout, LAYOUT_STORAGE_KEY } from '../layout/model';
import { IS_MAC } from '../canvas/shortcuts';
import { resetRelPanes, revealInEditor } from '../relational/paneStore';
import { useUi } from '../state/ui';

// 방 화면은 pane을 끼워 넣기만 한다. pane 내용과 상단 바는 계약(시그니처)만 흉내 낸다
const spy = vi.hoisted(() => ({ shortcuts: 0 }));
vi.mock('../canvas/ErdPane', () => ({ ErdPane: () => <div data-testid="erd-pane" tabIndex={-1} /> }));
vi.mock('../canvas/shortcuts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../canvas/shortcuts')>()),
  useShortcuts: () => {
    spy.shortcuts++;
  },
}));
vi.mock('../relational/panes', () => ({
  // 실제 pane처럼 키 전파를 막는다
  RelationalTextPane: () => <textarea data-testid="pane-relational" onKeyDown={(e) => e.stopPropagation()} />,
  IePane: () => <div data-testid="pane-ie" />,
  SqlPane: () => <div data-testid="pane-sql" />,
}));
vi.mock('../ui/TopBar', () => ({
  TopBar: ({ paneMenu }: { paneMenu?: ReactNode }) => (
    <div>
      {paneMenu}
      <button type="button" data-testid="issues-button" onClick={() => useUi.getState().togglePanel('issues')} />
    </div>
  ),
}));
vi.mock('../ui/ContextMenu', () => ({ ContextMenu: () => null }));
vi.mock('../presence/NicknameDialog', () => ({ NicknameDialog: () => null }));

import { RoomLayout } from './RoomPage';

function makeRoom(): Room {
  const doc = new Y.Doc();
  return {
    id: 'room1',
    doc,
    nodes: new ElementStore<ErdNode>(getNodesMap(doc), readNode),
    edges: new ElementStore<ErdEdge>(getEdgesMap(doc), readEdge),
    provider: { on: () => {}, off: () => {}, connect: () => {} },
    setPresence: () => {},
  } as unknown as Room;
}

function mount() {
  return render(
    <RoomContext.Provider value={makeRoom()}>
      <RoomLayout />
    </RoomContext.Provider>,
  );
}

const slotOf = (pane: string) => document.querySelector(`.dock-pane[data-pane="${pane}"]`)!.parentElement!;
const isShown = (pane: string) => slotOf(pane).classList.contains('dock-content');
const tab = (pane: string) => document.querySelector<HTMLElement>(`[role="tab"][data-tab="${pane}"]`)!;

beforeEach(() => {
  setLocale('ko');
  localStorage.clear();
  history.replaceState(null, '', '/r/room1');
  useUi.getState().reset();
  resetRelPanes();
  spy.shortcuts = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('방 화면의 pane 배치', () => {
  it('처음에는 기본 배치(ERD 옆 위에 관계 모델, 아래에 IE와 SQL 탭)를 보이고 캔버스 단축키를 건다', async () => {
    mount();
    expect(await screen.findByTestId('pane-relational')).toBeTruthy();
    expect(isShown('erd')).toBe(true);
    expect(isShown('relational')).toBe(true);
    expect(isShown('ie')).toBe(true);
    expect(isShown('sql')).toBe(false);
    expect(tab('relational').textContent).toContain('관계 모델');
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(4);
    expect(document.querySelector('[data-pane="steps"]')).toBeNull();
    expect(spy.shortcuts).toBeGreaterThan(0);
  });

  it('예전 배치에 남은 변환 과정 pane은 빼고 연다', async () => {
    const legacy = {
      version: 1,
      maximized: null,
      lastGroup: 'g1',
      root: {
        type: 'split',
        id: 's1',
        direction: 'row',
        sizes: [0.6, 0.4],
        children: [
          { type: 'group', id: 'g1', panes: ['erd'], active: 'erd' },
          {
            type: 'split',
            id: 's2',
            direction: 'column',
            sizes: [0.62, 0.38],
            children: [
              { type: 'group', id: 'g2', panes: ['relational', 'ie', 'sql'], active: 'relational' },
              { type: 'group', id: 'g3', panes: ['steps'], active: 'steps' },
            ],
          },
        ],
      },
    };
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(legacy));
    mount();
    await screen.findByTestId('pane-relational');
    expect(isShown('erd')).toBe(true);
    expect(isShown('relational')).toBe(true);
    expect(document.querySelector('[data-pane="steps"]')).toBeNull();
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(4);
  });

  it('다른 pane이 편집기의 자리를 보여 달라고 하면 관계 모델 pane을 보이게 한다', async () => {
    const stored = {
      ...defaultLayout(),
      root: { type: 'group', id: 'g2', panes: ['erd', 'relational', 'ie', 'sql'], active: 'ie' },
      lastGroup: 'g2',
    };
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(stored));
    mount();
    await screen.findByTestId('pane-ie');
    expect(isShown('relational')).toBe(false);
    act(() => revealInEditor({ line: 2, column: 1 }));
    expect(isShown('relational')).toBe(true);
  });

  it('관계 모델 쪽 pane은 포커스를 받을 수 있는 틀 안에 있다', async () => {
    mount();
    await screen.findByTestId('pane-sql');
    const frame = screen.getByTestId('pane-sql').closest('.room-pane') as HTMLElement;
    expect(frame.tabIndex).toBe(-1);
    expect(frame.closest('[data-pane="sql"]')).not.toBeNull();
  });

  it('ERD pane이 닫혀 있으면 단축키를 걸지 않고, 상단 바에서 검증 패널을 열면 ERD pane을 다시 연다', async () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(closePane(defaultLayout(), 'erd')));
    mount();
    await screen.findByTestId('pane-relational');
    expect(document.querySelector('[data-pane="erd"]')).toBeNull();
    expect(spy.shortcuts).toBe(0);
    fireEvent.click(screen.getByTestId('issues-button'));
    expect(isShown('erd')).toBe(true);
    expect(spy.shortcuts).toBeGreaterThan(0);
  });

  it('상단 바에서 검증 패널을 열면 가려져 있던 ERD 탭을 보이게 한다', async () => {
    // 모든 pane이 한 그룹의 탭이고 ERD 탭이 가려진 배치
    const stored = {
      ...defaultLayout(),
      root: { type: 'group', id: 'g2', panes: ['erd', 'relational', 'ie', 'sql'], active: 'relational' },
      lastGroup: 'g2',
    };
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(stored));
    mount();
    await screen.findByTestId('pane-relational');
    expect(isShown('erd')).toBe(false);
    fireEvent.click(screen.getByTestId('issues-button'));
    expect(isShown('erd')).toBe(true);
    expect(useUi.getState().panels.issues).toBe(true);
  });

  it('예전 링크의 #sql은 SQL pane을 보이게 하고 주소에서 해시를 지운다', async () => {
    history.replaceState(null, '', '/r/room1#sql');
    mount();
    await screen.findByTestId('pane-sql');
    expect(isShown('sql')).toBe(true);
    expect(location.hash).toBe('');
    expect(location.pathname).toBe('/r/room1');
  });

  it('배치를 바꾸면 잠시 뒤에 저장하고, 페이지를 떠날 때는 바로 저장한다', async () => {
    mount();
    await screen.findByTestId('pane-relational');
    vi.useFakeTimers();
    fireEvent.click(tab('sql'));
    expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBeNull();
    act(() => vi.advanceTimersByTime(350));
    expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!).root.children[1].children[1].active).toBe('sql');

    fireEvent.click(tab('ie'));
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!).root.children[1].children[1].active).toBe('ie');
  });

  it('Ctrl/Cmd+S는 키 전파를 막는 pane 안에서도, ERD pane이 닫혀 있어도 브라우저 저장 창을 막는다', async () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(closePane(defaultLayout(), 'erd')));
    mount();
    const editor = await screen.findByTestId('pane-relational');
    const mod = IS_MAC ? { metaKey: true } : { ctrlKey: true };
    const event = new KeyboardEvent('keydown', { code: 'KeyS', key: 's', bubbles: true, cancelable: true, ...mod });
    editor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('패널 메뉴가 상단 바에 있고 pane을 닫고 연다', async () => {
    mount();
    await screen.findByTestId('pane-relational');
    fireEvent.click(screen.getByTestId('pane-menu-button'));
    fireEvent.click(screen.getByTestId('pane-menu-ie'));
    expect(document.querySelector('[data-pane="ie"]')).toBeNull();
  });
});
