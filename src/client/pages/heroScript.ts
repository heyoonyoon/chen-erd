/**
 * 첫 화면 제품 화면 예시(HomePreview)의 각본. 화면에 닿지 않는 순수 계산만 둔다.
 *
 * 각본은 사람별 행동 목록이다. 행동은 둘뿐이다.
 *   - 이동(Move): 직전 자리에서 다음 자리(Anchor)로 휘는 길을 따라 간다. 끄는 중(drag)일 수도 있다
 *   - 사건(Event): 지금 자리에서 누르기(click), 끌기 시작(drag), 글자 치기(type). 화면 상태는 오직 사건의 결과로만 바뀐다
 * 자리(Anchor)는 화면 요소를 가리키는 이름이고, 실제 좌표는 그리는 쪽이 재서 준다(resolve).
 * 포인터 자리는 시간에 대한 연속 함수(cursorAt)라서 단계가 바뀌거나 처음으로 돌아가도 순간이동하지 않는다.
 */
import { approximateLineWidth } from '../text/measure';

export interface Pt {
  x: number;
  y: number;
}
export type Who = 0 | 1;

/** IE 칸: [표 번호, 컬럼 번호, 칸 종류] */
export type CellKind = 'type' | 'null';
export type CellRef = readonly [number, number, CellKind];
export const cellKey = ([ti, ci, kind]: CellRef) => `${ti}.${ci}.${kind}`;

export type Anchor =
  /** ERD 그림 좌표 */
  | { k: 'erd'; x: number; y: number }
  /** 관계 모델 편집기 n번째 줄의 시작 */
  | { k: 'line'; line: number }
  /** 밑줄을 그을 기본키 낱말의 앞 끝이나 뒤 끝 */
  | { k: 'word'; key: number; end: boolean }
  /** 편집기 도구 막대의 밑줄 버튼 */
  | { k: 'underline' }
  /** 편집기 안에서 글을 가리지 않는 빈자리 */
  | { k: 'relRest' }
  /** IE 칸 */
  | { k: 'cell'; cell: CellRef }
  /** IE 칸 메뉴의 항목 */
  | { k: 'item'; cell: CellRef; index: number }
  /** IE 그룹의 SQL 탭 */
  | { k: 'tab' };

export type Effect =
  | { e: 'place'; ids: string[] }
  | { e: 'label'; edge: string }
  | { e: 'focus' }
  | { e: 'type'; line: number; chars: number }
  | { e: 'select'; key: number }
  | { e: 'underline'; key: number }
  | { e: 'menu'; cell: CellRef }
  | { e: 'fill'; cell: CellRef; value: string }
  | { e: 'tab' };

export interface Move {
  who: Who;
  at: number;
  dur: number;
  from: Anchor;
  to: Anchor;
  /** 길이 휘는 정도(거리에 대한 비율, 부호가 방향) */
  bend: number;
  /** 끝에서 조금 지나쳤다 돌아오는 정도 */
  over: number;
  /** 버튼을 누른 채로 끄는 중이면 고르는 기본키 번호 */
  drag?: number;
}

export interface ScriptEvent {
  who: Who;
  at: number;
  kind: 'click' | 'drag' | 'type';
  /** 누르거나 끌기 시작한 자리. 글자 치기는 자판이라 없다 */
  anchor: Anchor | null;
  effect: Effect;
}

export interface Script {
  moves: Move[];
  events: ScriptEvent[];
  /** 두 사람이 처음 있는 자리(마지막에 이리로 돌아온다) */
  start: [Anchor, Anchor];
  /** 정지 장면으로 보여 줄 시각(SQL 탭을 누르기 직전, IE가 다 채워진 때) */
  still: number;
  /** 이 시각부터 화면 전체가 흐려지고 loop에서 처음으로 돌아간다 */
  leaveAt: number;
  loop: number;
  /** SQL 탭을 누른 시각 */
  sqlAt: number;
}

// ───────────────────────── 예시 그림 좌표 ─────────────────────────

/** ERD 도형의 가운데와 카디널리티 글자 자리(그림 좌표). HomePreview의 NODES와 같은 자리다 */
const AT = {
  stu: { x: 160, y: 68 },
  dep: { x: 160, y: 304 },
  bel: { x: 160, y: 186 },
  sid: { x: 48, y: 20 },
  snm: { x: 276, y: 20 },
  dcd: { x: 52, y: 364 },
  dnm: { x: 267, y: 364 },
  r1: { x: 176, y: 122 },
  r2: { x: 178, y: 252 },
};
const erd = (p: Pt): Anchor => ({ k: 'erd', x: p.x, y: p.y });

