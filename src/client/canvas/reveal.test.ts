import { describe, expect, it } from 'vitest';
import { MIN_ZOOM, type ErdEdge, type ErdNode, type Rect, type Viewport } from '../../shared/types';
import { highlightBounds, revealInsets, revealViewport } from './reveal';
import { keepCenterOnResize } from './interaction/useCanvasSetup';
import { connectReasonPosition } from './interaction/Overlays';

const SIZE = { w: 1000, h: 600 };
const NO_INSETS = { left: 0, top: 0, right: 0, bottom: 0 };

function onScreen(v: Viewport, r: Rect) {
  return { x: r.x * v.zoom + v.x, y: r.y * v.zoom + v.y, w: r.w * v.zoom, h: r.h * v.zoom };
}

describe('revealViewport', () => {
  it('이미 다 보이면 움직이지 않는다(null)', () => {
    const v = { x: 0, y: 0, zoom: 1 };
    expect(revealViewport(v, SIZE, { x: 100, y: 100, w: 200, h: 100 }, NO_INSETS)).toBeNull();
  });

  it('화면 밖에 있고 지금 배율로 들어가면 배율은 그대로 두고 가운데로 민다', () => {
    const v = { x: 0, y: 0, zoom: 1.5 };
    const rect = { x: 2000, y: 1500, w: 200, h: 100 };
    const next = revealViewport(v, SIZE, rect, NO_INSETS)!;
    expect(next.zoom).toBe(1.5);
    const s = onScreen(next, rect);
    expect(s.x + s.w / 2).toBeCloseTo(SIZE.w / 2);
    expect(s.y + s.h / 2).toBeCloseTo(SIZE.h / 2);
  });

  it('일부만 보여도 옮긴다', () => {
    const v = { x: 0, y: 0, zoom: 1 };
    expect(revealViewport(v, SIZE, { x: 950, y: 100, w: 100, h: 50 }, NO_INSETS)).not.toBeNull();
  });

  it('지금 배율로 다 안 들어가면 들어갈 만큼만 줄인다', () => {
    const v = { x: 0, y: 0, zoom: 2 };
    const rect = { x: 0, y: 0, w: 1500, h: 300 };
    const next = revealViewport(v, SIZE, rect, NO_INSETS)!;
    expect(next.zoom).toBeCloseTo(1000 / 1500);
    const s = onScreen(next, rect);
    expect(s.x).toBeGreaterThanOrEqual(-0.01);
    expect(s.x + s.w).toBeLessThanOrEqual(SIZE.w + 0.01);
  });

  it('작게 줄인 화면에서 작은 도형을 데려올 때 확대하지 않는다', () => {
    const v = { x: 0, y: 0, zoom: 0.4 };
    const next = revealViewport(v, SIZE, { x: 5000, y: 5000, w: 50, h: 30 }, NO_INSETS)!;
    expect(next.zoom).toBe(0.4);
  });

  it('MIN_ZOOM 아래로는 줄이지 않는다', () => {
    const v = { x: 0, y: 0, zoom: 1 };
    const next = revealViewport(v, SIZE, { x: 0, y: 0, w: 100000, h: 100 }, NO_INSETS)!;
    expect(next.zoom).toBe(MIN_ZOOM);
  });

  it('여백(도구 팔레트 자리)을 피해 가운데에 놓는다', () => {
    const insets = revealInsets(SIZE);
    expect(insets.left).toBeGreaterThan(insets.right);
    const next = revealViewport({ x: 0, y: 0, zoom: 1 }, SIZE, { x: -3000, y: 0, w: 100, h: 100 })!;
    const s = onScreen(next, { x: -3000, y: 0, w: 100, h: 100 });
    const areaCenter = insets.left + (SIZE.w - insets.left - insets.right) / 2;
    expect(s.x + s.w / 2).toBeCloseTo(areaCenter);
  });

  it('캔버스 크기가 0이면(숨겨짐) 계산하지 않는다', () => {
    expect(revealViewport({ x: 0, y: 0, zoom: 1 }, { w: 0, h: 0 }, { x: 5000, y: 0, w: 10, h: 10 })).toBeNull();
  });

  it('작은 pane(360×300)에서도 여백이 자리를 다 먹지 않는다', () => {
    const size = { w: 360, h: 300 };
    const rect = { x: 2000, y: 2000, w: 120, h: 60 };
    const next = revealViewport({ x: 0, y: 0, zoom: 1 }, size, rect)!;
    expect(next.zoom).toBe(1);
    const s = onScreen(next, rect);
    expect(s.x).toBeGreaterThanOrEqual(0);
    expect(s.x + s.w).toBeLessThanOrEqual(size.w);
    expect(s.y).toBeGreaterThanOrEqual(0);
    expect(s.y + s.h).toBeLessThanOrEqual(size.h);
  });
});

