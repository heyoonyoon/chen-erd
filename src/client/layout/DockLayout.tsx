/**
 * 방 화면의 pane 배치 틀(VS Code의 편집기 그룹처럼). 나눔(split)은 줄이나 칸으로, 그룹은 탭 줄과 내용 칸으로 그린다.
 *
 * pane은 옮기거나 숨겨도 다시 마운트하지 않는다. 그렇게 하려고:
 *   - pane마다 떨어진 div(호스트)를 하나씩 만들고, 모든 열린 pane을 이 컴포넌트의 고정된 자리에서
 *     createPortal로 그 호스트에 그린다. 그래서 React 나무에서 pane의 자리는 배치가 바뀌어도 그대로다.
 *   - 그리고 나서(layout effect) 각 호스트 div를 보여야 할 그룹의 내용 칸에 appendChild로 붙인다.
 *     보이지 않는 pane은 숨김 보관함(holder)에 둔다. display: none을 쓰지 않고, 그룹 내용 칸의 크기를
 *     그대로 고정해 두므로 다시 붙일 때 크기가 0이었다가 돌아오는 일이 없다.
 *
 * 탭 끌기는 HTML5 끌어 놓기가 아니라 pointer 이벤트로 한다(어디서나 같고 시험하기 쉽다).
 */
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useT, type MessageKey } from '../i18n';
import {
  activatePane,
  allGroups,
  closePane,
  findGroup,
  focusGroup,
  focusedPane,
  groupOfPane,
  movePane,
  openPanes,
  resizeSplit,
  toggleMaximize,
} from './model';
import type { DropEdge, GroupNode, LayoutNode, LayoutState, PaneId, SplitNode } from './types';
import './DockLayout.css';

export interface DockLayoutProps {
  state: LayoutState;
  onChange: (next: LayoutState) => void;
  /** pane 내용. 옮기거나 숨겨도 다시 마운트하지 않는다. 같은 함수를 넘기면(useCallback) 배치가 바뀌어도 내용을 다시 그리지 않는다 */
  renderPane: (pane: PaneId) => ReactNode;
  paneTitle: (pane: PaneId) => string;
  paneIcon?: (pane: PaneId) => ReactNode;
  /** 좁은 화면: 나누지 않고 탭 한 줄로 모든 pane을 보여 준다 */
  narrow?: boolean;
  /** 좁은 화면에서 탭 줄 오른쪽 끝에 놓을 것(예: 패널 메뉴). 넓은 화면에서는 그리지 않는다 */
  narrowBarEnd?: ReactNode;
  className?: string;
}

/** 나눔 칸의 가장 작은 크기(px) */
export const MIN_PANE_PX = 160;
/** 탭을 이만큼(px) 움직여야 끌기로 본다 */
const DRAG_THRESHOLD = 5;
/** 가장자리 영역의 폭(그룹 크기에 대한 비율) */
const EDGE_ZONE = 0.28;
/** 나눔선을 키보드로 움직이는 양(px) */
const KEY_STEP = 16;
const KEY_STEP_LARGE = 64;
const NARROW_SLOT = '__narrow';

/** 탭을 놓을 자리 */
interface DropTarget {
  groupId: string;
  edge: DropEdge;
  /** 탭 줄에 놓을 때 끼울 자리 */
  index?: number;
  /** 놓을 수 없는 자리(혼자인 탭을 자기 그룹 가장자리나 자기 그룹 가운데에) */
  none?: boolean;
  /** 미리 보기 사각형(틀 기준 px) */
  preview?: { left: number; top: number; width: number; height: number };
  /** 끼울 자리 표시(틀 기준 px) */
  marker?: { left: number; top: number; height: number };
}

interface DragState {
  pane: PaneId;
  x: number;
  y: number;
  target: DropTarget | null;
}

interface Pending {
  pane: PaneId;
  groupId: string;
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
}

