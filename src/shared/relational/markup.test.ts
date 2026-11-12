import { describe, expect, it } from 'vitest';
import { fromMarkup, toMarkup } from './markup';
import { parseMarkup, parseRelational, RELATIONAL_SYNTAX_EXAMPLE } from './text';
import type { RelationalSource } from './userSchema';

/** ⟨ ⟩ 사이를 밑줄로 둔 글 */
function u(marked: string): RelationalSource {
  let text = '';
  const underlines: RelationalSource['underlines'] = [];
  let from = -1;
  for (const ch of marked) {
    if (ch === '⟨') from = text.length;
    else if (ch === '⟩') underlines.push({ from, to: text.length });
    else text += ch;
  }
  return { text, underlines };
}

/** 밑줄 구간을 ⟨ ⟩ 로 다시 적는다 */
function show(s: RelationalSource): string {
  let out = '';
  let at = 0;
  for (const r of s.underlines) {
    out += s.text.slice(at, r.from) + '⟨' + s.text.slice(r.from, r.to) + '⟩';
    at = r.to;
  }
  return out + s.text.slice(at);
}

/** 위치를 뺀 구조 */
const names = (r: ReturnType<typeof parseRelational>) =>
  r.schema.tables.map((t) => [t.name, t.columns.map((c) => [c.name, c.primaryKey]), t.foreignKeys.map((f) => [f.columns, f.refTable, f.refColumns])]);

const COURSE = u(
  [
    'Player (⟨SSN⟩, Name, DOB, Address, Status)',
    'Foreign Key (SSN) references Player (SSN)',
    'Film (⟨Film_ID⟩, Title, Rate)',
    'Film_Director (⟨Film_ID⟩, ⟨Director⟩)',
    'Foreign Key (Film_ID) references Film (Film_ID)',
    'Performs_In (⟨Performer_ID⟩, ⟨Film_ID⟩, Role)  # 출연',
    'Foreign Key (Performer_ID) references Performer (ID)',
    'Foreign Key (Film_ID) references Film (Film_ID)',
    '"Order Item" (⟨"Order No"⟩, ⟨"Line"⟩, "_note_")',
  ].join('\n'),
);

describe('toMarkup', () => {
  it('밑줄 친 이름을 _이름_ 으로 감싼다. 이름 안의 _ 는 그대로다', () => {
    expect(toMarkup(COURSE)).toBe(
      [
        'Player (_SSN_, Name, DOB, Address, Status)',
        'Foreign Key (SSN) references Player (SSN)',
        'Film (_Film_ID_, Title, Rate)',
        'Film_Director (_Film_ID_, _Director_)',
        'Foreign Key (Film_ID) references Film (Film_ID)',
        'Performs_In (_Performer_ID_, _Film_ID_, Role)  # 출연',
        'Foreign Key (Performer_ID) references Performer (ID)',
        'Foreign Key (Film_ID) references Film (Film_ID)',
        '"Order Item" (_"Order No"_, _"Line"_, "_note_")',
      ].join('\n'),
    );
  });

  it('경계 사례', () => {
    const cases: Array<[string, string]> = [
      // 이름 전체
      ['T(⟨a⟩)', 'T(_a_)'],
      // 이름의 일부: 이름 전체로 넓힌다
      ['T(⟨Fi⟩lm_ID)', 'T(_Film_ID_)'],
      ['T(Film⟨_⟩ID)', 'T(_Film_ID_)'],
      // 여러 이름과 그 사이의 공백, 쉼표에 걸친 밑줄: 이름마다 감싸고 공백과 쉼표의 밑줄은 버린다
      ['T(⟨a, b⟩)', 'T(_a_, _b_)'],
      // 공백, 구두점, 주석에만 걸친 밑줄은 버린다
      ['T(a⟨, ⟩b)⟨ # x⟩', 'T(a, b) # x'],
      // 따옴표 이름: 따옴표까지 감싼다. 안쪽만 그어도 같다
      ['T(⟨"a b"⟩, "⟨c⟩")', 'T(_"a b"_, _"c"_)'],
      // 닫히지 않은 따옴표 이름은 감쌀 수 없어 밑줄을 버린다
      ['T(⟨"a b⟩', 'T("a b'],
      // 이미 앞이나 뒤에 _ 가 있는 이름도 한 겹 더 감싼다
      ['T(⟨_a⟩, ⟨b_⟩, ⟨_c_⟩, ⟨_⟩)', 'T(__a_, _b__, __c__, ___)'],
      // 밑줄이 없는데 표시로 읽힐 이름은 따옴표로 묶는다
      ['T(_SSN_, __init__, _a, b_, Film_ID)', 'T("_SSN_", "__init__", _a, b_, Film_ID)'],
      ['T(_"a"_)', 'T("_""a"_)'],
    ];
    for (const [input, expected] of cases) expect(toMarkup(u(input)), input).toBe(expected);
  });

  it('밑줄 범위를 벗어나거나 거꾸로 된 구간은 버린다', () => {
    expect(toMarkup({ text: 'T(a)', underlines: [{ from: 2, to: 99 }, { from: 3, to: 1 }, { from: -5, to: 0 }] })).toBe('T(_a_)');
  });
});

