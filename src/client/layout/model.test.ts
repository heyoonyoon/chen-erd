import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LAYOUT_STORAGE_KEY,
  activatePane,
  allGroups,
  closePane,
  defaultLayout,
  findGroup,
  focusGroup,
  focusedPane,
  groupOfPane,
  isValidLayout,
  loadLayout,
  movePane,
  normalizeLayout,
  openPane,
  openPanes,
  resizeSplit,
  saveLayout,
  toggleMaximize,
} from './model';
import { PANE_IDS, type DropEdge, type LayoutNode, type LayoutState, type PaneId } from './types';

/** 정리된 상태의 약속을 모두 확인한다 */
function expectNormalized(state: LayoutState) {
  expect(state.version).toBe(1);
  const ids = new Set<string>();
  const seen = new Set<PaneId>();
  const visit = (n: LayoutNode, parentDir: string | null) => {
    expect(ids.has(n.id)).toBe(false);
    ids.add(n.id);
    if (n.type === 'group') {
      expect(n.panes.length).toBeGreaterThan(0);
      expect(n.panes).toContain(n.active);
      for (const p of n.panes) {
        expect(PANE_IDS).toContain(p);
        expect(seen.has(p)).toBe(false);
        seen.add(p);
      }
      return;
    }
    expect(n.children.length).toBeGreaterThanOrEqual(2);
    expect(n.sizes.length).toBe(n.children.length);
    expect(n.direction).not.toBe(parentDir);
    for (const s of n.sizes) expect(s).toBeGreaterThan(0);
    expect(n.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    n.children.forEach((c) => visit(c, n.direction));
  };
  visit(state.root, null);
  expect(seen.size).toBeGreaterThan(0);
  const groupIds = new Set(allGroups(state.root).map((g) => g.id));
  if (state.maximized !== null) {
    expect(groupIds.has(state.maximized)).toBe(true);
    expect(groupIds.size).toBeGreaterThan(1);
  }
  if (state.lastGroup !== undefined) expect(groupIds.has(state.lastGroup)).toBe(true);
}

/** 나무 모양만 짧은 글로(크기 빼고) */
function shape(n: LayoutNode): string {
  if (n.type === 'group') return `[${n.panes.map((p) => (p === n.active ? `*${p}` : p)).join(',')}]`;
  return `${n.direction}(${n.children.map(shape).join(' ')})`;
}

const groupWith = (s: LayoutState, p: PaneId) => groupOfPane(s, p)!.id;

describe('defaultLayout', () => {
  it('왼쪽 ERD(55%), 오른쪽 위 관계 모델, 오른쪽 아래 IE와 SQL 탭(ie 보임)', () => {
    const s = defaultLayout();
    expectNormalized(s);
    expect(shape(s.root)).toBe('row([*erd] column([*relational] [*ie,sql]))');
    expect(s.root.type === 'split' && s.root.sizes).toEqual([0.55, 0.45]);
    const right = s.root.type === 'split' ? s.root.children[1] : null;
    expect(right?.type === 'split' && right.sizes).toEqual([0.5, 0.5]);
    expect(s.maximized).toBeNull();
    expect(openPanes(s)).toEqual(['erd', 'relational', 'ie', 'sql']);
    expect(PANE_IDS).toEqual(['erd', 'relational', 'ie', 'sql']);
  });
});

describe('movePane: 가운데', () => {
  it('다른 그룹 끝에 탭으로 넣고 보이게 한다. 비는 그룹은 사라진다', () => {
    const s = defaultLayout();
    const next = movePane(s, 'relational', groupWith(s, 'ie'), 'center');
    expectNormalized(next);
    expect(shape(next.root)).toBe('row([*erd] [ie,sql,*relational])');
    expect(next.lastGroup).toBe(groupWith(s, 'ie'));
  });

  it('index 자리에 끼운다', () => {
    const s = defaultLayout();
    const next = movePane(s, 'relational', groupWith(s, 'ie'), 'center', 1);
    expect(shape(next.root)).toBe('row([*erd] [ie,*relational,sql])');
  });

  it('같은 그룹 안에서 순서를 바꾼다(index는 옮기기 전 목록 기준)', () => {
    const s = defaultLayout();
    const g = groupWith(s, 'ie');
    expect(shape(movePane(s, 'ie', g, 'center', 2).root)).toContain('[sql,*ie]');
    expect(shape(movePane(s, 'sql', g, 'center', 0).root)).toContain('[*sql,ie]');
    // 제자리
    expect(shape(movePane(s, 'ie', g, 'center', 1).root)).toContain('[*ie,sql]');
  });

  it('index가 범위를 벗어나면 끝이나 처음으로 맞춘다', () => {
    const s = defaultLayout();
    const g = groupWith(s, 'ie');
    expect(shape(movePane(s, 'erd', g, 'center', 99).root)).toBe('column([*relational] [ie,sql,*erd])');
    expect(shape(movePane(s, 'erd', g, 'center', -5).root)).toBe('column([*relational] [*erd,ie,sql])');
  });

  it('없는 그룹이면 그대로', () => {
    const s = defaultLayout();
    expect(movePane(s, 'erd', 'nope', 'center')).toBe(s);
  });

  it('보이던 탭을 옮기면 원래 그룹은 이웃 탭을 보인다', () => {
    const s = defaultLayout();
    const next = movePane(s, 'ie', groupWith(s, 'relational'), 'center');
    expect(shape(next.root)).toBe('row([*erd] column([relational,*ie] [*sql]))');
  });
});

describe('movePane: 가장자리', () => {
  it('부모 split과 방향이 다르면 대상을 새 split으로 감싼다', () => {
    const s = defaultLayout();
    const next = movePane(s, 'sql', groupWith(s, 'relational'), 'right');
    expectNormalized(next);
    expect(shape(next.root)).toBe('row([*erd] column(row([*relational] [*sql]) [*ie]))');
    expect(next.lastGroup).toBe(groupWith(next, 'sql'));
  });

  it('부모 split과 방향이 같으면 그 split에 넣고 대상의 몫을 반으로 나눈다', () => {
    const s = defaultLayout();
    const next = movePane(s, 'sql', groupWith(s, 'relational'), 'top');
    expectNormalized(next);
    expect(shape(next.root)).toBe('row([*erd] column([*sql] [*relational] [*ie]))');
    const col = next.root.type === 'split' ? next.root.children[1] : null;
    expect(col?.type === 'split' && col.sizes.map((x) => +x.toFixed(3))).toEqual([0.25, 0.25, 0.5]);
  });

  it('루트 그룹의 가장자리', () => {
    let s = defaultLayout();
    s = movePane(s, 'ie', groupWith(s, 'erd'), 'left');
    expect(shape(s.root)).toBe('row([*ie] [*erd] column([*relational] [*sql]))');
    s = movePane(s, 'erd', groupWith(s, 'relational'), 'bottom');
    expectNormalized(s);
    expect(shape(s.root)).toBe('row([*ie] column([*relational] [*erd] [*sql]))');
  });

  it('네 방향 모두 알맞은 자리에 새 그룹을 만든다', () => {
    const s = defaultLayout();
    const target = groupWith(s, 'erd');
    const expected: Record<Exclude<DropEdge, 'center'>, string> = {
      left: 'row([*relational] [*erd] [*ie,sql])',
      right: 'row([*erd] [*relational] [*ie,sql])',
      top: 'row(column([*relational] [*erd]) [*ie,sql])',
      bottom: 'row(column([*erd] [*relational]) [*ie,sql])',
    };
    for (const [edge, want] of Object.entries(expected)) {
      const next = movePane(s, 'relational', target, edge as DropEdge);
      expectNormalized(next);
      // 한 자식만 남은 column은 펼쳐진다
      expect(shape(next.root)).toBe(want);
    }
  });

  it('혼자 있는 탭을 자기 그룹 가장자리에 놓으면 그대로다', () => {
    const s = defaultLayout();
    for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
      expect(movePane(s, 'erd', groupWith(s, 'erd'), edge)).toBe(s);
    }
  });

  it('여러 탭인 그룹에서는 자기 그룹 가장자리로 나눌 수 있다', () => {
    const s = defaultLayout();
    const next = movePane(s, 'ie', groupWith(s, 'ie'), 'bottom');
    expect(shape(next.root)).toBe('row([*erd] column([*relational] [*sql] [*ie]))');
  });

  it('가장자리로 옮기면 크게 보기를 푼다', () => {
    let s = defaultLayout();
    s = toggleMaximize(s, groupWith(s, 'relational'));
    const next = movePane(s, 'ie', groupWith(s, 'relational'), 'right');
    expect(next.maximized).toBeNull();
  });
});

