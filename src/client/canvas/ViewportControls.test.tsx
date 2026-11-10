// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM } from '../../shared/types';
import type { ErdEdge, ErdNode } from '../../shared/types';
import { RoomContext } from '../collab/hooks';
import type { Room } from '../collab/room';
import { ui, useUi } from '../state/ui';
import { screenToWorld, worldToScreen } from './coords';
import {
  Grid,
  Minimap,
  ZoomControls,
  centerOn,
  panBy,
  setZoom,
  useWheelZoom,
  zoomAt,
  zoomBy,
  zoomToRect,
} from './ViewportControls';

const SIZE = { w: 1000, h: 600 };

function node(id: string, kind: ErdNode['kind'], x: number, y: number, w = 140, h = 60): ErdNode {
  return { id, kind, x, y, w, h, text: id };
}

/** useNodes/useEdges가 읽는 부분만 흉내 낸 방 */
function fakeRoom(nodes: ErdNode[], edges: ErdEdge[] = []): Room {
  const store = <T,>(list: T[]) => ({ subscribe: () => () => {}, getSnapshot: () => list });
  return { id: 'test', nodes: store(nodes), edges: store(edges) } as unknown as Room;
}

function withRoom(children: ReactNode, nodes: ErdNode[], edges: ErdEdge[] = []) {
  return <RoomContext.Provider value={fakeRoom(nodes, edges)}>{children}</RoomContext.Provider>;
}

beforeEach(() => {
  useUi.getState().reset();
  ui().setCanvasSize(SIZE);
});
afterEach(cleanup);

describe('화면 이동/확대 함수', () => {
  it('panBy는 화면을 민다', () => {
    panBy(30, -10);
    expect(ui().viewport).toEqual({ x: 30, y: -10, zoom: 1 });
  });

  it('zoomAt은 화면 점 아래의 월드 좌표를 유지하고 배율을 제한한다', () => {
    ui().setViewport({ x: 120, y: -40, zoom: 1 });
    const p = { x: 700, y: 150 };
    const before = screenToWorld(ui().viewport, p);
    zoomAt(p, 1.7);
    expect(ui().viewport.zoom).toBeCloseTo(1.7, 10);
    expect(screenToWorld(ui().viewport, p).x).toBeCloseTo(before.x, 8);
    expect(screenToWorld(ui().viewport, p).y).toBeCloseTo(before.y, 8);
    zoomAt(p, 1000);
    expect(ui().viewport.zoom).toBe(MAX_ZOOM);
    zoomAt(p, 1e-6);
    expect(ui().viewport.zoom).toBe(MIN_ZOOM);
    expect(screenToWorld(ui().viewport, p).x).toBeCloseTo(before.x, 6);
  });

  it('zoomBy와 setZoom은 캔버스 가운데를 기준으로 한다', () => {
    ui().setViewport({ x: 10, y: 20, zoom: 1 });
    const center = { x: 500, y: 300 };
    const before = screenToWorld(ui().viewport, center);
    zoomBy(2);
    expect(ui().viewport.zoom).toBe(2);
    expect(screenToWorld(ui().viewport, center).x).toBeCloseTo(before.x, 8);
    setZoom(0.5);
    expect(ui().viewport.zoom).toBe(0.5);
    expect(screenToWorld(ui().viewport, center).y).toBeCloseTo(before.y, 8);
    setZoom(99);
    expect(ui().viewport.zoom).toBe(MAX_ZOOM);
  });

  it('zoomToRect와 centerOn', () => {
    zoomToRect({ x: 0, y: 0, w: 4400, h: 100 });
    // 왼쪽 도구 팔레트 폭 72를 뺀 928 안에서 맞춘다: (928 - 120) / 4400
    expect(ui().viewport.zoom).toBeCloseTo(808 / 4400, 10);
    expect(worldToScreen(ui().viewport, { x: 2200, y: 50 }).x).toBeCloseTo(536, 8);
    expect(worldToScreen(ui().viewport, { x: 2200, y: 50 }).y).toBeCloseTo(300, 8);
    zoomToRect(null);
    expect(ui().viewport).toEqual({ x: 500, y: 300, zoom: 1 });
    ui().setViewport({ x: 0, y: 0, zoom: 2 });
    centerOn({ x: 100, y: 100 });
    expect(ui().viewport.zoom).toBe(2);
    expect(worldToScreen(ui().viewport, { x: 100, y: 100 })).toEqual({ x: 500, y: 300 });
  });

  it('바뀐 것이 없으면 viewport 객체를 새로 만들지 않는다', () => {
    const v = ui().viewport;
    panBy(0, 0);
    setZoom(1);
    expect(ui().viewport).toBe(v);
  });
});

