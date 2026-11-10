import { describe, expect, it } from 'vitest';
import { MIN_NODE_SIZE, type ErdEdge, type ErdNode } from '../../../shared/types';
import {
  connectDotPoints,
  edgeSideProps,
  exceedsThreshold,
  handlePoint,
  inExpandedRect,
  marqueeSelection,
  isSide,
  nextCardinality,
  pickConnectTarget,
  rectFromPoints,
  resizeRect,
  resolveEndDrop,
  roundRect,
  shouldStoreSides,
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
  it('상하좌우 고정점 바깥에 하나씩 놓는다', () => {
    const pts = connectDotPoints(node('n', 0, 0, 100, 60), 10);
    expect(pts).toEqual([
      { side: 'top', x: 50, y: -10 },
      { side: 'right', x: 110, y: 30 },
      { side: 'bottom', x: 50, y: 70 },
      { side: 'left', x: -10, y: 30 },
    ]);
  });

  it('마름모는 꼭짓점 바로 바깥에 놓인다', () => {
    const pts = connectDotPoints(node('r', 100, 100, 140, 80, 'relationship'), 14);
    expect(pts.find((p) => p.side === 'top')).toEqual({ side: 'top', x: 170, y: 86 });
    expect(pts.find((p) => p.side === 'right')).toEqual({ side: 'right', x: 254, y: 140 });
    expect(pts.find((p) => p.side === 'left')).toEqual({ side: 'left', x: 86, y: 140 });
  });
});

describe('isSide', () => {
  it('네 면 이름만 통과시킨다', () => {
    expect(isSide('top')).toBe(true);
    expect(isSide('left')).toBe(true);
    expect(isSide('middle')).toBe(false);
    expect(isSide(null)).toBe(false);
  });
});

describe('면 저장 조건', () => {
  const e = node('e', 0, 0, 140, 60, 'entity');
  const r = node('r', 300, 0, 140, 80, 'relationship');
  const a = node('a', 0, 200, 120, 50, 'attribute');
  const sp = node('s', 300, 200, 34, 34, 'spec');
  const memo = node('m', 600, 0, 160, 50, 'note');

  it('엔티티와 관계, 엔티티와 특수화 원 사이의 선만 면을 저장한다(방향 무관)', () => {
    expect(shouldStoreSides(e, r)).toBe(true);
    expect(shouldStoreSides(r, e)).toBe(true);
    expect(shouldStoreSides(e, sp)).toBe(true);
    expect(shouldStoreSides(sp, e)).toBe(true);
  });

  it('속성이 낀 선과 그 밖의 조합은 저장하지 않는다', () => {
    expect(shouldStoreSides(e, a)).toBe(false);
    expect(shouldStoreSides(r, a)).toBe(false);
    expect(shouldStoreSides(a, a)).toBe(false);
    expect(shouldStoreSides(e, e)).toBe(false);
    expect(shouldStoreSides(r, sp)).toBe(false);
    expect(shouldStoreSides(e, memo)).toBe(false);
  });

  it('edgeSideProps는 정해진 면만 넣고 없는 쪽은 키 자체를 넣지 않는다', () => {
    expect(edgeSideProps(e, r, 'right', 'left')).toEqual({ sourceSide: 'right', targetSide: 'left' });
    expect(edgeSideProps(e, r, 'right', null)).toEqual({ sourceSide: 'right' });
    expect('targetSide' in edgeSideProps(e, r, 'right', null)).toBe(false);
    expect(edgeSideProps(e, r, null, 'top')).toEqual({ targetSide: 'top' });
    expect(edgeSideProps(e, r, undefined, undefined)).toEqual({});
  });

  it('저장 조건에 맞지 않으면 면이 주어져도 넣지 않는다', () => {
    expect(edgeSideProps(e, a, 'bottom', 'top')).toEqual({});
    expect(edgeSideProps(a, r, 'right', 'left')).toEqual({});
  });
});

describe('pickConnectTarget', () => {
  const e = node('e', 0, 0, 140, 60, 'entity');
  const r = node('r', 300, 0, 140, 80, 'relationship'); // 꼭짓점: 위 (370,0) 오른쪽 (440,40) 아래 (370,80) 왼쪽 (300,40)
  const nodes = [e, r];

  it('고정점에서 달라붙는 거리 안이면 그 면을 함께 돌려준다', () => {
    expect(pickConnectTarget(nodes, { x: 306, y: 42 }, 'e', 14)).toEqual({ node: r, side: 'left' });
    expect(pickConnectTarget(nodes, { x: 372, y: 10 }, 'e', 14)).toEqual({ node: r, side: 'top' });
  });

  it('몸통 위지만 고정점에서 멀면 면이 없다(자동)', () => {
    expect(pickConnectTarget(nodes, { x: 370, y: 40 }, 'e', 14)).toEqual({ node: r, side: null });
  });

  it('마름모 꼭짓점 바로 바깥(도형 밖)이어도 달라붙는 거리 안이면 대상으로 잡는다', () => {
    expect(pickConnectTarget(nodes, { x: 292, y: 40 }, 'e', 14)).toEqual({ node: r, side: 'left' });
    expect(pickConnectTarget(nodes, { x: 280, y: 40 }, 'e', 14)).toBeNull();
  });

  it('출발 도형은 건너뛰고, 아무것도 없으면 null', () => {
    expect(pickConnectTarget(nodes, { x: 70, y: 30 }, 'e', 14)).toBeNull();
    expect(pickConnectTarget(nodes, { x: 70, y: 30 }, 'r', 14)?.node).toBe(e);
    expect(pickConnectTarget(nodes, { x: 1000, y: 1000 }, undefined, 14)).toBeNull();
  });

  it('달라붙는 거리는 인자로 받은 월드 단위 그대로 쓴다(배율 반영은 호출하는 쪽)', () => {
    expect(pickConnectTarget(nodes, { x: 320, y: 40 }, 'e', 14)?.side).toBeNull();
    expect(pickConnectTarget(nodes, { x: 320, y: 40 }, 'e', 28)?.side).toBe('left');
  });
});

describe('resolveEndDrop', () => {
  const r = node('r', 300, 0, 140, 80, 'relationship');

  it('고정점 근처에 놓으면 그 면에 붙인다', () => {
    expect(resolveEndDrop(r, { x: 436, y: 44 }, 14)).toEqual({ kind: 'side', side: 'right' });
    expect(resolveEndDrop(r, { x: 370, y: 90 }, 14)).toEqual({ kind: 'side', side: 'bottom' });
  });

  it('고정점에서 먼 몸통 위에 놓으면 자동으로 되돌린다', () => {
    expect(resolveEndDrop(r, { x: 370, y: 40 }, 14)).toEqual({ kind: 'auto' });
  });

  it('도형 밖에 놓으면 아무것도 바꾸지 않는다', () => {
    expect(resolveEndDrop(r, { x: 600, y: 300 }, 14)).toEqual({ kind: 'none' });
    // 사각형 범위 안이라도 마름모 밖(모서리 쪽)이면 도형 밖이다
    expect(resolveEndDrop(r, { x: 305, y: 5 }, 14)).toEqual({ kind: 'none' });
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