/** 메뉴 항목 */
export const TYPE_ITEMS = 7;
export const NULL_ITEMS = 3;

export const CHAR_MS = 42;
const LINE_MS = 240;
export const SQL_LINE_MS = 120;

/**
 * 각본을 만든다. 사람마다 시계를 따로 두고 행동을 차례로 쌓는다.
 * lines는 관계 모델 글 세 줄, keys는 밑줄을 그을 [줄 번호, 낱말]이다.
 */
export function buildScript(lines: string[]): Script {
  const moves: Move[] = [];
  const events: ScriptEvent[] = [];
  const start: [Anchor, Anchor] = [erd({ x: 296, y: 150 }), erd({ x: -24, y: 214 })];
  const clock = [0, 0];
  const here: [Anchor, Anchor] = [start[0], start[1]];
  const move = (who: Who, to: Anchor, dur: number, bend = 0.12, over = 0.9, drag?: number) => {
    moves.push({ who, at: clock[who], dur, from: here[who], to, bend, over, drag });
    clock[who] += dur;
    here[who] = to;
  };
  const wait = (who: Who, ms: number) => {
    clock[who] += ms;
  };
  const until = (who: Who, t: number) => {
    clock[who] = Math.max(clock[who], t);
  };
  /** 누르기 전에 잠깐 멈칫한다 */
  const click = (who: Who, effect: Effect, pause = 110) => {
    clock[who] += pause;
    events.push({ who, at: clock[who], kind: 'click', anchor: here[who], effect });
    clock[who] += 70;
  };
  const type = (who: Who, line: number, text: string, from = 0) => {
    const n = Array.from(text).length;
    for (let i = from; i < n; i++) {
      events.push({ who, at: clock[who], kind: 'type', anchor: null, effect: { e: 'type', line, chars: i + 1 } });
      clock[who] += CHAR_MS;
    }
  };
  /** 버튼을 누르고(끌기 시작) 낱말 끝까지 끈다 */
  const dragSelect = (who: Who, key: number, dur: number) => {
    clock[who] += 90;
    events.push({ who, at: clock[who], kind: 'drag', anchor: here[who], effect: { e: 'select', key } });
    move(who, { k: 'word', key, end: true }, dur, 0, 0, key);
  };

  // ── 1. ERD: 지민은 엔티티와 관계를 놓고 카디널리티를 적는다. 서연은 조금 늦게 들어와 속성을 붙인다
  wait(0, 150);
  move(0, erd(AT.stu), 460, 0.18, 1.1);
  click(0, { e: 'place', ids: ['stu'] }, 120);
  move(0, erd(AT.dep), 420, -0.22, 0.9);
  click(0, { e: 'place', ids: ['dep'] }, 100);
  move(0, erd(AT.bel), 330, 0.12, 1.2);
  click(0, { e: 'place', ids: ['bel', 'r1', 'r2'] }, 130);
  move(0, erd(AT.r1), 300, -0.16, 0.8);
  click(0, { e: 'label', edge: 'r1' }, 100);
  move(0, erd(AT.r2), 300, 0.2, 1);
  click(0, { e: 'label', edge: 'r2' }, 90);
  move(0, erd({ x: 262, y: 228 }), 420, 0.1, 0.4);

  wait(1, 380);
  move(1, erd(AT.sid), 540, -0.2, 0.8);
  click(1, { e: 'place', ids: ['sid', 'a1'] }, 120);
  move(1, erd(AT.snm), 360, 0.14, 1.2);
  click(1, { e: 'place', ids: ['snm', 'a2'] }, 90);
  until(1, events.find((ev) => ev.effect.e === 'place' && ev.effect.ids.includes('dep'))!.at + 200);
  move(1, erd(AT.dcd), 480, -0.1, 0.7);
  click(1, { e: 'place', ids: ['dcd', 'a3'] }, 110);
  move(1, erd(AT.dnm), 320, 0.16, 1);
  click(1, { e: 'place', ids: ['dnm', 'a4'] }, 100);

  // ── 2. 관계 모델: 서연이 첫 줄을 눌러 자리를 잡고, 글을 가리지 않게 비켜 둔 뒤 자판으로 적는다
  move(1, { k: 'line', line: 0 }, 700, -0.12, 0.6);
  click(1, { e: 'focus' }, 120);
  move(1, { k: 'relRest' }, 360, 0.2, 0.3);
  wait(1, 120);
  lines.forEach((line, i) => {
    type(1, i, line);
    if (i < lines.length - 1) wait(1, LINE_MS);
  });
  wait(1, 300);
  // 기본키를 끌어 고르고 밑줄 버튼을 누른다
  for (const key of [0, 1]) {
    move(1, { k: 'word', key, end: false }, 420, 0.14, 0.5);
    dragSelect(1, key, 380);
    wait(1, 60);
    move(1, { k: 'underline' }, 420, -0.18, 0.6);
    click(1, { e: 'underline', key }, 140);
  }
  move(1, { k: 'relRest' }, 460, 0.12, 0.4);

  // ── 3. IE: 밑줄을 다 그은 뒤 지민이 IE로 와서 타입 두 칸과 NULL 한 칸을 메뉴에서 고른다
  until(0, clock[1] - 200);
  const pick = (cell: CellRef, index: number, value: string, first: boolean) => {
    move(0, { k: 'cell', cell }, first ? 760 : 320, first ? -0.14 : 0.16, first ? 0.5 : 0.9);
    click(0, { e: 'menu', cell }, 120);
    wait(0, 220);
    move(0, { k: 'item', cell, index }, 300 + index * 12, 0.1, 0.6);
    wait(0, 220);
    click(0, { e: 'fill', cell, value }, 60);
  };
  pick([1, 0, 'type'], 6, 'CHAR(10)', true);
  pick([1, 1, 'type'], 5, 'VARCHAR(255)', false);
  pick([1, 1, 'null'], 1, 'NOT NULL', false);
  const still = clock[0] + 300;

  // ── 4. SQL: 지민이 SQL 탭을 누르면 CREATE TABLE 문이 나온다
  move(0, { k: 'tab' }, 520, -0.2, 0.7);
  wait(0, 200);
  click(0, { e: 'tab' }, 60);
  const sqlAt = clock[0] - 70;
  wait(0, 3000);
  // 두 사람이 처음 자리로 돌아간 뒤 화면 전체가 흐려진다
  const back = Math.max(clock[0], clock[1]);
  until(0, back);
  until(1, back + 120);
  move(0, start[0], 760, 0.16, 0.2);
  move(1, start[1], 760, -0.12, 0.2);
  const leaveAt = Math.max(clock[0], clock[1]) + 100;
  // 두 사람의 사건을 시간순으로 섞는다(stateAt은 시간순으로 쌓는다)
  events.sort((a, b) => a.at - b.at);
  moves.sort((a, b) => a.at - b.at);
  return { moves, events, start, still, leaveAt, loop: leaveAt + 500, sqlAt };
}

