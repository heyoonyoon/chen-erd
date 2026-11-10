// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErdNode, Presence } from '../../shared/types';
import { RoomContext } from '../collab/hooks';
import type { Room } from '../collab/room';
import { useUi } from '../state/ui';
import { useNicknameDialog } from './NicknameDialog';
import { CURSOR_INTERVAL_MS, RemoteCursors, RemoteSelections, UserAvatars, useBroadcastCursor } from './Presence';

const centerOn = vi.hoisted(() => vi.fn());
vi.mock('../canvas/ViewportControls', () => ({ centerOn }));

const ME: Presence = { user: { id: 'me', name: '나연', color: '#E5484D' }, cursor: null, selection: [], editing: null };

/** awareness와 노드 저장소만 흉내 낸 가짜 방 */
function fakeRoom(nodes: ErdNode[] = []) {
  const listeners = new Set<() => void>();
  const states = new Map<number, unknown>();
  let local: Presence | null = { ...ME };
  states.set(1, local);
  const emit = () => listeners.forEach((l) => l());
  const setPresence = vi.fn((patch: Partial<Presence>) => {
    local = { ...(local ?? ME), ...patch };
    states.set(1, local);
    emit();
  });
  const room = {
    id: 'test',
    awareness: {
      clientID: 1,
      getStates: () => states,
      getLocalState: () => local,
      on: (_: string, fn: () => void) => listeners.add(fn),
      off: (_: string, fn: () => void) => listeners.delete(fn),
    },
    nodes: { subscribe: () => () => {}, getSnapshot: () => nodes },
    setPresence,
  } as unknown as Room;
  const setPeer = (clientId: number, state: Partial<Presence> | null) => {
    if (state === null) states.delete(clientId);
    else states.set(clientId, { cursor: null, selection: [], editing: null, ...state });
    emit();
  };
  return { room, setPresence, setPeer };
}

function wrap(room: Room, children: ReactNode) {
  return <RoomContext.Provider value={room}>{children}</RoomContext.Provider>;
}

function Area() {
  const ref = useRef<HTMLDivElement>(null);
  useBroadcastCursor(ref);
  return (
    <div ref={ref} data-testid="area">
      <span data-testid="inner" />
    </div>
  );
}

function pointer(el: Element, type: string, x = 0, y = 0, bubbles = true) {
  el.dispatchEvent(new MouseEvent(type, { bubbles, clientX: x, clientY: y }));
}

