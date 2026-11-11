/**
 * 키보드 단축키. [담당: shortcuts 에이전트]
 *
 * 한글 입력 상태에서도 동작하도록 `KeyboardEvent.code`로 판정한다.
 * 복사/잘라내기/붙여넣기는 keydown이 아니라 copy/cut/paste DOM 이벤트로 처리한다
 * (이벤트의 clipboardData를 쓰면 권한 창 없이 시스템 클립보드를 읽고 쓸 수 있다).
 */
import { useEffect } from 'react';
import { diagramBounds } from '../../shared/geometry';
import { NODE_PRESETS, PRESET_ORDER, placeTool, type Tool } from '../../shared/types';
import { deleteSelection, nudgeSelection, redo, selectAll, undo } from '../actions';
import { copySelectionText, cutSelectionText, duplicateSelection, pasteText } from '../collab/clipboard';
import { useRoom } from '../collab/hooks';
import type { Room } from '../collab/room';
import { t, type MessageKey } from '../i18n';
import { ui } from '../state/ui';
import { toast } from '../ui/toast';
import { setZoom, zoomBy, zoomToRect } from './ViewportControls';

// ───────────────────────── 플랫폼 ─────────────────────────

/** Mac은 Cmd, 그 외는 Ctrl을 수정 키로 쓴다. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');

/** 화면에 보여 줄 키 이름 */
export const KEY_LABEL = {
  mod: IS_MAC ? '⌘' : 'Ctrl',
  shift: IS_MAC ? '⇧' : 'Shift',
  delete: IS_MAC ? '⌫' : 'Delete',
} as const;

/** 키 이름 목록을 한 줄 글자로 만든다(메뉴의 단축키 표시용). Mac은 '⌘D', 그 외는 'Ctrl+D' */
export function formatShortcut(keys: string[]): string {
  return keys.join(IS_MAC ? '' : '+');
}

/** 확대/축소 버튼과 같은 배율 */
const ZOOM_STEP = 1.25;

// ───────────────────────── 판정 ─────────────────────────

/** 글자를 입력하지 않는 input 종류. 여기에 포커스가 남아 있어도 단축키를 막지 않는다. */
const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'button', 'submit', 'reset']);

/** 글자를 입력받는 요소인지(input, textarea, select, contenteditable) */
export function isEditableElement(el: EventTarget | null): boolean {
  if (!el || !(el instanceof Element)) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUT_TYPES.has((el as HTMLInputElement).type);
  if ((el as HTMLElement).isContentEditable) return true;
  // isContentEditable을 지원하지 않는 환경(jsdom)과 중첩된 요소를 위해 속성도 본다
  const host = el.closest('[contenteditable]');
  return Boolean(host) && host!.getAttribute('contenteditable') !== 'false';
}

/** Enter를 스스로 처리하는 요소(버튼, 링크)에 포커스가 있는지 */
function isActivatableElement(el: EventTarget | null): boolean {
  if (!el || !(el instanceof Element)) return false;
  return Boolean(el.closest('button, a[href], summary, [role="button"], [role="menuitem"]'));
}

/** 입력창에 포커스가 있거나 도형 글자를 편집 중이면 전역 단축키와 클립보드 처리를 하지 않는다. */
function isTyping(target: EventTarget | null): boolean {
  if (ui().editingId) return true;
  if (isEditableElement(target)) return true;
  return typeof document !== 'undefined' && isEditableElement(document.activeElement);
}

/** 도구 단축키(수정 키 없이 누른다). 프리셋의 shortcut에 적힌 키를 그대로 쓴다. */
const TOOL_KEYS: Record<string, Tool> = (() => {
  const map: Record<string, Tool> = { KeyV: 'select', KeyH: 'pan', KeyL: 'connect' };
  for (const id of PRESET_ORDER) {
    const code = NODE_PRESETS[id].shortcut;
    if (code && !(code in map)) map[code] = placeTool(id);
  }
  return map;
})();

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