// ───────────────────────── 포인터 자리 ─────────────────────────

const easeOutBack = (t: number, c: number) => 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);

/** 이동 진행도(0~1)를 경로 위치 비율로. 부드럽게 출발해 목표 근처에서 느려지고 조금 지나쳤다 돌아온다 */
export function moveEase(t: number, over: number): number {
  const u = t * t * (3 - 2 * t) * 0.45 + t * 0.55;
  return over > 0 ? easeOutBack(u, over) : 1 - Math.pow(1 - u, 3);
}

/** a에서 b로 가는 휘는 길(2차 베지어)의 e 지점 */
export function bendPoint(a: Pt, b: Pt, bend: number, e: number): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const c = { x: (a.x + b.x) / 2 - dy * bend, y: (a.y + b.y) / 2 + dx * bend };
  const u = 1 - e;
  return { x: u * u * a.x + 2 * u * e * c.x + e * e * b.x, y: u * u * a.y + 2 * u * e * c.y + e * e * b.y };
}

/** ms 시각에 who의 포인터가 있는 자리. 쉬는 동안에도 아주 조금 흔들린다 */
export function cursorAt(script: Script, who: Who, ms: number, resolve: (a: Anchor) => Pt): Pt {
  let anchor = script.start[who];
  let p: Pt | null = null;
  for (const m of script.moves) {
    if (m.who !== who) continue;
    if (ms < m.at) break;
    if (ms >= m.at + m.dur) {
      anchor = m.to;
      continue;
    }
    const t = (ms - m.at) / m.dur;
    p = bendPoint(resolve(m.from), resolve(m.to), m.bend, moveEase(t, m.over));
    break;
  }
  const base = p ?? resolve(anchor);
  // 끄는 동안에는 흔들지 않는다
  if (script.moves.some((m) => m.who === who && m.drag !== undefined && ms >= m.at && ms < m.at + m.dur)) return base;
  const phase = who === 0 ? 0.7 : 2.3;
  const wobble = Math.sin(ms / 230 + phase) * Math.sin(ms / 710 + phase * 2);
  return { x: base.x + wobble * 1.2, y: base.y + Math.cos(ms / 310 + phase) * wobble };
}

