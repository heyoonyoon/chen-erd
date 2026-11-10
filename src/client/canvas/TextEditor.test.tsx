// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErdEdge, ErdNode } from '../../shared/types';
import { addNode, deleteElements, getEdgesMap, getNode, getNodesMap, readEdge, readNode, updateNode } from '../collab/docOps';
import { RoomContext } from '../collab/hooks';
import { ElementStore, type Room } from '../collab/room';
import { ui } from '../state/ui';
import { growToFit } from '../text/measure';
import { TextEditor, normalizeText } from './TextEditor';

vi.mock('../text/measure', () => ({ growToFit: vi.fn(() => null) }));
const growToFitMock = vi.mocked(growToFit);

/** 웹소켓 없이 문서와 저장소만 있는 방 */
function makeRoom(): Room {
  const doc = new Y.Doc();
  const nodes = new ElementStore<ErdNode>(getNodesMap(doc), readNode);
  const edges = new ElementStore<ErdEdge>(getEdgesMap(doc), readEdge);
  return { id: 'test', doc, nodes, edges, setPresence() {}, destroy() {} } as unknown as Room;
}

function entity(id: string, text: string, extra: Partial<ErdNode> = {}): ErdNode {
  return { id, kind: 'entity', x: 100, y: 50, w: 140, h: 60, text, ...extra };
}

