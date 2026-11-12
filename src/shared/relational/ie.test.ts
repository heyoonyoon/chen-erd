import { describe, expect, it } from 'vitest';
import { deriveIe } from './ie';
import { columnKey } from './settings';
import { parseMarkup, parseRelational } from './text';
import type { ColumnSetting, ColumnSettings, IeLink } from './userSchema';

function ie(text: string, settings: Record<string, Record<string, ColumnSetting>> = {}) {
  const s: ColumnSettings = {};
  for (const [table, cols] of Object.entries(settings)) for (const [col, v] of Object.entries(cols)) s[columnKey(table, col)] = v;
  // 시험 글은 일반 텍스트 교환 표기(_이름_ = 밑줄)로 적는다
  return deriveIe(parseMarkup(text).schema, s);
}

function link(text: string, settings?: Record<string, Record<string, ColumnSetting>>): IeLink {
  const links = ie(text, settings).links;
  expect(links).toHaveLength(1);
  return links[0];
}

const DEPT = '학과(_학과코드_, 학과명)\n';

describe('deriveIe: 테이블과 컬럼', () => {
  it('타입, NOT NULL, UNIQUE는 사람이 정한 것만. 기본키는 NOT NULL로 본다', () => {
    const model = ie(`${DEPT}학생(_학번_, 이름, 학과코드)\nForeign Key (학과코드) references 학과`, {
      학생: { 학번: { type: 'CHAR(8)', notNull: false }, 이름: { notNull: true, unique: true } },
    });
    expect(model.tables.map((t) => t.name)).toEqual(['학과', '학생']);
    expect(model.tables[1].columns).toEqual([
      { name: '학번', primaryKey: true, foreignKey: false, type: 'CHAR(8)', notNull: true, inheritedType: null, unique: false },
      { name: '이름', primaryKey: false, foreignKey: false, type: null, notNull: true, inheritedType: null, unique: true },
      { name: '학과코드', primaryKey: false, foreignKey: true, type: null, notNull: null, inheritedType: null, unique: false },
    ]);
  });

  it('외래키 컬럼은 가리키는 컬럼의 타입을 물려받는다(끝까지 따라가고, 자기 타입이 있으면 그것을 쓴다)', () => {
    const model = ie('A(_a_)\nB(_b_)\nForeign Key (b) references A\nC(_c_, x)\nForeign Key (c) references B\nD(_d_)\nForeign Key (d) references A', { a: { a: { type: 'INT' } }, d: { d: { type: 'BIGINT' } } });
    const col = (t: string) => model.tables.find((x) => x.name === t)!.columns[0];
    expect(col('B')).toMatchObject({ type: null, inheritedType: 'INT' });
    expect(col('C')).toMatchObject({ type: null, inheritedType: 'INT' });
    expect(col('D')).toMatchObject({ type: 'BIGINT', inheritedType: null });
  });

  it('설정 키는 대소문자와 공백을 따지지 않는다', () => {
    const model = ie('Student(_ID_, "First  Name")', { student: { id: { type: 'INT' }, 'first name': { type: 'TEXT' } } });
    expect(model.tables[0].columns.map((c) => c.type)).toEqual(['INT', 'TEXT']);
  });

  it('틀린 설정 값은 쓰지 않는다', () => {
    const model = deriveIe(parseRelational('T(_a_, b)').schema, {
      [columnKey('T', 'b')]: { type: 'INT; DROP', notNull: 'yes', unique: 1 } as never,
    });
    expect(model.tables[0].columns[1]).toMatchObject({ type: null, notNull: null, unique: false });
  });
});