/** ms 시각에 who가 마지막으로 간(또는 가고 있는) 자리와 도착했는지 */
export function targetAt(script: Script, who: Who, ms: number): { anchor: Anchor; arrived: boolean } {
  let anchor = script.start[who];
  let arrived = true;
  for (const m of script.moves) {
    if (m.who !== who || ms <= m.at) continue;
    anchor = m.to;
    arrived = ms >= m.at + m.dur;
  }
  return { anchor, arrived };
}

// ───────────────────────── 화면 상태 ─────────────────────────

export interface HeroState {
  shown: ReadonlySet<string>;
  /** 사람별로 마지막에 놓은 도형(선택 테두리) */
  picks: readonly [string | null, string | null];
  /** 줄마다 적힌 글자 수와 다 적었는지 */
  typed: number[];
  lineDone: boolean[];
  /** 편집기에 서연의 캐럿이 있는 줄. 없으면 -1 */
  caretLine: number;
  /** 고른 기본키와 고른 비율(끄는 만큼). 없으면 null */
  sel: { key: number; frac: number } | null;
  /** 밑줄 버튼: 포인터가 올라감, 눌림 */
  btn: 'hover' | 'pressed' | null;
  marked: number;
  fills: Readonly<Record<string, string>>;
  /** 열린 메뉴와 포인터가 올라간 항목 */
  menu: CellRef | null;
  hover: number;
  tab: 'ie' | 'sql';
  tabHover: boolean;
  sqlLines: number;
  /** 누른 자리를 잠깐 보여 주는 표시(사람, 남은 비율) */
  clicks: Array<{ who: Who; anchor: Anchor; age: number }>;
  leaving: boolean;
}

const sameCell = (a: CellRef | null, b: CellRef) => !!a && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** 사건을 시간순으로 쌓아 ms 시각의 화면 상태를 만든다. 사건이 아닌 것으로는 상태가 바뀌지 않는다 */
export function stateAt(script: Script, lines: string[], ms: number): HeroState {
  const shown = new Set<string>();
  const picks: [string | null, string | null] = [null, null];
  const typed = lines.map(() => 0);
  let focused = false;
  let marked = 0;
  let selKey = -1;
  const fills: Record<string, string> = {};
  let menu: CellRef | null = null;
  let tab: 'ie' | 'sql' = 'ie';
  let lastUnderline = -Infinity;
  const clicks: HeroState['clicks'] = [];
  for (const ev of script.events) {
    if (ev.at > ms) break;
    const f = ev.effect;
    if (ev.kind !== 'type' && ev.anchor && ms - ev.at < 360) clicks.push({ who: ev.who, anchor: ev.anchor, age: (ms - ev.at) / 360 });
    if (f.e === 'place') {
      f.ids.forEach((id) => shown.add(id));
      picks[ev.who] = f.ids[0];
    } else if (f.e === 'label') {
      shown.add(`${f.edge}L`);
      picks[ev.who] = null;
    } else if (f.e === 'focus') focused = true;
    else if (f.e === 'type') typed[f.line] = f.chars;
    else if (f.e === 'select') {
      selKey = f.key;
      focused = false;
    }
    else if (f.e === 'underline') {
      marked = Math.max(marked, f.key + 1);
      lastUnderline = ev.at;
      selKey = -1;
    } else if (f.e === 'menu') menu = f.cell;
    else if (f.e === 'fill') {
      fills[cellKey(f.cell)] = f.value;
      if (sameCell(menu, f.cell)) menu = null;
    } else if (f.e === 'tab') tab = 'sql';
  }
  // 끄는 만큼 고른다(끌기의 결과)
  let sel: HeroState['sel'] = null;
  if (selKey >= 0) {
    const drag = script.moves.find((m) => m.drag === selKey);
    const frac = drag ? Math.min(1, Math.max(0, (ms - drag.at) / drag.dur)) : 1;
    sel = { key: selKey, frac };
  }
  // 포인터가 올라간 것(도착한 자리)
  const s = targetAt(script, 1, ms);
  const j = targetAt(script, 0, ms);
  const btn: HeroState['btn'] = ms - lastUnderline < 300 ? 'pressed' : s.arrived && s.anchor.k === 'underline' ? 'hover' : null;
  const hover = menu && j.arrived && j.anchor.k === 'item' && sameCell(menu, j.anchor.cell) ? j.anchor.index : -1;
  const lengths = lines.map((l) => Array.from(l).length);
  const caretLine = focused ? Math.max(0, typed.findIndex((n, i) => n < lengths[i])) : -1;
  const sqlAt = script.sqlAt;
  return {
    shown,
    picks,
    typed,
    lineDone: typed.map((n, i) => n >= lengths[i]),
    caretLine: focused && typed.every((n, i) => n >= lengths[i]) ? lines.length - 1 : caretLine,
    sel,
    btn,
    marked,
    fills,
    menu,
    hover,
    tab,
    tabHover: tab === 'ie' && j.arrived && j.anchor.k === 'tab',
    sqlLines: tab === 'sql' ? Math.floor((ms - sqlAt - 200) / SQL_LINE_MS) + 1 : 0,
    clicks,
    leaving: ms >= script.leaveAt,
  };
}

