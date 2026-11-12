// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { ErdEdge, ErdNode } from '../../shared/types';
import { RoomContext } from '../collab/hooks';
import { LOCAL_ORIGIN, addEdges, addNodes, getEdgesMap, getMetaMap, getNodesMap, readEdge, readNode } from '../collab/docOps';
import { ElementStore, type Room } from '../collab/room';
import { clearErdHighlight, setErdHighlight, useErdHighlight } from '../state/highlight';
import { useUi } from '../state/ui';
import { Canvas } from './Canvas';
import { clientToWorld } from './coords';
import { ErdPane, erdPaneSize } from './ErdPane';
import { Minimap } from './ViewportControls';

// ───────── 환경: ResizeObserver와 캔버스 위치를 직접 정한다 ─────────

/** 캔버스(.canvas-root)의 화면 위치. 페이지 왼쪽 300, 위 120에 놓인 pane을 흉내 낸다 */
let canvasRect = { left: 300, top: 120, width: 800, height: 600 };
const observers: Array<{ cb: ResizeObserverCallback; ro: ResizeObserver }> = [];

class FakeResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    observers.push({ cb, ro: this as unknown as ResizeObserver });
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** 캔버스 크기를 바꾸고 ResizeObserver를 부른다(배치 틀이 pane 크기를 바꾼 것처럼) */
function resizeCanvas(width: number, height: number) {
  canvasRect = { ...canvasRect, width, height };
  act(() => {
    for (const o of observers) o.cb([], o.ro);
  });
}

const originalRect = HTMLElement.prototype.getBoundingClientRect;

function makeRoom(synced = true): Room {
  const doc = new Y.Doc();
  const nodesMap = getNodesMap(doc);
  const edgesMap = getEdgesMap(doc);
  const listeners = new Map<string, Set<(v: unknown) => void>>();
  return {
    id: 'room',
    doc,
    provider: {
      synced,
      wsconnected: true,
      on: (ev: string, fn: (v: unknown) => void) => void (listeners.get(ev) ?? listeners.set(ev, new Set()).get(ev)!).add(fn),
      off: (ev: string, fn: (v: unknown) => void) => void listeners.get(ev)?.delete(fn),
      connect: () => undefined,
    },
    awareness: { getStates: () => new Map(), clientID: 1, on: () => undefined, off: () => undefined, getLocalState: () => null },
    undo: new Y.UndoManager([nodesMap, edgesMap, getMetaMap(doc)], { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 0 }),
    nodes: new ElementStore<ErdNode>(nodesMap, readNode),
    edges: new ElementStore<ErdEdge>(edgesMap, readEdge),
    setPresence: () => undefined,
    destroy: () => undefined,
  } as unknown as Room;
}

const NODES: ErdNode[] = [
  { id: 'a', kind: 'entity', x: 0, y: 0, w: 120, h: 60, text: '학생' },
  { id: 'b', kind: 'relationship', x: 300, y: 0, w: 100, h: 60, text: '수강' },
  { id: 'c', kind: 'entity', x: 600, y: 0, w: 120, h: 60, text: '과목' },
  { id: 'far', kind: 'entity', x: 4000, y: 3000, w: 120, h: 60, text: '멀리' },
];
const EDGES: ErdEdge[] = [
  { id: 'ab', source: 'a', target: 'b', double: false, label: '', role: '' },
  { id: 'bc', source: 'b', target: 'c', double: false, label: '', role: '' },
];

let room: Room;
const ui = () => useUi.getState();

function mount(el: ReactElement, r: Room = room) {
  return render(<RoomContext.Provider value={r}>{el}</RoomContext.Provider>);
}

beforeEach(() => {
  observers.length = 0;
  canvasRect = { left: 300, top: 120, width: 800, height: 600 };
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList.contains('canvas-root')) {
      const { left, top, width, height } = canvasRect;
      return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
    }
    return originalRect.call(this);
  };
  ui().reset();
  useErdHighlight.setState({ ids: [], source: null, revealToken: 0 });
  room = makeRoom();
  addNodes(room.doc, NODES);
  addEdges(room.doc, EDGES);
  room.undo.clear();
});

afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

// ───────── 좌표 ─────────