beforeEach(() => {
  useUi.getState().reset();
  useNicknameDialog.setState({ open: false, forced: false });
  centerOn.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useBroadcastCursor', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    useUi.setState({ viewport: { x: 10, y: 20, zoom: 2 } });
  });
  const lastCursor = (fn: ReturnType<typeof vi.fn>) => (fn.mock.calls.at(-1)?.[0] as Partial<Presence>).cursor;

  it('마우스 위치를 월드 좌표로 보낸다', () => {
    const { room, setPresence } = fakeRoom();
    render(wrap(room, <Area />));
    pointer(screen.getByTestId('inner'), 'pointermove', 100, 50);
    expect(setPresence).toHaveBeenCalledTimes(1);
    expect(lastCursor(setPresence)).toEqual({ x: 45, y: 15 });
  });

  it('안쪽 요소가 전파를 막아도 보낸다', () => {
    const { room, setPresence } = fakeRoom();
    render(wrap(room, <Area />));
    const inner = screen.getByTestId('inner');
    inner.addEventListener('pointermove', (e) => e.stopPropagation());
    pointer(inner, 'pointermove', 30, 40);
    expect(lastCursor(setPresence)).toEqual({ x: 10, y: 10 });
  });

  it('간격 안의 움직임은 모았다가 마지막 위치를 반드시 보낸다', () => {
    const { room, setPresence } = fakeRoom();
    render(wrap(room, <Area />));
    const inner = screen.getByTestId('inner');
    pointer(inner, 'pointermove', 100, 50);
    vi.advanceTimersByTime(5);
    pointer(inner, 'pointermove', 110, 60);
    vi.advanceTimersByTime(5);
    pointer(inner, 'pointermove', 130, 80);
    expect(setPresence).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CURSOR_INTERVAL_MS);
    expect(setPresence).toHaveBeenCalledTimes(2);
    expect(lastCursor(setPresence)).toEqual({ x: 60, y: 30 });
  });

  it('같은 자리면 다시 보내지 않는다', () => {
    const { room, setPresence } = fakeRoom();
    render(wrap(room, <Area />));
    const inner = screen.getByTestId('inner');
    pointer(inner, 'pointermove', 100, 50);
    vi.advanceTimersByTime(100);
    pointer(inner, 'pointermove', 100, 50);
    vi.advanceTimersByTime(100);
    expect(setPresence).toHaveBeenCalledTimes(1);
  });

  it('요소를 벗어나면 null을 보내고 예약된 전송은 버린다', () => {
    const { room, setPresence } = fakeRoom();
    render(wrap(room, <Area />));
    const area = screen.getByTestId('area');
    pointer(area, 'pointermove', 100, 50);
    pointer(area, 'pointermove', 120, 50);
    pointer(area, 'pointerleave', 0, 0, false);
    expect(lastCursor(setPresence)).toBeNull();
    const count = setPresence.mock.calls.length;
    vi.advanceTimersByTime(200);
    expect(setPresence).toHaveBeenCalledTimes(count);
  });

  it('창이 포커스를 잃거나 탭이 숨으면 null을 보낸다', () => {
    const { room, setPresence } = fakeRoom();
    render(wrap(room, <Area />));
    const area = screen.getByTestId('area');
    pointer(area, 'pointermove', 100, 50);
    window.dispatchEvent(new Event('blur'));
    expect(lastCursor(setPresence)).toBeNull();

    vi.advanceTimersByTime(100);
    pointer(area, 'pointermove', 100, 50);
    expect(lastCursor(setPresence)).toEqual({ x: 45, y: 15 });
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(lastCursor(setPresence)).toBeNull();
    spy.mockRestore();
  });

  it('화면을 밀거나 확대하면 마지막 마우스 위치로 다시 계산해 보낸다', () => {
    const { room, setPresence } = fakeRoom();
    render(wrap(room, <Area />));
    pointer(screen.getByTestId('area'), 'pointermove', 100, 50);
    vi.advanceTimersByTime(100);
    act(() => useUi.getState().setViewport({ x: 0, y: 0, zoom: 1 }));
    expect(lastCursor(setPresence)).toEqual({ x: 100, y: 50 });
    act(() => useUi.getState().setViewport({ x: -100, y: 0, zoom: 1 }));
    vi.advanceTimersByTime(CURSOR_INTERVAL_MS);
    expect(lastCursor(setPresence)).toEqual({ x: 200, y: 50 });
  });

  it('마우스가 밖에 있으면 화면이 움직여도 보내지 않는다', () => {
    const { room, setPresence } = fakeRoom();
    render(wrap(room, <Area />));
    act(() => useUi.getState().setViewport({ x: 0, y: 0, zoom: 1 }));
    vi.advanceTimersByTime(100);
    expect(setPresence).not.toHaveBeenCalled();
  });

  it('사라질 때 null을 보내고 듣기를 멈춘다', () => {
    const { room, setPresence } = fakeRoom();
    const { unmount } = render(wrap(room, <Area />));
    const area = screen.getByTestId('area');
    pointer(area, 'pointermove', 100, 50);
    unmount();
    expect(lastCursor(setPresence)).toBeNull();
    const count = setPresence.mock.calls.length;
    window.dispatchEvent(new Event('blur'));
    pointer(area, 'pointermove', 5, 5);
    vi.advanceTimersByTime(100);
    expect(setPresence).toHaveBeenCalledTimes(count);
  });
});

