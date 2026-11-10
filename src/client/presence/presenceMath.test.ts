import { describe, expect, it, vi } from 'vitest';
import {
  EDGE_INSETS,
  RING_PAD,
  anchorOffset,
  buildRemoteRings,
  createThrottle,
  displayName,
  estimateTextWidth,
  initialOf,
  isPoint,
  locateCursor,
  normalizeName,
  roundPoint,
  safeColor,
  type ThrottleClock,
} from './presenceMath';

/** 손으로 시간을 돌리는 가짜 시계 */
function fakeClock() {
  let now = 1000;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: ThrottleClock = {
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (handle) => {
      timers.delete(handle as number);
    },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  return { clock, advance, timerCount: () => timers.size };
}

describe('createThrottle', () => {
  it('첫 호출은 바로 실행한다', () => {
    const { clock } = fakeClock();
    const fn = vi.fn();
    const t = createThrottle(fn, 33, clock);
    t(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith(1);
  });

  it('간격 안의 호출은 모았다가 마지막 값만 보낸다', () => {
    const { clock, advance } = fakeClock();
    const fn = vi.fn();
    const t = createThrottle(fn, 33, clock);
    t(1);
    advance(5);
    t(2);
    advance(5);
    t(3);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(t.pending()).toBe(true);
    advance(22);
    expect(fn).toHaveBeenCalledTimes(1);
    advance(1);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(3);
    expect(t.pending()).toBe(false);
  });

  it('연속으로 불러도 실행 사이가 간격보다 짧아지지 않는다', () => {
    const { clock, advance } = fakeClock();
    const at: number[] = [];
    const t = createThrottle(() => at.push(clock.now()), 33, clock);
    for (let i = 0; i < 100; i++) {
      t();
      advance(4);
    }
    advance(100);
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(33);
    // 400ms 동안 4ms마다 불렀으니 대략 13번 실행된다
    expect(at.length).toBeGreaterThanOrEqual(12);
    expect(at.length).toBeLessThanOrEqual(14);
  });

  it('충분히 쉬었다가 부르면 다시 바로 실행한다', () => {
    const { clock, advance, timerCount } = fakeClock();
    const fn = vi.fn();
    const t = createThrottle(fn, 33, clock);
    t('a');
    advance(40);
    t('b');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(timerCount()).toBe(0);
  });

  it('trailing 실행 직후의 호출도 간격을 지킨다', () => {
    const { clock, advance } = fakeClock();
    const fn = vi.fn();
    const t = createThrottle(fn, 33, clock);
    t(1);
    advance(10);
    t(2);
    advance(23); // trailing 실행
    expect(fn).toHaveBeenCalledTimes(2);
    advance(5);
    t(3);
    expect(fn).toHaveBeenCalledTimes(2);
    advance(28);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(fn).toHaveBeenLastCalledWith(3);
  });

  it('cancel은 예약된 호출을 버린다', () => {
    const { clock, advance, timerCount } = fakeClock();
    const fn = vi.fn();
    const t = createThrottle(fn, 33, clock);
    t(1);
    t(2);
    t.cancel();
    expect(timerCount()).toBe(0);
    advance(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flush는 예약된 호출을 바로 실행한다', () => {
    const { clock, advance } = fakeClock();
    const fn = vi.fn();
    const t = createThrottle(fn, 33, clock);
    t(1);
    t(2);
    t.flush();
    expect(fn).toHaveBeenLastCalledWith(2);
    advance(100);
    expect(fn).toHaveBeenCalledTimes(2);
    t.flush();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('사용자 표시', () => {
  it('이름이 비어 있으면 익명', () => {
    expect(displayName('')).toBe('익명');
    expect(displayName('   ')).toBe('익명');
    expect(displayName(undefined)).toBe('익명');
    expect(displayName(42)).toBe('익명');
    expect(displayName(' 희윤 ')).toBe('희윤');
  });

  it('너무 긴 이름은 20자로 자른다', () => {
    expect(displayName('가'.repeat(30))).toBe('가'.repeat(20));
  });

  it('아바타 글자는 이름 첫 글자, 없으면 ?', () => {
    expect(initialOf('희윤')).toBe('희');
    expect(initialOf(' alice')).toBe('A');
    expect(initialOf('')).toBe('?');
    expect(initialOf(null)).toBe('?');
  });

  it('저장할 이름은 공백을 걷어내고 20자로 자른다', () => {
    expect(normalizeName('  김 철수  ')).toBe('김 철수');
    expect(normalizeName('   ')).toBe('');
    expect(normalizeName('a'.repeat(25))).toHaveLength(20);
  });

  it('색은 #hex 형식만 받는다', () => {
    expect(safeColor('#E5484D')).toBe('#E5484D');
    expect(safeColor('#abc')).toBe('#abc');
    expect(safeColor('red; background: url(x)')).toBe('#6b7280');
    expect(safeColor(undefined)).toBe('#6b7280');
  });

  it('좌표 검사와 반올림', () => {
    expect(isPoint({ x: 1, y: 2 })).toBe(true);
    expect(isPoint(null)).toBe(false);
    expect(isPoint({ x: NaN, y: 0 })).toBe(false);
    expect(isPoint({ x: '1', y: 0 })).toBe(false);
    expect(roundPoint({ x: 1.26, y: -3.94 })).toEqual({ x: 1.3, y: -3.9 });
  });
});

describe('locateCursor', () => {
  const size = { w: 800, h: 600 };

  it('화면 안이면 그 자리에 그린다', () => {
    expect(locateCursor({ x: 100, y: 200 }, size)).toMatchObject({ offscreen: false, x: 100, y: 200 });
    expect(locateCursor({ x: 0, y: 0 }, size).offscreen).toBe(false);
    expect(locateCursor({ x: 800, y: 600 }, size).offscreen).toBe(false);
  });

  it('왼쪽으로 벗어나면 왼쪽 가장자리에 놓고 오른쪽으로 펼친다', () => {
    const p = locateCursor({ x: -500, y: 300 }, size);
    expect(p).toMatchObject({ offscreen: true, x: EDGE_INSETS.left, y: 300, ax: 'start', ay: 'center' });
  });

  it('오른쪽으로 벗어나면 오른쪽 가장자리에 놓고 왼쪽으로 펼친다', () => {
    const p = locateCursor({ x: 2000, y: 300 }, size);
    expect(p).toMatchObject({ offscreen: true, x: 800 - EDGE_INSETS.right, ax: 'end', ay: 'center' });
  });

  it('위아래로 벗어나면 가로 위치는 유지하되 삐져나가지 않게 당긴다', () => {
    expect(locateCursor({ x: 400, y: -50 }, size)).toMatchObject({ offscreen: true, x: 400, y: EDGE_INSETS.top, ax: 'center', ay: 'start' });
    expect(locateCursor({ x: 400, y: 900 }, size)).toMatchObject({ offscreen: true, x: 400, y: 600 - EDGE_INSETS.bottom, ay: 'end' });
    const nearLeft = locateCursor({ x: 5, y: -50 }, size);
    expect(nearLeft.x).toBeGreaterThan(EDGE_INSETS.left);
    const nearRight = locateCursor({ x: 795, y: -50 }, size);
    expect(nearRight.x).toBeLessThan(800 - EDGE_INSETS.right);
  });

  it('대각선으로 벗어나면 모서리에 놓는다', () => {
    expect(locateCursor({ x: 900, y: 700 }, size)).toMatchObject({
      offscreen: true,
      x: 800 - EDGE_INSETS.right,
      y: 600 - EDGE_INSETS.bottom,
      ax: 'end',
      ay: 'end',
    });
  });

  it('표시 위치는 항상 화면 안이다', () => {
    for (const s of [size, { w: 120, h: 60 }, { w: 40, h: 30 }]) {
      for (const p of [{ x: -9, y: -9 }, { x: 9999, y: 10 }, { x: 10, y: 9999 }, { x: -1, y: 9999 }, { x: 20, y: -3 }]) {
        const r = locateCursor(p, s);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x).toBeLessThanOrEqual(s.w);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeLessThanOrEqual(s.h);
      }
    }
  });

  it('크기를 모르면 안에 있는 것으로 본다', () => {
    expect(locateCursor({ x: -100, y: 5000 }, { w: 0, h: 0 })).toMatchObject({ offscreen: false, x: -100, y: 5000 });
  });

  it('정렬 값을 CSS로 바꾼다', () => {
    expect(anchorOffset('start')).toBe('0');
    expect(anchorOffset('center')).toBe('-50%');
    expect(anchorOffset('end')).toBe('-100%');
  });
});

describe('buildRemoteRings', () => {
  const nodes = new Map([
    ['n1', { x: 100, y: 50, w: 120, h: 60 }],
    ['n2', { x: 0, y: 0, w: 10, h: 10 }],
  ]);
  const peer = (clientId: number, name: string, selection: string[], editing: string | null = null) => ({
    clientId,
    user: { id: `u${clientId}`, name, color: '#0090FF' },
    selection,
    editing,
  });

  it('선택한 노드마다 4px 큰 사각형을 만든다', () => {
    const rings = buildRemoteRings([peer(1, '가', ['n1', 'n2'])], nodes, 1);
    expect(rings).toHaveLength(2);
    expect(rings[0]).toMatchObject({ nodeId: 'n1', x: 96, y: 46, w: 128, h: 68, color: '#0090FF', editing: false, label: null, stack: 0 });
    expect(rings[1]).toMatchObject({ nodeId: 'n2', x: -RING_PAD, y: -RING_PAD, w: 18, h: 18 });
  });

  it('엣지나 지워진 요소는 건너뛴다', () => {
    expect(buildRemoteRings([peer(1, '가', ['edge-1', 'gone'])], nodes, 1)).toEqual([]);
  });

  it('편집 중인 노드는 선택에 없어도 그리고 이름표를 단다', () => {
    const rings = buildRemoteRings([peer(1, '희윤', [], 'n1')], nodes, 1);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toMatchObject({ editing: true, label: '희윤 편집 중' });
  });

  it('선택하면서 편집 중인 노드는 한 번만 그린다', () => {
    const rings = buildRemoteRings([peer(1, '', ['n1'], 'n1')], nodes, 1);
    expect(rings).toHaveLength(1);
    expect(rings[0].label).toBe('익명 편집 중');
  });

  it('같은 노드를 여러 명이 고르면 바깥으로 밀어 겹치지 않게 한다', () => {
    const rings = buildRemoteRings([peer(1, '가', ['n1']), peer(2, '나', ['n1']), peer(3, '다', ['n1', 'n2'])], nodes, 1);
    const onN1 = rings.filter((r) => r.nodeId === 'n1');
    expect(onN1.map((r) => r.stack)).toEqual([0, 1, 2]);
    expect(onN1.map((r) => r.x)).toEqual([96, 92, 88]);
    expect(rings.find((r) => r.nodeId === 'n2')?.stack).toBe(0);
    expect(new Set(rings.map((r) => r.key)).size).toBe(rings.length);
  });

  it('축소한 화면에서도 테두리 사이가 화면 기준 3px 이상 벌어진다', () => {
    const zoom = 0.25;
    const rings = buildRemoteRings([peer(1, '가', ['n1']), peer(2, '나', ['n1'])], nodes, zoom);
    expect((rings[0].x - rings[1].x) * zoom).toBeGreaterThanOrEqual(3);
  });

  it('형식이 깨진 값이 와도 죽지 않는다', () => {
    const broken = { clientId: 9, user: { name: 1, color: 'x' }, selection: [3, 'n1'], editing: 7 } as never;
    const rings = buildRemoteRings([broken], nodes, 0);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toMatchObject({ color: '#6b7280', editing: false });
  });
});

describe('estimateTextWidth', () => {
  it('한글을 영문보다 넓게 본다', () => {
    expect(estimateTextWidth('가나다', 11)).toBeGreaterThan(estimateTextWidth('abc', 11));
    expect(estimateTextWidth('', 11)).toBe(0);
  });
});