describe('deriveIe: 선 끝', () => {
  it('비식별(점선): 외래키가 기본키에 들지 않는다. child.max는 N, child.min은 null, parent.max는 1', () => {
    expect(link(`${DEPT}학생(_학번_, 학과코드)\nForeign Key (학과코드) references 학과`)).toEqual({
      id: '학생#fk1',
      child: { table: '학생', min: null, max: 'N' },
      parent: { table: '학과', min: null, max: '1' },
      identifying: false,
      columns: ['학과코드'],
    });
  });

  it('식별(실선): 외래키가 모두 기본키에 든다. 기본키 일부면 N, 기본키 전체면 1', () => {
    const part = link('과목(_코드_)\n분반(_코드_, _번호_)\nForeign Key (코드) references 과목');
    expect(part).toMatchObject({ identifying: true, child: { max: 'N' }, parent: { min: 1 } });
    const whole = link('사람(_번호_)\n학생(_번호_, 학년)\nForeign Key (번호) references 사람 (번호)');
    expect(whole).toMatchObject({ identifying: true, child: { max: '1' }, parent: { min: 1 } });
    const composite = link('분반(_과목_, _번호_)\n강의계획(_과목_, _번호_, 내용)\nForeign Key (과목, 번호) references 분반');
    expect(composite).toMatchObject({ identifying: true, child: { max: '1' }, columns: ['과목', '번호'] });
  });

  it('일부만 기본키인 복합 외래키는 비식별', () => {
    expect(link('분반(_과목_, _번호_)\n수강(_학번_, _과목_, 번호)\nForeign Key (과목, 번호) references 분반')).toMatchObject({ identifying: false, child: { max: 'N' } });
  });

  it('child.max: UNIQUE로 정한 외래키 컬럼이면 1', () => {
    const text = `${DEPT}교수(_사번_, 학과코드)\nForeign Key (학과코드) references 학과`;
    expect(link(text, { 교수: { 학과코드: { unique: true } } }).child.max).toBe('1');
    expect(link(text, { 교수: { 학과코드: { unique: false } } }).child.max).toBe('N');
  });

  it('parent.min: NOT NULL로 정하면 1, NULL 허용으로 정하면 0, 정하지 않으면 null', () => {
    const text = `${DEPT}학생(_학번_, 학과코드)\nForeign Key (학과코드) references 학과`;
    expect(link(text, { 학생: { 학과코드: { notNull: true } } }).parent.min).toBe(1);
    expect(link(text, { 학생: { 학과코드: { notNull: false } } }).parent.min).toBe(0);
    expect(link(text).parent.min).toBeNull();
    expect(link(text, { 학생: { 학과코드: { type: 'CHAR(4)' } } }).parent.min).toBeNull();
  });

  it('parent.min: 복합 외래키는 모두 NOT NULL이어야 1, 하나라도 NULL 허용이면 0, 기본키 컬럼은 NOT NULL로 본다', () => {
    const text = '분반(_과목_, _번호_)\n수강(_학번_, _과목_, 번호)\nForeign Key (과목, 번호) references 분반';
    expect(link(text).parent.min).toBeNull();
    expect(link(text, { 수강: { 번호: { notNull: true } } }).parent.min).toBe(1);
    expect(link(text, { 수강: { 번호: { notNull: false } } }).parent.min).toBe(0);
    // 기본키 컬럼을 NULL 허용으로 정해도 기본키라서 NOT NULL로 본다
    expect(link(text, { 수강: { 과목: { notNull: false }, 번호: { notNull: true } } }).parent.min).toBe(1);
  });

  it('재귀 외래키는 자기 자신에게 선을 긋는다', () => {
    expect(link('직원(_사번_, 상사)\nForeign Key (상사) references 직원 (사번)')).toMatchObject({ child: { table: '직원' }, parent: { table: '직원' }, identifying: false });
  });

  it('쓸 수 없는 외래키에는 선을 긋지 않지만 컬럼의 외래키 표시는 남는다', () => {
    const model = ie('로그(시각)\n분반(_a_, _b_)\nT(_x_, y, z, w)\nForeign Key (y) references 없음\nForeign Key (z) references 로그\nForeign Key (w) references 분반');
    expect(model.links).toEqual([]);
    expect(model.tables.find((t) => t.name === 'T')!.columns.map((c) => c.foreignKey)).toEqual([false, true, true, true]);
  });

  it('가리키는 이름의 대소문자가 달라도 선은 테이블의 이름으로 긋는다', () => {
    expect(link('Dept(_id_)\nEmp(_no_, dept)\nforeign key (dept) REFERENCES DEPT').parent.table).toBe('Dept');
  });

  it('가리키는 컬럼을 적으면 적은 순서대로 짝짓는다(기본키 순서와 달라도)', () => {
    const text = '분반(_과목_, _번호_)\n강의계획(_x_, _y_)\nForeign Key (x, y) references 분반 (번호, 과목)';
    const model = ie(text, { 분반: { 과목: { type: 'CHAR(4)' }, 번호: { type: 'INT' } } });
    const cols = model.tables.find((t) => t.name === '강의계획')!.columns;
    expect(cols.map((c) => [c.name, c.inheritedType])).toEqual([
      ['x', 'INT'],
      ['y', 'CHAR(4)'],
    ]);
    expect(model.links[0]).toMatchObject({ columns: ['x', 'y'], identifying: true, child: { max: '1' } });
  });

  it('기본키가 아닌 컬럼을 가리키는 외래키에는 선을 긋지 않는다', () => {
    const model = ie('A(_a_, b)\nB(_x_, y)\nForeign Key (y) references A (b)');
    expect(model.links).toEqual([]);
    expect(model.tables[1].columns.map((c) => c.foreignKey)).toEqual([false, true]);
  });
});
