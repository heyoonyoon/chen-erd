import { describe, expect, it } from 'vitest';
import { formatName, parseMarkup, parseRelational, RELATIONAL_SYNTAX, RELATIONAL_SYNTAX_EXAMPLE } from './text';
import type { RelationalSource, RelProblem } from './userSchema';

/** ⟨ ⟩ 사이를 밑줄로 둔 글. 시험에서 밑줄 서식을 _ 와 섞지 않고 적으려고 쓴다 */
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

/** 문제를 '줄:칸-끝 심각도 키'로 */
function brief(problems: RelProblem[]): string[] {
  return problems.map((p) => `${p.line}:${p.column}${p.endColumn ? `-${p.endColumn}` : ''} ${p.severity} ${p.message.key}`);
}

const problemsOf = (marked: string) => brief(parseRelational(u(marked)).problems);

/** 테이블을 '이름(컬럼들) fk' 꼴로. 기본키는 *이름 */
function shape(input: string | RelationalSource) {
  return parseRelational(input).schema.tables.map((t) => ({
    name: t.name,
    columns: t.columns.map((c) => (c.primaryKey ? `*${c.name}` : c.name)),
    fks: t.foreignKeys.map((f) => `${f.columns.join(',')}->${f.refTable}${f.refColumns ? `(${f.refColumns.join(',')})` : ''}`),
  }));
}

const COURSE = [
  'Player (⟨SSN⟩, Name, DOB, Address, Status)',
  'Foreign Key (SSN) references Player (SSN)',
  'Film (⟨Film_ID⟩, Title, Rate)',
  'Film_Director (⟨Film_ID⟩, ⟨Director⟩)',
  'Foreign Key (Film_ID) references Film (Film_ID)',
  'Performs_In (⟨Performer_ID⟩, ⟨Film_ID⟩, Role)',
  'Foreign Key (Performer_ID) references Performer (ID)',
  'Foreign Key (Film_ID) references Film (Film_ID)',
].join('\n');

describe('parseRelational: 수업 표기', () => {
  it('수업 예시를 밑줄 그은 그대로 읽는다(Performer 테이블은 예시에 없어서 그 하나만 오류)', () => {
    const r = parseRelational(u(COURSE));
    expect(brief(r.problems)).toEqual(['7:39-48 error rel.schema.unknownTable']);
    expect(shape(u(COURSE))).toEqual([
      { name: 'Player', columns: ['*SSN', 'Name', 'DOB', 'Address', 'Status'], fks: ['SSN->Player(SSN)'] },
      { name: 'Film', columns: ['*Film_ID', 'Title', 'Rate'], fks: [] },
      { name: 'Film_Director', columns: ['*Film_ID', '*Director'], fks: ['Film_ID->Film(Film_ID)'] },
      { name: 'Performs_In', columns: ['*Performer_ID', '*Film_ID', 'Role'], fks: ['Performer_ID->Performer(ID)', 'Film_ID->Film(Film_ID)'] },
    ]);
    const fk = r.schema.tables[3].foreignKeys[1];
    expect(fk).toEqual({ columns: ['Film_ID'], refTable: 'Film', refColumns: ['Film_ID'], line: 8, column: 1 });
    // Performer를 더하면 문제가 없다
    expect(parseRelational(u(`${COURSE}\nPerformer (⟨ID⟩, Name)`)).problems).toEqual([]);
  });

  it('낱말은 대소문자를 따지지 않고 공백은 자유롭다. references는 다음 줄에 와도 되고, 빈 줄과 주석을 사이에 두어도 된다', () => {
    const text = [
      'T (⟨x⟩, ⟨y⟩)',
      'S(⟨a⟩, b, c)',
      '',
      '# 외래키',
      'FOREIGN   KEY(  b ,c )REFERENCES  T(x,y)',
      'foreign key (b, c)',
      '   References t',
    ].join('\n');
    const r = parseRelational(u(text));
    expect(r.problems).toEqual([]);
    expect(shape(u(text))[1].fks).toEqual(['b,c->T(x,y)', 'b,c->t']);
    expect(r.schema.tables[1].foreignKeys[1].refColumns).toBeUndefined();
  });

  it('테이블 이름과 ( 사이의 공백, 여러 줄 괄호', () => {
    expect(shape(u('Student   (⟨ID⟩,\n  Name)'))).toEqual([{ name: 'Student', columns: ['*ID', 'Name'], fks: [] }]);
  });

  it('위치, 따옴표, 빈 글', () => {
    expect(parseRelational('')).toEqual({ schema: { tables: [] }, problems: [] });
    expect(parseRelational(u('  \n# 비어 있음\n'))).toEqual({ schema: { tables: [] }, problems: [] });
    const r = parseRelational(u('"수강 신청"(⟨"학생 번호"⟩, "메모 \\"1\\"")\n"학생   명부"(⟨" 학번 "⟩)'));
    expect(r.schema.tables[0].columns.map((c) => [c.name, c.primaryKey, c.line, c.column])).toEqual([
      ['학생 번호', true, 1, 9],
      ['메모 "1"', false, 1, 18],
    ]);
    expect(r.schema.tables[1].name).toBe('학생 명부');
    expect(r.schema.tables[1].columns[0].name).toBe('학번');
  });

  it('문자열은 밑줄이 없는 글이다(_이름_ 을 기본키로 읽지 않는다)', () => {
    const r = parseRelational('T(_a_)');
    expect(r.schema.tables[0].columns[0]).toMatchObject({ name: '_a_', primaryKey: false });
  });

  it('formatName은 필요할 때만 따옴표로 묶고, 묶은 이름은 다시 같은 이름으로 읽힌다', () => {
    expect(formatName('학생')).toBe('학생');
    expect(formatName('Film_ID')).toBe('Film_ID');
    expect(formatName('학생 번호')).toBe('"학생 번호"');
    for (const name of ['a"b', 'x->y', '_k', '_k_', '(괄호)', 'a,b', '#tag']) {
      expect(parseRelational(`${formatName(name)}(k)`).schema.tables[0].name, name).toBe(name);
    }
  });
});

