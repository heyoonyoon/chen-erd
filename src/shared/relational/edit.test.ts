import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyPlanToSource, applyRelationalEdit, checkNewName, planRenameColumn, planRenameTable, planSetKeys, planTogglePrimaryKey, type RelEditPlan } from './edit';
import { deriveIe } from './ie';
import { fromMarkup, toMarkup } from './markup';
import { columnKey } from './settings';
import { parseRelational } from './text';
import { getColumnSettingsMap, readColumnSettings, readRelationalSource, setColumnSetting, setRelationalSource } from './ydoc';

const MODEL = [
  '학과 (_학과코드_, 학과명)',
  '학생 (_학번_, 이름, 학과코드)',
  'Foreign Key (학과코드) references 학과 (학과코드)',
  '수강 (_학번_, 과목, 성적)',
  'Foreign Key (학번) references 학생',
].join('\n');

function room(markup = MODEL): Y.Doc {
  const doc = new Y.Doc();
  setRelationalSource(doc, fromMarkup(markup));
  return doc;
}

const ok = (plan: RelEditPlan) => {
  if (!plan.ok) throw new Error(`plan failed: ${plan.error}`);
  return plan;
};

describe('IE에서 고친 것을 글에 되써 넣기', () => {
  it('컬럼 이름: 테이블 줄, 그 테이블의 Foreign Key 목록, 가리키는 references 목록을 함께 바꾸고 밑줄을 지킨다', () => {
    const doc = room();
    setColumnSetting(doc, '학과', '학과코드', { type: 'CHAR(4)' });
    applyRelationalEdit(doc, ok(planRenameColumn(readRelationalSource(doc), '학과', '학과코드', 'dept_no')));
    expect(toMarkup(readRelationalSource(doc)).split('\n').slice(0, 3)).toEqual([
      '학과 (_dept_no_, 학과명)',
      '학생 (_학번_, 이름, 학과코드)',
      'Foreign Key (학과코드) references 학과 (dept_no)',
    ]);
    // 설정 키가 새 이름으로 옮겨 간다
    expect(readColumnSettings(doc)).toEqual({ [columnKey('학과', 'dept_no')]: { type: 'CHAR(4)' } });
    // 자식 쪽 외래키 컬럼 이름도 그 테이블에서 바꾸면 Foreign Key (cols) 목록이 따라간다
    applyRelationalEdit(doc, ok(planRenameColumn(readRelationalSource(doc), '학생', '학과코드', 'dept')));
    expect(toMarkup(readRelationalSource(doc)).split('\n')[2]).toBe('Foreign Key (dept) references 학과 (dept_no)');
    expect(parseRelational(readRelationalSource(doc)).problems).toEqual([]);
  });

  it('공백이 든 이름은 큰따옴표로 묶고 밑줄은 이름 글자에만 긋는다', () => {
    const doc = room();
    applyRelationalEdit(doc, ok(planRenameColumn(readRelationalSource(doc), '학생', '학번', '학생 번호')));
    const src = readRelationalSource(doc);
    expect(src.text.split('\n')[1]).toBe('학생 ("학생 번호", 이름, 학과코드)');
    const ie = deriveIe(parseRelational(src).schema, {});
    expect(ie.tables[1].columns[0]).toMatchObject({ name: '학생 번호', primaryKey: true });
    // 가리키는 컬럼을 적지 않은 외래키(수강 → 학생)는 그대로 기본키를 가리킨다
    expect(ie.links.find((l) => l.child.table === '수강')!.parent.table).toBe('학생');
  });

  it('테이블 이름: 테이블 줄과 모든 references를 바꾸고 그 테이블의 설정 키를 옮긴다', () => {
    const doc = room();
    setColumnSetting(doc, '학생', '이름', { type: 'VARCHAR(20)', notNull: true });
    setColumnSetting(doc, '수강', '성적', { type: 'INT' });
    applyRelationalEdit(doc, ok(planRenameTable(readRelationalSource(doc), '학생', 'Student')));
    const lines = toMarkup(readRelationalSource(doc)).split('\n');
    expect(lines[1]).toBe('Student (_학번_, 이름, 학과코드)');
    expect(lines[4]).toBe('Foreign Key (학번) references Student');
    expect(readColumnSettings(doc)).toEqual({
      [columnKey('Student', '이름')]: { type: 'VARCHAR(20)', notNull: true },
      [columnKey('수강', '성적')]: { type: 'INT' },
    });
  });

  it('기본키 켜고 끄기는 밑줄 서식으로', () => {
    const doc = room();
    applyRelationalEdit(doc, ok(planTogglePrimaryKey(readRelationalSource(doc), '수강', '과목')));
    expect(toMarkup(readRelationalSource(doc)).split('\n')[3]).toBe('수강 (_학번_, _과목_, 성적)');
    applyRelationalEdit(doc, ok(planTogglePrimaryKey(readRelationalSource(doc), '수강', '과목')));
    expect(toMarkup(readRelationalSource(doc)).split('\n')[3]).toBe('수강 (_학번_, 과목, 성적)');
  });

  it('잘못된 이름, 같은 이름, 오류 있는 글, 결과가 깨지는 경우는 고치지 않는다', () => {
    const src = fromMarkup(MODEL);
    expect(planRenameColumn(src, '학생', '이름', '  ')).toEqual({ ok: false, error: 'empty' });
    expect(planRenameColumn(src, '학생', '이름', 'a,b')).toEqual({ ok: false, error: 'chars' });
    expect(planRenameColumn(src, '학생', '이름', 'f(x)')).toEqual({ ok: false, error: 'chars' });
    expect(planRenameColumn(src, '학생', '이름', '학번')).toEqual({ ok: false, error: 'duplicate' });
    expect(planRenameColumn(src, '학생', '이름', '학과코드')).toEqual({ ok: false, error: 'duplicate' });
    expect(planRenameTable(src, '학생', '학과')).toEqual({ ok: false, error: 'duplicate' });
    expect(planRenameColumn(src, '학생', '없음', 'x')).toEqual({ ok: false, error: 'not-found' });
    expect(planRenameColumn(fromMarkup(`${MODEL}\n교수 (_번호_`), '학생', '이름', 'x')).toEqual({ ok: false, error: 'text-errors' });
    // 기본키 켜고 끄기는 밑줄만 바꾸므로 다른 곳의 오류와 상관없이 그 낱말이 제자리에 있으면 된다
    expect(planTogglePrimaryKey(fromMarkup(`${MODEL}\n교수 (_번호_`), '학생', '이름').ok).toBe(true);
    // 대소문자만 바꾸는 것은 된다
    expect(planRenameTable(src, '학생', '학생').ok).toBe(true);
    expect(checkNewName(' a  b ')).toEqual({ ok: true, name: 'a b' });
  });

  it('applyPlanToSource는 문서에 적용한 것과 같다', () => {
    const doc = room();
    const before = readRelationalSource(doc);
    const plan = ok(planRenameColumn(before, '학과', '학과코드', '코드'));
    applyRelationalEdit(doc, plan);
    expect(readRelationalSource(doc)).toEqual(applyPlanToSource(before, plan));
  });

  it('한 트랜잭션이라 되돌리기 한 번으로 글과 설정이 함께 돌아간다', () => {
    const doc = room();
    setColumnSetting(doc, '학생', '이름', { type: 'VARCHAR(20)' });
    const origin = { ie: true };
    const undo = new Y.UndoManager([doc.getText('relational-text'), getColumnSettingsMap(doc)], { trackedOrigins: new Set([origin]) });
    applyRelationalEdit(doc, ok(planRenameColumn(readRelationalSource(doc), '학생', '이름', 'name')), origin);
    expect(readColumnSettings(doc)).toEqual({ [columnKey('학생', 'name')]: { type: 'VARCHAR(20)' } });
    undo.undo();
    expect(toMarkup(readRelationalSource(doc))).toBe(MODEL);
    expect(readColumnSettings(doc)).toEqual({ [columnKey('학생', '이름')]: { type: 'VARCHAR(20)' } });
  });
});

