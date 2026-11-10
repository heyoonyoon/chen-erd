/**
 * 우클릭 메뉴. ui.contextMenu가 있으면 그 위치에 뜬다. [담당: shortcuts 에이전트]
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { edgeCanBeDouble, edgeHasCardinality } from '../../shared/rules';
import { CARDINALITY_OPTIONS, type ErdEdge, type ErdNode, type PresetId } from '../../shared/types';
import { deleteSelection, selectAll } from '../actions';
import { KEY_LABEL, fitToDiagram, formatShortcut } from '../canvas/shortcuts';
import { copySelection, cutSelection, duplicateSelection, hasClipboard, paste } from '../collab/clipboard';
import { addNode, createNodeFromPreset, updateEdge, updateNode, type NodePatch } from '../collab/docOps';
import { useEdges, useNodes, useRoom } from '../collab/hooks';
import type { Room } from '../collab/room';
import { ui, useUi, type ContextMenuState } from '../state/ui';
import './ContextMenu.css';

/** 화면 가장자리와 메뉴 사이에 남길 여백(px) */
const EDGE_MARGIN = 8;

export type MenuEntry =
  | {
      type: 'item';
      /** data-testid가 `menu-<id>`로 붙는다 */
      id: string;
      label: string;
      /** 오른쪽에 흐리게 보여 줄 단축키 */
      hint?: string;
      disabled?: boolean;
      /** 체크 항목이면 true/false, 보통 항목이면 생략 */
      checked?: boolean;
      danger?: boolean;
      run(): void;
    }
  | { type: 'separator' }
  | { type: 'heading'; label: string };

const { mod: MOD, shift: SHIFT } = KEY_LABEL;
const HINT = {
  edit: 'Enter',
  duplicate: formatShortcut([MOD, 'D']),
  copy: formatShortcut([MOD, 'C']),
  cut: formatShortcut([MOD, 'X']),
  paste: formatShortcut([MOD, 'V']),
  remove: KEY_LABEL.delete,
  selectAll: formatShortcut([MOD, 'A']),
  fit: formatShortcut([SHIFT, '1']),
};

/** 우클릭한 요소가 선택에 들어 있지 않으면 그것만 선택한다. 들어 있으면 선택 전체에 명령을 적용한다. */
function ensureTargetSelected(targetId: string): void {
  if (!ui().selection.includes(targetId)) ui().setSelection([targetId]);
}

// ───────────────────────── 항목 만들기 ─────────────────────────

/** 종류별 빠른 전환 */
function nodeToggleEntries(room: Room, node: ErdNode): MenuEntry[] {
  const set = (patch: NodePatch) => () => updateNode(room.doc, node.id, patch);
  switch (node.kind) {
    case 'entity':
      return [
        {
          type: 'item',
          id: 'toggle-weak',
          label: node.weak ? '일반 엔티티로 바꾸기' : '약한 엔티티로 바꾸기',
          run: set({ weak: node.weak ? undefined : true }),
        },
      ];
    case 'relationship':
      return [
        {
          type: 'item',
          id: 'toggle-identifying',
          label: node.identifying ? '일반 관계로 바꾸기' : '식별 관계로 바꾸기',
          run: set({ identifying: node.identifying ? undefined : true }),
        },
      ];
    case 'attribute': {
      const isKey = node.keyType === 'key';
      const isPartial = node.keyType === 'partial';
      return [
        { type: 'item', id: 'attr-key', label: '식별자', checked: isKey, run: set({ keyType: isKey ? undefined : 'key' }) },
        { type: 'item', id: 'attr-partial', label: '부분 키', checked: isPartial, run: set({ keyType: isPartial ? undefined : 'partial' }) },
        { type: 'item', id: 'attr-multivalued', label: '다중값', checked: Boolean(node.multivalued), run: set({ multivalued: node.multivalued ? undefined : true }) },
        { type: 'item', id: 'attr-derived', label: '유도', checked: Boolean(node.derived), run: set({ derived: node.derived ? undefined : true }) },
      ];
    }
    case 'spec': {
      const isOverlap = node.specType === 'o';
      return [
        {
          type: 'item',
          id: 'toggle-spec',
          label: isOverlap ? 'd(배타)로 바꾸기' : 'o(중첩)로 바꾸기',
          run: set({ specType: isOverlap ? 'd' : 'o' }),
        },
      ];
    }
    default:
      return [];
  }
}