describe('highlightBounds', () => {
  const nodes = new Map<string, ErdNode>([
    ['a', { id: 'a', kind: 'entity', x: 0, y: 0, w: 100, h: 50, text: 'A' }],
    ['b', { id: 'b', kind: 'relationship', x: 400, y: 200, w: 100, h: 60, text: 'B' }],
  ]);
  const edges = new Map<string, ErdEdge>([['ab', { id: 'ab', source: 'a', target: 'b', double: false, label: '', role: '' }]]);

  it('노드는 자기 사각형, 엣지는 양 끝 노드를 감싼다. 없는 id는 건너뛴다', () => {
    expect(highlightBounds(['a', 'zzz'], nodes, edges)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(highlightBounds(['ab'], nodes, edges)).toEqual({ x: 0, y: 0, w: 500, h: 260 });
    expect(highlightBounds(['zzz'], nodes, edges)).toBeNull();
  });
});

describe('keepCenterOnResize', () => {
  it('크기가 바뀌면 화면 가운데의 월드 점을 유지한다', () => {
    const v = { x: 37, y: -12, zoom: 1.7 };
    const prev = { w: 800, h: 600 };
    const next = { w: 1100, h: 450 };
    const moved = keepCenterOnResize(v, prev, next);
    const before = { x: (prev.w / 2 - v.x) / v.zoom, y: (prev.h / 2 - v.y) / v.zoom };
    const after = { x: (next.w / 2 - moved.x) / moved.zoom, y: (next.h / 2 - moved.y) / moved.zoom };
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(moved.zoom).toBe(v.zoom);
  });

  it('어느 쪽이든 0이면(숨겨짐) 그대로 둔다', () => {
    const v = { x: 1, y: 2, zoom: 1 };
    expect(keepCenterOnResize(v, { w: 0, h: 0 }, { w: 800, h: 600 })).toBe(v);
    expect(keepCenterOnResize(v, { w: 800, h: 600 }, { w: 0, h: 0 })).toBe(v);
    expect(keepCenterOnResize(v, { w: 800, h: 600 }, { w: 800, h: 600 })).toBe(v);
  });
});

describe('connectReasonPosition', () => {
  it('창 크기가 아니라 캔버스 크기 안으로 당긴다', () => {
    const size = { w: 360, h: 300 };
    const pos = connectReasonPosition({ x: 340, y: 100 }, size);
    // 말풍선 폭은 min(280, 360-16)=280 → 오른쪽 끝 8px 안쪽
    expect(pos.left).toBe(360 - 280 - 8);
    expect(pos.above).toBe(false);
  });

  it('아주 좁으면 말풍선 폭이 줄고 왼쪽 여백 8px은 지킨다', () => {
    const pos = connectReasonPosition({ x: 200, y: 50 }, { w: 200, h: 300 });
    expect(pos.left).toBe(8);
  });

  it('바닥 근처에서는 마우스 위로 올린다', () => {
    const pos = connectReasonPosition({ x: 100, y: 280 }, { w: 800, h: 300 });
    expect(pos.above).toBe(true);
    expect(pos.top).toBeLessThan(280);
  });
});