/** 그룹 하나를 그리는 데 필요한 것(틀이 만들어 내려보낸다) */
interface Ctx {
  uid: string;
  state: LayoutState;
  narrow: boolean;
  narrowBarEnd?: ReactNode;
  dragging: PaneId | null;
  canClose: boolean;
  canMaximize: boolean;
  paneTitle: (pane: PaneId) => string;
  paneIcon?: (pane: PaneId) => ReactNode;
  t: ReturnType<typeof useT>;
  registerGroup: (id: string, el: HTMLElement | null) => void;
  registerSlot: (id: string, el: HTMLElement | null) => void;
  onActivate: (pane: PaneId) => void;
  onClose: (pane: PaneId, refocus: boolean) => void;
  onFocusGroup: (groupId: string) => void;
  onToggleMaximize: (groupId: string) => void;
  onResize: (splitId: string, sizes: number[]) => void;
  tabPointer: {
    down: (e: ReactPointerEvent<HTMLElement>, pane: PaneId, groupId: string) => void;
    move: (e: ReactPointerEvent<HTMLElement>) => void;
    up: (e: ReactPointerEvent<HTMLElement>) => void;
    cancel: () => void;
  };
  /** 끌기를 마친 직후의 click은 무시한다 */
  consumeClick: () => boolean;
}

export const tabDomId = (uid: string, pane: PaneId) => `${uid}-tab-${pane}`;
export const paneDomId = (uid: string, pane: PaneId) => `${uid}-pane-${pane}`;

/** pane 내용. renderPane이 같으면 배치가 바뀌어도 다시 그리지 않는다 */
const PaneContent = memo(function PaneContent(props: { pane: PaneId; render: (pane: PaneId) => ReactNode }) {
  return <>{props.render(props.pane)}</>;
});

