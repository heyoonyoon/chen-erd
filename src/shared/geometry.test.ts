import { describe, expect, it } from 'vitest';
import {
  ELBOW_STUB,
  LABEL_OFFSET,
  SIBLING_SPREAD,
  anchorPoint,
  boundaryPoint,
  computeEdgeGeometry,
  diagramBounds,
  distanceToEdge,
  distanceToSegment,
  edgeInRect,
  edgePointAt,
  edgePolyline,
  edgeShapeOf,
  nearestSide,
  nodeCenter,
  nodeRect,
  pointInNode,
  segmentIntersectsRect,
  siblingInfo,
} from './geometry';
import type { EdgeGeometry } from './geometry';
import { STYLE } from './types';
import type { ErdEdge, ErdNode, NodeKind, Point, Rect, Side } from './types';

function node(id: string, kind: NodeKind, x: number, y: number, w: number, h: number, extra: Partial<ErdNode> = {}): ErdNode {
  return { id, kind, x, y, w, h, text: '', ...extra };
}
function edge(id: string, source: string, target: string, extra: Partial<ErdEdge> = {}): ErdEdge {
  return { id, source, target, double: false, label: '', role: '', ...extra };
}
/** 직선 모양을 명시한 엣지(엔티티와 관계 사이는 자동이면 꺾은선이다) */
function line(id: string, source: string, target: string, extra: Partial<ErdEdge> = {}): ErdEdge {
  return edge(id, source, target, { shape: 'straight', ...extra });
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
  const pts = [g.start, g.end, g.mid, g.labelPos, g.rolePos, ...g.points, ...(g.control ? [g.control] : [])];
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
    const g = computeEdgeGeometry(line('x', 'a', 'b'), e1, r1);
    expectPoint(g.start, 100, 30);
    expectPoint(g.end, 300, 30);
    expect(g.control).toBeNull();
    expect(g.paths).toEqual(['M 100 30 L 300 30']);
    expect(g.hitPath).toBe('M 100 30 L 300 30');
    expectPoint(g.mid, 200, 30);
  });

  it('가로선의 카디널리티는 위쪽, 역할 이름은 아래쪽', () => {
    const g = computeEdgeGeometry(line('x', 'a', 'b'), e1, r1);
    expectPoint(g.labelPos, 200, 30 - LABEL_OFFSET);
    expectPoint(g.rolePos, 200, 30 + LABEL_OFFSET);
  });

  it('source와 target을 뒤집어도 글자 위치가 같다', () => {
    const g1 = computeEdgeGeometry(line('x', 'a', 'b'), e1, r1);
    const g2 = computeEdgeGeometry(line('x', 'b', 'a'), r1, e1);
    expectPoint(g2.labelPos, g1.labelPos.x, g1.labelPos.y);
    expectPoint(g2.rolePos, g1.rolePos.x, g1.rolePos.y);
  });

  it('세로선의 카디널리티는 오른쪽(위아래 어느 방향으로 그려도)', () => {
    const top = node('t', 'entity', 0, 0, 100, 60);
    const bottom = node('u', 'entity', 0, 200, 100, 60);
    const down = computeEdgeGeometry(line('x', 't', 'u'), top, bottom);
    const up = computeEdgeGeometry(line('x', 'u', 't'), bottom, top);
    expectPoint(down.labelPos, 50 + LABEL_OFFSET, 130);
    expectPoint(up.labelPos, 50 + LABEL_OFFSET, 130);
    expectPoint(down.rolePos, 50 - LABEL_OFFSET, 130);
  });

  it('직선은 points가 [start, end]이고 면은 null이다', () => {
    const g = computeEdgeGeometry(line('x', 'a', 'b'), e1, r1);
    expect(g.points).toEqual([g.start, g.end]);
    expect(g.sourceSide).toBeNull();
    expect(g.targetSide).toBeNull();
  });

  it('속성 선과 특수화 선은 자동으로 직선이다', () => {
    const attr = node('q', 'attribute', 260, 180, 120, 50);
    const spec = node('s', 'spec', 33, 200, 34, 34);
    const g = computeEdgeGeometry(edge('x', 'a', 'q'), e1, attr);
    expect(edgeShapeOf(edge('x', 'a', 'q'), e1, attr)).toBe('straight');
    expectPoint(g.start, boundaryPoint(e1, nodeCenter(attr)).x, boundaryPoint(e1, nodeCenter(attr)).y);
    expectPoint(g.end, boundaryPoint(attr, nodeCenter(e1)).x, boundaryPoint(attr, nodeCenter(e1)).y);
    expect(g.points).toHaveLength(2);
    expect(g.control).toBeNull();
    expect(edgeShapeOf(edge('x', 'a', 's'), e1, spec)).toBe('straight');
    // 속성 선이 겹치면 예전처럼 곡선으로 벌어진다
    const curved = computeEdgeGeometry(edge('x', 'a', 'q'), e1, attr, 0, 2);
    expect(curved.control).not.toBeNull();
    expect(curved.points).toEqual([curved.start, curved.end]);
  });

  it('비스듬한 선의 카디널리티는 선보다 위에 있다', () => {
    const p = node('p', 'entity', 0, 0, 100, 60);
    const q = node('q', 'attribute', 260, 180, 120, 50);
    for (const g of [computeEdgeGeometry(line('x', 'p', 'q'), p, q), computeEdgeGeometry(line('x', 'q', 'p'), q, p)]) {
      expect(g.labelPos.y).toBeLessThan(g.mid.y);
      expect(g.rolePos.y).toBeGreaterThan(g.mid.y);
      expect(Math.hypot(g.labelPos.x - g.mid.x, g.labelPos.y - g.mid.y)).toBeCloseTo(LABEL_OFFSET, 6);
    }
  });

  it('이중선: 중심선에서 doubleGap/2씩 떨어진 평행선 2개', () => {
    const g = computeEdgeGeometry(line('x', 'a', 'b', { double: true }), e1, r1);
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
    const g = computeEdgeGeometry(line('x', 'p', 'q', { double: true }), p, q);
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
    const g = computeEdgeGeometry(line('x', 'a', 'b', { double: true }), e1, r1);
    expectPoint(g.labelPos, 200, 30 - LABEL_OFFSET - STYLE.doubleGap / 2);
  });
});

