import { describe, expect, it } from 'vitest';
import { columnKey } from './settings';
import { dialectType, quoteIdentifier, toSql, TYPE_PLACEHOLDER } from './sql';
import { parseMarkup, parseRelational, RELATIONAL_SYNTAX_EXAMPLE } from './text';
import type { ColumnSetting, ColumnSettings, SqlDialect } from './userSchema';

function settings(map: Record<string, Record<string, ColumnSetting>>): ColumnSettings {
  const s: ColumnSettings = {};
  for (const [table, cols] of Object.entries(map)) for (const [col, v] of Object.entries(cols)) s[columnKey(table, col)] = v;
  return s;
}

function sql(text: string, s: Record<string, Record<string, ColumnSetting>> = {}, dialect: SqlDialect = 'postgresql', opts = {}) {
  // 시험 글은 일반 텍스트 교환 표기(_이름_ = 밑줄)로 적는다
  return toSql(parseMarkup(text).schema, settings(s), dialect, opts);
}

const order = (text: string) => [...text.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]);

describe('dialectType, quoteIdentifier', () => {
  it('방언마다 타입과 따옴표가 다르다', () => {
    expect(dialectType('BOOLEAN', 'oracle')).toBe('NUMBER(1)');
    expect(dialectType('BOOLEAN', 'mysql')).toBe('BOOLEAN');
    expect(dialectType('TEXT', 'oracle')).toBe('CLOB');
    expect(dialectType('VARCHAR(20)', 'oracle')).toBe('VARCHAR2(20 CHAR)');
    expect(dialectType('varchar2(20)', 'postgresql')).toBe('VARCHAR(20)');
    expect(dialectType('INT', 'postgresql')).toBe('INTEGER');
    expect(dialectType('INT', 'oracle')).toBe('NUMBER(10)');
    expect(dialectType('DECIMAL(12,2)', 'oracle')).toBe('NUMBER(12,2)');
    expect(dialectType('TIMESTAMP', 'mysql')).toBe('DATETIME');
    expect(dialectType('geometry', 'postgresql')).toBe('geometry');
    expect(quoteIdentifier('학생', 'mysql')).toBe('`학생`');
    expect(quoteIdentifier('학생', 'postgresql')).toBe('"학생"');
    // Oracle은 따옴표 식별자 안에 큰따옴표를 받지 않는다(두 번 적기도 안 된다). 빼고 묶는다
    expect(quoteIdentifier('a"b', 'oracle')).toBe('"ab"');
    expect(quoteIdentifier('a"b', 'postgresql')).toBe('"a""b"');
    expect(quoteIdentifier('a`b', 'mysql')).toBe('`a``b`');
  });
});