describe('parseRelational: 밑줄', () => {
  it('밑줄이 이름 전체에 걸리면 기본키. 공백과 쉼표에 걸친 밑줄은 무시한다', () => {
    const r = parseRelational(u('T(⟨a, b⟩, ⟨"c d"⟩, ⟨e ⟩, f)'));
    expect(r.problems).toEqual([]);
    expect(shape(u('T(⟨a, b⟩, ⟨"c d"⟩, ⟨e ⟩, f)'))[0].columns).toEqual(['*a', '*b', '*c d', '*e', 'f']);
    // 따옴표 안의 이름만 그어도, 공백만 빼고 그어도 이름 전체로 본다
    expect(problemsOf('T(⟨"c⟩ ⟨d"⟩)')).toEqual([]);
    expect(problemsOf('T("⟨c d⟩")')).toEqual([]);
    // 공백과 구두점에만 그은 밑줄은 아무것도 아니다
    expect(shape(u('T(a⟨, ⟩b)'))[0].columns).toEqual(['a', 'b']);
  });

  it('이름의 일부만 그으면 경고하고 기본키로 본다', () => {
    const r = parseRelational(u('Film(⟨Fi⟩lm_ID, Title)'));
    expect(brief(r.problems)).toEqual(['1:6-13 warning rel.syntax.partialUnderline']);
    expect(r.schema.tables[0].columns[0]).toMatchObject({ name: 'Film_ID', primaryKey: true });
  });

  it('테이블 이름과 Foreign Key 줄에 그은 밑줄은 경고하고 무시한다', () => {
    const text = '⟨T⟩(⟨a⟩)\nS(⟨b⟩)\n⟨Foreign⟩ Key (⟨b⟩) references ⟨T⟩ (⟨a⟩)';
    const r = parseRelational(u(text));
    expect(brief(r.problems)).toEqual([
      '1:1-2 warning rel.syntax.underlineIgnored',
      '3:1-8 warning rel.syntax.underlineIgnored',
      '3:14-15 warning rel.syntax.underlineIgnored',
      '3:28-29 warning rel.syntax.underlineIgnored',
      '3:31-32 warning rel.syntax.underlineIgnored',
    ]);
    expect(shape(u(text))).toEqual([
      { name: 'T', columns: ['*a'], fks: [] },
      { name: 'S', columns: ['*b'], fks: ['b->T(a)'] },
    ]);
  });

  it('밑줄 문자(_)는 이름의 글자다. 앞뒤가 모두 _ 인 이름만 밑줄을 그으라고 경고한다', () => {
    const text = 'T(_SSN_, Film_ID, _Film_ID, Film_ID_, Film__ID, _, __, __init__, "_q_")';
    const r = parseRelational(text);
    expect(r.schema.tables[0].columns.map((c) => c.name)).toEqual(['_SSN_', 'Film_ID', '_Film_ID', 'Film_ID_', 'Film__ID', '_', '__', '__init__', '_q_']);
    expect(r.schema.tables[0].columns.every((c) => !c.primaryKey)).toBe(true);
    expect(brief(r.problems)).toEqual([
      '1:1-2 warning rel.schema.noPrimaryKey',
      '1:3-8 warning rel.syntax.underscoreKey',
      '1:56-64 warning rel.syntax.underscoreKey',
    ]);
    expect(r.problems[1].message.params?.name).toEqual({ key: 'rules.name.quoted', params: { name: '_SSN_' } });
    // 밑줄을 그었으면 경고하지 않는다(이름은 그대로 _SSN_)
    expect(brief(parseRelational(u('T(⟨_SSN_⟩)')).problems)).toEqual([]);
    // 밑줄 친 Film_ID는 이름 그대로 Film_ID인 기본키다
    expect(shape(u('T(⟨Film_ID⟩, Film_ID_x)'))[0].columns).toEqual(['*Film_ID', 'Film_ID_x']);
  });
});