// ───────────────────────── 명령 ─────────────────────────

/** Esc: 아래 순서대로 걸리는 것 하나만 한다. 할 일이 없으면 false */
function handleEscape(): boolean {
  const s = ui();
  if (s.contextMenu) {
    s.closeContextMenu();
    return true;
  }
  // 도움말은 화면을 덮고 있으므로 뒤의 선택보다 먼저 닫는다
  if (s.panels.help) {
    s.togglePanel('help', false);
    return true;
  }
  if (s.connectDraft) {
    s.setConnectDraft(null);
    return true;
  }
  if (s.tool !== 'select') {
    s.setTool('select');
    return true;
  }
  if (s.selection.length > 0) {
    s.clearSelection();
    return true;
  }
  return false;
}

/** 노드 하나만 선택돼 있으면 그 노드의 글자 편집으로 들어간다. */
function startEditingSelection(room: Room): boolean {
  const { selection } = ui();
  if (selection.length !== 1) return false;
  const node = room.nodes.get(selection[0]);
  // 특수화 원은 글자 대신 d/o를 그리므로 편집할 글자가 없다
  if (!node || node.kind === 'spec') return false;
  ui().setEditing(node.id);
  return true;
}

export function fitToDiagram(room: Room): void {
  zoomToRect(diagramBounds(room.nodes.getSnapshot()));
}

/** 수정 키(Cmd 또는 Ctrl)와 함께 누른 키 */
function handleModKey(e: KeyboardEvent, room: Room): boolean {
  switch (e.code) {
    case 'KeyZ':
      if (e.shiftKey) redo(room);
      else undo(room);
      return true;
    case 'KeyA':
      if (e.shiftKey) return false;
      selectAll(room);
      return true;
    case 'KeyD':
      if (e.shiftKey) return false;
      // 복제할 것이 없어도 브라우저의 즐겨찾기 추가 창은 막는다
      duplicateSelection(room);
      return true;
    case 'Equal':
    case 'NumpadAdd':
      zoomBy(ZOOM_STEP);
      return true;
    case 'Minus':
    case 'NumpadSubtract':
      zoomBy(1 / ZOOM_STEP);
      return true;
    case 'Digit0':
    case 'Numpad0':
      setZoom(1);
      return true;
    default:
      return false;
  }
}

/** 수정 키 없이 누른 키 */
function handlePlainKey(e: KeyboardEvent, room: Room): boolean {
  const { code } = e;

  if (code === 'Escape') return handleEscape();

  if (code === 'Delete' || code === 'Backspace') {
    if (ui().selection.length === 0) return false;
    deleteSelection(room);
    return true;
  }

  const arrow = ARROWS[code];
  if (arrow) {
    if (!ui().selection.some((id) => room.nodes.has(id))) return false;
    const step = e.shiftKey ? 10 : 1;
    // stopCapturing을 부르지 않아 연속 입력이 실행 취소 한 단계로 묶인다
    nudgeSelection(room, arrow[0] * step, arrow[1] * step);
    return true;
  }

  if (code === 'F2' || ((code === 'Enter' || code === 'NumpadEnter') && !e.shiftKey)) {
    if (e.repeat) return false;
    // 버튼에 포커스가 있을 때의 Enter는 그 버튼을 누르는 동작이다
    if (code !== 'F2' && isActivatableElement(e.target)) return false;
    return startEditingSelection(room);
  }

  if (e.shiftKey) {
    if (e.repeat) return false;
    switch (code) {
      case 'KeyL':
        ui().setTool('connect-double');
        return true;
      case 'Digit1':
        fitToDiagram(room);
        return true;
      case 'Slash':
        ui().togglePanel('help');
        return true;
      default:
        return false;
    }
  }

  if (code === 'KeyG') {
    if (e.repeat) return false;
    ui().setShowGrid(!ui().showGrid);
    return true;
  }

  const tool = TOOL_KEYS[code];
  if (tool) {
    ui().setTool(tool);
    return true;
  }
  return false;
}