function WheelHost() {
  const ref = useRef<HTMLDivElement>(null);
  useWheelZoom(ref);
  return (
    <div ref={ref} data-testid="host">
      <textarea data-testid="editor" />
    </div>
  );
}

function wheel(target: Element, init: WheelEventInit): WheelEvent {
  const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

describe('useWheelZoom', () => {
  it('일반 휠은 화면을 민다', () => {
    render(<WheelHost />);
    const e = wheel(screen.getByTestId('host'), { deltaX: 5, deltaY: 40 });
    expect(e.defaultPrevented).toBe(true);
    expect(ui().viewport).toEqual({ x: -5, y: -40, zoom: 1 });
  });

  it('Shift+휠은 가로로 민다', () => {
    render(<WheelHost />);
    wheel(screen.getByTestId('host'), { deltaY: 40, shiftKey: true });
    expect(ui().viewport).toEqual({ x: -40, y: 0, zoom: 1 });
  });

  it('줄 단위 휠(deltaMode 1)을 px로 보정한다', () => {
    render(<WheelHost />);
    wheel(screen.getByTestId('host'), { deltaY: 3, deltaMode: 1 });
    expect(ui().viewport.y).toBe(-48);
  });

  it('Ctrl+휠과 핀치는 마우스 위치 기준으로 확대하고 페이지 확대를 막는다', () => {
    render(<WheelHost />);
    const p = { x: 320, y: 210 };
    const before = screenToWorld(ui().viewport, p);
    const e = wheel(screen.getByTestId('host'), { deltaY: -10, ctrlKey: true, clientX: p.x, clientY: p.y });
    expect(e.defaultPrevented).toBe(true);
    expect(ui().viewport.zoom).toBeCloseTo(Math.exp(0.1), 10);
    expect(screenToWorld(ui().viewport, p).x).toBeCloseTo(before.x, 8);
    expect(screenToWorld(ui().viewport, p).y).toBeCloseTo(before.y, 8);

    wheel(screen.getByTestId('host'), { deltaY: 10, metaKey: true, clientX: p.x, clientY: p.y });
    expect(ui().viewport.zoom).toBeCloseTo(1, 10);
  });

  it('입력창 위의 일반 휠은 건드리지 않는다', () => {
    render(<WheelHost />);
    const e = wheel(screen.getByTestId('editor'), { deltaY: 40 });
    expect(e.defaultPrevented).toBe(false);
    expect(ui().viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('Safari gesture 이벤트로 확대하고 페이지 확대를 막는다', () => {
    render(<WheelHost />);
    const host = screen.getByTestId('host');
    const gesture = (type: string, scale: number) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(e, { scale, clientX: 100, clientY: 100 });
      act(() => {
        host.dispatchEvent(e);
      });
      return e;
    };
    expect(gesture('gesturestart', 1).defaultPrevented).toBe(true);
    expect(gesture('gesturechange', 1.2).defaultPrevented).toBe(true);
    gesture('gesturechange', 1.5);
    expect(ui().viewport.zoom).toBeCloseTo(1.5, 10);
    // 핀치 중에 같이 들어오는 Ctrl+휠은 이중으로 반영하지 않는다
    wheel(host, { deltaY: -10, ctrlKey: true });
    expect(ui().viewport.zoom).toBeCloseTo(1.5, 10);
    gesture('gestureend', 1.5);
    wheel(host, { deltaY: -10, ctrlKey: true });
    expect(ui().viewport.zoom).toBeGreaterThan(1.5);
  });

  it('언마운트하면 리스너를 뗀다', () => {
    const { unmount } = render(<WheelHost />);
    const host = screen.getByTestId('host');
    unmount();
    const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40 });
    host.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(ui().viewport.y).toBe(0);
  });
});

describe('Grid', () => {
  it('pattern으로 점 격자를 그리고 포인터 이벤트를 받지 않는다', () => {
    ui().setViewport({ x: 7, y: -3, zoom: 1 });
    const { container } = render(
      <svg>
        <Grid />
      </svg>,
    );
    const pattern = container.querySelector('pattern')!;
    expect(pattern.getAttribute('patternUnits')).toBe('userSpaceOnUse');
    expect(pattern.getAttribute('width')).toBe('20');
    // 점은 타일 가운데: 화면에서 x = 7, 27, ... / y = 17, 37, ...
    expect(Number(pattern.getAttribute('x')) + 10).toBe(7);
    expect(Number(pattern.getAttribute('y')) + 10).toBe(17);
    expect(container.querySelector('g')!.getAttribute('pointer-events')).toBe('none');
    expect(container.querySelector('rect')!.getAttribute('fill')).toBe(`url(#${pattern.id})`);
  });

  it('showGrid가 false면 아무것도 그리지 않는다', () => {
    ui().setShowGrid(false);
    const { container } = render(
      <svg>
        <Grid />
      </svg>,
    );
    expect(container.querySelector('svg')!.childNodes.length).toBe(0);
  });
});

describe('ZoomControls', () => {
  const nodes = [node('a', 'entity', 0, 0), node('b', 'entity', 4260, 40)];

  it('확대, 축소, 100%로 되돌리기', () => {
    render(withRoom(<ZoomControls />, nodes));
    expect(screen.getByTestId('zoom-level').textContent).toBe('100%');
    fireEvent.click(screen.getByTestId('zoom-in'));
    expect(ui().viewport.zoom).toBeCloseTo(1.25, 10);
    expect(screen.getByTestId('zoom-level').textContent).toBe('125%');
    fireEvent.click(screen.getByTestId('zoom-out'));
    fireEvent.click(screen.getByTestId('zoom-out'));
    expect(ui().viewport.zoom).toBeCloseTo(0.8, 10);
    fireEvent.click(screen.getByTestId('zoom-level'));
    expect(ui().viewport.zoom).toBe(1);
  });

  it('전체 보기는 다이어그램 범위에 맞춘다', () => {
    render(withRoom(<ZoomControls />, nodes));
    fireEvent.click(screen.getByTestId('zoom-fit'));
    // 범위 4400×100, 여백 60, 왼쪽 도구 팔레트 폭 72: (1000 - 72 - 120) / 4400
    expect(ui().viewport.zoom).toBeCloseTo(808 / 4400, 10);
    expect(worldToScreen(ui().viewport, { x: 2200, y: 50 }).x).toBeCloseTo(536, 8);
    expect(worldToScreen(ui().viewport, { x: 2200, y: 50 }).y).toBeCloseTo(300, 8);
  });

  it('노드가 없을 때 전체 보기는 배율 1, 원점 가운데', () => {
    ui().setViewport({ x: -900, y: 77, zoom: 3 });
    render(withRoom(<ZoomControls />, []));
    fireEvent.click(screen.getByTestId('zoom-fit'));
    expect(ui().viewport).toEqual({ x: 500, y: 300, zoom: 1 });
  });

  it('격자, 정렬 붙기, 미니맵 토글', () => {
    render(withRoom(<ZoomControls />, nodes));
    const grid = screen.getByRole('button', { name: '격자' });
    expect(grid.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(grid);
    expect(ui().showGrid).toBe(false);
    expect(grid.getAttribute('aria-pressed')).toBe('false');
    expect(grid.getAttribute('title')).toBe('격자 켜기');

    fireEvent.click(screen.getByRole('button', { name: '정렬 붙기' }));
    expect(ui().snapEnabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '미니맵' }));
    expect(ui().panels.minimap).toBe(false);
  });

  it('모든 버튼에 title과 aria-label이 있다', () => {
    render(withRoom(<ZoomControls />, nodes));
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(7);
    for (const b of buttons) {
      expect(b.getAttribute('title')).toBeTruthy();
      expect(b.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('한계 배율에서는 버튼을 끈다', () => {
    ui().setViewport({ x: 0, y: 0, zoom: MAX_ZOOM });
    render(withRoom(<ZoomControls />, nodes));
    expect((screen.getByTestId('zoom-in') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('zoom-out') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Minimap', () => {
  const nodes = [
    node('e', 'entity', 0, 0),
    node('r', 'relationship', 300, 0, 140, 80),
    node('a', 'attribute', 0, 200, 120, 50),
    node('s', 'spec', 300, 200, 34, 34),
    node('n', 'note', 600, 400, 160, 50),
  ];
  const edges: ErdEdge[] = [
    { id: 'x', source: 'e', target: 'r', double: false, label: '', role: '' },
    { id: 'y', source: 'e', target: 'gone', double: false, label: '', role: '' },
  ];

  it('노드가 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(withRoom(<Minimap />, []));
    expect(container.firstChild).toBeNull();
  });

  it('종류별 단순 도형과 선, 보이는 영역을 그린다', () => {
    const { container } = render(withRoom(<Minimap />, nodes, edges));
    expect(container.querySelectorAll('rect.minimap-node').length).toBe(2);
    expect(container.querySelectorAll('polygon.minimap-node').length).toBe(1);
    expect(container.querySelectorAll('ellipse.minimap-node').length).toBe(1);
    expect(container.querySelectorAll('circle.minimap-node').length).toBe(1);
    // 끊어진 선(없는 노드)은 그리지 않는다
    expect(container.querySelector('path.minimap-edge')!.getAttribute('d')).toBe('M70 30L370 40');
    const view = screen.getByTestId('minimap-view');
    expect(Number(view.getAttribute('width'))).toBeGreaterThan(0);
    // 보이는 영역(1000×600)이 다이어그램보다 크므로 가로를 꽉 채운다
    expect(Number(view.getAttribute('width'))).toBeCloseTo(184, 6);
  });

  it('클릭한 위치가 화면 가운데가 된다', () => {
    ui().setViewport({ x: 0, y: 0, zoom: 1 });
    const { container } = render(withRoom(<Minimap />, nodes, edges));
    const svg = container.querySelector('svg')!;
    // 처음 배치: 범위 (0,0)-(1000,600), 배율 0.184, 가운데 정렬 → 미니맵 (100, 70)은 월드 (500, 300)
    // 미니맵 (8, 70)은 월드 (0, 300)
    fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: 8, clientY: 70 });
    const c = screenToWorld(ui().viewport, { x: 500, y: 300 });
    expect(c.x).toBeCloseTo(0, 6);
    expect(c.y).toBeCloseTo(300, 6);

    // 끄는 동안에는 축척이 고정되어 같은 미니맵 위치는 같은 월드 위치다
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 100, clientY: 70 });
    const c2 = screenToWorld(ui().viewport, { x: 500, y: 300 });
    expect(c2.x).toBeCloseTo(500, 6);
    expect(c2.y).toBeCloseTo(300, 6);

    fireEvent.pointerUp(svg, { pointerId: 1 });
    const v = ui().viewport;
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 20, clientY: 20 });
    expect(ui().viewport).toBe(v);
  });
});