describe('parseRelational: Foreign Key 줄의 문제와 위치', () => {
  it('문법 오류마다 위치를 적는다', () => {
    const cases: Array<[string, string]> = [
      ['Foreign Key (a) references T\nT(⟨a⟩)', '1:1-12 error rel.syntax.foreignKeyBeforeTable'],
      ['T(⟨a⟩)\nForeign Key a references T', '2:13-14 error rel.syntax.expectedForeignKeyColumns'],
      ['T(⟨a⟩)\nForeign Key () references T', '2:14-15 error rel.syntax.expectedColumn'],
      ['T(⟨a⟩)\nForeign Key (a) T', '2:17-18 error rel.syntax.expectedReferences'],
      ['T(⟨a⟩)\nForeign Key (a) references', '2:27 error rel.syntax.expectedRefTable'],
      ['T(⟨a⟩)\nForeign Key (a) references (a)', '2:28-29 error rel.syntax.expectedRefTable'],
      ['T(⟨a⟩, b)\nForeign Key (a, A) references T', '2:17-18 error rel.syntax.duplicateInList'],
      ['T(⟨a⟩)\nForeign Key (a) references T (a, a)', '2:34-35 error rel.syntax.duplicateInList'],
      ['T(⟨a⟩)\nForeign Key (a) references T (a) x', '2:34-35 error rel.syntax.extraAfterTable'],
      ['T(⟨a⟩)\nForeign Key (a b) references T', '2:16-17 error rel.syntax.expectedCommaOrClose'],
      ['T(⟨a⟩)\nForeign Key (a references T', '2:16-26 error rel.syntax.expectedCommaOrClose'],
      ['T(⟨a⟩)\nForeign Key (a) references T (a', '2:30-31 error rel.syntax.unclosedParen'],
      ['T(⟨a⟩)\nForeign Key (a,\nS(⟨b⟩)', '2:13-14 error rel.syntax.unclosedParen'],
    ];
    for (const [text, expected] of cases) expect(problemsOf(text), text).toContain(expected);
  });

  it('위 테이블에 없는 컬럼을 적으면 그 이름에 오류를 내고 외래키는 버린다', () => {
    const r = parseRelational(u('T(⟨a⟩)\nS(⟨b⟩, c)\nForeign Key (c, d, e) references T'));
    expect(brief(r.problems)).toEqual(['3:17-18 error rel.schema.unknownForeignKeyColumn', '3:20-21 error rel.schema.unknownForeignKeyColumn']);
    expect(r.problems[0].message.params).toEqual({
      table: { key: 'rules.name.quoted', params: { name: 'S' } },
      name: { key: 'rules.name.quoted', params: { name: 'd' } },
    });
    expect(r.schema.tables[1].foreignKeys).toEqual([]);
  });

  it('가리키는 컬럼은 그 테이블의 기본키와 개수와 이름이 같아야 한다(순서는 상관없다)', () => {
    const base = 'P(⟨k1⟩, ⟨k2⟩, v)\nC(⟨x⟩, y, z)\n';
    const at = (line: string) => problemsOf(base + line);
    expect(at('Foreign Key (y, z) references P (k2, K1)')).toEqual([]);
    expect(at('Foreign Key (y, z) references P (k1)')).toEqual(['3:33-37 error rel.schema.refColumnCount']);
    expect(at('Foreign Key (y, z) references P (k1, v)')).toEqual(['3:38-39 error rel.schema.refNotPrimaryKey']);
    expect(at('Foreign Key (y, z) references P (k1, w)')).toEqual(['3:38-39 error rel.schema.unknownRefColumn']);
    expect(at('Foreign Key (y) references P (k1)')).toEqual(['3:1-34 error rel.schema.foreignKeyArity']);
    expect(at('Foreign Key (y) references P')).toEqual(['3:1-29 error rel.schema.foreignKeyArity']);
    expect(at('Foreign Key (y) references Q')).toEqual(['3:28-29 error rel.schema.unknownTable']);
    const r = parseRelational(u(`${base}Foreign Key (y, z) references P (k1, v)`));
    expect(r.problems[0].message).toEqual({
      key: 'rel.schema.refNotPrimaryKey',
      params: { table: { key: 'rules.name.quoted', params: { name: 'P' } }, name: { key: 'rules.name.quoted', params: { name: 'v' } } },
    });
  });

  it('기본키가 없는 테이블을 가리키면 오류, 기본키가 없는 테이블은 경고', () => {
    const r = parseRelational(u('로그(시각, 내용)\n알림(⟨번호⟩, 시각)\nForeign Key (시각) references 로그'));
    expect(brief(r.problems)).toEqual(['1:1-3 warning rel.schema.noPrimaryKey', '3:29-31 error rel.schema.refNoPrimaryKey']);
  });

  it('자기 자신을 가리키는 외래키(재귀)는 바르다', () => {
    expect(parseRelational(u('직원(⟨사번⟩, 상사)\nForeign Key (상사) references 직원')).problems).toEqual([]);
  });
});

