import { describe, expect, it } from 'vitest';
import { GRID_SIZE, MAX_ZOOM, MIN_ZOOM } from '../../shared/types';
import type { Viewport } from '../../shared/types';
import { screenToWorld, visibleWorldRect, worldToScreen } from './coords';
import {
  FIT_MAX_ZOOM,
  centerViewportOn,
  clampZoom,
  fitRect,
  fitViewport,
  gridLayout,
  panViewport,
  unionRect,
  wheelDeltaPx,
  wheelPan,
  wheelZoomFactor,
  zoomViewportAt,
  zoomViewportTo,
} from './viewportMath';

const SIZE = { w: 1000, h: 600 };

describe('clampZoom', () => {
  it('MIN_ZOOM~MAX_ZOOM 안으로 제한한다', () => {
    expect(clampZoom(0.001)).toBe(MIN_ZOOM);
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(1.3)).toBe(1.3);
    expect(clampZoom(NaN)).toBe(1);
  });
});

describe('panViewport', () => {
  it('배율은 그대로 두고 dx, dy만큼 민다', () => {
    expect(panViewport({ x: 10, y: 20, zoom: 2 }, 5, -7)).toEqual({ x: 15, y: 13, zoom: 2 });
  });
});

describe('zoomViewportAt', () => {
  it('주어진 화면 점 아래의 월드 좌표가 유지된다', () => {
    const v: Viewport = { x: 37, y: -120, zoom: 0.8 };
    const screen = { x: 412, y: 233 };
    const before = screenToWorld(v, screen);
    for (const factor of [1.1, 2, 0.5, 0.33]) {
      const next = zoomViewportAt(v, screen, factor);
      expect(next.zoom).toBeCloseTo(0.8 * factor, 10);
      const after = screenToWorld(next, screen);
      expect(after.x).toBeCloseTo(before.x, 8);
      expect(after.y).toBeCloseTo(before.y, 8);
    }
  });

  it('제한에 걸려도 화면 점 아래의 월드 좌표는 유지된다', () => {
    const v: Viewport = { x: 50, y: 60, zoom: 3 };
    const screen = { x: 300, y: 200 };
    const before = screenToWorld(v, screen);
    const next = zoomViewportAt(v, screen, 10);
    expect(next.zoom).toBe(MAX_ZOOM);
    expect(screenToWorld(next, screen).x).toBeCloseTo(before.x, 8);
    expect(screenToWorld(next, screen).y).toBeCloseTo(before.y, 8);

    const small = zoomViewportAt(v, screen, 0.0001);
    expect(small.zoom).toBe(MIN_ZOOM);
    expect(screenToWorld(small, screen).x).toBeCloseTo(before.x, 8);
  });

  it('이미 한계 배율이면 같은 객체를 돌려준다', () => {
    const v: Viewport = { x: 1, y: 2, zoom: MAX_ZOOM };
    expect(zoomViewportAt(v, { x: 0, y: 0 }, 2)).toBe(v);
  });

  it('잘못된 배수는 무시한다', () => {
    const v: Viewport = { x: 1, y: 2, zoom: 1 };
    expect(zoomViewportAt(v, { x: 0, y: 0 }, 0)).toBe(v);
    expect(zoomViewportAt(v, { x: 0, y: 0 }, -1)).toBe(v);
    expect(zoomViewportAt(v, { x: 0, y: 0 }, NaN)).toBe(v);
  });
});

describe('zoomViewportTo', () => {
  it('배율을 정확히 맞추고 기준점을 유지한다', () => {
    const v: Viewport = { x: -200, y: 80, zoom: 2.4 };
    const center = { x: SIZE.w / 2, y: SIZE.h / 2 };
    const before = screenToWorld(v, center);
    const next = zoomViewportTo(v, center, 1);
    expect(next.zoom).toBe(1);
    expect(screenToWorld(next, center).x).toBeCloseTo(before.x, 8);
    expect(screenToWorld(next, center).y).toBeCloseTo(before.y, 8);
  });
});

