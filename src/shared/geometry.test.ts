import { describe, expect, it } from 'vitest';
import {
  LABEL_OFFSET,
  SIBLING_SPREAD,
  boundaryPoint,
  computeEdgeGeometry,
  diagramBounds,
  distanceToEdge,
  distanceToSegment,
  edgeInRect,
  edgePointAt,
  nodeCenter,
  pointInNode,
  segmentIntersectsRect,
  siblingInfo,
} from './geometry';
import type { EdgeGeometry } from './geometry';
import { STYLE } from './types';
import type { ErdEdge, ErdNode, NodeKind, Point } from './types';

function node(id: string, kind: NodeKind, x: number, y: number, w: number, h: number, extra: Partial<ErdNode> = {}): ErdNode {
  return { id, kind, x, y, w, h, text: '', ...extra };
}
function edge(id: string, source: string, target: string, extra: Partial<ErdEdge> = {}): ErdEdge {
  return { id, source, target, double: false, label: '', role: '', ...extra };
}
/** path d 문자열에서 좌표를 순서대로 뽑는다 */
function coords(d: string): Point[] {
  const nums = (d.match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(Number);
  const pts: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}
function expectPoint(p: Point, x: number, y: number, digits = 6) {
  expect(p.x).toBeCloseTo(x, digits);
  expect(p.y).toBeCloseTo(y, digits);
}
function allFinite(g: EdgeGeometry): boolean {
  const pts = [g.start, g.end, g.mid, g.labelPos, g.rolePos, ...(g.control ? [g.control] : [])];
  const numbersOk = pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const pathsOk = [g.hitPath, ...g.paths].every((d) => !/NaN|Infinity|undefined/.test(d));
  return numbersOk && pathsOk;
}

describe('boundaryPoint', () => {
  it('직사각형: 가로, 세로, 대각선 방향', () => {
    const n = node('e', 'entity', 0, 0, 100, 60);
    expectPoint(boundaryPoint(n, { x: 500, y: 30 }), 100, 30);
    expectPoint(boundaryPoint(n, { x: -500, y: 30 }), 0, 30);
    expectPoint(boundaryPoint(n, { x: 50, y: -400 }), 50, 0);
    expectPoint(boundaryPoint(n, { x: 50, y: 400 }), 50, 60);
    // 기울기 1인 방향은 위아래 변에 먼저 닿는다
    expectPoint(boundaryPoint(n, { x: 150, y: 130 }), 80, 60);
    // 모서리 방향
    expectPoint(boundaryPoint(n, { x: 100, y: 60 }), 100, 60);
  });

  it('note도 직사각형으로 계산한다', () => {
    const n = node('n', 'note', 10, 10, 160, 50);
    expectPoint(boundaryPoint(n, { x: 1000, y: 35 }), 170, 35);
  });

  it('마름모: 꼭짓점과 변', () => {
    const n = node('r', 'relationship', 0, 0, 140, 80);
    expectPoint(boundaryPoint(n, { x: 999, y: 40 }), 140, 40);
    expectPoint(boundaryPoint(n, { x: 70, y: -999 }), 70, 0);
    // 중심에서 (1, 1) 방향: |x|/70 + |y|/40 = 1
    const p = boundaryPoint(n, { x: 170, y: 140 });
    expect(Math.abs(p.x - 70) / 70 + Math.abs(p.y - 40) / 40).toBeCloseTo(1, 9);
    expect(p.x - 70).toBeCloseTo(p.y - 40, 9);
  });

  it('타원: 축 방향과 임의 방향', () => {
    const n = node('a', 'attribute', 0, 0, 120, 50);
    expectPoint(boundaryPoint(n, { x: 999, y: 25 }), 120, 25);
    expectPoint(boundaryPoint(n, { x: 60, y: 999 }), 60, 50);
    const p = boundaryPoint(n, { x: 160, y: 85 });
    expect(((p.x - 60) / 60) ** 2 + ((p.y - 25) / 25) ** 2).toBeCloseTo(1, 9);
    // 중심에서 toward로 가는 반직선 위에 있다
    expect((p.x - 60) * 60 - (p.y - 25) * 100).toBeCloseTo(0, 6);
  });

  it('spec: 원', () => {
    const n = node('s', 'spec', 0, 0, 34, 34);
    const p = boundaryPoint(n, { x: 117, y: 117 });
    expect(Math.hypot(p.x - 17, p.y - 17)).toBeCloseTo(17, 9);
    expectPoint(boundaryPoint(n, { x: 17, y: -50 }), 17, 0);
  });

  it('이중 도형은 바깥 도형(노드 사각형)을 외곽선으로 쓴다', () => {
    expectPoint(boundaryPoint(node('w', 'entity', 0, 0, 150, 66, { weak: true }), { x: 900, y: 33 }), 150, 33);
    expectPoint(boundaryPoint(node('i', 'relationship', 0, 0, 156, 92, { identifying: true }), { x: 900, y: 46 }), 156, 46);
    expectPoint(boundaryPoint(node('m', 'attribute', 0, 0, 130, 56, { multivalued: true }), { x: 900, y: 28 }), 130, 28);
  });

  it('toward가 도형 안에 있어도 외곽선 위의 점을 준다', () => {
    const n = node('e', 'entity', 0, 0, 100, 60);
    expectPoint(boundaryPoint(n, { x: 55, y: 30 }), 100, 30);
  });

  it('toward가 중심이면 중심을 돌려준다', () => {
    for (const kind of ['entity', 'relationship', 'attribute', 'spec', 'note'] as NodeKind[]) {
      const n = node('x', kind, 10, 20, 80, 40);
      expect(boundaryPoint(n, nodeCenter(n))).toEqual({ x: 50, y: 40 });
    }
  });

  it('크기가 0인 노드에서도 NaN이 나오지 않는다', () => {
    const p = boundaryPoint(node('z', 'attribute', 5, 5, 0, 0), { x: 100, y: 100 });
    expect(p).toEqual({ x: 5, y: 5 });
  });
});

describe('pointInNode', () => {
  it('직사각형은 모서리까지 포함한다', () => {
    const n = node('e', 'entity', 0, 0, 100, 60);
    expect(pointInNode(n, { x: 1, y: 1 })).toBe(true);
    expect(pointInNode(n, { x: 100, y: 60 })).toBe(true);
    expect(pointInNode(n, { x: 101, y: 30 })).toBe(false);
  });
  it('마름모는 사각형 모서리 근처를 제외한다', () => {
    const n = node('r', 'relationship', 0, 0, 140, 80);
    expect(pointInNode(n, { x: 70, y: 40 })).toBe(true);
    expect(pointInNode(n, { x: 70, y: 2 })).toBe(true);
    expect(pointInNode(n, { x: 5, y: 5 })).toBe(false);
    expect(pointInNode(n, { x: 135, y: 75 })).toBe(false);
  });
  it('타원은 사각형 모서리 근처를 제외한다', () => {
    const n = node('a', 'attribute', 0, 0, 120, 50);
    expect(pointInNode(n, { x: 60, y: 25 })).toBe(true);
    expect(pointInNode(n, { x: 118, y: 25 })).toBe(true);
    expect(pointInNode(n, { x: 3, y: 3 })).toBe(false);
  });
  it('spec은 원으로 판정한다', () => {
    const n = node('s', 'spec', 0, 0, 34, 34);
    expect(pointInNode(n, { x: 17, y: 17 })).toBe(true);
    expect(pointInNode(n, { x: 2, y: 2 })).toBe(false);
    expect(pointInNode(n, { x: 33, y: 17 })).toBe(true);
  });
});

describe('computeEdgeGeometry: 직선', () => {
  const e1 = node('a', 'entity', 0, 0, 100, 60);
  const r1 = node('b', 'relationship', 300, -10, 140, 80);

  it('두 중심을 잇는 선을 양쪽 외곽선에서 자른다', () => {
    const g = computeEdgeGeometry(edge('x', 'a', 'b'), e1, r1);
    expectPoint(g.start, 100, 30);
    expectPoint(g.end, 300, 30);
    expect(g.control).toBeNull();
    expect(g.paths).toEqual(['M 100 30 L 300 30']);
    expect(g.hitPath).toBe('M 100 30 L 300 30');
    expectPoint(g.mid, 200, 30);
  });

  it('가로선의 카디널리티는 위쪽, 역할 이름은 아래쪽', () => {
    const g = computeEdgeGeometry(edge('x', 'a', 'b'), e1, r1);
    expectPoint(g.labelPos, 200, 30 - LABEL_OFFSET);
    expectPoint(g.rolePos, 200, 30 + LABEL_OFFSET);
  });

  it('source와 target을 뒤집어도 글자 위치가 같다', () => {
    const g1 = computeEdgeGeometry(edge('x', 'a', 'b'), e1, r1);
    const g2 = computeEdgeGeometry(edge('x', 'b', 'a'), r1, e1);
    expectPoint(g2.labelPos, g1.labelPos.x, g1.labelPos.y);
    expectPoint(g2.rolePos, g1.rolePos.x, g1.rolePos.y);
  });

  it('세로선의 카디널리티는 왼쪽(위아래 어느 방향으로 그려도)', () => {
    const top = node('t', 'entity', 0, 0, 100, 60);
    const bottom = node('u', 'entity', 0, 200, 100, 60);
    const down = computeEdgeGeometry(edge('x', 't', 'u'), top, bottom);
    const up = computeEdgeGeometry(edge('x', 'u', 't'), bottom, top);
    expectPoint(down.labelPos, 50 - LABEL_OFFSET, 130);
    expectPoint(up.labelPos, 50 - LABEL_OFFSET, 130);
    expectPoint(down.rolePos, 50 + LABEL_OFFSET, 130);
  });

  it('비스듬한 선의 카디널리티는 선보다 위에 있다', () => {
    const p = node('p', 'entity', 0, 0, 100, 60);
    const q = node('q', 'attribute', 260, 180, 120, 50);
    for (const g of [computeEdgeGeometry(edge('x', 'p', 'q'), p, q), computeEdgeGeometry(edge('x', 'q', 'p'), q, p)]) {
      expect(g.labelPos.y).toBeLessThan(g.mid.y);
      expect(g.rolePos.y).toBeGreaterThan(g.mid.y);
      expect(Math.hypot(g.labelPos.x - g.mid.x, g.labelPos.y - g.mid.y)).toBeCloseTo(LABEL_OFFSET, 6);
    }
  });

  it('이중선: 중심선에서 doubleGap/2씩 떨어진 평행선 2개', () => {
    const g = computeEdgeGeometry(edge('x', 'a', 'b', { double: true }), e1, r1);
    expect(g.paths).toHaveLength(2);
    expect(g.hitPath).toBe('M 100 30 L 300 30');
    const [l1, l2] = g.paths.map(coords);
    const half = STYLE.doubleGap / 2;
    expect(l1[0].y).toBeCloseTo(l1[1].y, 6);
    expect(l2[0].y).toBeCloseTo(l2[1].y, 6);
    expect(Math.abs(l1[0].y - l2[0].y)).toBeCloseTo(STYLE.doubleGap, 6);
    expect(Math.abs(l1[0].y - 30)).toBeCloseTo(half, 6);
    expect(Math.abs(l2[0].y - 30)).toBeCloseTo(half, 6);
    // 직사각형 쪽 끝은 변 위에, 마름모 쪽 끝은 꼭짓점에서 물러난 변 위에 닿는다
    for (const l of [l1, l2]) {
      expect(l[0].x).toBeCloseTo(100, 6);
      expect(l[1].x).toBeCloseTo(300 + half * (70 / 40), 1);
      expect(Math.abs(l[1].x - 370) / 70 + Math.abs(l[1].y - 30) / 40).toBeCloseTo(1, 2);
    }
  });

  it('비스듬한 이중선도 간격이 doubleGap이다', () => {
    const p = node('p', 'entity', 0, 0, 100, 60);
    const q = node('q', 'attribute', 260, 180, 120, 50);
    const g = computeEdgeGeometry(edge('x', 'p', 'q', { double: true }), p, q);
    const [l1, l2] = g.paths.map(coords);
    const dir = { x: l1[1].x - l1[0].x, y: l1[1].y - l1[0].y };
    const len = Math.hypot(dir.x, dir.y);
    // 두 번째 선의 양 끝에서 첫 번째 선까지의 수직 거리
    for (const pt of l2) {
      const dist = Math.abs((pt.x - l1[0].x) * dir.y - (pt.y - l1[0].y) * dir.x) / len;
      expect(dist).toBeCloseTo(STYLE.doubleGap, 1);
    }
    // 타원 쪽 끝은 타원 위에 있다
    for (const l of [l1, l2]) {
      expect(((l[1].x - 320) / 60) ** 2 + ((l[1].y - 205) / 25) ** 2).toBeCloseTo(1, 1);
    }
  });

  it('이중선이면 글자를 조금 더 띄운다', () => {
    const g = computeEdgeGeometry(edge('x', 'a', 'b', { double: true }), e1, r1);
    expectPoint(g.labelPos, 200, 30 - LABEL_OFFSET - STYLE.doubleGap / 2);
  });
});

describe('computeEdgeGeometry: 형제 선', () => {
  const ent = node('a', 'entity', 0, 0, 100, 60);
  const rel = node('b', 'relationship', 300, -10, 140, 80);

  it('두 선이 서로 반대편으로 벌어진다', () => {
    const g0 = computeEdgeGeometry(edge('e0', 'a', 'b'), ent, rel, 0, 2);
    const g1 = computeEdgeGeometry(edge('e1', 'a', 'b'), ent, rel, 1, 2);
    // 두 중심의 중점은 (210, 30), 제어점은 수직 방향으로 ±20
    expectPoint(g0.control!, 210, 30 - SIBLING_SPREAD / 2);
    expectPoint(g1.control!, 210, 30 + SIBLING_SPREAD / 2);
    expect(g0.mid.y).toBeLessThan(30);
    expect(g1.mid.y).toBeGreaterThan(30);
    expect(g0.hitPath.includes('Q')).toBe(true);
    expect(g0.paths).toEqual([g0.hitPath]);
  });

  it('start와 end는 제어점 방향으로 외곽선에서 자른다', () => {
    const g = computeEdgeGeometry(edge('e0', 'a', 'b'), ent, rel, 0, 2);
    const s = boundaryPoint(ent, g.control!);
    const t = boundaryPoint(rel, g.control!);
    expectPoint(g.start, s.x, s.y);
    expectPoint(g.end, t.x, t.y);
    const m = edgePointAt(g, 0.5);
    expectPoint(g.mid, m.x, m.y);
  });

  it('source와 target이 뒤집혀 저장된 형제도 반대편으로 벌어진다', () => {
    const g0 = computeEdgeGeometry(edge('e0', 'a', 'b'), ent, rel, 0, 2);
    const g1 = computeEdgeGeometry(edge('e1', 'b', 'a'), rel, ent, 1, 2);
    expectPoint(g0.control!, 210, 10);
    expectPoint(g1.control!, 210, 50);
    // 뒤집힌 엣지는 같은 순번일 때 같은 제어점을 쓴다
    const g0r = computeEdgeGeometry(edge('e0', 'b', 'a'), rel, ent, 0, 2);
    expectPoint(g0r.control!, g0.control!.x, g0.control!.y);
  });

  it('세 개면 가운데 선은 직선이다', () => {
    const g = [0, 1, 2].map((i) => computeEdgeGeometry(edge(`e${i}`, 'a', 'b'), ent, rel, i, 3));
    expect(g[1].control).toBeNull();
    expectPoint(g[0].control!, 210, 30 - SIBLING_SPREAD);
    expectPoint(g[2].control!, 210, 30 + SIBLING_SPREAD);
  });

  it('글자는 휘어 나간 바깥쪽에 놓여 형제 선과 겹치지 않는다', () => {
    const upper = computeEdgeGeometry(edge('e0', 'a', 'b'), ent, rel, 0, 2);
    const lower = computeEdgeGeometry(edge('e1', 'a', 'b'), ent, rel, 1, 2);
    expect(upper.labelPos.y).toBeLessThan(upper.mid.y);
    expect(upper.rolePos.y).toBeLessThan(upper.labelPos.y);
    expect(lower.labelPos.y).toBeGreaterThan(lower.mid.y);
    expect(lower.rolePos.y).toBeGreaterThan(lower.labelPos.y);
    expect(distanceToEdge(lower, upper.labelPos)).toBeGreaterThan(LABEL_OFFSET);
    expect(distanceToEdge(upper, lower.rolePos)).toBeGreaterThan(LABEL_OFFSET);
  });

  it('휜 이중선도 두 줄 간격이 doubleGap에 가깝다', () => {
    const g = computeEdgeGeometry(edge('e0', 'a', 'b', { double: true }), ent, rel, 0, 2);
    expect(g.paths).toHaveLength(2);
    const curves = g.paths.map(coords);
    const at = (c: Point[], t: number): Point => ({
      x: (1 - t) ** 2 * c[0].x + 2 * (1 - t) * t * c[1].x + t * t * c[2].x,
      y: (1 - t) ** 2 * c[0].y + 2 * (1 - t) * t * c[1].y + t * t * c[2].y,
    });
    // 한 줄 위의 점에서 다른 줄(촘촘히 샘플링)까지의 최단 거리
    const other: Point[] = [];
    for (let i = 0; i <= 400; i++) other.push(at(curves[1], i / 400));
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const p = at(curves[0], t);
      const d = Math.min(...other.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
      expect(Math.abs(d - STYLE.doubleGap)).toBeLessThan(0.3);
    }
    // 가운데 점은 중심선에서 doubleGap/2
    for (const c of curves) {
      const m = at(c, 0.5);
      expect(Math.abs(Math.hypot(m.x - g.mid.x, m.y - g.mid.y) - STYLE.doubleGap / 2)).toBeLessThan(0.3);
    }
  });
});

describe('computeEdgeGeometry: 퇴화 사례', () => {
  it('두 노드가 완전히 겹쳐도 NaN이 없다', () => {
    const a = node('a', 'entity', 0, 0, 100, 60);
    const b = node('b', 'relationship', -20, -10, 140, 80);
    for (const double of [false, true]) {
      for (const [i, c] of [[0, 1], [0, 2], [1, 2], [1, 3]] as const) {
        const g = computeEdgeGeometry(edge('x', 'a', 'b', { double }), a, b, i, c);
        expect(allFinite(g)).toBe(true);
        expect(g.paths).toHaveLength(double ? 2 : 1);
      }
    }
  });

  it('같은 노드끼리 이은 선도 NaN이 없다', () => {
    const a = node('a', 'attribute', 0, 0, 120, 50);
    for (const double of [false, true]) {
      expect(allFinite(computeEdgeGeometry(edge('x', 'a', 'a', { double }), a, a))).toBe(true);
      expect(allFinite(computeEdgeGeometry(edge('x', 'a', 'a', { double }), a, a, 1, 2))).toBe(true);
    }
  });

  it('크기가 0인 노드와 일부만 겹친 노드에서도 NaN이 없다', () => {
    const zero = node('z', 'spec', 50, 50, 0, 0);
    const a = node('a', 'entity', 0, 0, 100, 60);
    const near = node('n', 'attribute', 60, 20, 120, 50);
    for (const double of [false, true]) {
      expect(allFinite(computeEdgeGeometry(edge('x', 'a', 'z', { double }), a, zero))).toBe(true);
      expect(allFinite(computeEdgeGeometry(edge('x', 'z', 'a', { double }), zero, a, 0, 2))).toBe(true);
      expect(allFinite(computeEdgeGeometry(edge('x', 'a', 'n', { double }), a, near))).toBe(true);
      expect(allFinite(computeEdgeGeometry(edge('x', 'a', 'n', { double }), a, near, 1, 2))).toBe(true);
    }
  });

  it('siblingCount가 0이나 1이면 직선이다', () => {
    const a = node('a', 'entity', 0, 0, 100, 60);
    const b = node('b', 'entity', 300, 0, 100, 60);
    expect(computeEdgeGeometry(edge('x', 'a', 'b'), a, b, 0, 0).control).toBeNull();
    expect(computeEdgeGeometry(edge('x', 'a', 'b'), a, b, 0, 1).control).toBeNull();
  });
});

describe('siblingInfo', () => {
  it('순서 없는 노드 쌍으로 묶고 edge id 순으로 번호를 매긴다', () => {
    const info = siblingInfo([
      edge('e3', 'b', 'a'),
      edge('e1', 'a', 'b'),
      edge('e2', 'a', 'c'),
      edge('e0', 'a', 'b'),
    ]);
    expect(info.get('e0')).toEqual({ index: 0, count: 3 });
    expect(info.get('e1')).toEqual({ index: 1, count: 3 });
    expect(info.get('e3')).toEqual({ index: 2, count: 3 });
    expect(info.get('e2')).toEqual({ index: 0, count: 1 });
    expect(info.size).toBe(4);
  });
  it('입력 순서가 달라도 결과가 같다', () => {
    const list = [edge('k2', 'x', 'y'), edge('k1', 'y', 'x')];
    expect(siblingInfo(list)).toEqual(siblingInfo([...list].reverse()));
  });
  it('빈 목록', () => {
    expect(siblingInfo([]).size).toBe(0);
  });
});

describe('distanceToEdge', () => {
  const a = node('a', 'entity', 0, 0, 100, 60);
  const b = node('b', 'entity', 300, 0, 100, 60);

  it('직선: 선분까지의 거리', () => {
    const g = computeEdgeGeometry(edge('x', 'a', 'b'), a, b);
    expect(distanceToEdge(g, { x: 200, y: 30 })).toBeCloseTo(0, 9);
    expect(distanceToEdge(g, { x: 200, y: 42 })).toBeCloseTo(12, 9);
    // 선분 끝을 지나면 끝점까지의 거리
    expect(distanceToEdge(g, { x: 60, y: 0 })).toBeCloseTo(50, 9);
  });

  it('곡선: 곡선 위의 점은 0에 가깝고 직선 위치에서는 떨어져 있다', () => {
    const g = computeEdgeGeometry(edge('x', 'a', 'b'), a, b, 0, 2);
    expect(distanceToEdge(g, g.mid)).toBeLessThan(0.05);
    expect(distanceToEdge(g, edgePointAt(g, 0.37))).toBeLessThan(0.05);
    expect(distanceToEdge(g, { x: 200, y: 30 })).toBeGreaterThan(5);
  });

  it('길이가 0인 선에서도 유한한 값을 준다', () => {
    const g = computeEdgeGeometry(edge('x', 'a', 'a'), a, a);
    expect(Number.isFinite(distanceToEdge(g, { x: 500, y: 500 }))).toBe(true);
  });
});

describe('보조 함수', () => {
  it('distanceToSegment', () => {
    expect(distanceToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distanceToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });

  it('segmentIntersectsRect', () => {
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect(segmentIntersectsRect({ x: -5, y: 5 }, { x: 15, y: 5 }, r)).toBe(true);
    expect(segmentIntersectsRect({ x: 2, y: 2 }, { x: 4, y: 4 }, r)).toBe(true);
    expect(segmentIntersectsRect({ x: -5, y: -5 }, { x: -1, y: 20 }, r)).toBe(false);
    expect(segmentIntersectsRect({ x: -5, y: 8 }, { x: 8, y: -5 }, r)).toBe(true);
    expect(segmentIntersectsRect({ x: -5, y: 2 }, { x: 2, y: -5 }, r)).toBe(false);
    expect(segmentIntersectsRect({ x: 20, y: 0 }, { x: 20, y: 10 }, r)).toBe(false);
  });

  it('edgeInRect: 선이 지나가는 상자만 참', () => {
    const a = node('a', 'entity', 0, 0, 100, 60);
    const b = node('b', 'entity', 300, 0, 100, 60);
    const straight = computeEdgeGeometry(edge('x', 'a', 'b'), a, b);
    expect(edgeInRect(straight, { x: 180, y: 20, w: 40, h: 20 })).toBe(true);
    expect(edgeInRect(straight, { x: 180, y: 40, w: 40, h: 20 })).toBe(false);
    const curved = computeEdgeGeometry(edge('x', 'a', 'b'), a, b, 0, 2);
    expect(edgeInRect(curved, { x: 190, y: curved.mid.y - 2, w: 20, h: 4 })).toBe(true);
    expect(edgeInRect(curved, { x: 190, y: 29, w: 20, h: 2 })).toBe(false);
  });

  it('diagramBounds는 여백을 더한다', () => {
    const nodes = [node('a', 'entity', 0, 0, 100, 60), node('b', 'entity', 300, 100, 100, 60)];
    expect(diagramBounds(nodes, 10)).toEqual({ x: -10, y: -10, w: 420, h: 180 });
    expect(diagramBounds([])).toBeNull();
  });
});