describe('parseRelational: 화살표 표기는 받지 않는다', () => {
  it('컬럼 -> 테이블, (a, b) -> 테이블은 Foreign Key 줄로 적으라는 오류', () => {
    expect(problemsOf('X(⟨a⟩)\nT(⟨a⟩, b -> X)')).toEqual(['2:6-12 error rel.syntax.arrowNotSupported']);
    expect(problemsOf('X(⟨a⟩)\nT(⟨a⟩, b → X)')).toEqual(['2:6-11 error rel.syntax.arrowNotSupported']);
    expect(problemsOf('X(⟨a⟩, ⟨b⟩)\nT(⟨k⟩, (a, b) -> X)')).toEqual(['2:6-17 error rel.syntax.arrowNotSupported']);
    expect(problemsOf('T(⟨a⟩, b ->\n  X)')).toEqual(['1:6-10 error rel.syntax.arrowNotSupported']);
    // 화살표가 없는 괄호 묶음은 그냥 컬럼 자리 오류
    expect(problemsOf('T(⟨k⟩, (a, b))')).toEqual(['1:6-7 error rel.syntax.expectedColumn']);
  });

  it('화살표 오류 뒤에도 다음 테이블과 Foreign Key 줄을 읽는다', () => {
    const text = 'X(⟨a⟩)\nT(⟨k⟩, a -> X)\nForeign Key (a) references X\nS(⟨s⟩)';
    expect(shape(u(text))).toEqual([
      { name: 'X', columns: ['*a'], fks: [] },
      { name: 'T', columns: ['*k', 'a'], fks: ['a->X'] },
      { name: 'S', columns: ['*s'], fks: [] },
    ]);
  });
});