describe('캔버스가 페이지 안쪽(왼쪽 300, 위 120)에 있을 때의 좌표', () => {
  it('clientToWorld는 캔버스 요소의 지금 위치를 기준으로 한다', () => {
    const el = document.createElement('div');
    el.className = 'canvas-root';
    document.body.appendChild(el);
    const v = { x: 10, y: 20, zoom: 2 };
    expect(clientToWorld(el, v, 350, 170)).toEqual({ x: 20, y: 15 });
    // pane이 다른 자리로 옮겨지면 다음 변환부터 바로 새 위치를 쓴다
    canvasRect = { ...canvasRect, left: 0, top: 0 };
    expect(clientToWorld(el, v, 50, 50)).toEqual({ x: 20, y: 15 });
  });

  it('우클릭 메뉴의 월드 좌표가 마우스 아래 점이다', () => {
    const { getByTestId } = mount(<Canvas />);
    act(() => ui().setViewport({ x: 40, y: 30, zoom: 2 }));
    fireEvent.contextMenu(getByTestId('canvas-svg'), { clientX: 300 + 240, clientY: 120 + 130 });
    const menu = ui().contextMenu!;
    expect(menu.x).toBe(540);
    expect(menu.y).toBe(250);
    expect(menu.world).toEqual({ x: (240 - 40) / 2, y: (130 - 30) / 2 });
  });

  it('도형 놓기 도구로 누른 자리(마우스 아래)에 도형이 생긴다', () => {
    const { getByTestId } = mount(<Canvas />);
    act(() => {
      ui().setViewport({ x: 0, y: 0, zoom: 1 });
      ui().setTool('place:entity');
    });
    const svg = getByTestId('canvas-svg');
    const before = new Set(room.nodes.getSnapshot().map((n) => n.id));
    fireEvent.pointerDown(svg, { button: 0, buttons: 1, pointerId: 1, clientX: 300 + 500, clientY: 120 + 400 });
    fireEvent.pointerUp(svg, { button: 0, buttons: 0, pointerId: 1, clientX: 300 + 500, clientY: 120 + 400 });
    const created = room.nodes.getSnapshot().find((n) => !before.has(n.id));
    expect(created).toBeTruthy();
    expect(created!.x + created!.w / 2).toBeCloseTo(500, -1);
    expect(created!.y + created!.h / 2).toBeCloseTo(400, -1);
  });
});

// ───────── 크기 ─────────