describe('openPane, closePane, activatePane', () => {
  it('닫으면 그 탭이 빠지고, 마지막 탭이면 그룹도 사라진다', () => {
    let s = defaultLayout();
    s = closePane(s, 'relational');
    expectNormalized(s);
    expect(shape(s.root)).toBe('row([*erd] [*ie,sql])');
    s = closePane(s, 'ie');
    expect(shape(s.root)).toBe('row([*erd] [*sql])');
  });

  it('마지막 남은 pane은 닫지 않는다', () => {
    let s = defaultLayout();
    for (const p of ['relational', 'ie', 'sql'] as const) s = closePane(s, p);
    expect(openPanes(s)).toEqual(['erd']);
    expect(closePane(s, 'erd')).toBe(s);
  });

  it('닫힌 pane을 닫으면 그대로', () => {
    const s = closePane(defaultLayout(), 'sql');
    expect(closePane(s, 'sql')).toBe(s);
  });

  it('최근에 쓴 ERD 아닌 그룹에 연다', () => {
    let s = closePane(defaultLayout(), 'sql');
    s = activatePane(s, 'relational');
    s = openPane(s, 'sql');
    expectNormalized(s);
    expect(groupWith(s, 'sql')).toBe(groupWith(s, 'relational'));
    expect(findGroup(s, groupWith(s, 'sql'))!.active).toBe('sql');
    expect(s.lastGroup).toBe(groupWith(s, 'sql'));
  });

  it('최근 그룹이 ERD 그룹이면 ERD 없는 가장 넓은 그룹에 연다', () => {
    let s = resizeSplit(closePane(defaultLayout(), 'sql'), 's2', [0.3, 0.7]);
    s = activatePane(s, 'erd');
    s = openPane(s, 'sql');
    expect(groupWith(s, 'sql')).toBe(groupWith(s, 'ie'));
  });

  it('최근 그룹 기록이 없으면 가장 넓은 ERD 없는 그룹에 연다', () => {
    let s = resizeSplit(closePane(defaultLayout(), 'sql'), 's2', [0.7, 0.3]);
    s = { ...s };
    delete s.lastGroup;
    s = openPane(s, 'sql');
    expect(groupWith(s, 'sql')).toBe(groupWith(s, 'relational'));
  });

  it('모두 ERD 그룹뿐이면 그 그룹에 연다', () => {
    let s = defaultLayout();
    for (const p of ['relational', 'ie', 'sql'] as const) s = closePane(s, p);
    s = openPane(s, 'sql');
    expect(shape(s.root)).toBe('[erd,*sql]');
  });

  it('ERD를 다시 열면 왼쪽에 넓은 그룹을 만든다', () => {
    let s = closePane(defaultLayout(), 'erd');
    s = openPane(s, 'erd');
    expectNormalized(s);
    expect(shape(s.root)).toBe('row([*erd] column([*relational] [*ie,sql]))');
    expect(s.root.type === 'split' && +s.root.sizes[0].toFixed(2)).toBe(0.55);
  });

  it('이미 열려 있으면 보이게만 한다', () => {
    const s = defaultLayout();
    const next = openPane(s, 'sql');
    expect(shape(next.root)).toBe('row([*erd] column([*relational] [ie,*sql]))');
    expect(openPane(next, 'sql')).toBe(next);
  });

  it('activatePane은 최근 그룹을 기록하고, 크게 보던 다른 그룹은 푼다', () => {
    let s = defaultLayout();
    s = toggleMaximize(s, groupWith(s, 'erd'));
    s = activatePane(s, 'sql');
    expect(s.maximized).toBeNull();
    expect(s.lastGroup).toBe(groupWith(s, 'sql'));
    expect(focusedPane(s)).toBe('sql');
    expect(activatePane(s, 'sql')).toBe(s);
  });

  it('focusGroup', () => {
    const s = defaultLayout();
    const g = groupWith(s, 'ie');
    expect(focusGroup(s, g).lastGroup).toBe(g);
    expect(focusGroup(s, 'nope')).toBe(s);
  });
});

