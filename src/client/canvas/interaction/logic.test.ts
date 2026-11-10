import { describe, expect, it } from 'vitest';
import { MIN_NODE_SIZE, type ErdEdge, type ErdNode } from '../../../shared/types';
import {
  connectDotPoints,
  exceedsThreshold,
  handlePoint,
  inExpandedRect,
  marqueeSelection,
  nextCardinality,
  rectFromPoints,
  resizeRect,
  roundRect,
  topNodeAt,
} from './logic';

function node(id: string, x: number, y: number, w = 100, h = 50, kind: ErdNode['kind'] = 'entity'): ErdNode {
  return { id, kind, x, y, w, h, text: id };
}
function edge(id: string, source: string, target: string): ErdEdge {
  return { id, source, target, double: false, label: '', role: '' };
}

describe('exceedsThreshold', () => {
  it('3px 미만은 드래그로 보지 않는다', () => {
    expect(exceedsThreshold(0, 0, 2, 2)).toBe(false);
    expect(exceedsThreshold(0, 0, 3, 0)).toBe(true);
    expect(exceedsThreshold(10, 10, 8, 8)).toBe(false);
    expect(exceedsThreshold(10, 10, 7, 7)).toBe(true);
  });
});

describe('rectFromPoints', () => {
  it('어느 방향으로 끌어도 w, h가 양수인 사각형이 된다', () => {
    expect(rectFromPoints({ x: 10, y: 20 }, { x: 4, y: 50 })).toEqual({ x: 4, y: 20, w: 6, h: 30 });
    expect(rectFromPoints({ x: 0, y: 0 }, { x: -5, y: -7 })).toEqual({ x: -5, y: -7, w: 5, h: 7 });
  });
});