/**
 * keydown 하나를 처리한다. 단축키로 처리했으면 기본 동작을 막고 true를 돌려준다.
 * (useShortcuts가 window keydown에 연결한다. 테스트할 수 있게 따로 뺐다.)
 */
export function handleShortcutKey(e: KeyboardEvent, room: Room): boolean {
  // 다른 처리기(메뉴, 대화 상자)가 이미 처리한 키와 한글 조합 중인 키는 건드리지 않는다
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return false;
  // 스페이스(화면 이동)는 Canvas가 직접 처리한다
  if (e.code === 'Space') return false;

  const mod = IS_MAC ? e.metaKey : e.ctrlKey;
  const otherMod = IS_MAC ? e.ctrlKey : e.metaKey;

  // 저장 창은 입력창에 포커스가 있어도 막는다. 문서는 바뀔 때마다 서버에 저장된다.
  if (mod && !otherMod && !e.altKey && !e.shiftKey && e.code === 'KeyS') {
    e.preventDefault();
    if (!e.repeat) toast(t('toast.autosave'));
    return true;
  }

  if (isTyping(e.target)) return false;

  let handled: boolean;
  if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.code === 'KeyY') {
    // Ctrl+Y는 Mac에서도 다시 실행으로 받는다
    redo(room);
    handled = true;
  } else if (e.altKey || otherMod) {
    handled = false;
  } else if (mod) {
    handled = handleModKey(e, room);
  } else {
    handled = handlePlainKey(e, room);
  }

  if (handled) {
    e.preventDefault();
    // 메뉴가 떠 있는 채로 다른 명령을 실행했으면 메뉴는 닫는다(Esc는 위에서 메뉴만 닫는다)
    if (e.code !== 'Escape') ui().closeContextMenu();
  }
  return handled;
}

// ───────────────────────── 클립보드 이벤트 ─────────────────────────

/** copy/cut 이벤트. 선택한 도형이 있으면 JSON을 클립보드에 넣고, 없으면 브라우저 기본 동작에 맡긴다. */
export function handleCopyEvent(e: ClipboardEvent, room: Room, cut = false): boolean {
  if (e.defaultPrevented || isTyping(e.target)) return false;
  // clipboardData가 없으면 복사할 수 없으니 잘라내기로 지우지도 않는다
  if (!e.clipboardData) return false;
  const text = cut ? cutSelectionText(room) : copySelectionText(room);
  if (!text) return false;
  e.clipboardData.setData('text/plain', text);
  e.preventDefault();
  return true;
}

/** paste 이벤트. 이 도구에서 복사한 내용일 때만 붙여넣는다. */
export function handlePasteEvent(e: ClipboardEvent, room: Room): boolean {
  if (e.defaultPrevented || isTyping(e.target)) return false;
  const text = e.clipboardData?.getData('text/plain');
  if (!pasteText(room, text)) return false;
  e.preventDefault();
  return true;
}

// ───────────────────────── 훅 ─────────────────────────

/** window에 keydown을, document에 copy/cut/paste를 걸어 단축키를 처리한다. RoomLayout에서 한 번 호출된다. */
export function useShortcuts(): void {
  const room = useRoom();
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      handleShortcutKey(e, room);
    };
    const onCopy = (e: ClipboardEvent) => {
      handleCopyEvent(e, room);
    };
    const onCut = (e: ClipboardEvent) => {
      handleCopyEvent(e, room, true);
    };
    const onPaste = (e: ClipboardEvent) => {
      handlePasteEvent(e, room);
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, [room]);
}

// ───────────────────────── 도움말 목록 ─────────────────────────

/** 도움말의 묶음. 화면에는 help.group.<이름> 문장으로 보인다 */
export type ShortcutGroup = 'tools' | 'edit' | 'view' | 'misc';

