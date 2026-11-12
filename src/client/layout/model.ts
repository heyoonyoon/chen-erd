/**
 * 배치 나무를 다루는 순수 함수(types.ts의 계약). 모든 함수는 정리된 상태를 돌려준다:
 * 빈 그룹 없음, 자식이 하나인 split 없음, 같은 방향 split의 중첩 없음, sizes 합 1,
 * active는 panes 안, 한 pane은 많아야 한 번, maximized와 lastGroup은 있는 그룹만 가리킨다.
 * 바뀐 것이 없으면 받은 state를 그대로 돌려준다(같은 객체라서 React가 다시 그리지 않는다).
 */
import {
  PANE_IDS,
  type DropEdge,
  type GroupNode,
  type LayoutNode,
  type LayoutState,
  type PaneId,
  type SplitNode,
} from './types';

export const LAYOUT_STORAGE_KEY = 'modelll.layout';

/** 가장자리에 새 그룹을 만들 때 새 그룹이 대상 자리에서 가져가는 몫 */
const EDGE_SHARE = 0.5;
/** 닫혀 있던 ERD를 다시 열 때 왼쪽에 만드는 그룹의 몫 */
const ERD_SHARE = 0.55;

// ───────────── 기본 배치 ─────────────

/**
 * 처음 배치. 왼쪽에 ERD(55%), 오른쪽 위에 관계 모델 글(오른쪽 높이의 절반), 오른쪽 아래에 IE 다이어그램과 SQL 탭.
 * 사람이 그리는 ERD, 사람이 적는 관계 모델, 그 글에서 나오는 IE와 SQL을 한눈에 본다.
 * 최근 그룹은 ERD 그룹이라서 좁은 화면에서 처음 보이는 pane은 ERD다.
 */
export function defaultLayout(): LayoutState {
  return {
    version: 1,
    root: {
      type: 'split',
      id: 's1',
      direction: 'row',
      sizes: [0.55, 0.45],
      children: [
        { type: 'group', id: 'g1', panes: ['erd'], active: 'erd' },
        {
          type: 'split',
          id: 's2',
          direction: 'column',
          sizes: [0.5, 0.5],
          children: [
            { type: 'group', id: 'g2', panes: ['relational'], active: 'relational' },
            { type: 'group', id: 'g3', panes: ['ie', 'sql'], active: 'ie' },
          ],
        },
      ],
    },
    maximized: null,
    lastGroup: 'g1',
  };
}

// ───────────── 읽기 ─────────────

/** 나무 순서(왼쪽 위부터)대로 모든 그룹 */
export function allGroups(node: LayoutNode): GroupNode[] {
  if (node.type === 'group') return [node];
  return node.children.flatMap(allGroups);
}

/** 열린 pane. 나무 순서, 그룹 안에서는 탭 순서 */
export function openPanes(state: LayoutState): PaneId[] {
  return allGroups(state.root).flatMap((g) => g.panes);
}

export function findGroup(state: LayoutState, groupId: string): GroupNode | null {
  return allGroups(state.root).find((g) => g.id === groupId) ?? null;
}

/** pane이 들어 있는 그룹. 닫혀 있으면 null */
export function groupOfPane(state: LayoutState, pane: PaneId): GroupNode | null {
  return allGroups(state.root).find((g) => g.panes.includes(pane)) ?? null;
}

/** 화면 전체에서 각 그룹이 차지하는 넓이의 비율 */
function groupAreas(node: LayoutNode, share = 1, out = new Map<string, number>()): Map<string, number> {
  if (node.type === 'group') out.set(node.id, share);
  else node.children.forEach((c, i) => groupAreas(c, share * node.sizes[i], out));
  return out;
}

/** 가장 최근에 쓴 그룹. 기록이 없으면 가장 넓은 그룹 */
export function focusedGroup(state: LayoutState): GroupNode {
  const last = state.lastGroup ? findGroup(state, state.lastGroup) : null;
  if (last) return last;
  return largestGroup(state, () => true) ?? allGroups(state.root)[0];
}

/** 가장 최근에 쓴 그룹에서 보이는 pane(좁은 화면은 이 pane 하나를 보여 준다) */
export function focusedPane(state: LayoutState): PaneId {
  return focusedGroup(state).active;
}