export function nodeEntries(room: Room, node: ErdNode): MenuEntry[] {
  const scoped = (fn: () => void) => () => {
    ensureTargetSelected(node.id);
    fn();
  };
  const entries: MenuEntry[] = [
    {
      type: 'item',
      id: 'edit-text',
      label: '글자 편집',
      hint: HINT.edit,
      // 특수화 원은 글자 대신 d/o를 그린다
      disabled: node.kind === 'spec',
      run: () => {
        ui().setSelection([node.id]);
        ui().setEditing(node.id);
      },
    },
    { type: 'item', id: 'duplicate', label: '복제', hint: HINT.duplicate, run: scoped(() => duplicateSelection(room)) },
    { type: 'item', id: 'copy', label: '복사', hint: HINT.copy, run: scoped(() => copySelection(room)) },
    { type: 'item', id: 'cut', label: '잘라내기', hint: HINT.cut, run: scoped(() => cutSelection(room)) },
    { type: 'item', id: 'delete', label: '삭제', hint: HINT.remove, danger: true, run: scoped(() => deleteSelection(room)) },
  ];
  const toggles = nodeToggleEntries(room, node);
  if (toggles.length > 0) entries.push({ type: 'separator' }, ...toggles);
  return entries;
}

export function edgeEntries(room: Room, edge: ErdEdge): MenuEntry[] {
  const source = room.nodes.get(edge.source);
  const target = room.nodes.get(edge.target);
  const entries: MenuEntry[] = [];

  if (source && target && edgeHasCardinality(source, target)) {
    entries.push({ type: 'heading', label: '카디널리티' });
    for (const value of CARDINALITY_OPTIONS) {
      entries.push({
        type: 'item',
        id: `card-${value || 'none'}`,
        label: value || '없음',
        checked: edge.label === value,
        run: () => updateEdge(room.doc, edge.id, { label: value }),
      });
    }
    entries.push({ type: 'separator' });
  }
  if (source && target && edgeCanBeDouble(source, target)) {
    entries.push(
      { type: 'item', id: 'line-single', label: '단선', checked: !edge.double, run: () => updateEdge(room.doc, edge.id, { double: false }) },
      { type: 'item', id: 'line-double', label: '이중선', checked: edge.double, run: () => updateEdge(room.doc, edge.id, { double: true }) },
      { type: 'separator' },
    );
  }
  entries.push({
    type: 'item',
    id: 'delete',
    label: '삭제',
    hint: HINT.remove,
    danger: true,
    run: () => {
      ensureTargetSelected(edge.id);
      deleteSelection(room);
    },
  });
  return entries;
}

export function emptyEntries(room: Room, menu: ContextMenuState): MenuEntry[] {
  const add = (presetId: PresetId) => () => {
    const node = createNodeFromPreset(presetId, menu.world);
    addNode(room.doc, node);
    ui().setSelection([node.id]);
    ui().setEditing(node.id);
  };
  const isEmpty = room.nodes.getSnapshot().length === 0;
  return [
    { type: 'item', id: 'paste', label: '붙여넣기', hint: HINT.paste, disabled: !hasClipboard(), run: () => void paste(room, menu.world) },
    { type: 'separator' },
    { type: 'item', id: 'add-entity', label: '여기에 엔티티 추가', run: add('entity') },
    { type: 'item', id: 'add-relationship', label: '여기에 관계 추가', run: add('relationship') },
    { type: 'item', id: 'add-attribute', label: '여기에 속성 추가', run: add('attribute') },
    { type: 'separator' },
    { type: 'item', id: 'select-all', label: '모두 선택', hint: HINT.selectAll, disabled: isEmpty, run: () => selectAll(room) },
    { type: 'item', id: 'fit', label: '전체 보기', hint: HINT.fit, disabled: isEmpty, run: () => fitToDiagram(room) },
  ];
}

/** 우클릭한 대상에 맞는 항목. 대상이 그사이 지워졌으면 null */
export function buildEntries(room: Room, menu: ContextMenuState): MenuEntry[] | null {
  if (menu.targetId === null) return emptyEntries(room, menu);
  const node = room.nodes.get(menu.targetId);
  if (node) return nodeEntries(room, node);
  const edge = room.edges.get(menu.targetId);
  if (edge) return edgeEntries(room, edge);
  return null;
}

