// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { ErdEdge, ErdNode } from '../../shared/types';
import { copySelectionText, resetClipboardForTest } from '../collab/clipboard';
import { LOCAL_ORIGIN, addEdges, addNodes, getEdgesMap, getMetaMap, getNodesMap, readEdge, readNode, updateNode } from '../collab/docOps';
import { ElementStore, type Room } from '../collab/room';
import { useUi } from '../state/ui';
import { isErdCanvasShown, isInErdScope, registerCanvasRoot } from './paneScope';
import { IS_MAC, handleCopyEvent, handlePasteEvent, handleShortcutKey } from './shortcuts';

vi.mock('../ui/toast', () => ({ toast: vi.fn() }));

function makeRoom(): Room {
  const doc = new Y.Doc();
  const nodesMap = getNodesMap(doc);
  const edgesMap = getEdgesMap(doc);
  return {
    id: 'room',
    doc,
    undo: new Y.UndoManager([nodesMap, edgesMap, getMetaMap(doc)], { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 0 }),
    nodes: new ElementStore<ErdNode>(nodesMap, readNode),
    edges: new ElementStore<ErdEdge>(edgesMap, readEdge),
  } as unknown as Room;
}

const NODES: ErdNode[] = [
  { id: 'a', kind: 'entity', x: 0, y: 0, w: 100, h: 50, text: '학생' },
  { id: 'b', kind: 'relationship', x: 200, y: 0, w: 100, h: 50, text: '수강' },
];
const MOD = IS_MAC ? { metaKey: true } : { ctrlKey: true };
const ui = () => useUi.getState();

let room: Room;

/** pane 배치를 흉내 낸다: ERD pane, 관계 모델 pane, pane 밖의 상단 바 */
function mountPanes(): { erd: HTMLElement; erdButton: HTMLElement; rel: HTMLElement; relButton: HTMLElement; relEditor: HTMLElement; top: HTMLElement } {
  document.body.innerHTML = `
    <header><button id="top">top</button></header>
    <div data-pane="erd"><div id="erd-inner" tabindex="-1"><button id="erd-btn">z</button></div></div>
    <div data-pane="relational"><div id="rel-inner"><button id="rel-btn">x</button><textarea id="rel-editor"></textarea></div></div>`;
  const q = (s: string) => document.querySelector<HTMLElement>(s)!;
  return { erd: q('#erd-inner'), erdButton: q('#erd-btn'), rel: q('#rel-inner'), relButton: q('#rel-btn'), relEditor: q('#rel-editor'), top: q('#top') };
}

function press(code: string, target: EventTarget, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init });
  let handled = false;
  const listener = (e: Event) => {
    handled = handleShortcutKey(e as KeyboardEvent, room);
  };
  window.addEventListener('keydown', listener);
  target.dispatchEvent(event);
  window.removeEventListener('keydown', listener);
  return handled;
}

function clipboardEvent(type: string, target: EventTarget, initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  const event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: { setData: (k: string, v: string) => void (data[k] = v), getData: (k: string) => data[k] ?? '' },
  });
  Object.defineProperty(event, 'target', { value: target });
  return { event, data };
}

