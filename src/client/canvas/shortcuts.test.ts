// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { NODE_PRESETS, PRESET_ORDER, type ErdEdge, type ErdNode } from '../../shared/types';
import { parseClip, resetClipboardForTest } from '../collab/clipboard';
import { t } from '../i18n';
import { LOCAL_ORIGIN, addEdges, addNodes, getEdgesMap, getMetaMap, getNodesMap, readEdge, readNode } from '../collab/docOps';
import { ElementStore, type Room } from '../collab/room';
import { useUi } from '../state/ui';
import { toast } from '../ui/toast';
import { IS_MAC, SHORTCUT_GROUPS, SHORTCUT_LIST, handleCopyEvent, handlePasteEvent, handleShortcutKey, isEditableElement } from './shortcuts';

function makeRoom(): Room {
  const doc = new Y.Doc();
  const nodesMap = getNodesMap(doc);
  const edgesMap = getEdgesMap(doc);
  const undo = new Y.UndoManager([nodesMap, edgesMap, getMetaMap(doc)], {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: 400,
  });
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
  { id: 'a', kind: 'entity', x: 0, y: 0, w: 100, h: 50, text: '학생' },
  { id: 'b', kind: 'relationship', x: 200, y: 0, w: 100, h: 50, text: '수강' },
  { id: 's', kind: 'spec', x: 400, y: 0, w: 34, h: 34, text: '', specType: 'd' },
];
const EDGES: ErdEdge[] = [{ id: 'ab', source: 'a', target: 'b', double: false, label: '', role: '' }];

// 알림 모듈은 다른 담당의 구현이라 호출 여부만 본다
vi.mock('../ui/toast', () => ({ toast: vi.fn() }));

const ui = () => useUi.getState();
/** jsdom은 Mac이 아니므로 Ctrl이 수정 키다 */
const MOD = IS_MAC ? { metaKey: true } : { ctrlKey: true };

let room: Room;

/** document.body(또는 target)에서 keydown을 일으켜 처리기에 넘긴다. 처리 여부를 돌려준다. */
function press(code: string, init: KeyboardEventInit = {}, target: EventTarget = document.body): { handled: boolean; event: KeyboardEvent } {
  const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init });
  let handled = false;
  const listener = (e: Event) => {
    handled = handleShortcutKey(e as KeyboardEvent, room);
  };
  window.addEventListener('keydown', listener);
  target.dispatchEvent(event);
  window.removeEventListener('keydown', listener);
  return { handled, event };
}

/** jsdom에는 DataTransfer가 없어서 필요한 부분만 흉내 낸다 */
function clipboardEvent(type: string, initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  const event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData: (k: string, v: string) => void (data[k] = v),
      getData: (k: string) => data[k] ?? '',
    },
  });
  Object.defineProperty(event, 'target', { value: document.body });
  return { event, data };
}

