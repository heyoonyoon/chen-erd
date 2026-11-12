import { describe, expect, it } from 'vitest';
import { buildScript, cursorAt, stateAt, targetAt, type Anchor, type Pt, type Who } from './heroScript';

const LINES = ['학과 (학과코드, 학과명)', '학생 (학번, 이름, 학과코드)', 'Foreign Key (학과코드) references 학과 (학과코드)'];

/** 분할 화면(약 620×432)의 실제 배치를 어림한 좌표. ERD는 왼쪽, 관계 모델은 오른쪽 위, IE와 탭은 오른쪽 아래다 */
function fakeResolve(a: Anchor): Pt {
  switch (a.k) {
    case 'erd':
      return { x: 60 + a.x * 0.85, y: 50 + a.y * 0.85 };
    case 'line':
      return { x: 360, y: 70 + a.line * 18 };
    case 'word':
      return { x: 400 + (a.end ? 48 : 0), y: 72 + a.key * 18 };
    case 'underline':
      return { x: 368, y: 44 };
    case 'relRest':
      return { x: 540, y: 140 };
    case 'cell':
      return { x: (a.cell[2] === 'type' ? 470 : 550) + 0, y: 260 + a.cell[0] * 90 + a.cell[1] * 22 };
    case 'item':
      return { x: 480, y: 170 + a.index * 18 };
    case 'tab':
      return { x: 470, y: 182 };
  }
}

const script = buildScript(LINES);
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

describe('히어로 각본', () => {
  it('포인터는 순간이동하지 않는다: 16ms마다 40px 이하로만 움직이고, 처음으로 돌아갈 때도 이어진다', () => {
    for (const who of [0, 1] as Who[]) {
      let prev = cursorAt(script, who, 0, fakeResolve);
      for (let ms = 16; ms < script.loop + 16; ms += 16) {
        // 마지막 한 걸음은 처음(0)과 이어지는지 본다
        const at = ms >= script.loop ? 0 : ms;
        const p = cursorAt(script, who, at, fakeResolve);
        expect(dist(prev, p), `who ${who} at ${ms}ms`).toBeLessThanOrEqual(40);
        prev = p;
      }
    }
  });

  it('사람마다 이동은 직전 자리에서 시작하고 겹치지 않는다', () => {
    for (const who of [0, 1] as Who[]) {
      const moves = script.moves.filter((m) => m.who === who);
      let here = script.start[who];
      let free = 0;
      for (const m of moves) {
        expect(m.from).toEqual(here);
        expect(m.at).toBeGreaterThanOrEqual(free);
        here = m.to;
        free = m.at + m.dur;
      }
      // 마지막에는 처음 자리로 돌아온다
      expect(here).toEqual(script.start[who]);
      expect(free).toBeLessThanOrEqual(script.leaveAt);
    }
  });

  it('누르기와 끌기는 포인터가 그 자리에 도착한 뒤에 일어난다', () => {
    for (const ev of script.events) {
      if (ev.kind === 'type') continue;
      const target = targetAt(script, ev.who, ev.at);
      expect(target.arrived, `${ev.effect.e} at ${ev.at}`).toBe(true);
      expect(target.anchor).toEqual(ev.anchor);
      expect(dist(cursorAt(script, ev.who, ev.at, fakeResolve), fakeResolve(ev.anchor!))).toBeLessThan(3);
    }
  });

  it('사건은 시간순이고, 사람마다 각본에 적힌 결과가 그 시각에 화면에 나타난다', () => {
    script.events.forEach((e, i) => i > 0 && expect(e.at).toBeGreaterThanOrEqual(script.events[i - 1].at));
    for (const ev of script.events.filter((e) => e.effect.e === 'place')) {
      const ids = (ev.effect as { ids: string[] }).ids;
      expect([...stateAt(script, LINES, ev.at - 1).shown].some((id) => ids.includes(id))).toBe(false);
      expect(ids.every((id) => stateAt(script, LINES, ev.at).shown.has(id))).toBe(true);
    }
  });

  it('글자는 같은 사람이 편집기를 눌러 자리를 잡은 뒤에만 쳐진다', () => {
    for (const ev of script.events.filter((e) => e.kind === 'type')) {
      const focus = script.events.find((e) => e.effect.e === 'focus' && e.who === ev.who && e.at < ev.at);
      expect(focus, `type at ${ev.at}`).toBeDefined();
    }
  });

  it('화면 상태는 사건(누르기, 끌기, 치기)이 있는 순간에만 바뀐다', () => {
    const shape = (ms: number) => {
      const s = stateAt(script, LINES, ms);
      return JSON.stringify({ shown: [...s.shown].sort(), picks: s.picks, typed: s.typed, marked: s.marked, fills: s.fills, menu: s.menu, tab: s.tab });
    };
    let prev = shape(0);
    for (let ms = 8; ms < script.loop; ms += 8) {
      const now = shape(ms);
      if (now !== prev) {
        const cause = script.events.some((e) => e.at > ms - 8 && e.at <= ms);
        expect(cause, `state changed at ${ms}ms without an action`).toBe(true);
      }
      prev = now;
    }
    // 처음에는 아무것도 없다
    const first = stateAt(script, LINES, 0);
    expect(first.shown.size).toBe(0);
    expect(first.typed).toEqual([0, 0, 0]);
  });

  it('정지 장면은 IE를 다 채운 뒤이고, SQL 탭은 지민이 눌러서 열린다', () => {
    const still = stateAt(script, LINES, script.still);
    expect(still.tab).toBe('ie');
    expect(still.marked).toBe(2);
    expect(still.fills).toEqual({ '1.0.type': 'CHAR(10)', '1.1.type': 'VARCHAR(255)', '1.1.null': 'NOT NULL' });
    expect(still.menu).toBeNull();
    const tab = script.events.find((e) => e.effect.e === 'tab')!;
    expect(tab.who).toBe(0);
    expect(tab.anchor).toEqual({ k: 'tab' });
    expect(stateAt(script, LINES, tab.at - 1).tab).toBe('ie');
    expect(stateAt(script, LINES, tab.at).tab).toBe('sql');
  });
});
