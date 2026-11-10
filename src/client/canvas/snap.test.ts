import { describe, expect, it } from 'vitest';
import type { Guide, Rect } from '../../shared/types';
import { GAP_TICK, GUIDE_PAD, computeSnap, snapToGrid } from './snap';

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const vGuides = (gs: Guide[]) => gs.filter((g) => g.orientation === 'v');
const hGuides = (gs: Guide[]) => gs.filter((g) => g.orientation === 'h');

// other: x 100~200(가운데 150), y 100~160(가운데 130)
const OTHER = rect(100, 100, 100, 60);

describe('computeSnap 세로 기준선(x축)', () => {
  it('왼쪽끼리 붙는다', () => {
    const r = computeSnap(rect(103, 300, 40, 30), [OTHER], 5);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([{ orientation: 'v', pos: 100, from: 100 - GUIDE_PAD, to: 330 + GUIDE_PAD }]);
  });

  it('가운데끼리 붙는다', () => {
    // moving 가운데 = 128 + 20 = 148 → 150
    const r = computeSnap(rect(128, 300, 40, 30), [OTHER], 5);
    expect(r.dx).toBe(2);
    expect(vGuides(r.guides).map((g) => g.pos)).toEqual([150]);
  });

  it('오른쪽끼리 붙는다', () => {
    // moving 오른쪽 = 164 + 40 = 204 → 200
    const r = computeSnap(rect(164, 300, 40, 30), [OTHER], 5);
    expect(r.dx).toBe(-4);
    expect(vGuides(r.guides).map((g) => g.pos)).toEqual([200]);
  });

  it('moving의 왼쪽이 other의 오른쪽에 붙는다(다른 종류의 선끼리도 맞춘다)', () => {
    const r = computeSnap(rect(202, 300, 40, 30), [OTHER], 5);
    expect(r.dx).toBe(-2);
    expect(vGuides(r.guides).map((g) => g.pos)).toEqual([200]);
  });

  it('threshold 밖이면 붙지 않는다', () => {
    // 세로 선 106, 121, 136: 가장 가까운 후보(100)까지 6
    const r = computeSnap(rect(106, 300, 30, 30), [OTHER], 5);
    expect(r).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('threshold와 정확히 같은 거리면 붙는다', () => {
    expect(computeSnap(rect(105, 300, 40, 30), [OTHER], 5).dx).toBe(-5);
  });

  it('여러 후보 가운데 가장 가까운 선에 붙는다', () => {
    const near = rect(101, 500, 100, 60);
    const r = computeSnap(rect(103, 300, 40, 30), [OTHER, near], 5);
    expect(r.dx).toBe(-2);
    expect(vGuides(r.guides).map((g) => g.pos)).toEqual([101]);
  });

  it('거리가 같으면 가운데 맞춤을 우선한다', () => {
    // a: 왼쪽 100에 +3, b: 가운데 120에 -3 (moving 가운데 = 123)
    const a = rect(100, 0, 500, 40);
    const b = rect(110, 600, 20, 40);
    const moving = rect(97, 300, 52, 30);
    expect(computeSnap(moving, [a, b], 5).dx).toBe(-3);
    expect(computeSnap(moving, [b, a], 5).dx).toBe(-3);
  });

  it('이미 맞아 있으면 보정 없이 안내선만 낸다', () => {
    const r = computeSnap(rect(100, 300, 40, 30), [OTHER], 5);
    expect(r.dx).toBe(0);
    expect(vGuides(r.guides).map((g) => g.pos)).toEqual([100]);
  });
});

describe('computeSnap 가로 기준선(y축)', () => {
  it('위, 가운데, 아래에 각각 붙는다', () => {
    expect(computeSnap(rect(400, 102, 40, 30), [OTHER], 5).dy).toBe(-2); // 위 102 → 100
    expect(computeSnap(rect(400, 112, 40, 30), [OTHER], 5).dy).toBe(3); // 가운데 127 → 130
    expect(computeSnap(rect(400, 134, 40, 30), [OTHER], 5).dy).toBe(-4); // 아래 164 → 160
  });

  it('가로 안내선은 x 범위를 덮는다', () => {
    const r = computeSnap(rect(400, 102, 40, 34), [OTHER], 5);
    expect(r.dx).toBe(0);
    expect(r.guides).toEqual([{ orientation: 'h', pos: 100, from: 100 - GUIDE_PAD, to: 440 + GUIDE_PAD }]);
  });
});

describe('computeSnap x와 y 동시', () => {
  it('두 축이 따로 계산되어 함께 붙는다', () => {
    const top = rect(100, 0, 100, 60); // x 맞춤 대상
    const side = rect(500, 300, 80, 40); // y 맞춤 대상
    const r = computeSnap(rect(103, 298, 40, 30), [top, side], 5);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(2);
    // 안내선 범위는 보정 후의 moving(100~140, 300~330) 기준이다
    expect(vGuides(r.guides)).toEqual([{ orientation: 'v', pos: 100, from: 0 - GUIDE_PAD, to: 330 + GUIDE_PAD }]);
    expect(hGuides(r.guides)).toEqual([{ orientation: 'h', pos: 300, from: 100 - GUIDE_PAD, to: 580 + GUIDE_PAD }]);
  });

  it('한 축만 threshold 안이면 그 축만 붙는다', () => {
    const r = computeSnap(rect(103, 300, 40, 30), [OTHER], 5);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(0);
    expect(hGuides(r.guides)).toEqual([]);
  });
});

describe('computeSnap 안내선', () => {
  it('같은 위치에 맞는 other가 여럿이면 안내선 하나로 합치고 모두 덮는다', () => {
    const above = rect(100, -200, 60, 40);
    const below = rect(100, 700, 30, 50);
    const r = computeSnap(rect(102, 300, 40, 30), [above, OTHER, below], 5);
    expect(r.dx).toBe(-2);
    expect(r.guides).toEqual([{ orientation: 'v', pos: 100, from: -200 - GUIDE_PAD, to: 750 + GUIDE_PAD }]);
  });

  it('moving이 other보다 바깥에 있으면 moving까지 덮는다', () => {
    const r = computeSnap(rect(102, -50, 40, 30), [OTHER], 5);
    expect(r.guides).toEqual([{ orientation: 'v', pos: 100, from: -50 - GUIDE_PAD, to: 160 + GUIDE_PAD }]);
  });

  it('크기가 같아 세 선이 모두 맞으면 안내선 세 개가 나온다', () => {
    const r = computeSnap(rect(102, 300, 100, 30), [OTHER], 5);
    expect(r.dx).toBe(-2);
    expect(vGuides(r.guides).map((g) => g.pos)).toEqual([100, 150, 200]);
  });

  it('붙은 선에 우연히 걸친 다른 선도 같이 표시한다', () => {
    // 왼쪽을 100에 맞추면 오른쪽 140이 second의 왼쪽과 맞는다
    const second = rect(140, 600, 70, 40);
    const r = computeSnap(rect(101, 300, 40, 30), [OTHER, second], 5);
    expect(r.dx).toBe(-1);
    expect(vGuides(r.guides)).toEqual([
      { orientation: 'v', pos: 100, from: 100 - GUIDE_PAD, to: 330 + GUIDE_PAD },
      { orientation: 'v', pos: 140, from: 300 - GUIDE_PAD, to: 640 + GUIDE_PAD },
    ]);
  });
});

describe('computeSnap 경계', () => {
  it('others가 비면 아무것도 하지 않는다', () => {
    expect(computeSnap(rect(10, 10, 40, 30), [], 5)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('입력을 바꾸지 않는다', () => {
    const moving = rect(103, 298, 40, 30);
    const others = [rect(500, 300, 80, 40), rect(100, 0, 100, 60), rect(300, 290, 50, 50)];
    const before = JSON.stringify([moving, others]);
    computeSnap(moving, others, 5);
    expect(JSON.stringify([moving, others])).toBe(before);
  });

  it('threshold가 0이면 정확히 맞은 선만 표시한다', () => {
    expect(computeSnap(rect(101, 300, 40, 30), [OTHER], 0).guides).toEqual([]);
    expect(computeSnap(rect(100, 300, 40, 30), [OTHER], 0).guides).toHaveLength(1);
  });

  it('도형이 많아도 가장 가까운 것을 찾는다', () => {
    const others: Rect[] = [];
    for (let i = 0; i < 2000; i++) others.push(rect(1000 + i * 137, 1000 + i * 91, 77, 45));
    others.push(rect(100, 5000, 100, 60));
    const r = computeSnap(rect(103, 300, 40, 30), others, 5);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(0);
  });
});

describe('computeSnap 같은 간격 맞춤(가로)', () => {
  // 가로로 나란한 두 도형. 간격 = 200 - 150 = 50.
  // moving은 y 107~113(가운데 110)에 두어 y 정렬 후보(100, 120, 140)가 threshold 밖이 되게 한다.
  const A = rect(100, 100, 50, 40);
  const B = rect(200, 100, 60, 40);
  const gapGuide = (y: number, from: number, to: number): Guide[] => [
    { orientation: 'h', pos: y, from, to },
    { orientation: 'v', pos: from, from: y - GAP_TICK, to: y + GAP_TICK },
    { orientation: 'v', pos: to, from: y - GAP_TICK, to: y + GAP_TICK },
  ];

  it('오른쪽에 같은 간격으로 붙는다', () => {
    // 목표 x = 260 + 50 = 310
    const r = computeSnap(rect(313, 107, 33, 6), [A, B], 5);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([...gapGuide(110, 150, 200), ...gapGuide(110, 260, 310)]);
  });

  it('왼쪽에 같은 간격으로 붙는다', () => {
    // 목표 오른쪽 끝 = 100 - 50 = 50 → x = 17
    const r = computeSnap(rect(15, 107, 33, 6), [A, B], 5);
    expect(r.dx).toBe(2);
    expect(r.guides).toEqual([...gapGuide(110, 50, 100), ...gapGuide(110, 150, 200)]);
  });

  it('두 도형 사이 한가운데에 붙는다', () => {
    const left = rect(0, 100, 50, 40);
    const right = rect(250, 100, 60, 40);
    // 빈 구간 50~250, 폭 33 → 양쪽 간격 83.5, x = 133.5
    const r = computeSnap(rect(131, 107, 33, 6), [right, left], 5);
    expect(r.dx).toBe(2.5);
    expect(r.guides).toEqual([...gapGuide(110, 50, 133.5), ...gapGuide(110, 166.5, 250)]);
  });

  it('threshold 밖이면 붙지 않는다', () => {
    expect(computeSnap(rect(317, 107, 33, 6), [A, B], 5)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('세로로 겹치지 않는 도형과는 간격을 맞추지 않는다', () => {
    expect(computeSnap(rect(313, 400, 33, 18), [A, B], 5)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('두 도형이 가로로 겹치면 간격 후보가 없다', () => {
    // 간격이 -10이다. 음수 간격을 그대로 쓰면 190에 붙게 되는 자리에 둔다.
    const overlapped = rect(140, 100, 60, 40);
    const r = computeSnap(rect(192, 107, 33, 6), [A, overlapped], 5);
    expect(r).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('사이 폭이 모자라면 사이 후보를 내지 않는다', () => {
    // 빈 구간 150~200(폭 50)에 폭 60은 들어가지 못한다. 가운데(175) 근처에 두어도 붙지 않아야 한다.
    const r = computeSnap(rect(146, 107, 60, 6), [A, B], 1);
    expect(r).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('목표 자리에 다른 도형이 끼어 있으면 붙지 않는다', () => {
    const moving = rect(314, 107, 10, 6);
    expect(computeSnap(moving, [A, B], 5).dx).toBe(-4); // 목표 310~320
    const blocker = rect(308, 100, 400, 40); // 목표 자리와 겹친다
    expect(computeSnap(moving, [A, B, blocker], 5)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('정렬 후보가 더 가깝거나 같은 거리면 정렬이 이긴다', () => {
    // 간격 목표 310(-3), 정렬 목표 312(-1): 위쪽 도형의 왼쪽 선
    const above = rect(312, -300, 80, 40);
    const r = computeSnap(rect(313, 107, 33, 6), [A, B, above], 5);
    expect(r.dx).toBe(-1);
    expect(r.guides).toEqual([{ orientation: 'v', pos: 312, from: -300 - GUIDE_PAD, to: 113 + GUIDE_PAD }]);

    // 같은 거리(간격 -3, 정렬 +3)
    const tie = rect(316, -300, 80, 40);
    expect(computeSnap(rect(313, 107, 33, 6), [A, B, tie], 5).dx).toBe(3);
  });

  it('간격 후보가 정렬 후보보다 가까우면 간격이 이긴다', () => {
    const above = rect(317, -300, 80, 40); // 정렬 +4, 간격 -3
    const r = computeSnap(rect(313, 107, 33, 6), [A, B, above], 5);
    expect(r.dx).toBe(-3);
    expect(vGuides(r.guides).some((g) => g.pos === 317)).toBe(false);
  });

  it('정렬과 간격이 같은 자리면 둘 다 표시한다', () => {
    const above = rect(310, -300, 80, 40);
    const r = computeSnap(rect(313, 107, 33, 6), [A, B, above], 5);
    expect(r.dx).toBe(-3);
    expect(r.guides).toEqual([
      { orientation: 'v', pos: 310, from: -300 - GUIDE_PAD, to: 113 + GUIDE_PAD },
      ...gapGuide(110, 150, 200),
      ...gapGuide(110, 260, 310),
    ]);
  });

  it('y 정렬과 함께 붙으면 보정된 y로 간격 표시를 그린다', () => {
    // 가운데 y: 122 → 120
    const r = computeSnap(rect(313, 113, 33, 18), [A, B], 5);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(-2);
    expect(r.guides).toContainEqual({ orientation: 'h', pos: 120, from: 100 - GUIDE_PAD, to: 343 + GUIDE_PAD });
    expect(r.guides).toContainEqual({ orientation: 'h', pos: 120, from: 260, to: 310 });
  });
});

describe('snapToGrid', () => {
  it('격자 배수로 맞춘다', () => {
    expect(snapToGrid(13, 10)).toBe(10);
    expect(snapToGrid(15, 10)).toBe(20);
    expect(snapToGrid(-13, 10)).toBe(-10);
  });
});