describe('RemoteCursors', () => {
  it('커서가 있는 접속자만 화면 좌표에 그린다', () => {
    const { room, setPeer } = fakeRoom();
    useUi.setState({ viewport: { x: 10, y: 20, zoom: 2 }, canvasSize: { w: 800, h: 600 } });
    render(wrap(room, <RemoteCursors />));
    act(() => {
      setPeer(2, { user: { id: 'a', name: '철수', color: '#0090FF' }, cursor: { x: 45, y: 15 } });
      setPeer(3, { user: { id: 'b', name: '', color: '#46A758' }, cursor: { x: 0, y: 0 } });
      setPeer(4, { user: { id: 'c', name: '영희', color: '#8E4EC6' }, cursor: null });
    });
    const cursors = screen.getAllByTestId('remote-cursor');
    expect(cursors.map((c) => c.getAttribute('data-user-name'))).toEqual(['철수', '익명']);
    expect(cursors[0].style.transform).toBe('translate(100px, 50px)');
    expect(cursors[0].textContent).toBe('철수');
    expect(cursors[0].querySelector('svg path')?.getAttribute('fill')).toBe('#0090FF');
    expect(cursors[1].style.transform).toBe('translate(10px, 20px)');
  });

  it('화면 밖의 커서는 가장자리 표시로 바꾼다', () => {
    const { room, setPeer } = fakeRoom();
    useUi.setState({ viewport: { x: 0, y: 0, zoom: 1 }, canvasSize: { w: 800, h: 600 } });
    render(wrap(room, <RemoteCursors />));
    act(() => setPeer(2, { user: { id: 'a', name: '철수', color: '#0090FF' }, cursor: { x: 5000, y: 300 } }));
    expect(screen.queryByTestId('remote-cursor')).toBeNull();
    const edge = screen.getByTestId('remote-cursor-edge');
    expect(edge.getAttribute('data-user-name')).toBe('철수');
    expect(edge.style.transform).toBe('translate(788px, 300px)');

    act(() => useUi.getState().setViewport({ x: -4800, y: 0, zoom: 1 }));
    expect(screen.getByTestId('remote-cursor').style.transform).toBe('translate(200px, 300px)');
  });

  it('나간 접속자의 커서는 지운다', () => {
    const { room, setPeer } = fakeRoom();
    render(wrap(room, <RemoteCursors />));
    act(() => setPeer(2, { user: { id: 'a', name: '철수', color: '#0090FF' }, cursor: { x: 1, y: 1 } }));
    expect(screen.getAllByTestId('remote-cursor')).toHaveLength(1);
    act(() => setPeer(2, null));
    expect(screen.queryByTestId('remote-cursor')).toBeNull();
  });
});