describe('fromMarkup', () => {
  it('앞뒤가 모두 _ 인 낱말만 밑줄이 된다', () => {
    const cases: Array<[string, string]> = [
      ['T(_a_, b)', 'T(⟨a⟩, b)'],
      ['T(_Film_ID_)', 'T(⟨Film_ID⟩)'],
      ['T(Film_ID, _Film_ID, Film_ID_, Film__ID, _, __)', 'T(Film_ID, _Film_ID, Film_ID_, Film__ID, _, __)'],
      ['T(___, __a_, __c__)', 'T(⟨_⟩, ⟨_a⟩, ⟨_c_⟩)'],
      ['T(_"a b"_, "_q_")', 'T(⟨"a b"⟩, "_q_")'],
      // 닫는 _ 가 없으면 그대로 둔다
      ['T(_"a b", c)', 'T(_"a b", c)'],
      // 주석 안은 건드리지 않는다
      ['T(a) # _x_', 'T(a) # _x_'],
      ['Foreign Key (_a_) references _T_ (_b_)', 'Foreign Key (⟨a⟩) references ⟨T⟩ (⟨b⟩)'],
    ];
    for (const [input, expected] of cases) expect(show(fromMarkup(input)), input).toBe(expected);
  });

  it('보통 글은 fromMarkup(toMarkup(s))가 s와 같다', () => {
    const sources = [
      COURSE,
      u(''),
      u('T(⟨a⟩)'),
      u('T(⟨a⟩, ⟨b⟩)\nS (⟨x⟩, y)\nForeign Key (y) references T'),
      u('"수강 신청"(⟨"학생 번호"⟩, 이름)'),
      u('T(⟨_a⟩, ⟨b_⟩, ⟨_c_⟩, ⟨__⟩)'),
      u('T(⟨😀⟩, 😃)'),
      fromMarkup(RELATIONAL_SYNTAX_EXAMPLE),
    ];
    for (const s of sources) expect(fromMarkup(toMarkup(s)), show(s)).toEqual(s);
    // 위치도 표기 글 기준으로 옮긴다(감싼 _ 다음의 이름 첫 글자)
    const r = parseMarkup('Film (_Film_ID_, Title)\nForeign Key (Title) references Film');
    expect(r.schema.tables[0].columns.map((c) => c.column)).toEqual([8, 18]);
    expect(r.schema.tables[0].foreignKeys[0]).toMatchObject({ line: 2, column: 1 });
    expect(toMarkup(fromMarkup(RELATIONAL_SYNTAX_EXAMPLE))).toBe(RELATIONAL_SYNTAX_EXAMPLE);
  });

  it('바뀌는 경계 사례도 읽은 구조는 같다', () => {
    for (const marked of ['T(⟨Fi⟩lm, x)', 'T(⟨a, b⟩)', 'T(_k_, ⟨a⟩)', 'T("⟨c⟩")', '⟨T⟩(⟨a⟩)']) {
      const s = u(marked);
      const back = fromMarkup(toMarkup(s));
      expect(names(parseRelational(back)), marked).toEqual(names(parseRelational(s)));
      expect(names(parseMarkup(toMarkup(s))), marked).toEqual(names(parseRelational(s)));
    }
  });
});