beforeEach(() => {
  resetClipboardForTest();
  ui().reset();
  room = makeRoom();
  addNodes(room.doc, NODES);
  addEdges(room.doc, [{ id: 'ab', source: 'a', target: 'b', double: false, label: '', role: '' }]);
  room.undo.clear();
  ui().setCanvasSize({ w: 800, h: 600 });
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('isInErdScope', () => {
  it('data-pane이 하나도 없으면(지금 화면, 기존 테스트) 어디서든 적용한다', () => {
    document.body.innerHTML = '<header><button id="top">x</button></header><main><div id="c"></div></main>';
    expect(isInErdScope(document.body)).toBe(true);
    expect(isInErdScope(document.getElementById('top'))).toBe(true);
    expect(isInErdScope(document.getElementById('c'))).toBe(true);
    expect(isInErdScope(null)).toBe(true);
    // 캔버스 크기를 몰라도(0) 옛 화면에서는 그대로 적용한다
    ui().setCanvasSize({ w: 0, h: 0 });
    expect(isInErdScope(document.body)).toBe(true);
  });

  it('ERD pane 안이면 적용하고, 다른 pane이나 pane 밖(상단 바)이면 적용하지 않는다', () => {
    const p = mountPanes();
    expect(isInErdScope(p.erd)).toBe(true);
    expect(isInErdScope(p.erdButton)).toBe(true);
    expect(isInErdScope(p.rel)).toBe(false);
    expect(isInErdScope(p.relButton)).toBe(false);
    expect(isInErdScope(p.top)).toBe(false);
  });

  it('body(아무것도 포커스 안 됨)는 ERD 캔버스가 보일 때만 적용한다', () => {
    mountPanes();
    expect(isInErdScope(document.body)).toBe(true);
    expect(isInErdScope(window)).toBe(true);
    // 비활성 탭이라 숨겨져 크기가 0이다
    ui().setCanvasSize({ w: 0, h: 0 });
    expect(isInErdScope(document.body)).toBe(false);
  });

  it('등록된 캔버스 루트가 모두 문서에서 떨어져 있으면 보이지 않는 것으로 본다', () => {
    const p = mountPanes();
    const unregister = registerCanvasRoot(p.erd);
    expect(isErdCanvasShown()).toBe(true);
    p.erd.remove();
    expect(isErdCanvasShown()).toBe(false);
    unregister();
    expect(isErdCanvasShown()).toBe(true);
  });
});

describe('pane이 있을 때 단축키 범위', () => {
  it('다른 pane의 버튼에서 누른 Delete, 도구 키, 실행 취소는 다이어그램에 닿지 않는다', () => {
    const p = mountPanes();
    ui().setSelection(['a']);
    expect(press('Delete', p.relButton)).toBe(false);
    expect(press('KeyE', p.relButton)).toBe(false);
    expect(room.nodes.has('a')).toBe(true);
    expect(ui().tool).toBe('select');

    updateNode(room.doc, 'a', { text: '바뀜' });
    expect(press('KeyZ', p.rel, MOD)).toBe(false);
    expect(room.nodes.get('a')?.text).toBe('바뀜');
  });

  it('상단 바 같은 pane 밖의 요소에서도 처리하지 않는다', () => {
    const p = mountPanes();
    ui().setSelection(['a']);
    expect(press('Delete', p.top)).toBe(false);
    expect(room.nodes.has('a')).toBe(true);
  });

  it('ERD pane 안이나 body에서는 처리한다', () => {
    const p = mountPanes();
    expect(press('KeyE', p.erd)).toBe(true);
    expect(ui().tool).not.toBe('select');
    expect(press('KeyV', document.body)).toBe(true);
    expect(ui().tool).toBe('select');
    ui().setSelection(['a']);
    expect(press('Delete', p.erdButton)).toBe(true);
    expect(room.nodes.has('a')).toBe(false);
    expect(press('KeyZ', p.erd, MOD)).toBe(true);
    expect(room.nodes.has('a')).toBe(true);
  });

  it('ERD가 숨겨져 있으면 body에서 누른 Delete로 보이지 않는 도형을 지우지 않는다', () => {
    mountPanes();
    ui().setSelection(['a']);
    ui().setCanvasSize({ w: 0, h: 0 });
    expect(press('Delete', document.body)).toBe(false);
    expect(room.nodes.has('a')).toBe(true);
  });

  it('비활성 탭이라 크기를 지닌 채 숨김 보관함(inert, visibility:hidden)에 있으면 body의 Delete와 붙여넣기를 처리하지 않는다', () => {
    const p = mountPanes();
    const unregister = registerCanvasRoot(p.erd);
    ui().setSelection(['a']);
    // 배치 틀이 ERD pane을 보관함으로 옮긴 상태: 크기는 그대로(800×600)고 문서에도 붙어 있다
    const holder = document.createElement('div');
    holder.setAttribute('inert', '');
    holder.style.visibility = 'hidden';
    document.body.appendChild(holder);
    holder.appendChild(p.erd.parentElement!);
    expect(isErdCanvasShown()).toBe(false);
    expect(press('Delete', document.body)).toBe(false);
    expect(room.nodes.has('a')).toBe(true);
    const text = copySelectionText(room)!;
    const paste = clipboardEvent('paste', document.body, { 'text/plain': text });
    expect(handlePasteEvent(paste.event, room)).toBe(false);
    expect(room.nodes.getSnapshot().length).toBe(2);

    // 다시 보이게 하면(그룹 내용 칸으로 돌아오면) 처리한다
    document.body.appendChild(holder.firstElementChild!);
    expect(isErdCanvasShown()).toBe(true);
    expect(press('Delete', document.body)).toBe(true);
    expect(room.nodes.has('a')).toBe(false);
    unregister();
  });

  it('checkVisibility가 숨겨졌다고 하면 보이지 않는 것으로 본다', () => {
    const p = mountPanes();
    const unregister = registerCanvasRoot(p.erd);
    const el = p.erd as HTMLElement & { checkVisibility?: unknown };
    el.checkVisibility = () => false;
    expect(isErdCanvasShown()).toBe(false);
    el.checkVisibility = () => true;
    expect(isErdCanvasShown()).toBe(true);
    unregister();
  });
});

describe('pane이 있을 때 복사, 붙여넣기', () => {
  it('관계 모델 pane에서 붙여넣으면 도형을 붙여넣지 않는다(입력창이든 아니든)', () => {
    const p = mountPanes();
    ui().setSelection(['a']);
    const text = copySelectionText(room)!;
    expect(text).toBeTruthy();
    const before = room.nodes.getSnapshot().length;
    for (const target of [p.relEditor, p.rel]) {
      const paste = clipboardEvent('paste', target, { 'text/plain': text });
      expect(handlePasteEvent(paste.event, room)).toBe(false);
      expect(paste.event.defaultPrevented).toBe(false);
    }
    expect(room.nodes.getSnapshot().length).toBe(before);

    const ok = clipboardEvent('paste', p.erd, { 'text/plain': text });
    expect(handlePasteEvent(ok.event, room)).toBe(true);
    expect(room.nodes.getSnapshot().length).toBe(before + 1);
  });

  it('다른 pane에서의 복사와 잘라내기는 브라우저 기본 동작에 맡긴다', () => {
    const p = mountPanes();
    ui().setSelection(['a']);
    const copy = clipboardEvent('copy', p.rel);
    expect(handleCopyEvent(copy.event, room)).toBe(false);
    expect(copy.data['text/plain']).toBeUndefined();
    const cut = clipboardEvent('cut', p.relButton);
    expect(handleCopyEvent(cut.event, room, true)).toBe(false);
    expect(room.nodes.has('a')).toBe(true);

    const mine = clipboardEvent('copy', p.erd);
    expect(handleCopyEvent(mine.event, room)).toBe(true);
    expect(mine.data['text/plain']).toBeTruthy();
  });
});