export function DockLayout(props: DockLayoutProps) {
  const { state, onChange, renderPane, paneTitle, paneIcon, narrow = false } = props;
  const t = useT();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const latest = useRef({ state, onChange });
  latest.current = { state, onChange };

  const rootRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const hosts = useRef(new Map<PaneId, HTMLDivElement>());
  const groupEls = useRef(new Map<string, HTMLElement>());
  const slots = useRef(new Map<string, HTMLElement>());
  /** 마지막으로 보였을 때의 pane 크기 */
  const lastSize = useRef(new Map<PaneId, { w: number; h: number }>());
  const focusAfter = useRef<PaneId | null>(null);
  const narrowRef = useRef(narrow);
  narrowRef.current = narrow;

  const panes = openPanes(state);
  const shownGroup = !narrow && state.maximized ? findGroup(state, state.maximized) : null;

  /** pane의 호스트 div. 처음 부를 때 만들고 닫힐 때까지 같은 것을 쓴다 */
  const host = (pane: PaneId): HTMLDivElement => {
    let el = hosts.current.get(pane);
    if (!el) {
      el = document.createElement('div');
      el.className = 'dock-pane';
      el.dataset.pane = pane;
      el.setAttribute('role', 'tabpanel');
      hosts.current.set(pane, el);
    }
    el.id = paneDomId(uid, pane);
    el.setAttribute('aria-labelledby', tabDomId(uid, pane));
    return el;
  };

  /** 지금 상태에 맞게 호스트 div를 그룹 내용 칸이나 보관함에 붙인다 */
  const place = useCallback(() => {
    const holder = holderRef.current;
    if (!holder) return;
    const { state: s } = latest.current;
    const shown = new Map<PaneId, string>();
    if (narrowRef.current) shown.set(focusedPane(s), NARROW_SLOT);
    else for (const g of allGroups(s.root)) if (slots.current.has(g.id)) shown.set(g.active, g.id);
    const open = new Set(openPanes(s));

    for (const [pane, el] of hosts.current) {
      if (!open.has(pane)) {
        // 닫힌 pane: 내용은 이미 내려졌다. 호스트도 버린다
        el.remove();
        hosts.current.delete(pane);
        lastSize.current.delete(pane);
        continue;
      }
      const slot = shown.has(pane) ? slots.current.get(shown.get(pane)!) : undefined;
      if (slot) {
        if (el.parentNode !== slot) slot.appendChild(el);
        el.classList.remove('is-parked');
        el.style.width = '';
        el.style.height = '';
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) lastSize.current.set(pane, { w: r.width, h: r.height });
      } else {
        // 보이지 않는 pane은 자기 그룹 내용 칸의 크기(없으면 마지막 크기)를 그대로 지닌 채 보관함에 둔다
        const group = narrowRef.current ? null : groupOfPane(s, pane);
        const groupSlot = group ? slots.current.get(group.id) : narrowRef.current ? slots.current.get(NARROW_SLOT) : undefined;
        const r = groupSlot?.getBoundingClientRect();
        const size = r && r.width > 0 && r.height > 0 ? { w: r.width, h: r.height } : lastSize.current.get(pane);
        if (size) {
          el.style.width = `${size.w}px`;
          el.style.height = `${size.h}px`;
        }
        el.classList.add('is-parked');
        if (el.parentNode !== holder) holder.appendChild(el);
      }
    }
  }, []);

  useLayoutEffect(() => {
    place();
    if (focusAfter.current) {
      document.getElementById(tabDomId(uid, focusAfter.current))?.focus();
      focusAfter.current = null;
    }
  });

  // 창 크기가 바뀌면 보관함의 pane 크기도 맞춘다
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => place());
    ro.observe(root);
    return () => ro.disconnect();
  }, [place]);

  // 틀이 내려가면 호스트를 화면에서 뗀다. 목록은 비우지 않는다: StrictMode는 내렸다가 다시 올려 보는데,
  // 그때 같은 호스트를 다시 붙여야 포털이 새 컨테이너로 옮겨 가며 내용을 다시 마운트하지 않는다
  useLayoutEffect(() => {
    const map = hosts.current;
    return () => {
      for (const el of map.values()) el.remove();
    };
  }, []);

  const registerGroup = useCallback((id: string, el: HTMLElement | null) => {
    if (el) groupEls.current.set(id, el);
    else groupEls.current.delete(id);
  }, []);
  const registerSlot = useCallback((id: string, el: HTMLElement | null) => {
    if (el) slots.current.set(id, el);
    else slots.current.delete(id);
  }, []);

  const commit = (next: LayoutState) => {
    if (next !== latest.current.state) latest.current.onChange(next);
  };

  // ───────────── 탭 끌기 ─────────────

  const [drag, setDrag] = useState<DragState | null>(null);
  const [announce, setAnnounce] = useState('');
  const pending = useRef<Pending | null>(null);
  const swallowClick = useRef(false);
  const lastHint = useRef<string>('');

  const hitTest = (x: number, y: number, pane: PaneId): DropTarget | null => {
    const root = rootRef.current;
    if (!root) return null;
    const base = root.getBoundingClientRect();
    const s = latest.current.state;
    const source = groupOfPane(s, pane);
    for (const [groupId, el] of groupEls.current) {
      const group = findGroup(s, groupId);
      if (!group) continue;
      const gr = el.getBoundingClientRect();
      if (x < gr.left || x > gr.right || y < gr.top || y > gr.bottom) continue;
      const strip = el.querySelector<HTMLElement>('.dock-bar');
      const sr = strip?.getBoundingClientRect();
      if (sr && y <= sr.bottom) {
        // 탭 줄 위: 탭 사이에 끼운다
        const tabs = Array.from(el.querySelectorAll<HTMLElement>('.dock-tabs > .dock-tab'));
        let index = tabs.length;
        let markX = tabs.length ? tabs[tabs.length - 1].getBoundingClientRect().right : sr.left;
        for (let i = 0; i < tabs.length; i++) {
          const r = tabs[i].getBoundingClientRect();
          if (x < r.left + r.width / 2) {
            index = i;
            markX = r.left;
            break;
          }
        }
        return {
          groupId,
          edge: 'center',
          index,
          marker: { left: markX - base.left, top: sr.top - base.top, height: sr.height },
        };
      }
      const content = slots.current.get(groupId)?.getBoundingClientRect() ?? gr;
      const w = Math.max(content.width, 1);
      const h = Math.max(content.height, 1);
      const fx = (x - content.left) / w;
      const fy = (y - content.top) / h;
      const dist: [DropEdge, number][] = [
        ['left', fx],
        ['right', 1 - fx],
        ['top', fy],
        ['bottom', 1 - fy],
      ];
      dist.sort((a, b) => a[1] - b[1]);
      const edge: DropEdge = dist[0][1] < EDGE_ZONE ? dist[0][0] : 'center';
      const own = source?.id === groupId;
      const none = edge === 'center' ? own : own && group.panes.length === 1;
      if (none) return { groupId, edge, none: true };
      const rel = { left: gr.left - base.left, top: gr.top - base.top, width: gr.width, height: gr.height };
      let preview = rel;
      if (edge === 'center') {
        preview = { left: content.left - base.left, top: content.top - base.top, width: content.width, height: content.height };
      } else if (edge === 'left') preview = { ...rel, width: rel.width / 2 };
      else if (edge === 'right') preview = { ...rel, left: rel.left + rel.width / 2, width: rel.width / 2 };
      else if (edge === 'top') preview = { ...rel, height: rel.height / 2 };
      else preview = { ...rel, top: rel.top + rel.height / 2, height: rel.height / 2 };
      return { groupId, edge, preview };
    }
    return null;
  };

  const hintKey = (target: DropTarget | null): MessageKey =>
    !target || target.none ? 'dock.drop.none' : (`dock.drop.${target.edge}` as MessageKey);

  const endDrag = useCallback(() => {
    pending.current = null;
    setDrag(null);
    lastHint.current = '';
  }, []);

  const cancelDrag = useCallback(() => {
    const wasDragging = pending.current?.dragging;
    endDrag();
    if (wasDragging) setAnnounce(t('dock.dragCancelled'));
  }, [endDrag, t]);

  // 끄는 동안 Esc로 취소한다(캔버스 단축키로 넘기지 않는다)
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        swallowClick.current = true;
        cancelDrag();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [drag, cancelDrag]);

  const tabPointer: Ctx['tabPointer'] = {
    down: (e, pane, groupId) => {
      // 끌기를 마친 뒤의 click이 다른 요소에 가서(누른 탭과 놓은 자리가 달라서) 남은 표시는 새로 누를 때 지운다.
      // 그대로 두면 다음 탭 클릭 한 번을 삼킨다
      swallowClick.current = false;
      if (narrow || e.button !== 0 || e.isPrimary === false) return;
      pending.current = { pane, groupId, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, dragging: false };
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* 캡처를 못 해도 끌기는 된다 */
      }
    },
    move: (e) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (!p.dragging) {
        if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < DRAG_THRESHOLD) return;
        p.dragging = true;
        setAnnounce(t('dock.dragStart', { title: paneTitle(p.pane) }));
      }
      e.preventDefault();
      const target = hitTest(e.clientX, e.clientY, p.pane);
      const hint = t(hintKey(target));
      if (hint !== lastHint.current) {
        lastHint.current = hint;
        if (target) setAnnounce(hint);
      }
      setDrag({ pane: p.pane, x: e.clientX, y: e.clientY, target });
    },
    up: (e) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (!p.dragging) {
        pending.current = null;
        return;
      }
      swallowClick.current = true;
      const target = hitTest(e.clientX, e.clientY, p.pane);
      endDrag();
      if (!target || target.none) return;
      const s = latest.current.state;
      const next = movePane(s, p.pane, target.groupId, target.edge, target.index);
      if (next !== s) {
        commit(next);
        setAnnounce(t('dock.moved', { title: paneTitle(p.pane) }));
      }
    },
    cancel: () => {
      if (pending.current) cancelDrag();
    },
  };

  // ───────────── 상태 바꾸기 ─────────────

  const ctx: Ctx = {
    uid,
    state,
    narrow,
    narrowBarEnd: props.narrowBarEnd,
    dragging: drag?.pane ?? null,
    canClose: panes.length > 1,
    canMaximize: !narrow && (allGroups(state.root).length > 1 || state.maximized !== null),
    paneTitle,
    paneIcon,
    t,
    registerGroup,
    registerSlot,
    onActivate: (pane) => commit(activatePane(latest.current.state, pane)),
    onClose: (pane, refocus) => {
      const s = latest.current.state;
      const before = groupOfPane(s, pane);
      const next = closePane(s, pane);
      if (next === s) return;
      if (refocus) {
        const after = before ? findGroup(next, before.id) : null;
        focusAfter.current = narrow || !after ? focusedPane(next) : after.active;
      }
      commit(next);
    },
    onFocusGroup: (groupId) => commit(focusGroup(latest.current.state, groupId)),
    onToggleMaximize: (groupId) => commit(toggleMaximize(latest.current.state, groupId)),
    onResize: (splitId, sizes) => commit(resizeSplit(latest.current.state, splitId, sizes)),
    tabPointer,
    consumeClick: () => {
      const v = swallowClick.current;
      swallowClick.current = false;
      return v;
    },
  };

  let body: ReactNode;
  if (narrow) {
    const group: GroupNode = { type: 'group', id: NARROW_SLOT, panes, active: focusedPane(state) };
    body = <GroupView group={group} ctx={ctx} />;
  } else if (shownGroup) {
    body = <GroupView key={shownGroup.id} group={shownGroup} ctx={ctx} maximized />;
  } else {
    body = <NodeView node={state.root} ctx={ctx} />;
  }

  const base = rootRef.current?.getBoundingClientRect();
  const className = ['dock', narrow ? 'dock-narrow' : '', drag ? 'is-dragging' : '', props.className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className} ref={rootRef} data-testid="dock">
      {body}
      {/* 보이지 않는 pane을 두는 곳. 크기는 지닌 채로 화면과 포커스에서 빠진다 */}
      <div className="dock-holder" ref={holderRef} aria-hidden="true" inert />
      {drag && (
        <div className="dock-overlay" aria-hidden="true">
          {drag.target?.preview && (
            <div
              className={`dock-drop-preview dock-drop-${drag.target.edge}`}
              data-testid="dock-drop-preview"
              data-edge={drag.target.edge}
              style={drag.target.preview}
            />
          )}
          {drag.target?.marker && (
            <div className="dock-drop-marker" data-testid="dock-drop-marker" style={drag.target.marker} />
          )}
          <div
            className="dock-ghost"
            style={ghostPosition(drag, base)}
          >
            {paneIcon && <span className="dock-tab-icon">{paneIcon(drag.pane)}</span>}
            <span>{paneTitle(drag.pane)}</span>
          </div>
        </div>
      )}
      <div className="sr-only" aria-live="polite" data-testid="dock-live">
        {announce}
      </div>
      {panes.map((pane) => createPortal(<PaneContent pane={pane} render={renderPane} />, host(pane), pane))}
    </div>
  );
}

