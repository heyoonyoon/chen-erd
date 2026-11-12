// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockLayout } from './DockLayout';
import { allGroups, groupOfPane, movePane } from './model';
import type { LayoutNode, LayoutState, PaneId } from './types';

const TITLES: Record<PaneId, string> = { erd: 'ERD', relational: 'Relational', ie: 'IE', sql: 'SQL' };
const paneTitle = (p: PaneId) => TITLES[p];
const paneIcon = (p: PaneId) => <svg data-icon={p} />;

let mounts: Record<string, number> = {};
let unmounts: Record<string, number> = {};

function Counter({ pane }: { pane: PaneId }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    mounts[pane] = (mounts[pane] ?? 0) + 1;
    return () => {
      unmounts[pane] = (unmounts[pane] ?? 0) + 1;
    };
  }, [pane]);
  return (
    <button type="button" data-testid={`count-${pane}`} onClick={() => setN((v) => v + 1)}>
      {n}
    </button>
  );
}
const renderPane = (p: PaneId) => <Counter pane={p} />;

let current: LayoutState;
const changes = vi.fn();

function Harness({ initial, narrow }: { initial: LayoutState; narrow?: boolean }) {
  const [s, setS] = useState(initial);
  current = s;
  return (
    <DockLayout
      state={s}
      onChange={(next) => {
        changes(next);
        setS(next);
      }}
      renderPane={renderPane}
      paneTitle={paneTitle}
      paneIcon={paneIcon}
      narrow={narrow}
    />
  );
}

function shape(n: LayoutNode): string {
  if (n.type === 'group') return `[${n.panes.map((p) => (p === n.active ? `*${p}` : p)).join(',')}]`;
  return `${n.direction}(${n.children.map(shape).join(' ')})`;
}

// ───────────── 가짜 배치(jsdom은 크기를 계산하지 않는다) ─────────────

type Rect = { left: number; top: number; width: number; height: number };
let groupRects: Record<string, Rect> = {};
const ROOT: Rect = { left: 0, top: 0, width: 1000, height: 400 };
const BAR = 32;
const TAB_W = 80;

function domRect({ left, top, width, height }: Rect): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function fakeRect(this: Element): DOMRect {
  const el = this as HTMLElement;
  if (el.dataset.testid === 'dock') return domRect(ROOT);
  const group = el.closest<HTMLElement>('[data-group]');
  const g = group ? groupRects[group.dataset.group!] : undefined;
  if (!g) return domRect({ left: 0, top: 0, width: 0, height: 0 });
  if (el === group) return domRect(g);
  if (el.classList.contains('dock-bar')) return domRect({ ...g, height: BAR });
  if (el.classList.contains('dock-content') || (el.classList.contains('dock-pane') && !el.classList.contains('is-parked')))
    return domRect({ ...g, top: g.top + BAR, height: g.height - BAR });
  if (el.classList.contains('dock-tab')) {
    const i = Array.from(el.parentElement!.children).indexOf(el);
    return domRect({ left: g.left + i * TAB_W, top: g.top, width: TAB_W, height: BAR });
  }
  return domRect({ left: 0, top: 0, width: 0, height: 0 });
}

/**
 * 시험용 배치: 왼쪽 ERD(g1), 오른쪽 위 relational과 ie 탭(g2), 오른쪽 아래 sql(g3).
 * 그룹마다 탭 수가 달라야 시험할 것이 많아서 기본 배치(defaultLayout) 대신 쓴다.
 */
function base(): LayoutState {
  return {
    version: 1,
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
            { type: 'group', id: 'g2', panes: ['relational', 'ie'], active: 'relational' },
            { type: 'group', id: 'g3', panes: ['sql'], active: 'sql' },
          ],
        },
      ],
    },
    maximized: null,
    lastGroup: 'g1',
  };
}

/** 시험용 배치의 그룹 자리: 왼쪽 600, 오른쪽 위 248, 오른쪽 아래 152 */
const DEFAULT_RECTS: Record<string, Rect> = {
  g1: { left: 0, top: 0, width: 600, height: 400 },
  g2: { left: 600, top: 0, width: 400, height: 248 },
  g3: { left: 600, top: 248, width: 400, height: 152 },
};