describe('toSql', () => {
  it('타입을 추측하지 않는다: 정하지 않은 컬럼은 자리 표시를 넣고 missingTypes에 적는다', () => {
    const r = sql('학생(_학번_, 이름, 나이)', { 학생: { 학번: { type: 'CHAR(8)' } } });
    expect(r.sql).toBe(
      ['-- PostgreSQL', '', 'CREATE TABLE "학생" (', '  "학번" CHAR(8) NOT NULL,', `  "이름" ${TYPE_PLACEHOLDER},`, `  "나이" ${TYPE_PLACEHOLDER},`, '  PRIMARY KEY ("학번")', ');', ''].join('\n'),
    );
    expect(TYPE_PLACEHOLDER).toBe('/* 타입 미지정 */');
    expect(r.missingTypes).toEqual([
      { table: '학생', column: '이름' },
      { table: '학생', column: '나이' },
    ]);
  });

  it('listMissingTypes면 머리 주석에도 적는다. 모두 정했으면 적지 않는다', () => {
    const r = sql('학생(_학번_, 이름)', {}, 'mysql', { title: '수강\n신청', listMissingTypes: true });
    expect(r.sql.split('\n').slice(0, 4)).toEqual([
      '-- 수강 신청 (MySQL)',
      '-- 타입을 정하지 않은 컬럼이 2개 있습니다. 타입을 정하기 전에는 이 SQL이 실행되지 않습니다.',
      '--   학생.학번',
      '--   학생.이름',
    ]);
    const done = sql('학생(_학번_)', { 학생: { 학번: { type: 'INT' } } }, 'mysql', { listMissingTypes: true });
    expect(done.missingTypes).toEqual([]);
    expect(done.sql).not.toContain('타입을 정하지 않은');
  });

  it('외래키 컬럼은 가리키는 컬럼의 타입을 물려받는다(끝까지 따라가고, 자기 타입이 먼저다)', () => {
    const r = sql('학생(_학번_)\n수강(_학번_, 메모)\nForeign Key (학번) references 학생\n출석(_학번_)\nForeign Key (학번) references 수강 (학번)\n기록(_학번_)\nForeign Key (학번) references 학생', {
      학생: { 학번: { type: 'VARCHAR(20)' } },
      기록: { 학번: { type: 'CHAR(8)' } },
    }, 'oracle');
    expect(r.sql).toContain('CREATE TABLE "수강" (\n  "학번" VARCHAR2(20 CHAR) NOT NULL,');
    expect(r.sql).toContain('CREATE TABLE "출석" (\n  "학번" VARCHAR2(20 CHAR) NOT NULL,');
    expect(r.sql).toContain('CREATE TABLE "기록" (\n  "학번" CHAR(8 CHAR) NOT NULL,');
    expect(r.missingTypes).toEqual([{ table: '수강', column: '메모' }]);
  });

  it('NOT NULL은 기본키와 사람이 정한 것만, UNIQUE는 정한 것만(기본키 하나와 같으면 뺀다)', () => {
    const r = sql('T(_id_, a, b, c)', { t: { id: { type: 'INT', notNull: false, unique: true }, a: { type: 'INT', notNull: true }, b: { type: 'INT', notNull: false, unique: true }, c: { type: 'INT' } } });
    expect(r.sql).toContain(['  "id" INTEGER NOT NULL,', '  "a" INTEGER NOT NULL,', '  "b" INTEGER,', '  "c" INTEGER,', '  PRIMARY KEY ("id"),', '  UNIQUE ("b")', ');'].join('\n'));
  });

  it('참조당하는 테이블을 먼저 만들고, 외래키는 기본키 순서로 짝짓는다', () => {
    const r = sql(RELATIONAL_SYNTAX_EXAMPLE);
    const created = order(r.sql);
    expect(created).toEqual(['Department', 'Student', 'Course', 'Section', 'Enrolls', 'Employee']);
    expect(r.sql).toContain('CONSTRAINT "Enrolls_fk2" FOREIGN KEY ("Course_ID", "Section_No") REFERENCES "Section" ("Course_ID", "Section_No")');
    expect(r.sql).toContain('CONSTRAINT "Employee_fk1" FOREIGN KEY ("Manager_ID") REFERENCES "Employee" ("Emp_ID")');
    expect(r.sql).not.toContain('ALTER TABLE');
    const reversed = sql('수강(_학번_)\nForeign Key (학번) references 학생\n학생(_학번_)');
    expect(order(reversed.sql)).toEqual(['학생', '수강']);
  });

  it('서로 가리키는 고리는 ALTER TABLE로 끊는다', () => {
    const r = sql('직원(_사번_, 부서번호)\nForeign Key (부서번호) references 부서\n부서(_부서번호_, 관리자)\nForeign Key (관리자) references 직원');
    expect(order(r.sql)).toEqual(['직원', '부서']);
    expect(r.sql).not.toMatch(/CREATE TABLE "직원" \([^;]*FOREIGN KEY/);
    expect(r.sql).toContain('CREATE TABLE "부서" (\n  "부서번호" /* 타입 미지정 */ NOT NULL,\n  "관리자" /* 타입 미지정 */,\n  PRIMARY KEY ("부서번호"),\n  CONSTRAINT "부서_fk1" FOREIGN KEY ("관리자") REFERENCES "직원" ("사번")\n);');
    expect(r.sql.trimEnd().split('\n').at(-1)).toBe('ALTER TABLE "직원" ADD CONSTRAINT "직원_fk1" FOREIGN KEY ("부서번호") REFERENCES "부서" ("부서번호");');
  });

  it('쓸 수 없는 외래키와 컬럼이 없는 테이블은 주석으로 남긴다', () => {
    const r = sql(
      [
        '로그(시각, 내용)',
        '분반(_a_, _b_, c)',
        'T(_x_, y, z, w, v, u)',
        'Foreign Key (y) references 없음',
        'Foreign Key (z) references 로그',
        'Foreign Key (w) references 분반',
        'Foreign Key (v, u) references 분반 (a)',
        'Foreign Key (v, u) references 분반 (a, c)',
        'Foreign Key (v, u) references 분반 (a, d)',
        '빈()',
      ].join('\n'),
    );
    expect(r.sql).toContain('-- 넣지 않은 외래키: "T" ("y") REFERENCES "없음". 가리키는 테이블이 없습니다.');
    expect(r.sql).toContain('-- 넣지 않은 외래키: "T" ("z") REFERENCES "로그". 가리키는 테이블에 기본키가 없습니다.');
    expect(r.sql).toContain('-- 넣지 않은 외래키: "T" ("w") REFERENCES "분반". 컬럼 수가 가리키는 테이블의 기본키와 다릅니다.');
    expect(r.sql).toContain('-- 넣지 않은 외래키: "T" ("v", "u") REFERENCES "분반" ("a"). 외래키 컬럼 수와 가리키는 컬럼 수가 다릅니다.');
    expect(r.sql).toContain('-- 넣지 않은 외래키: "T" ("v", "u") REFERENCES "분반" ("a", "c"). 가리키는 컬럼이 그 테이블의 기본키가 아닙니다.');
    expect(r.sql).toContain('-- 넣지 않은 외래키: "T" ("v", "u") REFERENCES "분반" ("a", "d"). 가리키는 컬럼이 그 테이블에 없습니다.');
    expect(r.sql).toContain('-- 만들지 않은 테이블: "빈". 컬럼이 없습니다.');
    expect(r.sql).not.toContain('FOREIGN KEY');
  });

  it('방언마다 따옴표와 타입이 다르다', () => {
    const text = '학생(_학번_, 휴학 , 메모)';
    const s = { 학생: { 학번: { type: 'VARCHAR(20)' }, 휴학: { type: 'BOOLEAN' }, 메모: { type: 'TEXT' } } };
    expect(sql(text, s, 'postgresql').sql).toContain('CREATE TABLE "학생" (\n  "학번" VARCHAR(20) NOT NULL,\n  "휴학" BOOLEAN,\n  "메모" TEXT,');
    expect(sql(text, s, 'mysql').sql).toContain('CREATE TABLE `학생` (\n  `학번` VARCHAR(20) NOT NULL,\n  `휴학` BOOLEAN,\n  `메모` TEXT,\n  PRIMARY KEY (`학번`)');
    expect(sql(text, s, 'oracle').sql).toContain('CREATE TABLE "학생" (\n  "학번" VARCHAR2(20 CHAR) NOT NULL,\n  "휴학" NUMBER(1),\n  "메모" CLOB,');
    expect(sql(text, s, 'oracle').sql.startsWith('-- Oracle\n')).toBe(true);
  });

  it('빈 글이면 테이블이 없다고 적는다. 틀린 설정 타입은 정하지 않은 것으로 본다', () => {
    expect(sql('').sql).toBe('-- PostgreSQL\n\n-- 관계 모델 글에 테이블이 없습니다.\n');
    const r = toSql(parseRelational({ text: 'T(a)', underlines: [{ from: 2, to: 3 }] }).schema, { [columnKey('T', 'a')]: { type: 'INT; DROP TABLE x' } }, 'postgresql');
    expect(r.missingTypes).toEqual([{ table: 'T', column: 'a' }]);
    expect(r.sql).not.toContain('DROP');
  });

  it('가리키는 컬럼을 적으면 적은 순서대로 짝짓는다', () => {
    const r = sql('분반(_과목_, _번호_)\n강의계획(_x_, _y_)\nForeign Key (x, y) references 분반 (번호, 과목)');
    expect(r.sql).toContain('CONSTRAINT "강의계획_fk1" FOREIGN KEY ("x", "y") REFERENCES "분반" ("번호", "과목")');
    const keyOrder = sql('분반(_과목_, _번호_)\n강의계획(_x_, _y_)\nForeign Key (x, y) references 분반');
    expect(keyOrder.sql).toContain('CONSTRAINT "강의계획_fk1" FOREIGN KEY ("x", "y") REFERENCES "분반" ("과목", "번호")');
  });
});


/**
 * 만든 SQL을 DBMS처럼 낱말로 나눠, 따옴표 식별자와 문자열과 주석 밖에 남는 글자만 돌려준다.
 * PostgreSQL은 줄 주석을 \n과 \r에서 끝낸다(더 엄격한 쪽을 따른다).
 */
function outsideQuotes(text: string, dialect: SqlDialect): string {
  let out = '';
  let i = 0;
  const idQuote = dialect === 'mysql' ? '`' : '"';
  while (i < text.length) {
    const c = text[i];
    if (c === idQuote || c === "'") {
      i++;
      for (;;) {
        if (i >= text.length) throw new Error('닫히지 않은 따옴표');
        if (text[i] === c) {
          // Oracle 식별자는 두 번 적기를 받지 않는다
          if (text[i + 1] === c && !(dialect === 'oracle' && c === '"')) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      out += ' Q ';
      continue;
    }
    if (c === '-' && text[i + 1] === '-') {
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new Error('닫히지 않은 주석');
      i = end + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

describe('SQL 인젝션: 사람이 적은 이름과 타입이 SQL을 깨뜨리지 못한다', () => {
  const nasty = ['"; DROP TABLE x; --', 'a`; DROP TABLE x; --', "a'); DROP TABLE x; --", 'a\\"b', 'a\rDROP TABLE x; --', 'a */ DROP TABLE x; /*', 'a DROP TABLE x;'];
  /** 글 안에서 따옴표 이름으로 적는다(" 와 \ 는 백슬래시로) */
  const q = (name: string) => `"${name.replace(/[\\"]/g, (c) => `\\${c}`)}"`;

  for (const dialect of ['postgresql', 'mysql', 'oracle'] as const) {
    it(`${dialect}: 테이블과 컬럼 이름`, () => {
      for (const name of nasty) {
        const text = `${q(name)}(_id_, ${q(name)}, other)\nRef(_rid_, fk)\nfk -> ${q(name)}\nBad(_k_, z)\nz -> ${q(name + 'missing')}`;
        const out = sql(text, {}, dialect, { listMissingTypes: true, title: name }).sql;
        const bare = outsideQuotes(out, dialect);
        expect(bare, `${dialect} ${JSON.stringify(name)}\n${out}`).not.toMatch(/DROP/i);
        // 세미콜론은 CREATE TABLE 문의 끝에만 있다
        expect((bare.match(/;/g) ?? []).length, out).toBe((out.match(/^CREATE TABLE /gm) ?? []).length + (out.match(/^ALTER TABLE /gm) ?? []).length);
      }
    });
  }

  it('타입 글자는 문장을 끝내거나 문자열·주석을 여는 기호를 받지 않는다', () => {
    const bad = [
      'INT; DROP TABLE x',
      "INT DEFAULT '",
      "VARCHAR(10) DEFAULT 'a\\'",
      'INT DEFAULT $$',
      'INT # c',
      'INT -- c',
      'INT /* c */',
      'INT)',
      'INT DEFAULT "x',
      'INT `',
      'INT\rDROP',
      'INT DROP',
    ];
    for (const type of bad) {
      const out = sql('T(_a_)', { T: { a: { type } } }, 'postgresql').sql;
      expect(out, JSON.stringify(type)).toContain(TYPE_PLACEHOLDER);
    }
    expect(sql('T(_a_)', { T: { a: { type: "ENUM('a','b')" } } }, 'mysql').sql).toContain("ENUM('a','b')");
  });
});