// ───────────────────────── IE 그림의 짜임 ─────────────────────────

/** 방 화면의 IE와 같은 짜임: 머리 아래 [PK/FK | 이름 | 타입 | NULL] 네 칸 */
export const IE = { head: 34, row: 26, tag: 30, font: 12, pad: 8, nul: 70, gap: 52 };
/** 칸 메뉴(방 화면의 PaneMenu 모양): 항목 높이, 안쪽 여백 */
export const MENU = { item: 21, pad: 4 };

export interface IeGeom {
  w: number;
  ys: number[];
  heights: number[];
  total: number;
  nameW: number;
  typeW: number;
  X: { name: number; type: number; null: number };
  cell: (c: CellRef) => { x: number; y: number; w: number; h: number };
  menu: (c: CellRef, items: string[], check: boolean) => { x: number; y: number; w: number; h: number };
}

/** 표 이름과 컬럼 이름(언어마다 다르다)으로 IE 그림의 칸 자리를 정한다 */
export function ieGeometry(tables: Array<{ cols: string[] }>): IeGeom {
  const nameW = Math.ceil(Math.max(...tables.flatMap((tb) => tb.cols.map((c) => approximateLineWidth(c, IE.font)))) + IE.pad * 2);
  const typeW = Math.ceil(approximateLineWidth('VARCHAR(255)', IE.font - 1) + IE.pad * 2);
  const w = IE.tag + nameW + typeW + IE.nul;
  const heights = tables.map((tb) => IE.head + tb.cols.length * IE.row);
  const ys = [0, heights[0] + IE.gap];
  const X = { name: IE.tag, type: IE.tag + nameW, null: IE.tag + nameW + typeW };
  const cell = ([ti, ci, kind]: CellRef) => ({ x: kind === 'type' ? X.type : X.null, y: ys[ti] + IE.head + ci * IE.row, w: kind === 'type' ? typeW : IE.nul, h: IE.row });
  const menu = (c: CellRef, items: string[], check: boolean) => {
    const box = cell(c);
    const mw = Math.ceil(Math.max(...items.map((it) => approximateLineWidth(it, 11))) + 20 + (check ? 18 : 0));
    const mh = items.length * MENU.item + MENU.pad * 2;
    // 아래 표에서는 칸 위로 연다(방 화면도 아래 공간이 모자라면 위로 연다)
    return { x: Math.min(box.x, w + 12 - mw), y: c[0] === 1 ? box.y - mh - 3 : box.y + box.h + 3, w: mw, h: mh };
  };
  return { w, ys, heights, total: ys[1] + heights[1], nameW, typeW, X, cell, menu };
}