describe('컨테이너 크기 변화', () => {
  it('크기가 바뀌어도 화면 가운데의 월드 점이 그대로다', () => {
    mount(<Canvas />);
    expect(ui().canvasSize).toEqual({ w: 800, h: 600 });
    act(() => ui().setViewport({ x: 10, y: 20, zoom: 1.25 }));
    const center = () => {
      const { viewport: v, canvasSize: s } = ui();
      return { x: (s.w / 2 - v.x) / v.zoom, y: (s.h / 2 - v.y) / v.zoom };
    };
    const before = center();
    resizeCanvas(1000, 500);
    expect(center().x).toBeCloseTo(before.x);
    expect(center().y).toBeCloseTo(before.y);
    expect(ui().viewport.zoom).toBe(1.25);
  });

  it('숨겼다가(0×0) 다시 보이면 튀지 않는다. 숨긴 동안 크기가 바뀌었으면 가운데를 맞춘다', () => {
    mount(<Canvas />);
    act(() => ui().setViewport({ x: 10, y: 20, zoom: 1 }));
    resizeCanvas(0, 0);
    expect(ui().canvasSize).toEqual({ w: 0, h: 0 });
    expect(ui().viewport).toEqual({ x: 10, y: 20, zoom: 1 });
    resizeCanvas(800, 600);
    expect(ui().viewport).toEqual({ x: 10, y: 20, zoom: 1 });
    resizeCanvas(0, 0);
    resizeCanvas(600, 600);
    expect(ui().viewport).toEqual({ x: -90, y: 20, zoom: 1 });
  });

  it('크기가 바뀌면 떠 있는 우클릭 메뉴를 닫는다', () => {
    mount(<Canvas />);
    act(() => ui().openContextMenu({ x: 1, y: 1, world: { x: 0, y: 0 }, targetId: null }));
    resizeCanvas(700, 600);
    expect(ui().contextMenu).toBeNull();
  });

  it('처음 뜰 때 크기가 0이면 전체 보기를 미뤘다가 실제 크기를 얻으면 한 번 한다', () => {
    canvasRect = { ...canvasRect, width: 0, height: 0 };
    mount(<Canvas />);
    expect(ui().viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    resizeCanvas(900, 700);
    const v = ui().viewport;
    expect(v).not.toEqual({ x: 0, y: 0, zoom: 1 });
    // 모든 도형이 화면 안에 들어온다
    for (const n of NODES) {
      expect(n.x * v.zoom + v.x).toBeGreaterThanOrEqual(0);
      expect((n.x + n.w) * v.zoom + v.x).toBeLessThanOrEqual(900);
      expect((n.y + n.h) * v.zoom + v.y).toBeLessThanOrEqual(700);
    }
    // 다시 크기가 바뀌어도 전체 보기를 또 하지 않는다(가운데만 유지)
    const fitted = ui().viewport;
    resizeCanvas(800, 700);
    expect(ui().viewport.zoom).toBe(fitted.zoom);
    expect(ui().viewport.x).toBeCloseTo(fitted.x - 50);
  });
});

// ───────── 포커스 ─────────

describe('포커스', () => {
  it('캔버스를 누르면 다른 pane에 있던 포커스가 캔버스로 온다', () => {
    const other = document.createElement('button');
    other.setAttribute('data-pane', 'relational');
    document.body.appendChild(other);
    other.focus();
    const { container, getByTestId } = mount(<Canvas />);
    fireEvent.pointerDown(getByTestId('canvas-svg'), { button: 0, buttons: 1, pointerId: 1, clientX: 900, clientY: 600 });
    expect(document.activeElement).toBe(container.querySelector('.canvas-root'));
    expect(container.querySelector('.canvas-root')!.getAttribute('tabindex')).toBe('-1');
  });

  it('ERD pane의 빈 패널 자리를 눌러도 포커스가 pane으로 온다', () => {
    const other = document.createElement('input');
    document.body.appendChild(other);
    other.focus();
    const { getByTestId } = mount(<ErdPane />);
    const pane = getByTestId('erd-pane');
    fireEvent.pointerDown(pane.querySelector('.erd-slot-left')!);
    expect(document.activeElement).toBe(pane);
  });
});

// ───────── 강조 ─────────

describe('다른 pane의 강조', () => {
  it('강조한 노드와 엣지에 후광을 그리고 나머지는 옅게 한다. 선택, 문서, 실행 취소 기록은 그대로다', () => {
    const { container } = mount(<Canvas />);
    act(() => ui().setSelection(['c']));
    const docBefore = Y.encodeStateAsUpdate(room.doc);
    act(() => setErdHighlight(['a', 'ab'], 'steps'));

    const nodeG = (id: string) => container.querySelector(`[data-node-id="${id}"]`)!;
    const edgeG = (id: string) => container.querySelector(`[data-edge-id="${id}"]`)!;
    expect(nodeG('a').getAttribute('data-related')).toBe('true');
    expect(nodeG('a').querySelector('[data-related-halo]')).not.toBeNull();
    expect(nodeG('a').getAttribute('opacity')).toBeNull();
    expect(edgeG('ab').getAttribute('data-related')).toBe('true');
    expect(edgeG('ab').querySelector('[data-related-halo]')).not.toBeNull();
    // 대상이 아닌 것은 옅게
    expect(Number(nodeG('b').getAttribute('opacity'))).toBeGreaterThan(0.3);
    expect(Number(nodeG('b').getAttribute('opacity'))).toBeLessThan(0.6);
    expect(edgeG('bc').getAttribute('opacity')).not.toBeNull();
    // 후광은 클릭을 가로채지 않는다
    expect(nodeG('a').querySelector('[data-related-halo]')!.getAttribute('pointer-events')).toBe('none');
    expect(container.querySelector('.canvas-root')!.getAttribute('data-related')).toBe('true');

    expect(ui().selection).toEqual(['c']);
    expect(room.undo.undoStack.length).toBe(0);
    expect(Y.encodeStateAsUpdate(room.doc)).toEqual(docBefore);

    act(() => clearErdHighlight('steps'));
    expect(nodeG('a').getAttribute('data-related')).toBeNull();
    expect(nodeG('b').getAttribute('opacity')).toBeNull();
    expect(container.querySelector('[data-related-halo]')).toBeNull();
  });

  it('Esc는 강조를 지우지 않는다', () => {
    mount(<Canvas />);
    act(() => setErdHighlight(['a'], 'table'));
    fireEvent.keyDown(window, { code: 'Escape' });
    expect(useErdHighlight.getState().ids).toEqual(['a']);
  });

  it('미니맵에도 강조를 그린다', () => {
    act(() => ui().setCanvasSize({ w: 800, h: 600 }));
    const { container } = mount(<Minimap />);
    expect(container.querySelector('.minimap-node.is-related')).toBeNull();
    act(() => setErdHighlight(['b', 'bc'], 'choice'));
    expect(container.querySelectorAll('.minimap-node.is-related')).toHaveLength(1);
    expect(container.querySelectorAll('.minimap-node.is-dimmed')).toHaveLength(NODES.length - 1);
    expect(container.querySelector('.minimap-edge.is-related')).not.toBeNull();
  });
});

describe('강조한 도형 보여 주기(revealToken)', () => {
  it('reveal 요청이 오면 화면 밖 도형을 화면 안으로 데려온다(움직임 줄이기 환경에서는 바로)', () => {
    mount(<Canvas />);
    act(() => ui().setViewport({ x: 0, y: 0, zoom: 1 }));
    act(() => setErdHighlight(['far'], 'steps', true));
    const v = ui().viewport;
    const far = NODES[3];
    const cx = (far.x + far.w / 2) * v.zoom + v.x;
    const cy = (far.y + far.h / 2) * v.zoom + v.y;
    expect(cx).toBeGreaterThan(0);
    expect(cx).toBeLessThan(800);
    expect(cy).toBeGreaterThan(0);
    expect(cy).toBeLessThan(600);
    expect(v.zoom).toBe(1);
  });

  it('강조만 바꾸면(reveal 없이) 화면을 움직이지 않는다', () => {
    mount(<Canvas />);
    act(() => ui().setViewport({ x: 0, y: 0, zoom: 1 }));
    act(() => setErdHighlight(['far'], 'steps'));
    expect(ui().viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('이미 보이는 도형이면 움직이지 않는다', () => {
    mount(<Canvas />);
    act(() => ui().setViewport({ x: 100, y: 200, zoom: 1 }));
    act(() => setErdHighlight(['b'], 'steps', true));
    expect(ui().viewport).toEqual({ x: 100, y: 200, zoom: 1 });
  });

  it('숨겨진 동안 온 요청은 다시 보일 때 한 번 처리한다', () => {
    mount(<Canvas />);
    act(() => ui().setViewport({ x: 0, y: 0, zoom: 1 }));
    resizeCanvas(0, 0);
    act(() => setErdHighlight(['far'], 'steps', true));
    expect(ui().viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    resizeCanvas(800, 600);
    expect(ui().viewport).not.toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('비활성 탭이라 크기를 지닌 채 숨김 보관함에 있을 때 온 요청은 바로 옮겨 두고, 다시 보여도 화면이 튀지 않는다', () => {
    const holder = document.createElement('div');
    holder.setAttribute('inert', '');
    holder.style.visibility = 'hidden';
    const slot = document.createElement('div');
    // 배치 틀의 pane 호스트처럼, 내용이 그려지는 div를 통째로 옮긴다
    const host = document.createElement('div');
    host.dataset.pane = 'erd';
    slot.appendChild(host);
    document.body.append(holder, slot);
    render(
      <RoomContext.Provider value={room}>
        <Canvas />
      </RoomContext.Provider>,
      { container: host },
    );
    act(() => ui().setViewport({ x: 0, y: 0, zoom: 1 }));
    // 배치 틀이 pane을 보관함으로 옮긴다(크기는 800×600 그대로)
    holder.appendChild(host);
    act(() => setErdHighlight(['far'], 'steps', true));
    const moved = ui().viewport;
    expect(moved).not.toEqual({ x: 0, y: 0, zoom: 1 });
    // 다시 그룹 내용 칸으로 붙인다: 크기가 같으니 ResizeObserver가 불려도 화면은 그대로다
    slot.appendChild(host);
    resizeCanvas(800, 600);
    expect(ui().viewport).toEqual(moved);
  });
});

// ───────── 작은 pane ─────────

describe('ErdPane 크기 단계', () => {
  it('erdPaneSize', () => {
    expect(erdPaneSize({ w: 0, h: 0 })).toBe('full');
    expect(erdPaneSize({ w: 1200, h: 800 })).toBe('full');
    expect(erdPaneSize({ w: 600, h: 800 })).toBe('compact');
    expect(erdPaneSize({ w: 1200, h: 400 })).toBe('compact');
    expect(erdPaneSize({ w: 360, h: 300 })).toBe('tiny');
  });

  it('작은 pane에서는 미니맵을 그리지 않고, 크면 다시 그린다. 패널은 pane 안에 놓인다', () => {
    canvasRect = { ...canvasRect, width: 360, height: 300 };
    const { getByTestId, queryByTestId } = mount(<ErdPane />);
    const pane = getByTestId('erd-pane');
    expect(pane.getAttribute('data-size')).toBe('tiny');
    expect(queryByTestId('minimap')).toBeNull();
    expect(pane.querySelector('[data-testid="toolbar"]')).not.toBeNull();
    expect(pane.querySelector('.zoom-controls')).not.toBeNull();
    resizeCanvas(1200, 800);
    expect(pane.getAttribute('data-size')).toBe('full');
    expect(queryByTestId('minimap')).not.toBeNull();
  });

  it('도움말은 pane 안에 그린다', () => {
    act(() => ui().togglePanel('help', true));
    const { getByTestId } = mount(<ErdPane />);
    expect(getByTestId('erd-pane').contains(getByTestId('help-overlay'))).toBe(true);
  });
});