const tab = (c: HTMLElement, p: PaneId) => c.querySelector<HTMLElement>(`[role="tab"][data-tab="${p}"]`)!;
const paneEl = (c: HTMLElement, p: PaneId) => c.ownerDocument.querySelector<HTMLElement>(`[data-pane="${p}"]`)!;
const slotOf = (c: HTMLElement, p: PaneId) => paneEl(c, p).parentElement!;

function drag(from: HTMLElement, to: { x: number; y: number }, opts: { drop?: boolean } = {}) {
  const r = from.getBoundingClientRect();
  const start = { clientX: r.left + 10, clientY: r.top + 10 };
  fireEvent.pointerDown(from, { pointerId: 1, button: 0, isPrimary: true, ...start });
  fireEvent.pointerMove(from, { pointerId: 1, clientX: start.clientX + 20, clientY: start.clientY + 20 });
  fireEvent.pointerMove(from, { pointerId: 1, clientX: to.x, clientY: to.y });
  if (opts.drop !== false) fireEvent.pointerUp(from, { pointerId: 1, clientX: to.x, clientY: to.y });
}

beforeEach(() => {
  mounts = {};
  unmounts = {};
  groupRects = { ...DEFAULT_RECTS };
  changes.mockClear();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(fakeRect);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('그리기', () => {
  it('나눔과 그룹, 탭, 보이는 pane을 그린다', () => {
    const { container } = render(<Harness initial={base()} />);
    expect(container.querySelectorAll('[role="tablist"]')).toHaveLength(3);
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4);
    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(2);
    expect(tab(container, 'relational').getAttribute('aria-selected')).toBe('true');
    expect(tab(container, 'ie').getAttribute('aria-selected')).toBe('false');
    expect(tab(container, 'relational').querySelector('[data-icon="relational"]')).not.toBeNull();
    // 보이는 pane은 그룹 내용 칸에, 나머지는 보관함에
    expect(slotOf(container, 'erd').dataset.slot).toBe('g1');
    expect(slotOf(container, 'relational').dataset.slot).toBe('g2');
    expect(slotOf(container, 'sql').dataset.slot).toBe('g3');
    expect(slotOf(container, 'ie').classList.contains('dock-holder')).toBe(true);
    expect(paneEl(container, 'ie').style.display).not.toBe('none');
    // 보관함의 pane은 그룹 내용 칸의 크기를 지닌다
    expect(paneEl(container, 'ie').style.width).toBe('400px');
    expect(paneEl(container, 'ie').style.height).toBe(`${248 - BAR}px`);
    // pane 바깥 요소의 속성
    const erd = paneEl(container, 'erd');
    expect(erd.getAttribute('role')).toBe('tabpanel');
    expect(erd.getAttribute('aria-labelledby')).toBe(tab(container, 'erd').id);
    expect(tab(container, 'erd').getAttribute('aria-controls')).toBe(erd.id);
    // 각 pane은 한 번만 마운트된다
    expect(mounts).toEqual({ erd: 1, relational: 1, ie: 1, sql: 1 });
  });

  it('pane 안의 클릭은 React 이벤트로 그대로 전해진다(포털)', () => {
    const { container } = render(<Harness initial={base()} />);
    const btn = paneEl(container, 'erd').querySelector('button')!;
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(btn.textContent).toBe('2');
  });
});

describe('탭', () => {
  it('누르면 그 탭을 보이고 상태는 그대로다', () => {
    const { container } = render(<Harness initial={base()} />);
    fireEvent.click(paneEl(container, 'relational').querySelector('button')!);
    fireEvent.click(tab(container, 'ie'));
    expect(tab(container, 'ie').getAttribute('aria-selected')).toBe('true');
    expect(slotOf(container, 'ie').dataset.slot).toBe('g2');
    expect(slotOf(container, 'relational').classList.contains('dock-holder')).toBe(true);
    fireEvent.click(tab(container, 'relational'));
    expect(paneEl(container, 'relational').querySelector('button')!.textContent).toBe('1');
    expect(mounts.relational).toBe(1);
    expect(unmounts.relational).toBeUndefined();
  });

  it('화살표로 포커스를 옮기고 Enter, Space로 연다. 키 입력은 밖으로 새지 않는다', () => {
    const outside = vi.fn();
    window.addEventListener('keydown', outside);
    const { container } = render(<Harness initial={base()} />);
    const rel = tab(container, 'relational');
    rel.focus();
    fireEvent.keyDown(rel, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab(container, 'ie'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(rel);
    fireEvent.keyDown(rel, { key: 'End' });
    expect(document.activeElement).toBe(tab(container, 'ie'));
    expect(current.root.type === 'split' && shape(current.root)).toContain('[*relational,ie]');
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(tab(container, 'ie').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tab(container, 'ie'), { key: 'Home' });
    fireEvent.keyDown(document.activeElement!, { key: ' ' });
    expect(tab(container, 'relational').getAttribute('aria-selected')).toBe('true');
    expect(outside).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outside);
  });

  it('Delete로 닫고 포커스는 그 그룹의 다음 탭으로 간다', () => {
    const { container } = render(<Harness initial={base()} />);
    tab(container, 'relational').focus();
    fireEvent.keyDown(tab(container, 'relational'), { key: 'Delete' });
    expect(tab(container, 'relational')).toBeNull();
    expect(document.activeElement).toBe(tab(container, 'ie'));
    expect(unmounts.relational).toBe(1);
    expect(document.querySelector('[data-pane="relational"]')).toBeNull();
  });

  it('닫기 단추와 가운데 단추 클릭으로 닫는다', () => {
    const { container, getByTestId } = render(<Harness initial={base()} />);
    fireEvent.click(getByTestId('dock-close-ie'));
    expect(tab(container, 'ie')).toBeNull();
    fireEvent(tab(container, 'sql'), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(tab(container, 'sql')).toBeNull();
    // 왼쪽 단추 auxclick은 무시
    fireEvent(tab(container, 'relational'), new MouseEvent('auxclick', { bubbles: true, button: 2 }));
    expect(tab(container, 'relational')).not.toBeNull();
  });

  it('마지막 남은 탭은 닫을 수 없다', () => {
    const s: LayoutState = { version: 1, root: { type: 'group', id: 'g1', panes: ['erd'], active: 'erd' }, maximized: null };
    const { container, queryByTestId } = render(<Harness initial={s} />);
    expect(queryByTestId('dock-close-erd')).toBeNull();
    fireEvent.keyDown(tab(container, 'erd'), { key: 'Delete' });
    expect(tab(container, 'erd')).not.toBeNull();
    expect(changes).not.toHaveBeenCalled();
  });
});

describe('끌어 놓기', () => {
  const g1 = DEFAULT_RECTS.g1;
  const points = {
    left: { x: g1.left + 30, y: 200 },
    right: { x: g1.left + g1.width - 20, y: 200 },
    top: { x: 300, y: BAR + 20 },
    bottom: { x: 300, y: g1.height - 10 },
    center: { x: 300, y: 220 },
  };
  const expected = {
    left: 'row([*ie] [*erd] column([*relational] [*sql]))',
    right: 'row([*erd] [*ie] column([*relational] [*sql]))',
    top: 'row(column([*ie] [*erd]) column([*relational] [*sql]))',
    bottom: 'row(column([*erd] [*ie]) column([*relational] [*sql]))',
    center: 'row([erd,*ie] column([*relational] [*sql]))',
  };
  for (const edge of ['left', 'right', 'top', 'bottom', 'center'] as const) {
    it(`다른 그룹의 ${edge}에 놓는다`, () => {
      const { container, getByTestId } = render(<Harness initial={base()} />);
      fireEvent.click(paneEl(container, 'ie').querySelector('button')!);
      drag(tab(container, 'ie'), points[edge], { drop: false });
      const preview = getByTestId('dock-drop-preview');
      expect(preview.dataset.edge).toBe(edge);
      if (edge === 'left') expect(preview.style.width).toBe('300px');
      if (edge === 'bottom') expect(preview.style.top).toBe('200px');
      expect(getByTestId('dock-live').textContent).not.toBe('');
      fireEvent.pointerUp(tab(container, 'ie'), { pointerId: 1, clientX: points[edge].x, clientY: points[edge].y });
      expect(shape(current.root)).toBe(expected[edge]);
      expect(container.querySelector('[data-testid="dock-drop-preview"]')).toBeNull();
      // 옮겨도 다시 마운트하지 않는다
      expect(mounts.ie).toBe(1);
      expect(paneEl(container, 'ie').querySelector('button')!.textContent).toBe('1');
      expect(slotOf(container, 'ie').classList.contains('dock-content')).toBe(true);
    });
  }

  it('탭 줄 위에서는 끼울 자리를 보이고 그 자리에 넣는다', () => {
    const { container, getByTestId } = render(<Harness initial={base()} />);
    // g2의 첫 탭(600~680)과 둘째 탭 사이 왼쪽 절반 → index 1
    drag(tab(container, 'sql'), { x: 690, y: 10 }, { drop: false });
    const marker = getByTestId('dock-drop-marker');
    expect(marker.style.left).toBe('680px');
    fireEvent.pointerUp(tab(container, 'sql'), { pointerId: 1, clientX: 690, clientY: 10 });
    expect(shape(current.root)).toBe('row([*erd] [relational,*sql,ie])');
  });

  it('같은 탭 줄 안에서 순서를 바꾼다', () => {
    const { container } = render(<Harness initial={base()} />);
    drag(tab(container, 'relational'), { x: 600 + 2 * TAB_W - 5, y: 10 });
    expect(shape(current.root)).toContain('[ie,*relational]');
  });

  it('혼자인 탭을 자기 그룹 가장자리에 놓으면 미리 보기가 없고 바뀌지 않는다', () => {
    const { container, queryByTestId } = render(<Harness initial={base()} />);
    drag(tab(container, 'erd'), { x: 20, y: 200 }, { drop: false });
    expect(queryByTestId('dock-drop-preview')).toBeNull();
    fireEvent.pointerUp(tab(container, 'erd'), { pointerId: 1, clientX: 20, clientY: 200 });
    expect(shape(current.root)).toBe(shape(base().root));
  });

  it('Esc로 끌기를 취소한다', () => {
    const outside = vi.fn();
    window.addEventListener('keydown', outside);
    const { container, queryByTestId } = render(<Harness initial={base()} />);
    drag(tab(container, 'sql'), points.left, { drop: false });
    expect(queryByTestId('dock-drop-preview')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(queryByTestId('dock-drop-preview')).toBeNull();
    fireEvent.pointerUp(tab(container, 'sql'), { pointerId: 1, clientX: points.left.x, clientY: points.left.y });
    expect(shape(current.root)).toBe(shape(base().root));
    expect(outside).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outside);
  });

  it('조금 움직인 것은 끌기가 아니다(누르기로 본다)', () => {
    const { container } = render(<Harness initial={base()} />);
    const t = tab(container, 'ie');
    fireEvent.pointerDown(t, { pointerId: 1, button: 0, clientX: 610, clientY: 10 });
    fireEvent.pointerMove(t, { pointerId: 1, clientX: 612, clientY: 11 });
    fireEvent.pointerUp(t, { pointerId: 1, clientX: 612, clientY: 11 });
    fireEvent.click(t);
    expect(container.querySelector('.dock-overlay')).toBeNull();
    expect(shape(current.root)).toBe('row([*erd] column([relational,*ie] [*sql]))');
  });

  it('끌기 뒤의 click은 탭을 바꾸지 않는다', () => {
    const { container } = render(<Harness initial={base()} />);
    drag(tab(container, 'ie'), { x: 2000, y: 2000 });
    fireEvent.click(tab(container, 'ie'));
    expect(tab(container, 'ie').getAttribute('aria-selected')).toBe('false');
  });

  it('끌기 뒤의 click이 탭이 아닌 곳에 가도 그다음 탭 클릭은 듣는다', () => {
    const { container } = render(<Harness initial={base()} />);
    // sql을 g2의 탭 줄에 넣는다. 놓은 뒤의 click은 탭이 아닌 곳(탭 줄)으로 간다
    drag(tab(container, 'sql'), { x: 690, y: 10 });
    fireEvent.click(container.querySelector('.dock-tabs')!);
    expect(shape(current.root)).toBe('row([*erd] [relational,*sql,ie])');
    // 다음에 누른 탭은 보인다
    const ie = tab(container, 'ie');
    fireEvent.pointerDown(ie, { pointerId: 2, button: 0, isPrimary: true, clientX: 700, clientY: 10 });
    fireEvent.pointerUp(ie, { pointerId: 2, clientX: 700, clientY: 10 });
    fireEvent.click(ie);
    expect(ie.getAttribute('aria-selected')).toBe('true');
  });
});

describe('다시 마운트하지 않는다', () => {
  it('옮기기, 나누기, 합치기, 탭 바꾸기, 크게 보기를 거쳐도 상태가 남는다', () => {
    const { container, getByTestId } = render(<Harness initial={base()} />);
    for (const p of ['erd', 'relational', 'sql'] as const) fireEvent.click(paneEl(container, p).querySelector('button')!);
    // 나누기: relational을 ERD 아래로
    drag(tab(container, 'relational'), { x: 300, y: 390 });
    expect(shape(current.root)).toBe('row(column([*erd] [*relational]) column([*ie] [*sql]))');
    // 합치기: sql을 ERD 그룹 탭으로
    groupRects = {};
    for (const g of allGroups(current.root)) groupRects[g.id] = { left: 0, top: 0, width: 0, height: 0 };
    groupRects[groupOfPane(current, 'erd')!.id] = { left: 0, top: 0, width: 600, height: 200 };
    groupRects[groupOfPane(current, 'sql')!.id] = { left: 600, top: 248, width: 400, height: 152 };
    drag(tab(container, 'sql'), { x: 300, y: 120 });
    expect(shape(current.root)).toBe('row(column([erd,*sql] [*relational]) [*ie])');
    // 탭 바꾸기
    fireEvent.click(tab(container, 'erd'));
    fireEvent.click(tab(container, 'sql'));
    fireEvent.click(tab(container, 'erd'));
    // 크게 보기와 되돌리기
    const erdGroup = groupOfPane(current, 'erd')!.id;
    fireEvent.click(getByTestId(`dock-maximize-${erdGroup}`));
    expect(current.maximized).toBe(erdGroup);
    expect(container.querySelectorAll('[role="tablist"]')).toHaveLength(1);
    fireEvent.click(getByTestId(`dock-maximize-${erdGroup}`));
    expect(current.maximized).toBeNull();
    for (const p of ['erd', 'relational', 'sql'] as const) {
      expect(paneEl(container, p).querySelector('button')!.textContent).toBe('1');
    }
    expect(mounts).toEqual({ erd: 1, relational: 1, ie: 1, sql: 1 });
    expect(unmounts).toEqual({});
  });

  it('밖에서 state를 바꿔도(되돌리기 등) 다시 마운트하지 않는다', () => {
    const states: LayoutState[] = [];
    let s = base();
    states.push(s);
    s = movePane(s, 'ie', 'g1', 'right');
    states.push(s);
    s = movePane(s, 'erd', groupOfPane(s, 'sql')!.id, 'center');
    states.push(s);
    const props = { onChange: () => {}, renderPane, paneTitle };
    const { rerender, container } = render(<DockLayout state={states[0]} {...props} />);
    fireEvent.click(paneEl(container, 'ie').ownerDocument.querySelector('[data-testid="count-ie"]')!);
    for (const st of [...states, ...states.reverse()]) rerender(<DockLayout state={st} {...props} />);
    expect(document.querySelector<HTMLElement>('[data-testid="count-ie"]')!.textContent).toBe('1');
    expect(mounts.ie).toBe(1);
    expect(unmounts).toEqual({});
  });
});

describe('크게 보기', () => {
  it('탭 줄을 두 번 누르면 크게 보고 다시 두 번 누르면 돌아온다', () => {
    const { container } = render(<Harness initial={base()} />);
    const bar = tab(container, 'relational').closest('.dock-bar')!;
    fireEvent.doubleClick(bar);
    expect(current.maximized).toBe('g2');
    expect(container.querySelectorAll('[role="tablist"]')).toHaveLength(1);
    expect(slotOf(container, 'erd').classList.contains('dock-holder')).toBe(true);
    // 숨은 그룹의 pane은 마지막 크기를 지닌다
    expect(paneEl(container, 'erd').style.width).not.toBe('');
    fireEvent.doubleClick(tab(container, 'relational').closest('.dock-bar')!);
    expect(current.maximized).toBeNull();
    expect(slotOf(container, 'erd').dataset.slot).toBe('g1');
    expect(paneEl(container, 'erd').style.width).toBe('');
  });
});

describe('나눔선', () => {
  it('키보드로 크기를 바꾸고 두 번 누르면 똑같이 나눈다', () => {
    const outside = vi.fn();
    window.addEventListener('keydown', outside);
    const { getByTestId } = render(<Harness initial={base()} />);
    const d = getByTestId('dock-divider-s1-0');
    vi.spyOn(d.parentElement!, 'getBoundingClientRect').mockReturnValue(domRect(ROOT));
    fireEvent.keyDown(d, { key: 'ArrowRight' });
    const sizes = () => (current.root.type === 'split' ? current.root.sizes : []);
    expect(sizes()[0]).toBeCloseTo(0.616, 3);
    fireEvent.keyDown(d, { key: 'ArrowLeft', shiftKey: true });
    expect(sizes()[0]).toBeCloseTo(0.552, 3);
    fireEvent.keyDown(d, { key: 'Home' });
    expect(sizes()[0]).toBeCloseTo(0.16, 3);
    fireEvent.doubleClick(d);
    expect(sizes()).toEqual([0.5, 0.5]);
    expect(outside).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outside);
  });

  it('끌어서 크기를 바꾸고 가장 작은 크기를 지킨다', () => {
    const { getByTestId } = render(<Harness initial={base()} />);
    const d = getByTestId('dock-divider-s1-0');
    vi.spyOn(d.parentElement!, 'getBoundingClientRect').mockReturnValue(domRect(ROOT));
    fireEvent.pointerDown(d, { pointerId: 2, button: 0, clientX: 600, clientY: 100 });
    fireEvent.pointerMove(d, { pointerId: 2, clientX: 700, clientY: 100 });
    const sizes = () => (current.root.type === 'split' ? current.root.sizes : []);
    expect(sizes()[0]).toBeCloseTo(0.7, 5);
    fireEvent.pointerMove(d, { pointerId: 2, clientX: 990, clientY: 100 });
    expect(sizes()[1]).toBeCloseTo(0.16, 5);
    fireEvent.pointerUp(d, { pointerId: 2 });
    fireEvent.pointerMove(d, { pointerId: 2, clientX: 100, clientY: 100 });
    expect(sizes()[1]).toBeCloseTo(0.16, 5);
  });
});

describe('좁은 화면', () => {
  it('탭 한 줄로 모든 pane을 보이고 나누거나 끌지 않는다', () => {
    const { container, queryByTestId } = render(<Harness initial={base()} narrow />);
    expect(container.querySelectorAll('[role="tablist"]')).toHaveLength(1);
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4);
    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(0);
    expect(queryByTestId(/dock-maximize/)).toBeNull();
    // 최근 그룹(기본 배치는 ERD 그룹)의 보이는 탭이 보인다
    expect(tab(container, 'erd').getAttribute('aria-selected')).toBe('true');
    expect(slotOf(container, 'relational').classList.contains('dock-holder')).toBe(true);
    fireEvent.click(tab(container, 'relational'));
    expect(tab(container, 'relational').getAttribute('aria-selected')).toBe('true');
    expect(slotOf(container, 'relational').classList.contains('dock-content')).toBe(true);
    expect(slotOf(container, 'erd').classList.contains('dock-holder')).toBe(true);
    drag(tab(container, 'sql'), { x: 10, y: 200 });
    expect(container.querySelector('.dock-overlay')).toBeNull();
    expect(shape(current.root)).toBe(shape(base().root));
    expect(mounts).toEqual({ erd: 1, relational: 1, ie: 1, sql: 1 });
  });

  it('좁은 화면과 넓은 화면을 오가도 다시 마운트하지 않는다', () => {
    const props = { onChange: () => {}, renderPane, paneTitle };
    const s = base();
    const { rerender } = render(<DockLayout state={s} {...props} />);
    rerender(<DockLayout state={s} {...props} narrow />);
    rerender(<DockLayout state={s} {...props} />);
    expect(mounts).toEqual({ erd: 1, relational: 1, ie: 1, sql: 1 });
    expect(unmounts).toEqual({});
  });
});