describe('RemoteSelections', () => {
  const node = (id: string, x: number): ErdNode => ({ id, kind: 'entity', x, y: 0, w: 100, h: 50, text: id }) as ErdNode;

  it('선택은 실선, 편집 중은 점선과 이름표로 그린다', () => {
    const { room, setPeer } = fakeRoom([node('n1', 0), node('n2', 300)]);
    useUi.setState({ viewport: { x: 0, y: 0, zoom: 2 } });
    const { container } = render(wrap(room, <svg><RemoteSelections /></svg>));
    act(() => setPeer(2, { user: { id: 'a', name: '철수', color: '#0090FF' }, selection: ['n1', 'n2', 'e1'], editing: 'n2' }));

    expect(container.querySelector('g[data-testid="remote-selections"]')?.getAttribute('pointer-events')).toBe('none');
    const rings = screen.getAllByTestId('remote-selection');
    expect(rings).toHaveLength(2);
    const rect = rings[0].querySelector('rect')!;
    expect(['x', 'y', 'width', 'height'].map((a) => rect.getAttribute(a))).toEqual(['-4', '-4', '108', '58']);
    expect(rect.getAttribute('stroke')).toBe('#0090FF');
    expect(rect.getAttribute('fill')).toBe('none');
    expect(rect.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    expect(rect.getAttribute('stroke-dasharray')).toBeNull();
    expect(rings[0].querySelector('text')).toBeNull();

    expect(rings[1].querySelector('rect')!.getAttribute('stroke-dasharray')).toBe('6 4');
    expect(rings[1].querySelector('text')!.textContent).toBe('철수 편집 중');
    expect(rings[1].querySelector('g')!.getAttribute('transform')).toBe('translate(296 -4) scale(0.5)');
    expect(container.querySelector('[data-node-id]')).toBeNull();
  });
});

describe('UserAvatars', () => {
  it('나를 맨 앞에 두고 접속자를 이어서 그린다', () => {
    const { room, setPeer } = fakeRoom();
    render(wrap(room, <UserAvatars />));
    act(() => {
      setPeer(2, { user: { id: 'a', name: 'bob', color: '#0090FF' } });
      setPeer(3, { user: { id: 'b', name: '', color: '#46A758' } });
    });
    const avatars = screen.getAllByTestId('avatar');
    expect(avatars.map((a) => a.textContent)).toEqual(['나', 'B', '?']);
    expect(avatars.map((a) => a.getAttribute('title'))).toEqual(['나연', 'bob', '익명']);
    expect(avatars[0].getAttribute('data-me')).toBe('true');
    expect(avatars[0].className).toContain('is-me');
    expect(avatars[1].getAttribute('data-me')).toBeNull();
    expect(screen.queryByTestId('avatar-more')).toBeNull();
  });

  it('6명을 넘으면 나머지는 +N으로 줄인다', () => {
    const { room, setPeer } = fakeRoom();
    render(wrap(room, <UserAvatars />));
    act(() => {
      for (let i = 2; i <= 9; i++) setPeer(i, { user: { id: `u${i}`, name: `사람${i}`, color: '#0090FF' } });
    });
    expect(screen.getAllByTestId('avatar')).toHaveLength(6);
    const more = screen.getByTestId('avatar-more');
    expect(more.textContent).toBe('+3');
    expect(more.getAttribute('title')).toBe('사람7, 사람8, 사람9');
  });

  it('정확히 6명이면 모두 그린다', () => {
    const { room, setPeer } = fakeRoom();
    render(wrap(room, <UserAvatars />));
    act(() => {
      for (let i = 2; i <= 6; i++) setPeer(i, { user: { id: `u${i}`, name: `사람${i}`, color: '#0090FF' } });
    });
    expect(screen.getAllByTestId('avatar')).toHaveLength(6);
    expect(screen.queryByTestId('avatar-more')).toBeNull();
  });

  it('내 아바타를 누르면 이름 입력 창을 연다', () => {
    const { room } = fakeRoom();
    render(wrap(room, <UserAvatars />));
    fireEvent.click(screen.getAllByTestId('avatar')[0]);
    expect(useNicknameDialog.getState()).toEqual({ open: true, forced: false });
  });

  it('다른 사람 아바타를 누르면 그 사람 커서로 화면을 옮긴다', () => {
    const { room, setPeer } = fakeRoom();
    render(wrap(room, <UserAvatars />));
    act(() => {
      setPeer(2, { user: { id: 'a', name: '철수', color: '#0090FF' }, cursor: { x: 320, y: -40 } });
      setPeer(3, { user: { id: 'b', name: '영희', color: '#46A758' }, cursor: null });
    });
    const avatars = screen.getAllByTestId('avatar');
    fireEvent.click(avatars[2]);
    expect(centerOn).not.toHaveBeenCalled();
    fireEvent.click(avatars[1]);
    expect(centerOn).toHaveBeenCalledWith({ x: 320, y: -40 });
    expect(useNicknameDialog.getState().open).toBe(false);
  });
});