describe('resizeSplit, toggleMaximize', () => {
  it('비율을 합 1로 맞춰 넣는다', () => {
    const s = resizeSplit(defaultLayout(), 's1', [3, 1]);
    expect(s.root.type === 'split' && s.root.sizes).toEqual([0.75, 0.25]);
  });

  it('길이가 다르거나 0, 음수, NaN이거나 없는 split이면 그대로', () => {
    const s = defaultLayout();
    expect(resizeSplit(s, 's1', [1])).toBe(s);
    expect(resizeSplit(s, 's1', [1, 0])).toBe(s);
    expect(resizeSplit(s, 's1', [1, -1])).toBe(s);
    expect(resizeSplit(s, 's1', [Number.NaN, 1])).toBe(s);
    expect(resizeSplit(s, 'nope', [1, 1])).toBe(s);
  });

  it('크게 보기를 켜고 끈다. 그룹이 하나면 켜지 않는다', () => {
    const s = defaultLayout();
    const on = toggleMaximize(s, 'g2');
    expect(on.maximized).toBe('g2');
    expect(toggleMaximize(on, 'g2').maximized).toBeNull();
    expect(toggleMaximize(s, 'nope')).toBe(s);
    let one = s;
    for (const p of ['relational', 'ie', 'sql'] as const) one = closePane(one, p);
    expect(toggleMaximize(one, allGroups(one.root)[0].id)).toBe(one);
  });

  it('크게 보던 그룹이 사라지면 크게 보기가 풀린다', () => {
    let s = toggleMaximize(defaultLayout(), 'g3');
    s = closePane(closePane(s, 'ie'), 'sql');
    expect(s.maximized).toBeNull();
  });
});