describe('centerViewportOn', () => {
  it('월드 점이 화면 가운데에 온다', () => {
    const next = centerViewportOn({ x: 0, y: 0, zoom: 1.5 }, SIZE, { x: 300, y: -40 });
    expect(next.zoom).toBe(1.5);
    expect(worldToScreen(next, { x: 300, y: -40 })).toEqual({ x: 500, y: 300 });
  });
});

describe('fitViewport', () => {
  it('rect가 null이면 배율 1에 월드 원점이 화면 가운데', () => {
    const v = fitViewport(null, SIZE);
    expect(v.zoom).toBe(1);
    expect(worldToScreen(v, { x: 0, y: 0 })).toEqual({ x: 500, y: 300 });
  });

  it('큰 그림은 여백 안에 다 들어오게 줄이고 가운데에 놓는다', () => {
    const rect = { x: -500, y: 100, w: 4000, h: 1000 };
    const v = fitViewport(rect, SIZE, 60);
    // 가로가 더 빡빡하다: (1000 - 120) / 4000
    expect(v.zoom).toBeCloseTo(0.22, 10);
    const tl = worldToScreen(v, { x: rect.x, y: rect.y });
    const br = worldToScreen(v, { x: rect.x + rect.w, y: rect.y + rect.h });
    expect(tl.x).toBeCloseTo(60, 6);
    expect(br.x).toBeCloseTo(940, 6);
    expect(tl.y).toBeGreaterThanOrEqual(60);
    expect(br.y).toBeLessThanOrEqual(540);
    expect((tl.y + br.y) / 2).toBeCloseTo(300, 6);
  });

  it('세로가 더 빡빡한 경우', () => {
    const rect = { x: 0, y: 0, w: 100, h: 2400 };
    const v = fitViewport(rect, SIZE, 60);
    expect(v.zoom).toBeCloseTo(480 / 2400, 10);
    const vis = visibleWorldRect(v, SIZE);
    expect(vis.y).toBeLessThanOrEqual(rect.y);
    expect(vis.y + vis.h).toBeGreaterThanOrEqual(rect.y + rect.h);
  });

  it('작은 그림은 1.5배까지만 키운다', () => {
    const rect = { x: 100, y: 100, w: 140, h: 60 };
    const v = fitViewport(rect, SIZE);
    expect(v.zoom).toBe(FIT_MAX_ZOOM);
    expect(worldToScreen(v, { x: 170, y: 130 })).toEqual({ x: 500, y: 300 });
  });

  it('아주 큰 그림은 MIN_ZOOM 아래로 내려가지 않는다', () => {
    const v = fitViewport({ x: 0, y: 0, w: 1e6, h: 1e6 }, SIZE);
    expect(v.zoom).toBe(MIN_ZOOM);
  });

  it('크기가 0인 rect도 처리한다', () => {
    const v = fitViewport({ x: 40, y: 50, w: 0, h: 0 }, SIZE);
    expect(v.zoom).toBe(FIT_MAX_ZOOM);
    expect(worldToScreen(v, { x: 40, y: 50 })).toEqual({ x: 500, y: 300 });
  });

  it('캔버스 크기를 모르면 배율 1', () => {
    const v = fitViewport({ x: 0, y: 0, w: 5000, h: 5000 }, { w: 0, h: 0 });
    expect(v.zoom).toBe(1);
    expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
  });
});

describe('fitRect', () => {
  it('배율을 제한하지 않는다(미니맵용)', () => {
    const v = fitRect({ x: 0, y: 0, w: 10000, h: 1000 }, { w: 200, h: 140 }, 8);
    expect(v.zoom).toBeCloseTo(184 / 10000, 10);
    expect(worldToScreen(v, { x: 5000, y: 500 })).toEqual({ x: 100, y: 70 });
  });
});