describe('parseRelational: 그 밖의 문법 오류와 이어 읽기', () => {
  it('같은 테이블 이름(대소문자 무시)과 같은 컬럼은 오류이고 처음 것만 남는다', () => {
    const r = parseRelational(u('Student(⟨id⟩)\nstudent(⟨no⟩)\nT(⟨a⟩, b, "b")'));
    expect(brief(r.problems)).toEqual(['2:1-8 error rel.syntax.duplicateTable', '3:9-12 error rel.syntax.duplicateColumn']);
    expect(r.schema.tables.map((t) => t.name)).toEqual(['Student', 'T']);
  });

  it('문법 오류마다 위치를 적는다', () => {
    const cases: Array<[string, string]> = [
      ['(a)', '1:1-2 error rel.syntax.expectedTableName'],
      ['학생 학번', '1:4-6 error rel.syntax.expectedOpenParen'],
      ['학생(⟨a⟩, ,)', '1:7-8 error rel.syntax.expectedColumn'],
      ['학생(⟨a⟩ b)', '1:6-7 error rel.syntax.expectedCommaOrClose'],
      ['학생(⟨a⟩) 과목', '1:7-9 error rel.syntax.extraAfterTable'],
      ['학생(⟨a⟩, b', '1:3-4 error rel.syntax.unclosedParen'],
      ['학생(⟨a⟩, "", b)', '1:7-9 error rel.syntax.emptyName'],
      ['학생(⟨a⟩, "b)', '1:7 error rel.syntax.unterminatedString'],
    ];
    for (const [text, expected] of cases) expect(problemsOf(text), text).toContain(expected);
  });

  it('괄호를 닫지 않은 테이블 아래의 Foreign Key 줄은 그 테이블에 붙고, 없는 컬럼은 따로 알리지 않는다', () => {
    const text = 'P(⟨k⟩)\nT(⟨a⟩, k\nForeign Key (k) references P\nForeign Key (z) references P';
    const r = parseRelational(u(text));
    expect(brief(r.problems)).toEqual(['2:2-3 error rel.syntax.unclosedParen']);
    expect(shape(u(text))[1]).toEqual({ name: 'T', columns: ['*a', 'k'], fks: ['k->P'] });
  });

  it('테이블 머리를 읽지 못했으면 그 아래 Foreign Key 줄은 붙일 곳이 없어 조용히 넘긴다', () => {
    expect(problemsOf('P(⟨k⟩)\n학생 학번\nForeign Key (k) references P')).toEqual(['2:4-6 error rel.syntax.expectedOpenParen']);
  });

  it('문제는 위치 순서로 나온다', () => {
    const r = parseRelational(u('A(⟨a⟩, x)\nForeign Key (x) references Z\nB(b\nC(⟨c⟩, c)'));
    const keys = r.problems.map((p) => [p.line, p.column]);
    expect(keys).toEqual([...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
    expect(brief(r.problems)).toEqual(['2:28-29 error rel.schema.unknownTable', '3:2-3 error rel.syntax.unclosedParen', '4:6-7 error rel.syntax.duplicateColumn']);
  });
});

describe('parseMarkup: 일반 텍스트 교환 표기', () => {
  it('_이름_ 은 밑줄이고, 문제의 위치는 표기 글 기준이다(감싼 _ 는 밑줄 범위에 넣지 않는다)', () => {
    const r = parseMarkup('Player (_SSN_, _ssn_)\nForeign Key (_x_) references Nowhere');
    expect(brief(r.problems)).toEqual([
      '1:17-20 error rel.syntax.duplicateColumn',
      '2:15-16 warning rel.syntax.underlineIgnored',
      '2:15-16 error rel.schema.unknownForeignKeyColumn',
    ]);
    expect(r.schema.tables[0].columns[0]).toMatchObject({ name: 'SSN', primaryKey: true });
  });

  it('도움말 예시는 문제 없이 읽힌다', () => {
    const r = parseMarkup(RELATIONAL_SYNTAX_EXAMPLE);
    expect(r.problems).toEqual([]);
    expect(r.schema.tables.map((t) => t.name)).toEqual(['Department', 'Student', 'Course', 'Section', 'Enrolls', 'Employee']);
    expect(r.schema.tables[4].foreignKeys.map((f) => f.columns)).toEqual([['Student_ID'], ['Course_ID', 'Section_No']]);
  });

  it('설명은 수업 표기를 말하고 화살표 표기는 말하지 않는다', () => {
    expect(RELATIONAL_SYNTAX).toContain('Foreign Key (column, ...) references Table (column, ...)');
    expect(RELATIONAL_SYNTAX).toContain('_name_');
    expect(RELATIONAL_SYNTAX).not.toMatch(/->|→/);
  });
});