beforeEach(() => {
  resetClipboardForTest();
  ui().reset();
  vi.mocked(toast).mockClear();
  room = makeRoom();
  addNodes(room.doc, NODES);
  addEdges(room.doc, EDGES);
  room.undo.clear();
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('도구 단축키', () => {
  it('V, H, L, Shift+L', () => {
    press('KeyH');
    expect(ui().tool).toBe('pan');
    press('KeyL');
    expect(ui().tool).toBe('connect');
    press('KeyL', { shiftKey: true });
    expect(ui().tool).toBe('connect-double');
    press('KeyV');
    expect(ui().tool).toBe('select');
  });

  it('프리셋에 적힌 키로 도형 놓기 도구를 고른다(한글 입력 상태의 key 값과 무관)', () => {
    for (const id of PRESET_ORDER) {
      const code = NODE_PRESETS[id].shortcut;
      if (!code) continue;
      const { handled, event } = press(code, { key: 'ㄷ' });
      expect(handled).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      expect(ui().tool).toBe(`place:${id}`);
    }
  });

  it('수정 키나 Shift, Alt와 함께 누르면 도구를 바꾸지 않는다', () => {
    expect(press('KeyE', { shiftKey: true }).handled).toBe(false);
    expect(press('KeyE', { altKey: true }).handled).toBe(false);
    expect(press('KeyR', MOD).handled).toBe(false);
    expect(ui().tool).toBe('select');
  });

  it('스페이스는 건드리지 않는다', () => {
    const { handled, event } = press('Space');
    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('입력 중에는 처리하지 않는다', () => {
  it('input, textarea, select, contenteditable', () => {
    ui().setSelection(['a']);
    for (const html of ['<input>', '<textarea></textarea>', '<select></select>', '<div contenteditable="true"><span id="in"></span></div>']) {
      document.body.innerHTML = html;
      const el = document.body.querySelector('#in') ?? document.body.firstElementChild!;
      expect(isEditableElement(el)).toBe(true);
      expect(press('KeyE', {}, el).handled).toBe(false);
      expect(press('Delete', {}, el).handled).toBe(false);
    }
    expect(ui().tool).toBe('select');
    expect(room.nodes.has('a')).toBe(true);
  });

  it('포커스가 입력창에 있으면 이벤트 대상이 달라도 처리하지 않는다', () => {
    document.body.innerHTML = '<input id="t">';
    (document.getElementById('t') as HTMLInputElement).focus();
    expect(press('KeyE').handled).toBe(false);
  });

  it('도형 글자를 편집 중이면 처리하지 않는다', () => {
    ui().setSelection(['a']);
    ui().setEditing('a');
    expect(press('Delete').handled).toBe(false);
    expect(press('Escape').handled).toBe(false);
    expect(room.nodes.has('a')).toBe(true);
  });

  it('체크박스와 버튼은 입력창으로 보지 않는다', () => {
    document.body.innerHTML = '<input type="checkbox"><button>x</button>';
    expect(isEditableElement(document.body.children[0])).toBe(false);
    expect(isEditableElement(document.body.children[1])).toBe(false);
  });

  it('한글 조합 중인 키는 무시한다', () => {
    expect(press('KeyE', { isComposing: true }).handled).toBe(false);
    expect(ui().tool).toBe('select');
  });
});

describe('편집 단축키', () => {
  it('Delete와 Backspace로 선택을 지운다', () => {
    ui().setSelection(['a']);
    expect(press('Delete').handled).toBe(true);
    expect(room.nodes.has('a')).toBe(false);
    expect(room.edges.has('ab')).toBe(false);
    ui().setSelection(['b']);
    expect(press('Backspace').handled).toBe(true);
    expect(room.nodes.has('b')).toBe(false);
    expect(press('Delete').handled).toBe(false);
  });

  it('실행 취소와 다시 실행', () => {
    ui().setSelection(['a']);
    press('Delete');
    press('KeyZ', MOD);
    expect(room.nodes.has('a')).toBe(true);
    press('KeyZ', { ...MOD, shiftKey: true });
    expect(room.nodes.has('a')).toBe(false);
    press('KeyZ', MOD);
    expect(room.nodes.has('a')).toBe(true);
    press('KeyY', { ctrlKey: true });
    expect(room.nodes.has('a')).toBe(false);
  });

  it('모두 선택과 복제', () => {
    press('KeyA', MOD);
    expect([...ui().selection].sort()).toEqual(['a', 'ab', 'b', 's']);
    ui().setSelection(['a', 'b']);
    const { event } = press('KeyD', MOD);
    expect(event.defaultPrevented).toBe(true);
    expect(room.nodes.getSnapshot()).toHaveLength(5);
    expect(room.edges.getSnapshot()).toHaveLength(2);
    expect(ui().selection).not.toContain('a');
  });

  it('방향키는 1px, Shift와 함께면 10px 옮긴다', () => {
    ui().setSelection(['a']);
    press('ArrowRight');
    press('ArrowDown', { shiftKey: true });
    expect(room.nodes.get('a')).toMatchObject({ x: 1, y: 10 });
    press('ArrowLeft', { shiftKey: true });
    press('ArrowUp');
    expect(room.nodes.get('a')).toMatchObject({ x: -9, y: 9 });
    // 연속 입력은 실행 취소 한 단계로 묶인다
    press('KeyZ', MOD);
    expect(room.nodes.get('a')).toMatchObject({ x: 0, y: 0 });
  });

  it('선택된 노드가 없으면 방향키를 처리하지 않는다', () => {
    expect(press('ArrowRight').handled).toBe(false);
    ui().setSelection(['ab']);
    expect(press('ArrowRight').handled).toBe(false);
  });

  it('Enter와 F2는 노드 하나가 선택돼 있을 때만 글자 편집으로 들어간다', () => {
    expect(press('Enter').handled).toBe(false);
    ui().setSelection(['a', 'b']);
    expect(press('Enter').handled).toBe(false);
    ui().setSelection(['ab']);
    expect(press('F2').handled).toBe(false);
    ui().setSelection(['s']);
    expect(press('Enter').handled).toBe(false);
    expect(ui().editingId).toBeNull();

    ui().setSelection(['a']);
    expect(press('Enter').handled).toBe(true);
    expect(ui().editingId).toBe('a');
    ui().setEditing(null);
    ui().setSelection(['b']);
    expect(press('F2').handled).toBe(true);
    expect(ui().editingId).toBe('b');
  });

  it('버튼에 포커스가 있을 때의 Enter는 버튼에 맡긴다', () => {
    document.body.innerHTML = '<button id="x">x</button>';
    ui().setSelection(['a']);
    expect(press('Enter', {}, document.getElementById('x')!).handled).toBe(false);
    expect(ui().editingId).toBeNull();
  });
});

describe('Esc', () => {
  it('우선순위대로 한 번에 하나만 처리한다', () => {
    const s = ui();
    s.togglePanel('help', true);
    s.setSelection(['a']);
    s.setTool('connect');
    s.setConnectDraft({ sourceId: 'a', to: { x: 0, y: 0 }, targetId: null, valid: false, double: false });
    s.openContextMenu({ x: 1, y: 1, world: { x: 0, y: 0 }, targetId: null });

    expect(press('Escape').handled).toBe(true);
    expect(ui().contextMenu).toBeNull();
    expect(ui().panels.help).toBe(true);

    press('Escape');
    expect(ui().panels.help).toBe(false);
    expect(ui().connectDraft).not.toBeNull();

    press('Escape');
    expect(ui().connectDraft).toBeNull();
    expect(ui().tool).toBe('connect');

    press('Escape');
    expect(ui().tool).toBe('select');
    expect(ui().selection).toEqual(['a']);

    press('Escape');
    expect(ui().selection).toEqual([]);

    expect(press('Escape').handled).toBe(false);
  });

  it('다른 처리기가 이미 처리한 키는 넘어간다', () => {
    ui().setSelection(['a']);
    const stop = (e: Event) => e.preventDefault();
    document.body.addEventListener('keydown', stop);
    expect(press('Escape').handled).toBe(false);
    document.body.removeEventListener('keydown', stop);
    expect(ui().selection).toEqual(['a']);
  });
});

describe('화면과 기타', () => {
  beforeEach(() => ui().setCanvasSize({ w: 800, h: 600 }));

  it('확대, 축소, 100%', () => {
    const plus = press('Equal', MOD);
    expect(plus.event.defaultPrevented).toBe(true);
    expect(ui().viewport.zoom).toBeGreaterThan(1);
    press('Digit0', MOD);
    expect(ui().viewport.zoom).toBe(1);
    press('Minus', MOD);
    expect(ui().viewport.zoom).toBeLessThan(1);
  });

  it('Shift+1로 전체가 보이게 맞춘다', () => {
    ui().setViewport({ x: -9000, y: -9000, zoom: 3 });
    expect(press('Digit1', { shiftKey: true }).handled).toBe(true);
    const v = ui().viewport;
    // 다이어그램 왼쪽 위(0,0)와 오른쪽 아래(434,50)가 화면 안에 들어온다
    expect(v.x).toBeGreaterThanOrEqual(0);
    expect(v.y).toBeGreaterThanOrEqual(0);
    expect(434 * v.zoom + v.x).toBeLessThanOrEqual(800);
    expect(50 * v.zoom + v.y).toBeLessThanOrEqual(600);
  });

  it('G로 격자, ?로 도움말을 켜고 끈다', () => {
    press('KeyG');
    expect(ui().showGrid).toBe(false);
    press('KeyG');
    expect(ui().showGrid).toBe(true);
    press('Slash', { shiftKey: true });
    expect(ui().panels.help).toBe(true);
    press('Slash', { shiftKey: true });
    expect(ui().panels.help).toBe(false);
    expect(press('Slash').handled).toBe(false);
  });

  it('수정 키+S는 저장 창을 막고 안내를 띄운다(입력창에서도)', () => {
    const a = press('KeyS', MOD);
    expect(a.event.defaultPrevented).toBe(true);
    expect(toast).toHaveBeenCalledWith('변경 내용은 자동으로 저장됩니다');
    document.body.innerHTML = '<input id="t">';
    const b = press('KeyS', MOD, document.getElementById('t')!);
    expect(b.event.defaultPrevented).toBe(true);
  });

  it('브라우저 단축키(새로 고침 등)는 막지 않는다', () => {
    for (const code of ['KeyR', 'KeyT', 'KeyW', 'KeyC', 'KeyV', 'KeyX', 'KeyL']) {
      const { handled, event } = press(code, MOD);
      expect(handled).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it('명령을 실행하면 떠 있던 우클릭 메뉴를 닫는다', () => {
    ui().openContextMenu({ x: 1, y: 1, world: { x: 0, y: 0 }, targetId: null });
    press('KeyE');
    expect(ui().contextMenu).toBeNull();
  });
});

describe('copy, cut, paste 이벤트', () => {
  it('선택을 text/plain JSON으로 넣고 붙여넣으면 새 요소가 생긴다', () => {
    ui().setSelection(['a', 'b']);
    const copy = clipboardEvent('copy');
    expect(handleCopyEvent(copy.event, room)).toBe(true);
    expect(copy.event.defaultPrevented).toBe(true);
    const clip = parseClip(copy.data['text/plain'])!;
    expect(clip.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(clip.edges.map((e) => e.id)).toEqual(['ab']);

    const paste = clipboardEvent('paste', { 'text/plain': copy.data['text/plain'] });
    expect(handlePasteEvent(paste.event, room)).toBe(true);
    expect(paste.event.defaultPrevented).toBe(true);
    expect(room.nodes.getSnapshot()).toHaveLength(5);
    expect(room.edges.getSnapshot()).toHaveLength(2);
    expect(ui().selection).toHaveLength(3);
  });

  it('잘라내면 클립보드에 넣고 문서에서 지운다', () => {
    ui().setSelection(['a']);
    const cut = clipboardEvent('cut');
    expect(handleCopyEvent(cut.event, room, true)).toBe(true);
    expect(parseClip(cut.data['text/plain'])!.nodes.map((n) => n.id)).toEqual(['a']);
    expect(room.nodes.has('a')).toBe(false);
  });

  it('선택이 없거나 다른 글자면 기본 동작에 맡긴다', () => {
    const copy = clipboardEvent('copy');
    expect(handleCopyEvent(copy.event, room)).toBe(false);
    expect(copy.event.defaultPrevented).toBe(false);
    const paste = clipboardEvent('paste', { 'text/plain': '그냥 글자' });
    expect(handlePasteEvent(paste.event, room)).toBe(false);
    expect(paste.event.defaultPrevented).toBe(false);
    expect(room.nodes.getSnapshot()).toHaveLength(3);
  });

  it('입력창에 포커스가 있으면 기본 동작에 맡긴다', () => {
    document.body.innerHTML = '<input id="t">';
    (document.getElementById('t') as HTMLInputElement).focus();
    ui().setSelection(['a']);
    expect(handleCopyEvent(clipboardEvent('copy').event, room)).toBe(false);
    expect(handleCopyEvent(clipboardEvent('cut').event, room, true)).toBe(false);
    expect(room.nodes.has('a')).toBe(true);
  });
});

describe('SHORTCUT_LIST', () => {
  it('정해진 묶음만 쓰고 묶음마다 항목이 있다', () => {
    const groups = new Set(SHORTCUT_LIST.map((s) => s.group));
    expect([...groups].sort()).toEqual([...SHORTCUT_GROUPS].sort());
    for (const s of SHORTCUT_LIST) {
      expect(s.keys.length).toBeGreaterThan(0);
      expect(t(s.description)).not.toBe('');
    }
  });

  it('단축키가 있는 프리셋이 모두 들어 있다', () => {
    for (const id of PRESET_ORDER) {
      const p = NODE_PRESETS[id];
      if (!p.shortcut) continue;
      expect(SHORTCUT_LIST.some((s) => s.group === 'tools' && s.description === `preset.${id}.label` && s.keys[0] === p.shortcut!.slice(3))).toBe(true);
    }
  });
});