/** 표시용 키. 글자 그대로 보이는 키 이름이거나, 언어마다 다르게 적는 키(방향키)의 사전 키 */
export type ShortcutKey = string | { label: MessageKey };

export interface ShortcutInfo {
  /** 표시용 키 목록. 예: ['⌘', 'Z'] */
  keys: ShortcutKey[];
  /** 설명 문장의 사전 키 */
  description: MessageKey;
  group: ShortcutGroup;
}

/** 도움말에 묶음을 보여 주는 순서 */
export const SHORTCUT_GROUPS = ['tools', 'edit', 'view', 'misc'] as const satisfies readonly ShortcutGroup[];

/** 'KeyE' → 'E' */
function codeLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

const { mod: MOD, shift: SHIFT } = KEY_LABEL;
const ARROW_KEYS: ShortcutKey = { label: 'shortcut.arrowKeys' };

/** 도움말에 보여 줄 단축키 목록. 설명은 사전 키로 두고 그릴 때 현재 언어로 바꾼다 */
export const SHORTCUT_LIST: ShortcutInfo[] = [
  { group: 'tools', keys: ['V'], description: 'tool.select.label' },
  { group: 'tools', keys: ['H'], description: 'shortcut.pan' },
  { group: 'tools', keys: ['L'], description: 'tool.connect.label' },
  { group: 'tools', keys: [SHIFT, 'L'], description: 'tool.connect-double.label' },
  ...PRESET_ORDER.filter((id) => NODE_PRESETS[id].shortcut && TOOL_KEYS[NODE_PRESETS[id].shortcut!] === placeTool(id)).map(
    (id): ShortcutInfo => ({ group: 'tools', keys: [codeLabel(NODE_PRESETS[id].shortcut!)], description: `preset.${id}.label` }),
  ),

  { group: 'edit', keys: [MOD, 'Z'], description: 'common.undo' },
  { group: 'edit', keys: [MOD, SHIFT, 'Z'], description: 'common.redo' },
  ...(IS_MAC ? [] : [{ group: 'edit', keys: ['Ctrl', 'Y'], description: 'common.redo' } satisfies ShortcutInfo]),
  { group: 'edit', keys: [MOD, 'C'], description: 'common.copy' },
  { group: 'edit', keys: [MOD, 'X'], description: 'common.cut' },
  { group: 'edit', keys: [MOD, 'V'], description: 'common.paste' },
  { group: 'edit', keys: [MOD, 'D'], description: 'common.duplicate' },
  { group: 'edit', keys: [MOD, 'A'], description: 'common.selectAll' },
  { group: 'edit', keys: [KEY_LABEL.delete], description: 'common.delete' },
  { group: 'edit', keys: [ARROW_KEYS], description: 'shortcut.move1' },
  { group: 'edit', keys: [SHIFT, ARROW_KEYS], description: 'shortcut.move10' },
  { group: 'edit', keys: ['Enter'], description: 'common.editText' },
  { group: 'edit', keys: ['F2'], description: 'common.editText' },

  { group: 'view', keys: [MOD, '+'], description: 'common.zoomIn' },
  { group: 'view', keys: [MOD, '−'], description: 'common.zoomOut' },
  { group: 'view', keys: [MOD, '0'], description: 'shortcut.zoomReset' },
  { group: 'view', keys: [SHIFT, '1'], description: 'common.fit' },
  { group: 'view', keys: ['G'], description: 'shortcut.grid' },
  { group: 'view', keys: ['Space'], description: 'shortcut.spacePan' },

  { group: 'misc', keys: ['Esc'], description: 'shortcut.escape' },
  { group: 'misc', keys: ['?'], description: 'shortcut.help' },
  { group: 'misc', keys: ['Enter'], description: 'shortcut.commitText' },
  { group: 'misc', keys: [SHIFT, 'Enter'], description: 'shortcut.newline' },
];