describe('정리', () => {
  it('빈 그룹, 자식 하나인 split, 같은 방향 중첩, 비율을 정리한다', () => {
    const messy = {
      version: 1,
      maximized: 'gone',
      lastGroup: 'gone',
      root: {
        type: 'split',
        id: 'a',
        direction: 'row',
        sizes: [2, 2, 0],
        children: [
          { type: 'split', id: 'b', direction: 'row', sizes: [1, 1], children: [
            { type: 'group', id: 'g1', panes: ['erd'], active: 'erd' },
            { type: 'group', id: 'g2', panes: ['ie', 'erd'], active: 'sql' },
          ] },
          { type: 'split', id: 'c', direction: 'column', sizes: [1], children: [{ type: 'group', id: 'g3', panes: ['sql'], active: 'sql' }] },
          { type: 'group', id: 'g4', panes: [], active: 'relational' },
        ],
      },
    } as unknown as LayoutState;
    const s = normalizeLayout(messy);
    expectNormalized(s);
    expect(shape(s.root)).toBe('row([*erd] [*ie] [*sql])');
    expect(s.root.type === 'split' && s.root.sizes).toEqual([0.25, 0.25, 0.5]);
  });
});

describe('무작위 조작 뒤에도 정리된 상태다', () => {
  /** 재현할 수 있는 난수(mulberry32) */
  function rng(seed: number) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const EDGES: DropEdge[] = ['center', 'left', 'right', 'top', 'bottom'];

  for (const seed of [1, 2, 3, 42, 1234, 9999, 31337, 777]) {
    it(`seed ${seed}`, () => {
      const r = rng(seed);
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
      let s = defaultLayout();
      for (let step = 0; step < 300; step++) {
        const groups = allGroups(s.root);
        const pane = pick(PANE_IDS);
        const op = Math.floor(r() * 8);
        const before = openPanes(s).length;
        if (op === 0) s = movePane(s, pane, pick(groups).id, pick(EDGES), r() < 0.5 ? Math.floor(r() * 5) : undefined);
        else if (op === 1) s = movePane(s, pane, pick(groups).id, pick(EDGES));
        else if (op === 2) s = openPane(s, pane);
        else if (op === 3) {
          s = closePane(s, pane);
          expect(openPanes(s).length).toBeGreaterThanOrEqual(Math.min(before, 1));
        } else if (op === 4) s = activatePane(s, pane);
        else if (op === 5) s = toggleMaximize(s, pick(groups).id);
        else if (op === 6) {
          const splits: string[] = [];
          const walk = (n: LayoutNode) => {
            if (n.type === 'split') {
              splits.push(n.id);
              n.children.forEach(walk);
            }
          };
          walk(s.root);
          if (splits.length) {
            const id = pick(splits);
            const n = (function find(x: LayoutNode): LayoutNode | null {
              if (x.id === id) return x;
              if (x.type === 'split') for (const c of x.children) { const f = find(c); if (f) return f; }
              return null;
            })(s.root);
            if (n?.type === 'split') s = resizeSplit(s, id, n.children.map(() => 0.05 + r()));
          }
        } else s = focusGroup(s, pick(groups).id);
        expectNormalized(s);
        expect(openPanes(s).length).toBeGreaterThan(0);
        // 저장했다 읽어도 같아야 한다
        if (step % 25 === 0) expect(isValidLayout(JSON.parse(JSON.stringify(s)))).toBe(true);
      }
    });
  }
});

