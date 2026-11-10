// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useUi } from '../state/ui';
import { GUIDE_COLOR, GuidesLayer } from './snap';

describe('GuidesLayer', () => {
  afterEach(() => {
    cleanup();
    useUi.getState().setGuides([]);
  });

  const mount = () =>
    render(
      <svg>
        <GuidesLayer />
      </svg>,
    ).container.querySelector('svg')!;

  it('guides가 비면 아무것도 그리지 않는다', () => {
    expect(mount().childNodes).toHaveLength(0);
  });

  it('월드 좌표 선을 배율과 무관한 1px로 그린다', () => {
    useUi.getState().setGuides([
      { orientation: 'v', pos: 100, from: -8, to: 338 },
      { orientation: 'h', pos: 300, from: 92, to: 588 },
    ]);
    const g = mount().querySelector('g')!;
    expect(g.getAttribute('pointer-events')).toBe('none');
    expect(g.getAttribute('stroke')).toBe(GUIDE_COLOR);
    expect(g.getAttribute('stroke-width')).toBe('1');
    const attrs = [...g.querySelectorAll('line')].map((l) =>
      ['x1', 'y1', 'x2', 'y2', 'vector-effect'].map((a) => l.getAttribute(a)),
    );
    expect(attrs).toEqual([
      ['100', '-8', '100', '338', 'non-scaling-stroke'],
      ['92', '300', '588', '300', 'non-scaling-stroke'],
    ]);
  });

  it('store가 바뀌면 다시 그리고, 비워지면 사라진다', () => {
    const svg = mount();
    act(() => useUi.getState().setGuides([{ orientation: 'v', pos: 5, from: 0, to: 10 }]));
    expect(svg.querySelectorAll('line')).toHaveLength(1);
    act(() => useUi.getState().setGuides([]));
    expect(svg.childNodes).toHaveLength(0);
  });
});