describe('unionRect', () => {
  it('두 사각형을 감싼다', () => {
    expect(unionRect({ x: 0, y: 0, w: 10, h: 10 }, { x: -5, y: 5, w: 30, h: 2 })).toEqual({ x: -5, y: 0, w: 30, h: 10 });
  });
});

describe('휠', () => {
  it('deltaMode를 px로 보정한다', () => {
    expect(wheelDeltaPx(12, 0, 600)).toBe(12);
    expect(wheelDeltaPx(3, 1, 600)).toBe(48);
    expect(wheelDeltaPx(1, 2, 600)).toBe(600);
  });

  it('위로 굴리면 확대, 아래로 굴리면 축소', () => {
    expect(wheelZoomFactor(-10)).toBeCloseTo(Math.exp(0.1), 10);
    expect(wheelZoomFactor(10)).toBeCloseTo(Math.exp(-0.1), 10);
    expect(wheelZoomFactor(0)).toBe(1);
  });

  it('마우스 휠 한 칸처럼 큰 값은 제한한다', () => {
    expect(wheelZoomFactor(-120)).toBe(wheelZoomFactor(-25));
    expect(wheelZoomFactor(120)).toBe(wheelZoomFactor(25));
    expect(wheelZoomFactor(-120)).toBeLessThan(1.3);
  });

  it('일반 휠은 반대 방향으로 화면을 민다', () => {
    expect(wheelPan(10, 30, false)).toEqual({ x: -10, y: -30 });
  });

  it('Shift+휠은 가로 이동', () => {
    expect(wheelPan(0, 30, true)).toEqual({ x: -30, y: 0 });
    // 이미 가로 값으로 온 경우(macOS)는 그대로
    expect(wheelPan(30, 0, true)).toEqual({ x: -30, y: -0 });
  });
});

describe('gridLayout', () => {
  it('어느 배율에서도 화면 간격이 16~40px이고 GRID_SIZE의 배수다', () => {
    for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom *= 1.07) {
      const g = gridLayout({ x: 0, y: 0, zoom });
      expect(g.step).toBeGreaterThanOrEqual(16);
      expect(g.step).toBeLessThanOrEqual(40);
      expect(g.worldStep % GRID_SIZE).toBe(0);
      expect(g.step).toBeCloseTo(g.worldStep * zoom, 10);
    }
    expect(gridLayout({ x: 0, y: 0, zoom: MAX_ZOOM }).step).toBeLessThanOrEqual(40);
  });

  it('배율이 낮아지면 2배, 5배, 10배 순으로 넓어진다', () => {
    expect(gridLayout({ x: 0, y: 0, zoom: 2 }).worldStep).toBe(GRID_SIZE);
    expect(gridLayout({ x: 0, y: 0, zoom: 1 }).worldStep).toBe(GRID_SIZE * 2);
    expect(gridLayout({ x: 0, y: 0, zoom: 0.5 }).worldStep).toBe(GRID_SIZE * 5);
    expect(gridLayout({ x: 0, y: 0, zoom: 0.25 }).worldStep).toBe(GRID_SIZE * 10);
    expect(gridLayout({ x: 0, y: 0, zoom: 0.1 }).worldStep).toBe(GRID_SIZE * 20);
  });

  it('점은 월드 좌표가 간격의 배수인 자리에 찍힌다', () => {
    const v: Viewport = { x: -137.5, y: 912.25, zoom: 0.7 };
    const g = gridLayout(v);
    expect(g.offsetX).toBeGreaterThanOrEqual(0);
    expect(g.offsetX).toBeLessThan(g.step);
    expect(g.offsetY).toBeGreaterThanOrEqual(0);
    expect(g.offsetY).toBeLessThan(g.step);
    const world = screenToWorld(v, { x: g.offsetX, y: g.offsetY });
    expect(world.x / g.worldStep).toBeCloseTo(Math.round(world.x / g.worldStep), 8);
    expect(world.y / g.worldStep).toBeCloseTo(Math.round(world.y / g.worldStep), 8);
  });
});