function renderEditor(room: Room, strict = false) {
  const tree = (
    <RoomContext.Provider value={room}>
      <div className="canvas-root">
        <TextEditor />
      </div>
    </RoomContext.Provider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

function startEditing(id: string | null) {
  act(() => ui().setEditing(id));
}

function input(): HTMLTextAreaElement {
  return screen.getByTestId('text-editor') as HTMLTextAreaElement;
}

function type(value: string) {
  fireEvent.change(input(), { target: { value } });
}

/** 문서에 일어난 변경(트랜잭션) 횟수를 센다 */
function countChanges(doc: Y.Doc): () => number {
  let n = 0;
  doc.on('update', () => {
    n += 1;
  });
  return () => n;
}

let room: Room;

beforeEach(() => {
  ui().reset();
  growToFitMock.mockReset();
  growToFitMock.mockReturnValue(null);
  room = makeRoom();
  addNode(room.doc, entity('a', '엔티티'));
});

afterEach(() => {
  cleanup();
});

describe('normalizeText', () => {
  it('앞뒤의 빈 줄과 줄 끝 공백을 없애고 가운데 빈 줄은 둔다', () => {
    expect(normalizeText('\n  \n 학생 \n\n과목  \n\n')).toBe('학생\n\n과목');
    expect(normalizeText('a\r\nb')).toBe('a\nb');
    expect(normalizeText('   \n ')).toBe('');
  });
});

describe('TextEditor', () => {
  it('편집 중이 아니면 아무것도 띄우지 않는다', () => {
    renderEditor(room);
    expect(screen.queryByTestId('text-editor')).toBeNull();
  });

  it('노드 위에 겹쳐 열리고 포커스와 전체 선택이 된다', () => {
    ui().setViewport({ x: 10, y: 20, zoom: 2 });
    renderEditor(room);
    startEditing('a');

    const el = input();
    expect(el.value).toBe('엔티티');
    expect(document.activeElement).toBe(el);
    expect(el.selectionStart).toBe(0);
    expect(el.selectionEnd).toBe(3);

    const box = el.closest('.text-editor') as HTMLElement;
    expect(box.parentElement?.className).toBe('canvas-root');
    // screen = world * zoom + (x, y)
    expect(box.style.left).toBe('210px');
    expect(box.style.top).toBe('120px');
    expect(box.style.width).toBe('140px');
    expect(box.style.height).toBe('60px');
    expect(box.style.transform).toBe('scale(2)');
  });

  it('편집 중에 화면을 옮기거나 확대하면 따라간다', () => {
    renderEditor(room);
    startEditing('a');
    type('학');
    act(() => ui().setViewport({ x: -30, y: 5, zoom: 0.5 }));

    const box = input().closest('.text-editor') as HTMLElement;
    expect(box.style.left).toBe('20px');
    expect(box.style.top).toBe('30px');
    expect(box.style.transform).toBe('scale(0.5)');
    expect(input().value).toBe('학');
  });

  it('Enter로 확정하면 문서에 반영되고 편집이 끝난다', () => {
    renderEditor(room);
    startEditing('a');
    const changes = countChanges(room.doc);
    type('학생');
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(getNode(room.doc, 'a')?.text).toBe('학생');
    expect(ui().editingId).toBeNull();
    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(changes()).toBe(1);
  });

  it('Shift+Enter는 확정하지 않고 줄바꿈으로 남긴다', () => {
    renderEditor(room);
    startEditing('a');
    type('학생');
    const notPrevented = fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true });

    expect(notPrevented).toBe(true);
    expect(ui().editingId).toBe('a');
    expect(getNode(room.doc, 'a')?.text).toBe('엔티티');

    type('학생\n명단');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(getNode(room.doc, 'a')?.text).toBe('학생\n명단');
  });

  it('Esc로 취소하면 원래 글자가 남는다', () => {
    renderEditor(room);
    startEditing('a');
    const changes = countChanges(room.doc);
    type('지울 글자');
    fireEvent.keyDown(input(), { key: 'Escape' });

    expect(getNode(room.doc, 'a')?.text).toBe('엔티티');
    expect(ui().editingId).toBeNull();
    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(changes()).toBe(0);
  });

  it('한글 조합 중 Enter는 무시한다', () => {
    renderEditor(room);
    startEditing('a');
    type('학새');

    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });
    expect(ui().editingId).toBe('a');
    fireEvent.keyDown(input(), { key: 'Enter', keyCode: 229 });
    expect(ui().editingId).toBe('a');
    expect(getNode(room.doc, 'a')?.text).toBe('엔티티');

    type('학생');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(getNode(room.doc, 'a')?.text).toBe('학생');
    expect(ui().editingId).toBeNull();
  });

  it('Tab과 blur도 확정한다', () => {
    renderEditor(room);
    startEditing('a');
    type('과목');
    const notPrevented = fireEvent.keyDown(input(), { key: 'Tab' });
    expect(notPrevented).toBe(false);
    expect(getNode(room.doc, 'a')?.text).toBe('과목');
    expect(ui().editingId).toBeNull();

    startEditing('a');
    type('교수');
    fireEvent.blur(input());
    expect(getNode(room.doc, 'a')?.text).toBe('교수');
    expect(ui().editingId).toBeNull();
  });

  it('확정 뒤에 blur가 겹쳐도 한 번만 반영한다', () => {
    renderEditor(room);
    startEditing('a');
    const changes = countChanges(room.doc);
    type('학생');
    const el = input();
    // 같은 이벤트 처리 안에서 Enter와 blur가 연달아 오는 경우
    act(() => {
      fireEvent.keyDown(el, { key: 'Enter' });
      fireEvent.blur(el);
    });
    expect(changes()).toBe(1);

    // Esc 뒤에 오는 blur가 취소한 글자를 확정하지 않는다
    startEditing('a');
    type('취소할 글자');
    const el2 = input();
    act(() => {
      fireEvent.keyDown(el2, { key: 'Escape' });
      fireEvent.blur(el2);
    });
    expect(getNode(room.doc, 'a')?.text).toBe('학생');
    expect(changes()).toBe(1);
  });

  it('글자가 그대로면 문서를 건드리지 않는다', () => {
    renderEditor(room);
    startEditing('a');
    const changes = countChanges(room.doc);
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(changes()).toBe(0);
    expect(growToFitMock).not.toHaveBeenCalled();
    expect(ui().editingId).toBeNull();
  });

  it('앞뒤 빈 줄을 다듬어 저장한다', () => {
    renderEditor(room);
    startEditing('a');
    type('\n학생  \n\n');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(getNode(room.doc, 'a')?.text).toBe('학생');
  });

  it('글자가 넘치면 크기 변경을 같은 변경 안에 묶는다', () => {
    growToFitMock.mockReturnValue({ x: 60, y: 50, w: 220, h: 60 });
    renderEditor(room);
    startEditing('a');
    const changes = countChanges(room.doc);
    type('아주 긴 엔티티 이름입니다');
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(growToFitMock).toHaveBeenCalledTimes(1);
    expect(growToFitMock.mock.calls[0][0].id).toBe('a');
    expect(growToFitMock.mock.calls[0][1]).toBe('아주 긴 엔티티 이름입니다');
    expect(getNode(room.doc, 'a')).toMatchObject({ text: '아주 긴 엔티티 이름입니다', x: 60, y: 50, w: 220, h: 60 });
    expect(changes()).toBe(1);
  });

  it('키 입력이 전역 단축키로 새지 않는다', () => {
    const onKey = vi.fn();
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    try {
      renderEditor(room);
      startEditing('a');
      fireEvent.keyDown(input(), { key: 'v', code: 'KeyV' });
      fireEvent.keyUp(input(), { key: 'v', code: 'KeyV' });
      fireEvent.keyDown(input(), { key: 'Backspace', code: 'Backspace' });
      fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });
      fireEvent.keyDown(input(), { key: 'Escape' });
      expect(onKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    }
  });

  it('spec은 입력창 없이 d와 o를 서로 바꾸고 끝낸다', () => {
    addNode(room.doc, { id: 's', kind: 'spec', x: 0, y: 0, w: 34, h: 34, text: '', specType: 'd' });
    renderEditor(room);

    startEditing('s');
    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(getNode(room.doc, 's')?.specType).toBe('o');
    expect(ui().editingId).toBeNull();

    startEditing('s');
    expect(getNode(room.doc, 's')?.specType).toBe('d');
    expect(ui().editingId).toBeNull();
  });

  it('specType이 비어 있는 spec은 d로 보고 o로 바꾼다', () => {
    addNode(room.doc, { id: 's', kind: 'spec', x: 0, y: 0, w: 34, h: 34, text: '' });
    renderEditor(room);
    startEditing('s');
    expect(getNode(room.doc, 's')?.specType).toBe('o');
  });

  it('편집 중인 노드가 지워지면 조용히 닫는다', () => {
    renderEditor(room);
    startEditing('a');
    type('쓰던 글자');
    act(() => deleteElements(room.doc, ['a']));

    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(ui().editingId).toBeNull();
    expect(getNode(room.doc, 'a')).toBeNull();
  });

  it('없는 노드를 편집하려 하면 바로 닫는다', () => {
    renderEditor(room);
    startEditing('없는-id');
    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(ui().editingId).toBeNull();
  });

  it('편집 대상이 바뀌면 이전 내용을 확정하고 새 노드로 넘어간다', () => {
    addNode(room.doc, entity('b', '과목', { x: 400 }));
    renderEditor(room);
    startEditing('a');
    type('학생');
    startEditing('b');

    expect(getNode(room.doc, 'a')?.text).toBe('학생');
    expect(ui().editingId).toBe('b');
    expect(input().value).toBe('과목');
    expect(document.activeElement).toBe(input());
    expect((input().closest('.text-editor') as HTMLElement).style.left).toBe('400px');
  });

  it('밖에서 편집을 끝내도(editingId = null) 쓰던 내용을 확정한다', () => {
    renderEditor(room);
    startEditing('a');
    type('학생');
    startEditing(null);
    expect(getNode(room.doc, 'a')?.text).toBe('학생');
  });

  it('편집 중 다른 사람이 글자를 바꿔도 내 입력을 덮어쓰지 않고, 확정하면 내 입력이 남는다', () => {
    renderEditor(room);
    startEditing('a');
    type('내 글자');
    act(() => updateNode(room.doc, 'a', { text: '남의 글자', x: 300 }));

    expect(input().value).toBe('내 글자');
    // 위치 변경은 따라간다
    expect((input().closest('.text-editor') as HTMLElement).style.left).toBe('300px');

    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(getNode(room.doc, 'a')?.text).toBe('내 글자');
  });

  it('내가 손대지 않았으면 다른 사람이 바꾼 글자를 되돌리지 않는다', () => {
    renderEditor(room);
    startEditing('a');
    act(() => updateNode(room.doc, 'a', { text: '남의 글자' }));
    expect(input().value).toBe('엔티티');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(getNode(room.doc, 'a')?.text).toBe('남의 글자');
  });

  it('입력창 위에서 누른 마우스가 캔버스로 전달되지 않는다', () => {
    const onDown = vi.fn();
    render(
      <RoomContext.Provider value={room}>
        <div className="canvas-root" onPointerDown={onDown} onMouseDown={onDown} onDoubleClick={onDown}>
          <TextEditor />
        </div>
      </RoomContext.Provider>,
    );
    startEditing('a');
    fireEvent.pointerDown(input());
    fireEvent.mouseDown(input());
    fireEvent.doubleClick(input());
    expect(onDown).not.toHaveBeenCalled();

    // 도형 안의 빈 곳을 눌러도 포커스가 유지된다(기본 동작을 막는다)
    const box = input().closest('.text-editor') as HTMLElement;
    expect(fireEvent.mouseDown(box)).toBe(false);
    expect(ui().editingId).toBe('a');
  });

  it('StrictMode에서도 한 번만 바꾸고 정상 동작한다', () => {
    addNode(room.doc, { id: 's', kind: 'spec', x: 0, y: 0, w: 34, h: 34, text: '', specType: 'd' });
    ui().setEditing('s');
    renderEditor(room, true);
    expect(getNode(room.doc, 's')?.specType).toBe('o');
    expect(ui().editingId).toBeNull();

    startEditing('a');
    type('학생');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(getNode(room.doc, 'a')?.text).toBe('학생');
    expect(ui().editingId).toBeNull();
  });
});