/** 메뉴가 화면 밖으로 나가지 않게 왼쪽 위 좌표를 고친다. */
export function clampMenuPosition(
  at: { x: number; y: number },
  size: { w: number; h: number },
  viewport: { w: number; h: number },
  margin = EDGE_MARGIN,
): { x: number; y: number } {
  const fit = (pos: number, len: number, max: number) => {
    // 넘치면 클릭한 지점의 반대쪽으로 펼치고, 그래도 안 되면 가장자리에 붙인다
    let p = pos + len > max - margin ? pos - len : pos;
    p = Math.min(p, max - margin - len);
    return Math.max(margin, p);
  };
  return { x: Math.round(fit(at.x, size.w, viewport.w)), y: Math.round(fit(at.y, size.h, viewport.h)) };
}

// ───────────────────────── 컴포넌트 ─────────────────────────

export function ContextMenu() {
  const menu = useUi((s) => s.contextMenu);
  if (!menu) return null;
  // 다른 곳을 다시 우클릭하면 위치 계산부터 새로 하도록 key를 바꾼다
  return <Menu key={`${menu.x}:${menu.y}:${menu.targetId ?? ''}`} menu={menu} />;
}

function Menu({ menu }: { menu: ContextMenuState }) {
  const room = useRoom();
  // 메뉴가 떠 있는 동안 다른 사람이 대상을 고치거나 지우면 다시 그린다
  useNodes();
  useEdges();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

  const entries = buildEntries(room, menu);
  const close = () => ui().closeContextMenu();

  // 대상이 지워졌으면 닫는다
  useEffect(() => {
    if (!entries) close();
  });

  // 그리기 전에 크기를 재서 화면 안으로 옮긴다
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const next = clampMenuPosition({ x: menu.x, y: menu.y }, { w: r.width, h: r.height }, { w: window.innerWidth, h: window.innerHeight });
    setPos((cur) => (cur.x === next.x && cur.y === next.y ? cur : next));
  }, [menu.x, menu.y, entries?.length]);

  useEffect(() => {
    const inside = (target: EventTarget | null) => target instanceof Node && Boolean(ref.current?.contains(target));
    const closeIfOutside = (e: Event) => {
      if (!inside(e.target)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        // 전역 단축키가 같은 Esc로 다른 일(도구 바꾸기, 선택 해제)을 하지 않게 여기서 끝낸다
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        if (items.length === 0) return;
        e.preventDefault();
        const cur = items.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.code === 'ArrowDown' ? 1 : -1;
        const next = cur === -1 ? (step === 1 ? 0 : items.length - 1) : (cur + step + items.length) % items.length;
        items[next].focus();
      }
    };
    // 캡처 단계에서 받아야 캔버스가 이벤트를 먼저 가로채도 닫힌다
    window.addEventListener('pointerdown', closeIfOutside, true);
    window.addEventListener('wheel', closeIfOutside, { capture: true, passive: true });
    window.addEventListener('scroll', closeIfOutside, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', closeIfOutside, true);
      window.removeEventListener('wheel', closeIfOutside, { capture: true });
      window.removeEventListener('scroll', closeIfOutside, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, []);

  if (!entries) return null;
  const hasChecks = entries.some((e) => e.type === 'item' && e.checked !== undefined);

  return (
    <div
      ref={ref}
      className="contextmenu panel"
      role="menu"
      data-testid="context-menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) => {
        if (entry.type === 'separator') return <div key={i} className="contextmenu-separator" role="separator" />;
        if (entry.type === 'heading') {
          return (
            <div key={i} className="contextmenu-heading">
              {entry.label}
            </div>
          );
        }
        const checkable = entry.checked !== undefined;
        return (
          <button
            key={entry.id}
            type="button"
            role={checkable ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={checkable ? entry.checked : undefined}
            className={`contextmenu-item${entry.danger ? ' is-danger' : ''}`}
            data-testid={`menu-${entry.id}`}
            disabled={entry.disabled}
            onClick={() => {
              entry.run();
              close();
            }}
          >
            {hasChecks && (
              <span className="contextmenu-check" aria-hidden="true">
                {entry.checked && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.5 6.5 5 9l4.5-6" />
                  </svg>
                )}
              </span>
            )}
            <span className="contextmenu-label">{entry.label}</span>
            {entry.hint && <span className="contextmenu-hint">{entry.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