describe('키 고르기(없음, PK, FK, PK+FK)', () => {
  const lines = (doc: Y.Doc) => toMarkup(readRelationalSource(doc)).split('\n');

  it('FK를 고르면 그 테이블 블록 아래에 Foreign Key 줄을 더하고, 끄면 그 줄을 지운다', () => {
    const doc = room();
    applyRelationalEdit(doc, ok(planSetKeys(readRelationalSource(doc), '수강', '과목', { primaryKey: false, foreignKey: true, ref: { table: '학과', column: '학과코드' } })));
    expect(lines(doc).slice(3)).toEqual(['수강 (_학번_, 과목, 성적)', 'Foreign Key (학번) references 학생', 'Foreign Key (과목) references 학과 (학과코드)']);
    // 중간 테이블(학생)에 더하면 그 테이블의 Foreign Key 줄 다음, 다음 테이블 앞에 들어간다
    applyRelationalEdit(doc, ok(planSetKeys(readRelationalSource(doc), '학생', '이름', { primaryKey: false, foreignKey: true, ref: { table: '학과', column: null } })));
    expect(lines(doc).slice(1, 5)).toEqual([
      '학생 (_학번_, 이름, 학과코드)',
      'Foreign Key (학과코드) references 학과 (학과코드)',
      'Foreign Key (이름) references 학과',
      '수강 (_학번_, 과목, 성적)',
    ]);
    expect(parseRelational(readRelationalSource(doc)).problems.filter((p) => p.severity === 'error')).toEqual([]);
    // 끄기: 그 줄만 줄째로 지운다
    applyRelationalEdit(doc, ok(planSetKeys(readRelationalSource(doc), '학생', '이름', { primaryKey: false, foreignKey: false })));
    applyRelationalEdit(doc, ok(planSetKeys(readRelationalSource(doc), '수강', '과목', { primaryKey: false, foreignKey: false })));
    expect(toMarkup(readRelationalSource(doc))).toBe(MODEL);
  });

  it('PK+FK는 밑줄과 Foreign Key 줄을 한 트랜잭션으로 바꾸고 되돌리기 한 번에 돌아간다', () => {
    const doc = room();
    const origin = { ie: true };
    const undo = new Y.UndoManager([doc.getText('relational-text'), getColumnSettingsMap(doc)], { trackedOrigins: new Set([origin]) });
    applyRelationalEdit(
      doc,
      // 이미 FK인 컬럼에 PK만 더한다(Foreign Key 줄은 그대로)
      ok(planSetKeys(readRelationalSource(doc), '학생', '학과코드', { primaryKey: true, foreignKey: true })),
      origin,
    );
    undo.stopCapturing();
    expect(lines(doc).slice(1, 3)).toEqual(['학생 (_학번_, 이름, _학과코드_)', 'Foreign Key (학과코드) references 학과 (학과코드)']);
    undo.undo();
    expect(toMarkup(readRelationalSource(doc))).toBe(MODEL);
    applyRelationalEdit(
      doc,
      ok(planSetKeys(readRelationalSource(doc), '수강', '과목', { primaryKey: true, foreignKey: true, ref: { table: '학과', column: '학과코드' } })),
      origin,
    );
    expect(lines(doc).slice(3)).toEqual(['수강 (_학번_, _과목_, 성적)', 'Foreign Key (학번) references 학생', 'Foreign Key (과목) references 학과 (학과코드)']);
    undo.undo();
    expect(toMarkup(readRelationalSource(doc))).toBe(MODEL);
  });

  it('여러 컬럼으로 된 외래키는 한 컬럼만 끌 수 없고, 오류 있는 글이나 없는 테이블은 고치지 않는다', () => {
    const composite = fromMarkup(['A (_x_, _y_)', 'B (_k_, x, y)', 'Foreign Key (x, y) references A'].join('\n'));
    expect(planSetKeys(composite, 'B', 'x', { primaryKey: false, foreignKey: false })).toEqual({ ok: false, error: 'composite' });
    const src = fromMarkup(MODEL);
    expect(planSetKeys(src, '수강', '과목', { primaryKey: false, foreignKey: true, ref: { table: '없음', column: null } })).toEqual({ ok: false, error: 'not-found' });
    expect(planSetKeys(src, '수강', '과목', { primaryKey: false, foreignKey: true })).toEqual({ ok: false, error: 'not-found' });
    expect(planSetKeys(fromMarkup(`${MODEL}\n교수 (_번호_`), '수강', '과목', { primaryKey: false, foreignKey: true, ref: { table: '학과', column: null } })).toEqual({
      ok: false,
      error: 'text-errors',
    });
    // 기본키가 아닌 컬럼을 가리키면 글에 오류가 생기므로 막는다
    expect(planSetKeys(src, '수강', '과목', { primaryKey: false, foreignKey: true, ref: { table: '학과', column: '학과명' } }).ok).toBe(false);
    // 바뀌는 것이 없으면 아무것도 하지 않는다
    expect(planSetKeys(src, '수강', '학번', { primaryKey: true, foreignKey: true })).toEqual({ ok: true, replaces: [], formats: [], settings: null });
  });
});