describe('loadLayout, saveLayout', () => {
  const store = new Map<string, string>();
  const fake = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });

  it('저장한 것을 그대로 읽는다', () => {
    vi.stubGlobal('localStorage', fake);
    let s = movePane(defaultLayout(), 'sql', 'g1', 'bottom');
    s = toggleMaximize(s, groupWith(s, 'sql'));
    saveLayout(s);
    expect(store.has(LAYOUT_STORAGE_KEY)).toBe(true);
    expect(loadLayout()).toEqual(s);
  });

  it('없으면 기본 배치', () => {
    vi.stubGlobal('localStorage', fake);
    expect(loadLayout()).toEqual(defaultLayout());
  });

  const bad: [string, unknown][] = [
    ['JSON이 아님', '{nope'],
    ['null', null],
    ['배열', []],
    ['숫자', 3],
    ['옛 버전', { ...defaultLayout(), version: 0 }],
    ['새 버전', { ...defaultLayout(), version: 2 }],
    ['root 없음', { version: 1, maximized: null }],
    ['모르는 pane만', { version: 1, maximized: null, root: { type: 'group', id: 'g', panes: ['chat', 'steps'], active: 'steps' } }],
    ['겹친 pane', { version: 1, maximized: null, root: { type: 'split', id: 's', direction: 'row', sizes: [0.5, 0.5], children: [
      { type: 'group', id: 'a', panes: ['erd'], active: 'erd' },
      { type: 'group', id: 'b', panes: ['erd'], active: 'erd' },
    ] } }],
    ['빈 그룹', { version: 1, maximized: null, root: { type: 'group', id: 'g', panes: [], active: 'erd' } }],
    ['active가 밖', { version: 1, maximized: null, root: { type: 'group', id: 'g', panes: ['erd'], active: 'sql' } }],
    ['겹친 id', { version: 1, maximized: null, root: { type: 'split', id: 'a', direction: 'row', sizes: [0.5, 0.5], children: [
      { type: 'group', id: 'a', panes: ['erd'], active: 'erd' },
      { type: 'group', id: 'b', panes: ['sql'], active: 'sql' },
    ] } }],
    ['sizes 길이', { version: 1, maximized: null, root: { type: 'split', id: 's', direction: 'row', sizes: [1], children: [
      { type: 'group', id: 'a', panes: ['erd'], active: 'erd' },
      { type: 'group', id: 'b', panes: ['sql'], active: 'sql' },
    ] } }],
    ['sizes 음수', { version: 1, maximized: null, root: { type: 'split', id: 's', direction: 'row', sizes: [1.5, -0.5], children: [
      { type: 'group', id: 'a', panes: ['erd'], active: 'erd' },
      { type: 'group', id: 'b', panes: ['sql'], active: 'sql' },
    ] } }],
    ['자식 하나', { version: 1, maximized: null, root: { type: 'split', id: 's', direction: 'row', sizes: [1], children: [
      { type: 'group', id: 'a', panes: ['erd'], active: 'erd' },
    ] } }],
    ['방향 이상', { version: 1, maximized: null, root: { type: 'split', id: 's', direction: 'diagonal', sizes: [0.5, 0.5], children: [
      { type: 'group', id: 'a', panes: ['erd'], active: 'erd' },
      { type: 'group', id: 'b', panes: ['sql'], active: 'sql' },
    ] } }],
    ['maximized 형식', { ...defaultLayout(), maximized: 3 }],
    ['종류 이상', { version: 1, maximized: null, root: { type: 'tab', id: 'g' } }],
  ];
  for (const [name, value] of bad) {
    it(`깨진 값이면 기본 배치: ${name}`, () => {
      vi.stubGlobal('localStorage', fake);
      store.set(LAYOUT_STORAGE_KEY, typeof value === 'string' ? value : JSON.stringify(value));
      expect(loadLayout()).toEqual(defaultLayout());
    });
  }

  it('예전 배치(변환 과정 pane이 있던 기본 배치)는 그 pane만 빼고 읽는다', () => {
    vi.stubGlobal('localStorage', fake);
    const legacy = {
      version: 1,
      maximized: 'g3',
      lastGroup: 'g3',
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
    store.set(LAYOUT_STORAGE_KEY, JSON.stringify(legacy));
    const s = loadLayout();
    expectNormalized(s);
    expect(shape(s.root)).toBe('row([*erd] [*relational,ie,sql])');
    expect(s.root.type === 'split' && s.root.sizes).toEqual([0.6, 0.4]);
    expect(s.maximized).toBeNull();
    expect(s.lastGroup).toBeUndefined();
  });

  it('보이던 탭이 없어진 pane이면 남은 첫 탭을 보이고, 모르는 pane은 뺀다', () => {
    vi.stubGlobal('localStorage', fake);
    store.set(
      LAYOUT_STORAGE_KEY,
      JSON.stringify({ version: 1, maximized: null, root: { type: 'group', id: 'g', panes: ['steps', 'erd', 'chat', 'sql'], active: 'steps' } }),
    );
    const s = loadLayout();
    expectNormalized(s);
    expect(shape(s.root)).toBe('[*erd,sql]');
  });

  it('사라진 그룹을 가리키는 maximized, lastGroup은 지우고 읽는다', () => {
    vi.stubGlobal('localStorage', fake);
    store.set(LAYOUT_STORAGE_KEY, JSON.stringify({ ...defaultLayout(), maximized: 'gone', lastGroup: 'gone' }));
    const s = loadLayout();
    expect(s.maximized).toBeNull();
    expect(s.lastGroup).toBeUndefined();
    expect(shape(s.root)).toBe(shape(defaultLayout().root));
  });

  it('localStorage가 던져도 기본 배치로 읽고, 저장은 조용히 넘어간다', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(loadLayout()).toEqual(defaultLayout());
    expect(() => saveLayout(defaultLayout())).not.toThrow();
  });

  it('localStorage가 없어도 된다', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadLayout()).toEqual(defaultLayout());
    expect(() => saveLayout(defaultLayout())).not.toThrow();
  });
});