function largestGroup(state: LayoutState, accept: (g: GroupNode) => boolean): GroupNode | null {
  const areas = groupAreas(state.root);
  let best: GroupNode | null = null;
  for (const g of allGroups(state.root)) {
    if (!accept(g)) continue;
    if (!best || (areas.get(g.id) ?? 0) > (areas.get(best.id) ?? 0)) best = g;
  }
  return best;
}

// ───────────── 정리 ─────────────

function allIds(node: LayoutNode, out = new Set<string>()): Set<string> {
  out.add(node.id);
  if (node.type === 'split') node.children.forEach((c) => allIds(c, out));
  return out;
}

function freshId(root: LayoutNode, prefix: 'g' | 's', taken: Set<string> = allIds(root)): string {
  for (let i = 1; ; i++) {
    const id = `${prefix}${i}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

/** 합이 1인 비율로 맞춘다. 0이나 음수, 숫자가 아닌 값은 아주 작은 몫으로 바꾼다 */
function normalizeSizes(sizes: number[]): number[] {
  const clean = sizes.map((s) => (Number.isFinite(s) && s > 0 ? s : 0));
  const sum = clean.reduce((a, b) => a + b, 0);
  if (sum <= 0) return sizes.map(() => 1 / sizes.length);
  const floor = sum / sizes.length / 20;
  const lifted = clean.map((s) => Math.max(s, floor));
  const total = lifted.reduce((a, b) => a + b, 0);
  return lifted.map((s) => s / total);
}

function normalizeNode(node: LayoutNode, seen: Set<PaneId>): LayoutNode | null {
  if (node.type === 'group') {
    const panes = node.panes.filter((p) => PANE_IDS.includes(p) && !seen.has(p));
    panes.forEach((p) => seen.add(p));
    if (panes.length === 0) return null;
    const active = panes.includes(node.active) ? node.active : panes[0];
    return { type: 'group', id: node.id, panes, active };
  }
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, i) => {
    const c = normalizeNode(child, seen);
    if (!c) return;
    const share = node.sizes[i] ?? 0;
    if (c.type === 'split' && c.direction === node.direction) {
      // 같은 방향의 중첩은 펼친다
      c.children.forEach((cc, j) => {
        children.push(cc);
        sizes.push(share * c.sizes[j]);
      });
    } else {
      children.push(c);
      sizes.push(share);
    }
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { type: 'split', id: node.id, direction: node.direction, children, sizes: normalizeSizes(sizes) };
}

/** 나무를 정리하고 maximized, lastGroup을 맞춘다. 남는 pane이 하나도 없으면 null */
function finish(root: LayoutNode, prev: LayoutState, patch: Partial<LayoutState> = {}): LayoutState | null {
  const next = normalizeNode(root, new Set());
  if (!next) return null;
  const ids = new Set(allGroups(next).map((g) => g.id));
  const many = ids.size > 1;
  const maximized = 'maximized' in patch ? patch.maximized ?? null : prev.maximized;
  const lastGroup = 'lastGroup' in patch ? patch.lastGroup : prev.lastGroup;
  const state: LayoutState = {
    version: 1,
    root: next,
    maximized: many && maximized && ids.has(maximized) ? maximized : null,
  };
  if (lastGroup && ids.has(lastGroup)) state.lastGroup = lastGroup;
  return state;
}

/** 아무 상태나 정리한다(검사는 하지 않는다). */
export function normalizeLayout(state: LayoutState): LayoutState {
  return finish(state.root, state) ?? defaultLayout();
}

// ───────────── 나무 고치기 ─────────────

function mapGroups(node: LayoutNode, fn: (g: GroupNode) => LayoutNode): LayoutNode {
  if (node.type === 'group') return fn(node);
  return { ...node, children: node.children.map((c) => mapGroups(c, fn)), sizes: [...node.sizes] };
}

function withoutPane(root: LayoutNode, pane: PaneId): LayoutNode {
  return mapGroups(root, (g) => {
    const i = g.panes.indexOf(pane);
    if (i < 0) return g;
    const panes = g.panes.filter((p) => p !== pane);
    // 보이던 탭을 빼면 오른쪽 이웃(없으면 왼쪽)을 보인다
    const active = g.active === pane ? panes[Math.min(i, panes.length - 1)] : g.active;
    return { ...g, panes, active: active ?? g.active };
  });
}

/** target 노드 옆에 node를 끼운다. 부모 split의 방향이 같으면 그 split에 넣는다 */
function insertBeside(
  root: LayoutNode,
  targetId: string,
  node: LayoutNode,
  edge: Exclude<DropEdge, 'center'>,
  share: number,
  splitId: () => string,
): LayoutNode {
  const direction = edge === 'left' || edge === 'right' ? 'row' : 'column';
  const before = edge === 'left' || edge === 'top';
  const wrap = (target: LayoutNode): SplitNode => ({
    type: 'split',
    id: splitId(),
    direction,
    children: before ? [node, target] : [target, node],
    sizes: before ? [share, 1 - share] : [1 - share, share],
  });
  if (root.id === targetId) return wrap(root);
  const visit = (n: LayoutNode): LayoutNode => {
    if (n.type === 'group') return n;
    const i = n.children.findIndex((c) => c.id === targetId);
    if (i < 0) return { ...n, children: n.children.map(visit), sizes: [...n.sizes] };
    const children = [...n.children];
    const sizes = [...n.sizes];
    if (n.direction === direction) {
      const s = sizes[i];
      sizes[i] = s * (1 - share);
      const at = before ? i : i + 1;
      children.splice(at, 0, node);
      sizes.splice(at, 0, s * share);
    } else {
      children[i] = wrap(children[i]);
    }
    return { ...n, children, sizes };
  };
  return visit(root);
}

// ───────────── 조작 ─────────────

/**
 * pane을 옮긴다. center면 그 그룹의 index 자리(없으면 끝)에 탭으로 넣고, 가장자리면 그 그룹 옆에 새 그룹을 만든다.
 * index는 옮기기 전 대상 그룹의 탭 목록에서 끼울 자리다(같은 그룹 안에서 옮겨도 그렇다).
 * 닫혀 있던 pane이면 그 자리에 연다.
 */
export function movePane(
  state: LayoutState,
  pane: PaneId,
  targetGroupId: string,
  edge: DropEdge,
  index?: number,
): LayoutState {
  if (!PANE_IDS.includes(pane)) return state;
  const target = findGroup(state, targetGroupId);
  if (!target) return state;
  const source = groupOfPane(state, pane);

  if (edge === 'center') {
    let at = index ?? target.panes.length;
    at = Math.max(0, Math.min(Math.floor(at), target.panes.length));
    if (source && source.id === target.id) {
      const from = target.panes.indexOf(pane);
      if (at > from) at -= 1;
      if (at === from && target.active === pane) return state.lastGroup === target.id ? state : focusGroup(state, target.id);
    }
    const removed = source ? withoutPane(state.root, pane) : state.root;
    const root = mapGroups(removed, (g) => {
      if (g.id !== target.id) return g;
      const panes = [...g.panes];
      panes.splice(Math.min(at, panes.length), 0, pane);
      return { ...g, panes, active: pane };
    });
    return finish(root, state, { lastGroup: target.id, maximized: keepMaximized(state, target.id) }) ?? state;
  }

  // 혼자 있는 탭을 자기 그룹 가장자리에 놓으면 그대로다
  if (source && source.id === target.id && source.panes.length === 1) return state;
  const taken = allIds(state.root);
  const group: GroupNode = { type: 'group', id: freshId(state.root, 'g', taken), panes: [pane], active: pane };
  // 먼저 끼우고 나서 원래 자리에서 뺀다(빈 그룹은 정리하면서 없어진다)
  const inserted = insertBeside(state.root, target.id, group, edge, EDGE_SHARE, () => freshId(state.root, 's', taken));
  const root = source ? removeFromGroup(inserted, source.id, pane) : inserted;
  return finish(root, state, { lastGroup: group.id, maximized: null }) ?? state;
}

function removeFromGroup(root: LayoutNode, groupId: string, pane: PaneId): LayoutNode {
  return mapGroups(root, (g) => (g.id === groupId ? (withoutPane(g, pane) as GroupNode) : g));
}

/** 크게 보던 그룹이 아닌 곳에서 무언가를 보이면 크게 보기를 푼다 */
function keepMaximized(state: LayoutState, groupId: string): string | null {
  return state.maximized === groupId ? state.maximized : null;
}

/**
 * 닫힌 pane을 연다. 가장 최근에 쓴 그룹(ERD가 든 그룹이면 ERD가 없는 가장 넓은 그룹)에 넣는다.
 * ERD는 왼쪽에 자기 그룹을 새로 만든다. 이미 열려 있으면 그 탭을 보이게만 한다.
 */
export function openPane(state: LayoutState, pane: PaneId): LayoutState {
  if (!PANE_IDS.includes(pane)) return state;
  if (groupOfPane(state, pane)) return activatePane(state, pane);
  if (pane === 'erd') {
    const taken = allIds(state.root);
    const group: GroupNode = { type: 'group', id: freshId(state.root, 'g', taken), panes: ['erd'], active: 'erd' };
    const root = insertBeside(state.root, state.root.id, group, 'left', ERD_SHARE, () => freshId(state.root, 's', taken));
    return finish(root, state, { lastGroup: group.id, maximized: null }) ?? state;
  }
  const noErd = (g: GroupNode) => !g.panes.includes('erd');
  const last = state.lastGroup ? findGroup(state, state.lastGroup) : null;
  const target = (last && noErd(last) ? last : null) ?? largestGroup(state, noErd) ?? focusedGroup(state);
  return movePane(state, pane, target.id, 'center');
}

/** pane을 닫는다. 마지막으로 열린 pane은 닫지 않는다 */
export function closePane(state: LayoutState, pane: PaneId): LayoutState {
  const group = groupOfPane(state, pane);
  if (!group) return state;
  if (openPanes(state).length <= 1) return state;
  return finish(withoutPane(state.root, pane), state) ?? state;
}

/** pane의 탭을 보이고 그 그룹을 최근에 쓴 그룹으로 기록한다 */
export function activatePane(state: LayoutState, pane: PaneId): LayoutState {
  const group = groupOfPane(state, pane);
  if (!group) return state;
  if (group.active === pane && state.lastGroup === group.id && keepMaximized(state, group.id) === state.maximized) {
    return state;
  }
  const root = mapGroups(state.root, (g) => (g.id === group.id ? { ...g, active: pane } : g));
  return finish(root, state, { lastGroup: group.id, maximized: keepMaximized(state, group.id) }) ?? state;
}

/** 그룹을 최근에 쓴 그룹으로 기록한다(그룹 안을 눌렀을 때) */
export function focusGroup(state: LayoutState, groupId: string): LayoutState {
  if (state.lastGroup === groupId || !findGroup(state, groupId)) return state;
  return { ...state, lastGroup: groupId };
}

/** split의 비율을 바꾼다. 길이가 다르거나 숫자가 아니면 그대로 */
export function resizeSplit(state: LayoutState, splitId: string, sizes: number[]): LayoutState {
  if (!sizes.every((s) => Number.isFinite(s) && s > 0)) return state;
  let found = false;
  const visit = (n: LayoutNode): LayoutNode => {
    if (n.type === 'group') return n;
    if (n.id === splitId) {
      if (sizes.length !== n.children.length) return n;
      found = true;
      const sum = sizes.reduce((a, b) => a + b, 0);
      return { ...n, sizes: sizes.map((s) => s / sum) };
    }
    return { ...n, children: n.children.map(visit) };
  };
  const root = visit(state.root);
  if (!found) return state;
  return finish(root, state) ?? state;
}

/** 그룹 하나를 크게 보거나 되돌린다. 그룹이 하나뿐이면 그대로 */
export function toggleMaximize(state: LayoutState, groupId: string): LayoutState {
  if (state.maximized === groupId) return { ...state, maximized: null };
  if (!findGroup(state, groupId) || allGroups(state.root).length < 2) return state;
  return { ...state, maximized: groupId, lastGroup: groupId };
}

// ───────────── 검사와 저장 ─────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validNode(v: unknown, ids: Set<string>, panes: Set<PaneId>, depth: number): v is LayoutNode {
  if (!isRecord(v) || depth > 32) return false;
  if (typeof v.id !== 'string' || v.id === '' || ids.has(v.id)) return false;
  ids.add(v.id);
  if (v.type === 'group') {
    if (!Array.isArray(v.panes) || v.panes.length === 0) return false;
    for (const p of v.panes) {
      if (!PANE_IDS.includes(p as PaneId) || panes.has(p as PaneId)) return false;
      panes.add(p as PaneId);
    }
    return v.panes.includes(v.active);
  }
  if (v.type === 'split') {
    if (v.direction !== 'row' && v.direction !== 'column') return false;
    if (!Array.isArray(v.children) || v.children.length < 2) return false;
    if (!Array.isArray(v.sizes) || v.sizes.length !== v.children.length) return false;
    if (!v.sizes.every((s) => typeof s === 'number' && Number.isFinite(s) && s > 0)) return false;
    return v.children.every((c) => validNode(c, ids, panes, depth + 1));
  }
  return false;
}

/** 저장된 값이 올바른 배치인지 본다(버전, 알 수 없는 pane, 겹침, 빈 그룹, 비율) */
export function isValidLayout(v: unknown): v is LayoutState {
  if (!isRecord(v) || v.version !== 1) return false;
  const ids = new Set<string>();
  if (!validNode(v.root, ids, new Set(), 0)) return false;
  if (v.maximized !== null && typeof v.maximized !== 'string') return false;
  if (v.lastGroup !== undefined && v.lastGroup !== null && typeof v.lastGroup !== 'string') return false;
  return true;
}

/**
 * 저장된 값에서 지금은 없는 pane(예전의 'steps' 같은 것)을 뺀다. 그룹이 비면 그룹을, 자식이 줄어든 split은 그 자식과 비율을 뺀다.
 * 모양 검사는 하지 않는다(isValidLayout이 한다). 남는 것이 없으면 null
 */
function dropUnknownPanes(v: unknown): unknown {
  if (!isRecord(v)) return v;
  if (v.type === 'group') {
    if (!Array.isArray(v.panes)) return v;
    const panes = v.panes.filter((p) => PANE_IDS.includes(p as PaneId));
    if (panes.length === 0) return null;
    // 보이던 탭이 없어진 pane이었을 때만 남은 첫 탭으로 바꾼다(그 밖의 잘못된 값은 검사에서 걸러진다)
    const active = PANE_IDS.includes(v.active as PaneId) ? v.active : panes[0];
    return { ...v, panes, active };
  }
  if (v.type === 'split' && Array.isArray(v.children) && Array.isArray(v.sizes) && v.sizes.length === v.children.length) {
    const children: unknown[] = [];
    const sizes: unknown[] = [];
    v.children.forEach((c, i) => {
      const next = dropUnknownPanes(c);
      if (next === null) return;
      children.push(next);
      sizes.push((v.sizes as unknown[])[i]);
    });
    if (children.length === v.children.length) return { ...v, children };
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    return { ...v, children, sizes };
  }
  return v;
}

/** 이 브라우저에 저장된 배치. 지금은 없는 pane은 빼고 읽는다. 없거나 깨졌으면 기본 배치 */
export function loadLayout(): LayoutState {
  try {
    const raw = globalThis.localStorage?.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return defaultLayout();
    const stored: unknown = JSON.parse(raw);
    if (!isRecord(stored)) return defaultLayout();
    const root = dropUnknownPanes(stored.root);
    if (root === null) return defaultLayout();
    const parsed: unknown = { ...stored, root };
    if (!isValidLayout(parsed)) return defaultLayout();
    const state: LayoutState = { version: 1, root: parsed.root, maximized: parsed.maximized };
    if (typeof parsed.lastGroup === 'string') state.lastGroup = parsed.lastGroup;
    return normalizeLayout(state);
  } catch {
    return defaultLayout();
  }
}

export function saveLayout(state: LayoutState): void {
  try {
    globalThis.localStorage?.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* 저장하지 못해도(사생활 보호 모드, 용량) 화면은 그대로 쓴다 */
  }
}