/** 끄는 탭 꼬리표의 자리. 포인터 오른쪽 아래에 두되 틀 밖으로 잘리지 않게 안쪽으로 당긴다 */
function ghostPosition(drag: DragState, base: DOMRect | undefined): { left: number; top: number } {
  const x = drag.x - (base?.left ?? 0);
  const y = drag.y - (base?.top ?? 0);
  const w = base?.width ?? Infinity;
  const h = base?.height ?? Infinity;
  const left = Math.max(0, Math.min(x + 10, w - 180));
  const top = y + 12 + 30 > h ? Math.max(0, y - 40) : y + 12;
  return { left, top };
}

// ───────────── 나무 ─────────────

function NodeView({ node, ctx }: { node: LayoutNode; ctx: Ctx }) {
  if (node.type === 'group') return <GroupView key={node.id} group={node} ctx={ctx} />;
  return <SplitView key={node.id} split={node} ctx={ctx} />;
}

function SplitView({ split, ctx }: { split: SplitNode; ctx: Ctx }) {
  const ref = useRef<HTMLDivElement>(null);
  const row = split.direction === 'row';
  const dragRef = useRef<{ index: number; start: number; sizes: number[]; total: number; pointerId: number } | null>(
    null,
  );
  const [active, setActive] = useState<number | null>(null);

  const total = () => {
    const r = ref.current?.getBoundingClientRect();
    return Math.max(1, (row ? r?.width : r?.height) ?? 1);
  };

  /** i번째 나눔선을 px만큼 옮긴 비율(양쪽 칸은 MIN_PANE_PX보다 작아지지 않는다) */
  const shifted = (sizes: number[], i: number, px: number, totalPx: number): number[] => {
    const a = sizes[i];
    const b = sizes[i + 1];
    const min = Math.min(MIN_PANE_PX / totalPx, (a + b) / 2);
    const nextA = Math.min(Math.max(a + px / totalPx, min), a + b - min);
    const next = [...sizes];
    next[i] = nextA;
    next[i + 1] = a + b - nextA;
    return next;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>, index: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { index, start: row ? e.clientX : e.clientY, sizes: split.sizes, total: total(), pointerId: e.pointerId };
    setActive(index);
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* 없어도 된다 */
    }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const px = (row ? e.clientX : e.clientY) - d.start;
    ctx.onResize(split.id, shifted(d.sizes, d.index, px, d.total));
  };
  const onPointerEnd = () => {
    dragRef.current = null;
    setActive(null);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>, index: number) => {
    e.stopPropagation();
    const back = row ? 'ArrowLeft' : 'ArrowUp';
    const forward = row ? 'ArrowRight' : 'ArrowDown';
    let px = 0;
    if (e.key === back) px = -1;
    else if (e.key === forward) px = 1;
    else if (e.key === 'Home') px = -1e6;
    else if (e.key === 'End') px = 1e6;
    else return;
    e.preventDefault();
    const step = Math.abs(px) > 1 ? px : px * (e.shiftKey ? KEY_STEP_LARGE : KEY_STEP);
    ctx.onResize(split.id, shifted(split.sizes, index, step, total()));
  };
  const equalize = () => ctx.onResize(split.id, split.sizes.map(() => 1 / split.sizes.length));

  const items: ReactNode[] = [];
  split.children.forEach((child, i) => {
    if (i > 0) {
      const di = i - 1;
      const before = Math.round(split.sizes.slice(0, i).reduce((a, b) => a + b, 0) * 100);
      items.push(
        <div
          key={`d-${child.id}`}
          className={`dock-divider${active === di ? ' is-active' : ''}`}
          role="separator"
          tabIndex={0}
          aria-orientation={row ? 'vertical' : 'horizontal'}
          aria-label={ctx.t('dock.resize')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={before}
          data-testid={`dock-divider-${split.id}-${di}`}
          onPointerDown={(e) => onPointerDown(e, di)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onLostPointerCapture={onPointerEnd}
          onDoubleClick={equalize}
          onKeyDown={(e) => onKeyDown(e, di)}
          onKeyUp={(e) => e.stopPropagation()}
        />,
      );
    }
    items.push(
      <div key={child.id} className="dock-cell" style={{ flex: `${split.sizes[i]} 1 0px` }}>
        <NodeView node={child} ctx={ctx} />
      </div>,
    );
  });

  return (
    <div ref={ref} className={`dock-split dock-split-${split.direction}`} data-split={split.id}>
      {items}
    </div>
  );
}

// ───────────── 그룹 ─────────────

function GroupView({ group, ctx, maximized = false }: { group: GroupNode; ctx: Ctx; maximized?: boolean }) {
  const { t, narrow } = ctx;
  const id = group.id;
  const focused = narrow || ctx.state.lastGroup === id;
  const focusRef = useRef<() => void>(() => {});
  focusRef.current = () => {
    if (!narrow && ctx.state.lastGroup !== id) ctx.onFocusGroup(id);
  };
  const unlisten = useRef<(() => void) | null>(null);
  const groupRef = useCallback(
    (el: HTMLElement | null) => {
      // pane 내용은 포털로 그려져 React 이벤트가 그룹을 거치지 않으므로, 실제 DOM에서 누르기와 포커스를 듣는다
      unlisten.current?.();
      unlisten.current = null;
      if (el) {
        const on = () => focusRef.current();
        el.addEventListener('pointerdown', on, true);
        el.addEventListener('focusin', on);
        unlisten.current = () => {
          el.removeEventListener('pointerdown', on, true);
          el.removeEventListener('focusin', on);
        };
      }
      if (narrow) return;
      ctx.registerGroup(id, el);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, narrow, ctx.registerGroup],
  );
  const slotRef = useCallback((el: HTMLElement | null) => ctx.registerSlot(id, el), [id, ctx.registerSlot]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // 탭 줄의 키 입력은 캔버스 단축키로 넘기지 않는다
    e.stopPropagation();
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
    const current = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    const i = current ? tabs.indexOf(current) : -1;
    if (i < 0) return;
    const pane = current!.dataset.tab as PaneId;
    let to = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i + tabs.length - 1) % tabs.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = tabs.length - 1;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      ctx.onActivate(pane);
      return;
    } else if (e.key === 'Delete') {
      e.preventDefault();
      if (ctx.canClose) ctx.onClose(pane, true);
      return;
    } else return;
    e.preventDefault();
    tabs[to].focus();
  };

  const onBarDoubleClick = (e: ReactMouseEvent) => {
    if (narrow || !ctx.canMaximize) return;
    if ((e.target as HTMLElement).closest('button')) return;
    ctx.onToggleMaximize(id);
  };

  return (
    <section
      ref={groupRef}
      className={`dock-group${focused ? ' is-focused' : ''}`}
      data-group={narrow ? undefined : id}
    >
      <div className="dock-bar" onDoubleClick={onBarDoubleClick}>
        <div
          className="dock-tabs"
          role="tablist"
          aria-label={t('dock.tablist')}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => e.stopPropagation()}
        >
          {group.panes.map((pane) => (
            <Tab key={pane} pane={pane} group={group} ctx={ctx} />
          ))}
        </div>
        {narrow && ctx.narrowBarEnd && <div className="dock-actions dock-bar-end">{ctx.narrowBarEnd}</div>}
        {ctx.canMaximize && (
          <div className="dock-actions">
            <button
              type="button"
              className="dock-action"
              data-testid={`dock-maximize-${id}`}
              aria-label={maximized ? t('dock.restore') : t('dock.maximize')}
              aria-pressed={maximized}
              title={maximized ? t('dock.restore') : t('dock.maximize')}
              onClick={() => ctx.onToggleMaximize(id)}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {maximized ? <RestoreIcon /> : <MaximizeIcon />}
            </button>
          </div>
        )}
      </div>
      <div className="dock-content" ref={slotRef} data-slot={id} />
    </section>
  );
}