describe('marqueeSelection', () => {
  const nodes = [node('a', 0, 0), node('b', 200, 0), node('c', 400, 0)];
  const edges = [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('ac', 'a', 'c')];

  it('사각형과 겹치는 노드만 고른다', () => {
    expect(marqueeSelection({ x: -10, y: -10, w: 50, h: 30 }, nodes, [])).toEqual(['a']);
    expect(marqueeSelection({ x: 1000, y: 0, w: 10, h: 10 }, nodes, [])).toEqual([]);
  });

  it('살짝만 걸쳐도 선택되고, 맞닿기만 한 것은 선택되지 않는다', () => {
    expect(marqueeSelection({ x: 99, y: 49, w: 50, h: 50 }, nodes, [])).toEqual(['a']);
    expect(marqueeSelection({ x: 100, y: 0, w: 100, h: 50 }, nodes, [])).toEqual([]);
  });

  it('양 끝이 모두 선택된 엣지만 함께 고른다', () => {
    const ids = marqueeSelection({ x: 0, y: 0, w: 250, h: 50 }, nodes, edges);
    expect(ids).toEqual(['a', 'b', 'ab']);
  });

  it('기존 선택(base)을 유지하고, base의 노드도 엣지 판정에 포함한다', () => {
    const ids = marqueeSelection({ x: 390, y: 0, w: 50, h: 50 }, nodes, edges, ['a', 'bc']);
    expect(ids).toEqual(['a', 'bc', 'c', 'ac']);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('resizeRect', () => {
  const orig = { x: 100, y: 100, w: 200, h: 100 };

  it('오른쪽 아래 모서리를 끌면 왼쪽 위는 그대로다', () => {
    expect(resizeRect(orig, 'se', 30, 20)).toEqual({ x: 100, y: 100, w: 230, h: 120 });
  });

  it('왼쪽 위 모서리를 끌면 오른쪽 아래가 그대로다', () => {
    const r = resizeRect(orig, 'nw', 30, -20);
    expect(r).toEqual({ x: 130, y: 80, w: 170, h: 120 });
    expect(r.x + r.w).toBe(300);
    expect(r.y + r.h).toBe(200);
  });

  it('변 손잡이는 한 방향으로만 바뀐다', () => {
    expect(resizeRect(orig, 'e', 50, 999)).toEqual({ x: 100, y: 100, w: 250, h: 100 });
    expect(resizeRect(orig, 'n', 999, -40)).toEqual({ x: 100, y: 60, w: 200, h: 140 });
    expect(resizeRect(orig, 'w', -10, 5)).toEqual({ x: 90, y: 100, w: 210, h: 100 });
    expect(resizeRect(orig, 's', 5, 10)).toEqual({ x: 100, y: 100, w: 200, h: 110 });
  });

  it('최소 크기 아래로 줄지 않고 반대쪽 변이 밀리지 않는다', () => {
    const a = resizeRect(orig, 'se', -1000, -1000);
    expect(a).toEqual({ x: 100, y: 100, w: MIN_NODE_SIZE.w, h: MIN_NODE_SIZE.h });
    const b = resizeRect(orig, 'nw', 1000, 1000);
    expect(b.w).toBe(MIN_NODE_SIZE.w);
    expect(b.h).toBe(MIN_NODE_SIZE.h);
    expect(b.x + b.w).toBe(300);
    expect(b.y + b.h).toBe(200);
  });

  it('최소 크기를 직접 줄 수 있다', () => {
    expect(resizeRect(orig, 'e', -1000, 0, { w: 10, h: 10 }).w).toBe(10);
  });
});

describe('roundRect', () => {
  it('좌표와 크기를 정수로 맞춘다', () => {
    const r = roundRect({ x: 10.4, y: 20.6, w: 100.3, h: 50.2 });
    expect(r).toEqual({ x: 10, y: 21, w: 101, h: 50 });
    for (const v of Object.values(r)) expect(Number.isInteger(v)).toBe(true);
  });
});

describe('handlePoint', () => {
  it('손잡이 위치를 돌려준다', () => {
    const r = { x: 0, y: 0, w: 100, h: 60 };
    expect(handlePoint(r, 'nw')).toEqual({ x: 0, y: 0 });
    expect(handlePoint(r, 'se')).toEqual({ x: 100, y: 60 });
    expect(handlePoint(r, 'n')).toEqual({ x: 50, y: 0 });
    expect(handlePoint(r, 'w')).toEqual({ x: 0, y: 30 });
  });
});

describe('connectDotPoints', () => {
  it('상하좌우 바깥에 하나씩 놓는다', () => {
    const pts = connectDotPoints({ x: 0, y: 0, w: 100, h: 60 }, 10);
    expect(pts).toEqual([
      { side: 'top', x: 50, y: -10 },
      { side: 'right', x: 110, y: 30 },
      { side: 'bottom', x: 50, y: 70 },
      { side: 'left', x: -10, y: 30 },
    ]);
  });
});

describe('inExpandedRect', () => {
  it('여유만큼 넓힌 범위로 판정한다', () => {
    const r = { x: 0, y: 0, w: 100, h: 60 };
    expect(inExpandedRect(r, { x: -15, y: 30 }, 20)).toBe(true);
    expect(inExpandedRect(r, { x: -25, y: 30 }, 20)).toBe(false);
    expect(inExpandedRect(r, { x: 50, y: 80 }, 20)).toBe(true);
  });
});

describe('topNodeAt', () => {
  const nodes = [node('below', 0, 0, 100, 100), node('above', 50, 50, 100, 100)];

  it('겹친 곳에서는 뒤에 그려진(위에 있는) 노드를 고른다', () => {
    expect(topNodeAt(nodes, { x: 75, y: 75 })?.id).toBe('above');
    expect(topNodeAt(nodes, { x: 10, y: 10 })?.id).toBe('below');
    expect(topNodeAt(nodes, { x: 500, y: 500 })).toBeNull();
  });

  it('제외할 노드는 건너뛴다', () => {
    expect(topNodeAt(nodes, { x: 75, y: 75 }, 'above')?.id).toBe('below');
  });
});

describe('nextCardinality', () => {
  it("'' → 1 → M → N → '' 순으로 돈다", () => {
    expect(nextCardinality('')).toBe('1');
    expect(nextCardinality('1')).toBe('M');
    expect(nextCardinality('M')).toBe('N');
    expect(nextCardinality('N')).toBe('');
  });

  it('직접 입력한 글자는 비운다', () => {
    expect(nextCardinality('0..1')).toBe('');
  });
});