describe('computeEdgeGeometry: 형제 선', () => {
  const ent = node('a', 'entity', 0, 0, 100, 60);
  const rel = node('b', 'relationship', 300, -10, 140, 80);

  it('두 선이 서로 반대편으로 벌어진다', () => {
    const g0 = computeEdgeGeometry(line('e0', 'a', 'b'), ent, rel, 0, 2);
    const g1 = computeEdgeGeometry(line('e1', 'a', 'b'), ent, rel, 1, 2);
    // 두 중심의 중점은 (210, 30), 제어점은 수직 방향으로 ±20
    expectPoint(g0.control!, 210, 30 - SIBLING_SPREAD / 2);
    expectPoint(g1.control!, 210, 30 + SIBLING_SPREAD / 2);
    expect(g0.mid.y).toBeLessThan(30);
    expect(g1.mid.y).toBeGreaterThan(30);
    expect(g0.hitPath.includes('Q')).toBe(true);
    expect(g0.paths).toEqual([g0.hitPath]);
  });

  it('start와 end는 제어점 방향으로 외곽선에서 자른다', () => {
    const g = computeEdgeGeometry(line('e0', 'a', 'b'), ent, rel, 0, 2);
    const s = boundaryPoint(ent, g.control!);
    const t = boundaryPoint(rel, g.control!);
    expectPoint(g.start, s.x, s.y);
    expectPoint(g.end, t.x, t.y);
    const m = edgePointAt(g, 0.5);
    expectPoint(g.mid, m.x, m.y);
  });

  it('source와 target이 뒤집혀 저장된 형제도 반대편으로 벌어진다', () => {
    const g0 = computeEdgeGeometry(line('e0', 'a', 'b'), ent, rel, 0, 2);
    const g1 = computeEdgeGeometry(line('e1', 'b', 'a'), rel, ent, 1, 2);
    expectPoint(g0.control!, 210, 10);
    expectPoint(g1.control!, 210, 50);
    // 뒤집힌 엣지는 같은 순번일 때 같은 제어점을 쓴다
    const g0r = computeEdgeGeometry(line('e0', 'b', 'a'), rel, ent, 0, 2);
    expectPoint(g0r.control!, g0.control!.x, g0.control!.y);
  });

  it('세 개면 가운데 선은 직선이다', () => {
    const g = [0, 1, 2].map((i) => computeEdgeGeometry(line(`e${i}`, 'a', 'b'), ent, rel, i, 3));
    expect(g[1].control).toBeNull();
    expectPoint(g[0].control!, 210, 30 - SIBLING_SPREAD);
    expectPoint(g[2].control!, 210, 30 + SIBLING_SPREAD);
  });

  it('글자는 휘어 나간 바깥쪽에 놓여 형제 선과 겹치지 않는다', () => {
    const upper = computeEdgeGeometry(line('e0', 'a', 'b'), ent, rel, 0, 2);
    const lower = computeEdgeGeometry(line('e1', 'a', 'b'), ent, rel, 1, 2);
    expect(upper.labelPos.y).toBeLessThan(upper.mid.y);
    expect(upper.rolePos.y).toBeLessThan(upper.labelPos.y);
    expect(lower.labelPos.y).toBeGreaterThan(lower.mid.y);
    expect(lower.rolePos.y).toBeGreaterThan(lower.labelPos.y);
    expect(distanceToEdge(lower, upper.labelPos)).toBeGreaterThan(LABEL_OFFSET);
    expect(distanceToEdge(upper, lower.rolePos)).toBeGreaterThan(LABEL_OFFSET);
  });

  it('휜 이중선도 두 줄 간격이 doubleGap에 가깝다', () => {
    const g = computeEdgeGeometry(line('e0', 'a', 'b', { double: true }), ent, rel, 0, 2);
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
      for (const shape of ['straight', 'elbow'] as const) {
        for (const [i, c] of [[0, 1], [0, 2], [1, 2], [1, 3]] as const) {
          const g = computeEdgeGeometry(edge('x', 'a', 'b', { double, shape }), a, b, i, c);
          expect(allFinite(g)).toBe(true);
          expect(g.paths).toHaveLength(double ? 2 : 1);
          expect(g.points.length).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('같은 노드끼리 이은 선도 NaN이 없다', () => {
    const a = node('a', 'attribute', 0, 0, 120, 50);
    for (const double of [false, true]) {
      for (const shape of ['straight', 'elbow'] as const) {
        expect(allFinite(computeEdgeGeometry(edge('x', 'a', 'a', { double, shape }), a, a))).toBe(true);
        expect(allFinite(computeEdgeGeometry(edge('x', 'a', 'a', { double, shape }), a, a, 1, 2))).toBe(true);
      }
    }
  });

  it('크기가 0인 노드와 일부만 겹친 노드에서도 NaN이 없다', () => {
    const zero = node('z', 'spec', 50, 50, 0, 0);
    const a = node('a', 'entity', 0, 0, 100, 60);
    const near = node('n', 'attribute', 60, 20, 120, 50);
    for (const double of [false, true]) {
      for (const shape of ['straight', 'elbow'] as const) {
        expect(allFinite(computeEdgeGeometry(edge('x', 'a', 'z', { double, shape }), a, zero))).toBe(true);
        expect(allFinite(computeEdgeGeometry(edge('x', 'z', 'a', { double, shape }), zero, a, 0, 2))).toBe(true);
        expect(allFinite(computeEdgeGeometry(edge('x', 'a', 'n', { double, shape }), a, near))).toBe(true);
        expect(allFinite(computeEdgeGeometry(edge('x', 'a', 'n', { double, shape }), a, near, 1, 2))).toBe(true);
        expect(allFinite(computeEdgeGeometry(edge('x', 'a', 'n', { double, shape, sourceSide: 'left', targetSide: 'left' }), a, near))).toBe(true);
      }
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
  it('면이 지정된 엣지는 순번에서 뺀다', () => {
    const info = siblingInfo([
      edge('e0', 'a', 'b', { sourceSide: 'right', targetSide: 'right' }),
      edge('e1', 'a', 'b'),
      edge('e2', 'b', 'a'),
    ]);
    expect(info.get('e0')).toEqual({ index: 0, count: 1 });
    expect(info.get('e1')).toEqual({ index: 0, count: 2 });
    expect(info.get('e2')).toEqual({ index: 1, count: 2 });
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

// ───────────────────────── 면 고정과 꺾은선 ─────────────────────────

/** 모든 선분이 가로 또는 세로인지 */
function isOrthogonal(pts: Point[]): boolean {
  for (let i = 1; i < pts.length; i++) {
    const dx = Math.abs(pts[i].x - pts[i - 1].x);
    const dy = Math.abs(pts[i].y - pts[i - 1].y);
    if (dx > 1e-6 && dy > 1e-6) return false;
  }
  return true;
}
/** 경로가 사각형 안쪽(테두리에서 2px 안)을 지나는지 */
function crosses(pts: Point[], r: Rect): boolean {
  const inner = { x: r.x + 2, y: r.y + 2, w: r.w - 4, h: r.h - 4 };
  for (let i = 1; i < pts.length; i++) if (segmentIntersectsRect(pts[i - 1], pts[i], inner)) return true;
  return false;
}
/** 왔던 길을 되돌아가는 선분이 있는지 */
function backtracks(pts: Point[]): boolean {
  for (let i = 2; i < pts.length; i++) {
    const ax = pts[i - 1].x - pts[i - 2].x, ay = pts[i - 1].y - pts[i - 2].y;
    const bx = pts[i].x - pts[i - 1].x, by = pts[i].y - pts[i - 1].y;
    if (Math.abs(ax * by - ay * bx) < 1e-6 && ax * bx + ay * by < 0) return true;
  }
  return false;
}

describe('edgeShapeOf', () => {
  const ent = node('a', 'entity', 0, 0, 140, 60);
  const rel = node('b', 'relationship', 0, 160, 140, 80);
  const attr = node('c', 'attribute', 300, 0, 120, 50);
  it('엔티티와 관계 사이는 꺾은선, 그 외는 직선', () => {
    expect(edgeShapeOf(edge('x', 'a', 'b'), ent, rel)).toBe('elbow');
    expect(edgeShapeOf(edge('x', 'b', 'a'), rel, ent)).toBe('elbow');
    expect(edgeShapeOf(edge('x', 'a', 'c'), ent, attr)).toBe('straight');
    expect(edgeShapeOf(edge('x', 'b', 'c'), rel, attr)).toBe('straight');
  });
  it('면이 하나라도 지정되면 자동일 때 꺾은선', () => {
    expect(edgeShapeOf(edge('x', 'a', 'c', { sourceSide: 'right' }), ent, attr)).toBe('elbow');
    expect(edgeShapeOf(edge('x', 'a', 'c', { targetSide: 'left' }), ent, attr)).toBe('elbow');
  });
  it('shape가 있으면 그대로', () => {
    expect(edgeShapeOf(edge('x', 'a', 'b', { shape: 'straight' }), ent, rel)).toBe('straight');
    expect(edgeShapeOf(edge('x', 'a', 'c', { shape: 'elbow' }), ent, attr)).toBe('elbow');
    expect(edgeShapeOf(edge('x', 'a', 'c', { shape: 'straight', sourceSide: 'top' }), ent, attr)).toBe('straight');
  });
});

describe('꺾은선: 수업 슬라이드 사례', () => {
  // Customer(위) — Submits(가운데) — Order(아래). 세 도형의 가운데 x가 서로 다르다(70, 80, 60)
  const customer = node('customer', 'entity', 0, 0, 140, 60);
  const submits = node('submits', 'relationship', 10, 150, 140, 80);
  const order = node('order', 'entity', -20, 320, 160, 60);

  it('엔티티 아래변에서 마름모 위 꼭짓점으로 수직으로 내려온다', () => {
    const g = computeEdgeGeometry(edge('e1', 'customer', 'submits'), customer, submits);
    // 엔티티 쪽은 변의 가운데(70)가 아니라 꼭짓점과 같은 x(80)에 붙는다
    expect(g.points).toEqual([{ x: 80, y: 60 }, { x: 80, y: 150 }]);
    expect(g.end).toEqual(anchorPoint(submits, 'top'));
    expect(g.sourceSide).toBe('bottom');
    expect(g.targetSide).toBe('top');
    expect(g.control).toBeNull();
    expect(g.hitPath).toBe('M 80 60 L 80 150');
    expect(g.paths).toEqual([g.hitPath]);
    expectPoint(g.mid, 80, 105);
  });

  it('마름모 아래 꼭짓점에서 엔티티 위변으로 수직으로 내려간다', () => {
    const g = computeEdgeGeometry(edge('e2', 'submits', 'order'), submits, order);
    expect(g.points).toEqual([{ x: 80, y: 230 }, { x: 80, y: 320 }]);
    expect(g.start).toEqual(anchorPoint(submits, 'bottom'));
    expect(g.sourceSide).toBe('bottom');
    expect(g.targetSide).toBe('top');
  });

  it('source와 target을 뒤집어 저장해도 같은 선이다', () => {
    const g = computeEdgeGeometry(edge('e1', 'submits', 'customer'), submits, customer);
    expect(g.points).toEqual([{ x: 80, y: 150 }, { x: 80, y: 60 }]);
    expect(g.sourceSide).toBe('top');
    expect(g.targetSide).toBe('bottom');
  });

  it('세로 선분의 카디널리티는 오른쪽, 역할 이름은 왼쪽', () => {
    const g = computeEdgeGeometry(edge('e1', 'customer', 'submits'), customer, submits);
    expectPoint(g.labelPos, 80 + LABEL_OFFSET, 105);
    expectPoint(g.rolePos, 80 - LABEL_OFFSET, 105);
  });

  it('옆으로 나란하면 마름모 옆 꼭짓점에서 수평으로 엔티티 변에 붙는다', () => {
    const left = node('left', 'entity', 0, 0, 140, 100);
    const rel = node('rel', 'relationship', 300, 20, 140, 80);
    const g = computeEdgeGeometry(edge('e', 'left', 'rel'), left, rel);
    // 엔티티 오른쪽 변의 가운데는 y=50이지만 꼭짓점 높이 y=60에 붙는다
    expect(g.points).toEqual([{ x: 140, y: 60 }, { x: 300, y: 60 }]);
    expect(g.sourceSide).toBe('right');
    expect(g.targetSide).toBe('left');
    // 가로 선분의 카디널리티는 위쪽
    expectPoint(g.labelPos, 220, 60 - LABEL_OFFSET);
    expectPoint(g.rolePos, 220, 60 + LABEL_OFFSET);
  });

  // Employee 바로 아래에 Manages가 있는 재귀 관계
  const employee = node('employee', 'entity', 0, 0, 140, 60);
  const manages = node('manages', 'relationship', 0, 160, 140, 80);
  const loop: Point[] = [
    { x: 140, y: 30 },
    { x: 140 + ELBOW_STUB, y: 30 },
    { x: 140 + ELBOW_STUB, y: 200 },
    { x: 140, y: 200 },
  ];

  it('재귀 관계(면 지정): 직선 하나와 오른쪽으로 돌아가는 꺾은선 하나', () => {
    const straight = computeEdgeGeometry(
      edge('r0', 'employee', 'manages', { sourceSide: 'bottom', targetSide: 'top' }), employee, manages);
    expect(straight.points).toEqual([{ x: 70, y: 60 }, { x: 70, y: 160 }]);
    const g = computeEdgeGeometry(
      edge('r1', 'employee', 'manages', { sourceSide: 'right', targetSide: 'right' }), employee, manages);
    expect(g.points).toEqual(loop);
    expect(g.start).toEqual(anchorPoint(employee, 'right'));
    expect(g.end).toEqual(anchorPoint(manages, 'right'));
    expect(g.sourceSide).toBe('right');
    expect(g.targetSide).toBe('right');
    expect(g.control).toBeNull();
    expect(g.hitPath).toBe(`M 140 30 L ${140 + ELBOW_STUB} 30 L ${140 + ELBOW_STUB} 200 L 140 200`);
    // 가운데 점은 경로 길이의 중간, 글자는 가장 긴(세로) 선분의 오른쪽
    expectPoint(g.mid, 140 + ELBOW_STUB, 115);
    expectPoint(g.labelPos, 140 + ELBOW_STUB + LABEL_OFFSET, 115);
    expectPoint(g.rolePos, 140 + ELBOW_STUB - LABEL_OFFSET, 115);
  });

  it('재귀 관계(자동): 같은 두 도형 사이의 두 번째 선은 첫 번째 선이 쓴 면을 피해 돌아간다', () => {
    const edges = [edge('r0', 'employee', 'manages'), edge('r1', 'manages', 'employee')];
    const info = siblingInfo(edges);
    const g0 = computeEdgeGeometry(edges[0], employee, manages, info.get('r0')!.index, info.get('r0')!.count);
    const g1 = computeEdgeGeometry(edges[1], manages, employee, info.get('r1')!.index, info.get('r1')!.count);
    expect(g0.points).toEqual([{ x: 70, y: 60 }, { x: 70, y: 160 }]);
    // r1은 manages에서 출발하도록 저장돼 있으므로 점 순서가 반대다
    expect(g1.points).toEqual([...loop].reverse());
    expect(g1.sourceSide).toBe('right');
    expect(g1.targetSide).toBe('right');
  });

  it('폭이 다른 두 도형의 같은 면끼리는 더 튀어나온 쪽 바깥으로 돈다', () => {
    const wide = node('wide', 'relationship', -20, 160, 180, 80);
    const g = computeEdgeGeometry(
      edge('r1', 'employee', 'wide', { sourceSide: 'right', targetSide: 'right' }), employee, wide);
    expect(g.points).toEqual([
      { x: 140, y: 30 },
      { x: 160 + ELBOW_STUB, y: 30 },
      { x: 160 + ELBOW_STUB, y: 200 },
      { x: 160, y: 200 },
    ]);
  });
});

describe('꺾은선: 면 지정', () => {
  const ent = node('a', 'entity', 0, 0, 140, 60);
  const rel = node('b', 'relationship', 300, 200, 140, 80);

  it('지정된 면은 anchorPoint에서 정확히 시작하고 끝난다', () => {
    for (const s of ['top', 'right', 'bottom', 'left'] as Side[]) {
      for (const t of ['top', 'right', 'bottom', 'left'] as Side[]) {
        const g = computeEdgeGeometry(edge('x', 'a', 'b', { sourceSide: s, targetSide: t }), ent, rel);
        expect(g.start).toEqual(anchorPoint(ent, s));
        expect(g.end).toEqual(anchorPoint(rel, t));
        expect(g.points[0]).toEqual(g.start);
        expect(g.points[g.points.length - 1]).toEqual(g.end);
        expect(g.sourceSide).toBe(s);
        expect(g.targetSide).toBe(t);
        expect(isOrthogonal(g.points)).toBe(true);
        expect(backtracks(g.points)).toBe(false);
        expect(allFinite(g)).toBe(true);
      }
    }
  });

  it('지정된 면에서는 그 면의 바깥 방향으로 나간다', () => {
    const g = computeEdgeGeometry(edge('x', 'a', 'b', { sourceSide: 'top', targetSide: 'bottom' }), ent, rel);
    expect(g.points[1].x).toBe(70);
    expect(g.points[1].y).toBeLessThan(0);
    const n = g.points.length;
    expect(g.points[n - 2].x).toBe(370);
    expect(g.points[n - 2].y).toBeGreaterThan(280);
    expect(crosses(g.points, nodeRect(ent))).toBe(false);
    expect(crosses(g.points, nodeRect(rel))).toBe(false);
  });

  it('한쪽만 지정하면 나머지 면은 자동으로 고른다', () => {
    const g = computeEdgeGeometry(edge('x', 'a', 'b', { sourceSide: 'right' }), ent, rel);
    expect(g.points).toEqual([{ x: 140, y: 30 }, { x: 370, y: 30 }, { x: 370, y: 200 }]);
    expect(g.sourceSide).toBe('right');
    expect(g.targetSide).toBe('top');
  });

  it('지정된 마름모 꼭짓점에서 쏜 선이 엔티티에 닿으면 곧게 잇는다', () => {
    const below = node('b', 'relationship', 20, 160, 140, 80);
    const g = computeEdgeGeometry(edge('x', 'a', 'b', { targetSide: 'top' }), ent, below);
    expect(g.points).toEqual([{ x: 90, y: 60 }, { x: 90, y: 160 }]);
    expect(g.sourceSide).toBe('bottom');
  });

  it('면이 지정된 속성 선도 꺾은선이 된다', () => {
    const attr = node('c', 'attribute', 300, 100, 120, 50);
    const g = computeEdgeGeometry(edge('x', 'a', 'c', { sourceSide: 'right' }), ent, attr);
    expect(g.start).toEqual(anchorPoint(ent, 'right'));
    expect(isOrthogonal(g.points)).toBe(true);
    expect(g.targetSide).not.toBeNull();
    expect(g.end).toEqual(anchorPoint(attr, g.targetSide!));
  });

  it('직선 모양에서 지정된 끝은 고정점, 나머지 끝은 그 점을 향한 외곽선 교점', () => {
    const g = computeEdgeGeometry(edge('x', 'a', 'b', { shape: 'straight', sourceSide: 'right' }), ent, rel, 0, 2);
    const s = anchorPoint(ent, 'right');
    expect(g.start).toEqual(s);
    const e = boundaryPoint(rel, s);
    expectPoint(g.end, e.x, e.y);
    // 면이 지정된 직선은 형제가 있어도 휘지 않는다
    expect(g.control).toBeNull();
    expect(g.points).toEqual([g.start, g.end]);
    expect(g.sourceSide).toBe('right');
    expect(g.targetSide).toBeNull();

    const both = computeEdgeGeometry(edge('x', 'a', 'b', { shape: 'straight', sourceSide: 'bottom', targetSide: 'left' }), ent, rel);
    expect(both.start).toEqual(anchorPoint(ent, 'bottom'));
    expect(both.end).toEqual(anchorPoint(rel, 'left'));
    const back = computeEdgeGeometry(edge('x', 'a', 'b', { shape: 'straight', targetSide: 'left' }), ent, rel);
    expect(back.end).toEqual(anchorPoint(rel, 'left'));
    const s2 = boundaryPoint(ent, back.end);
    expectPoint(back.start, s2.x, s2.y);
  });
});

describe('꺾은선: 자동 면 선택', () => {
  const ent = node('a', 'entity', 0, 0, 140, 60);

  it('대각선 위치면 한 번 꺾어 마름모 꼭짓점에 붙는다', () => {
    const rel = node('b', 'relationship', 300, 200, 140, 80);
    const g = computeEdgeGeometry(edge('x', 'a', 'b'), ent, rel);
    expect(g.points).toEqual([{ x: 140, y: 30 }, { x: 370, y: 30 }, { x: 370, y: 200 }]);
    expect(g.sourceSide).toBe('right');
    expect(g.targetSide).toBe('top');
    // 뒤집어 저장해도 같은 경로
    const r = computeEdgeGeometry(edge('x', 'b', 'a'), rel, ent);
    expect(r.points).toEqual([...g.points].reverse());
    expect(r.labelPos).toEqual(g.labelPos);
  });

  it('길이가 비슷한 선분이 여럿이면 관계 쪽 선분에 글자를 둔다', () => {
    // 가로 160, 세로 150: 가장 긴 것은 가로지만 차이가 작아 마름모에 붙는 세로 선분을 고른다
    const rel = node('b', 'relationship', 230, 180, 140, 80);
    const g = computeEdgeGeometry(edge('x', 'a', 'b'), ent, rel);
    expect(g.points).toEqual([{ x: 140, y: 30 }, { x: 300, y: 30 }, { x: 300, y: 180 }]);
    expectPoint(g.labelPos, 300 + LABEL_OFFSET, 105);
    const r = computeEdgeGeometry(edge('x', 'b', 'a'), rel, ent);
    expectPoint(r.labelPos, 300 + LABEL_OFFSET, 105);
    // 차이가 크면 가장 긴 선분
    const far = node('b', 'relationship', 500, 180, 140, 80);
    const g2 = computeEdgeGeometry(edge('x', 'a', 'b'), ent, far);
    expectPoint(g2.labelPos, (140 + 570) / 2, 30 - LABEL_OFFSET);
  });

  it('어느 위치에 있어도 가로세로로만 꺾이고 두 도형을 가로지르지 않는다', () => {
    const rel0 = node('b', 'relationship', 0, 0, 140, 80);
    let checked = 0;
    for (let x = -400; x <= 400; x += 37) {
      for (let y = -300; y <= 300; y += 29) {
        const rel = { ...rel0, x, y };
        // 겹치거나 꺾은선 여유(20)보다 가까이 붙은 배치는 제외
        const pad = 2 * ELBOW_STUB;
        if (x < 140 + pad && x + 140 > -pad && y < 60 + pad && y + 80 > -pad) continue;
        for (const e of [edge('x', 'a', 'b'), edge('x', 'b', 'a'), edge('x', 'a', 'b', { double: true })]) {
          const flipped = e.source === 'b';
          const g = flipped ? computeEdgeGeometry(e, rel, ent) : computeEdgeGeometry(e, ent, rel);
          expect(allFinite(g)).toBe(true);
          expect(isOrthogonal(g.points)).toBe(true);
          expect(backtracks(g.points)).toBe(false);
          expect(crosses(g.points, nodeRect(ent))).toBe(false);
          expect(crosses(g.points, nodeRect(rel))).toBe(false);
          expect(g.points.length).toBeLessThanOrEqual(4);
          // 마름모 쪽 끝은 항상 꼭짓점이다
          const relEnd = flipped ? g.start : g.end;
          const relSide = flipped ? g.sourceSide : g.targetSide;
          expect(relEnd).toEqual(anchorPoint(rel, relSide!));
          // 엔티티 쪽 끝은 엔티티 테두리 위에 있다
          const entEnd = flipped ? g.end : g.start;
          const onEdgeX = Math.abs(entEnd.x - 0) < 1e-6 || Math.abs(entEnd.x - 140) < 1e-6;
          const onEdgeY = Math.abs(entEnd.y - 0) < 1e-6 || Math.abs(entEnd.y - 60) < 1e-6;
          expect(onEdgeX || onEdgeY).toBe(true);
          expect(pointInNode(ent, entEnd)).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('도형을 조금씩 옮겨도 경로가 이리저리 뒤집히지 않는다', () => {
    const rel0 = node('b', 'relationship', 0, 220, 140, 80);
    const seen: string[] = [];
    for (let x = -400; x <= 400; x += 1) {
      const g = computeEdgeGeometry(edge('x', 'a', 'b'), ent, { ...rel0, x });
      const key = `${g.sourceSide}-${g.targetSide}-${g.points.length}`;
      if (seen[seen.length - 1] !== key) seen.push(key);
    }
    // 왼쪽에서 오른쪽으로 지나가는 동안 모양은 정해진 순서로 몇 번만 바뀐다
    expect(seen).toEqual(['left-top-3', 'bottom-top-4', 'bottom-top-2', 'bottom-top-4', 'right-top-3']);
  });

  it('엔티티끼리 꺾은선으로 이으면 마주 보는 변을 쓴다', () => {
    const other = node('b', 'entity', 300, 200, 140, 60);
    const g = computeEdgeGeometry(edge('x', 'a', 'b', { shape: 'elbow' }), ent, other);
    expect(isOrthogonal(g.points)).toBe(true);
    expect(crosses(g.points, nodeRect(ent))).toBe(false);
    expect(crosses(g.points, nodeRect(other))).toBe(false);
    expect(g.points.length).toBeLessThanOrEqual(4);
  });
});

describe('꺾은선: 이중선', () => {
  const employee = node('employee', 'entity', 0, 0, 140, 60);
  const manages = node('manages', 'relationship', 0, 160, 140, 80);
  const half = STYLE.doubleGap / 2;

  it('직각 모서리에서도 두 줄 간격이 doubleGap으로 유지된다', () => {
    const g = computeEdgeGeometry(
      edge('r1', 'employee', 'manages', { sourceSide: 'right', targetSide: 'right', double: true }), employee, manages);
    expect(g.paths).toHaveLength(2);
    expect(g.hitPath).toBe(`M 140 30 L ${140 + ELBOW_STUB} 30 L ${140 + ELBOW_STUB} 200 L 140 200`);
    const [inner, outer] = g.paths.map(coords).sort((p, q) => p[1].x - q[1].x);
    const x = 140 + ELBOW_STUB;
    expect(inner).toHaveLength(4);
    expect(outer).toHaveLength(4);
    // 안쪽 줄은 모서리가 안으로, 바깥 줄은 밖으로 half만큼 옮겨진다
    expectPoint(inner[1], x - half, 30 + half);
    expectPoint(inner[2], x - half, 200 - half);
    expectPoint(outer[1], x + half, 30 - half);
    expectPoint(outer[2], x + half, 200 + half);
    for (const l of [inner, outer]) {
      // 세 선분 모두 중심선에서 half 떨어진 가로세로 선
      expect(Math.abs(l[0].y - 30)).toBeCloseTo(half, 6);
      expect(l[0].y).toBeCloseTo(l[1].y, 6);
      expect(l[1].x).toBeCloseTo(l[2].x, 6);
      expect(l[2].y).toBeCloseTo(l[3].y, 6);
      expect(Math.abs(l[3].y - 200)).toBeCloseTo(half, 6);
      // 엔티티 쪽 끝은 변 위에
      expect(l[0].x).toBeCloseTo(140, 6);
    }
  });

  it('마름모 꼭짓점에 붙는 두 줄은 꼭짓점을 지나 외곽선까지 닿는다', () => {
    const g = computeEdgeGeometry(
      edge('r1', 'employee', 'manages', { sourceSide: 'right', targetSide: 'right', double: true }), employee, manages);
    for (const l of g.paths.map(coords)) {
      const end = l[3];
      // 꼭짓점(x=140)보다 안쪽이고 마름모 변 위에 있다
      expect(end.x).toBeLessThan(140);
      expect(Math.abs(end.x - 70) / 70 + Math.abs(end.y - 200) / 40).toBeCloseTo(1, 2);
    }
    // 수직으로 위 꼭짓점에 붙는 경우
    const v = computeEdgeGeometry(edge('r0', 'employee', 'manages', { double: true }), employee, manages);
    expect(v.points).toEqual([{ x: 70, y: 60 }, { x: 70, y: 160 }]);
    const lines = v.paths.map(coords);
    expect(Math.abs(lines[0][0].x - lines[1][0].x)).toBeCloseTo(STYLE.doubleGap, 6);
    for (const l of lines) {
      expect(l[0].x).toBeCloseTo(l[1].x, 6);
      expect(l[0].y).toBeCloseTo(60, 6);
      expect(l[1].y).toBeGreaterThan(160);
      expect(Math.abs(l[1].x - 70) / 70 + Math.abs(l[1].y - 200) / 40).toBeCloseTo(1, 2);
    }
  });

  it('타원 끝점에 붙는 두 줄도 타원 위에서 끝난다', () => {
    const attr = node('attr', 'attribute', 300, 5, 120, 50);
    const g = computeEdgeGeometry(
      edge('x', 'employee', 'attr', { sourceSide: 'right', targetSide: 'left', double: true }), employee, attr);
    expect(g.points).toEqual([{ x: 140, y: 30 }, { x: 300, y: 30 }]);
    for (const l of g.paths.map(coords)) {
      expect(l[1].x).toBeGreaterThan(300);
      expect(((l[1].x - 360) / 60) ** 2 + ((l[1].y - 30) / 25) ** 2).toBeCloseTo(1, 2);
    }
  });

  it('메모에 붙는 줄은 메모 안으로 들어가지 않는다', () => {
    const memo = node('memo', 'note', 300, 5, 160, 50);
    const g = computeEdgeGeometry(
      edge('x', 'employee', 'memo', { sourceSide: 'right', targetSide: 'left', double: true }), employee, memo);
    for (const l of g.paths.map(coords)) expect(l[l.length - 1].x).toBeCloseTo(300, 6);
  });

  it('이중선이면 글자를 half만큼 더 띄운다', () => {
    const g = computeEdgeGeometry(edge('r0', 'employee', 'manages', { double: true }), employee, manages);
    expectPoint(g.labelPos, 70 + LABEL_OFFSET + half, 110);
  });
});

describe('꺾은선: 거리와 선택', () => {
  const employee = node('employee', 'entity', 0, 0, 140, 60);
  const manages = node('manages', 'relationship', 0, 160, 140, 80);
  const g = computeEdgeGeometry(
    edge('r1', 'employee', 'manages', { sourceSide: 'right', targetSide: 'right' }), employee, manages);
  const x = 140 + ELBOW_STUB;

  it('edgePolyline은 꼭짓점을 그대로 준다', () => {
    expect(edgePolyline(g)).toEqual(g.points);
  });

  it('edgePointAt은 경로 길이 기준으로 꺾인 선 위의 점을 준다', () => {
    expectPoint(edgePointAt(g, 0), 140, 30);
    expectPoint(edgePointAt(g, 1), 140, 200);
    expectPoint(edgePointAt(g, 0.5), x, 115);
    // 전체 길이 20 + 170 + 20 = 210 의 10% 지점은 세로 선분 위
    expectPoint(edgePointAt(g, 0.1), x, 31);
  });

  it('distanceToEdge는 꺾인 경로까지의 거리다', () => {
    expect(distanceToEdge(g, { x, y: 100 })).toBeCloseTo(0, 9);
    expect(distanceToEdge(g, { x: x + 7, y: 100 })).toBeCloseTo(7, 9);
    expect(distanceToEdge(g, { x: 150, y: 30 })).toBeCloseTo(0, 9);
    // 양 끝을 곧게 이은 선(x=140) 위의 점은 경로에서 떨어져 있다
    expect(distanceToEdge(g, { x: 140, y: 115 })).toBeCloseTo(ELBOW_STUB, 9);
  });

  it('edgeInRect는 꺾인 경로가 지나는 상자만 참', () => {
    expect(edgeInRect(g, { x: x - 5, y: 100, w: 10, h: 10 })).toBe(true);
    expect(edgeInRect(g, { x: 141, y: 100, w: 10, h: 10 })).toBe(false);
    expect(edgeInRect(g, { x: 145, y: 195, w: 5, h: 10 })).toBe(true);
  });
});

describe('고정점 보조 함수', () => {
  it('anchorPoint: 도형별 네 면', () => {
    const rel = node('r', 'relationship', 0, 0, 140, 80);
    expect(anchorPoint(rel, 'top')).toEqual({ x: 70, y: 0 });
    expect(anchorPoint(rel, 'right')).toEqual({ x: 140, y: 40 });
    expect(anchorPoint(rel, 'bottom')).toEqual({ x: 70, y: 80 });
    expect(anchorPoint(rel, 'left')).toEqual({ x: 0, y: 40 });
    // 정사각형이 아닌 spec은 내접원 위의 점
    const spec = node('s', 'spec', 0, 0, 40, 34);
    expect(anchorPoint(spec, 'left')).toEqual({ x: 3, y: 17 });
    expect(anchorPoint(spec, 'top')).toEqual({ x: 20, y: 0 });
  });
  it('nearestSide: 가장 가까운 면, 너무 멀면 null', () => {
    const ent = node('e', 'entity', 0, 0, 140, 60);
    expect(nearestSide(ent, { x: 138, y: 28 })).toBe('right');
    expect(nearestSide(ent, { x: 70, y: -3 })).toBe('top');
    expect(nearestSide(ent, { x: 70, y: -30 }, 10)).toBeNull();
  });
});

describe('면이 지정된 엔티티 변에서의 미끄러짐', () => {
  it('엔티티 아래변과 마름모 위 꼭짓점이 살짝 어긋나도 꺾이지 않고 곧게 만난다', () => {
    const emp = node('emp', 'entity', 680, 160, 200, 100);
    const mng = node('mng', 'relationship', 720, 330, 140, 80);
    const edge: ErdEdge = { id: 'e', source: 'emp', target: 'mng', double: false, label: '1', role: '', sourceSide: 'bottom', targetSide: 'top' };
    const g = computeEdgeGeometry(edge, emp, mng);
    expect(g.points).toHaveLength(2);
    // 마름모 위 꼭짓점(x = 790)에서 수직으로 올라가 엔티티 아래변(y = 260)에 닿는다
    expect(g.end).toEqual({ x: 790, y: 330 });
    expect(g.start).toEqual({ x: 790, y: 260 });
  });

  it('지정된 면과 마주 보지 않으면 곧은 연결을 쓰지 않는다', () => {
    const emp = node('emp', 'entity', 680, 160, 200, 100);
    const mng = node('mng', 'relationship', 720, 330, 140, 80);
    const edge: ErdEdge = { id: 'e', source: 'emp', target: 'mng', double: false, label: 'M', role: '', sourceSide: 'right', targetSide: 'right' };
    const g = computeEdgeGeometry(edge, emp, mng);
    expect(g.points.length).toBeGreaterThan(2);
    expect(g.start).toEqual({ x: 880, y: 210 });
    expect(g.end).toEqual({ x: 860, y: 370 });
  });
});