function Tab({ pane, group, ctx }: { pane: PaneId; group: GroupNode; ctx: Ctx }) {
  const { t, uid, narrow } = ctx;
  const active = group.active === pane;
  const title = ctx.paneTitle(pane);
  return (
    <div
      role="tab"
      id={tabDomId(uid, pane)}
      className={`dock-tab${active ? ' is-active' : ''}${ctx.dragging === pane ? ' is-dragging' : ''}`}
      data-tab={pane}
      aria-selected={active}
      aria-controls={paneDomId(uid, pane)}
      tabIndex={active ? 0 : -1}
      title={title}
      onClick={() => {
        if (ctx.consumeClick()) return;
        ctx.onActivate(pane);
      }}
      onPointerDown={narrow ? undefined : (e) => ctx.tabPointer.down(e, pane, group.id)}
      onPointerMove={narrow ? undefined : ctx.tabPointer.move}
      onPointerUp={narrow ? undefined : ctx.tabPointer.up}
      onPointerCancel={narrow ? undefined : ctx.tabPointer.cancel}
      onMouseDown={(e) => {
        // 가운데 단추의 자동 스크롤을 막는다
        if (e.button === 1) e.preventDefault();
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        if (ctx.canClose) ctx.onClose(pane, false);
      }}
    >
      {ctx.paneIcon && <span className="dock-tab-icon">{ctx.paneIcon(pane)}</span>}
      <span className="dock-tab-title">{title}</span>
      {ctx.canClose && (
        <button
          type="button"
          className="dock-tab-close"
          tabIndex={-1}
          aria-label={t('dock.closeTab', { title })}
          title={t('dock.closeTab', { title })}
          data-testid={`dock-close-${pane}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            ctx.onClose(pane, false);
          }}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

// ───────────── 아이콘 ─────────────

const iconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function CloseIcon() {
  return (
    <svg {...iconProps} width={14} height={14}>
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg {...iconProps}>
      <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg {...iconProps}>
      <path d="M13.5 6.5h-4v-4M9.5 6.5l4.5-4.5M2.5 9.5h4v4M6.5 9.5 2 14" />
    </svg>
  );
}
