import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyModel, parseModel } from '../model';
import { applyChange, getEdges, getNodes, getTitle } from '../ydoc';
import { columnKey } from './settings';
import { fromMarkup, toMarkup } from './markup';
import { UNDERLINE_ATTR, type RelationalSource } from './userSchema';
import { getColumnSettingsMap, getRelationalText, readColumnSettings, readRelationalSource, setColumnSetting, setRelationalSource, setRelationalText } from './ydoc';

function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

describe('columnKey', () => {
  it('공백과 대소문자를 맞춘 두 이름의 JSON 배열이다', () => {
    expect(columnKey('학생', '학번')).toBe('["학생","학번"]');
    expect(columnKey(' Student ', 'First   Name')).toBe(columnKey('student', 'first name'));
    expect(columnKey('학생 번호', 'a')).not.toBe(columnKey('학생_번호', 'a'));
    // 구분자가 이름 안에 있어도 키가 겹치지 않는다
    expect(columnKey('a","b', 'c')).not.toBe(columnKey('a', 'b","c'));
  });
});

describe('컬럼 설정 저장', () => {
  it('고친 키만 바꾸고, undefined는 그 키를, null은 설정 전체를 지운다', () => {
    const doc = new Y.Doc();
    expect(readColumnSettings(doc)).toEqual({});
    expect(setColumnSetting(doc, '학생', '이름', { type: '  VARCHAR(20) ' })).toBe(true);
    setColumnSetting(doc, '학생', '이름', { notNull: true });
    setColumnSetting(doc, 'STUDENT', 'Email', { unique: true, notNull: false });
    const key = columnKey('학생', '이름');
    expect(readColumnSettings(doc)).toEqual({
      [key]: { type: 'VARCHAR(20)', notNull: true },
      [columnKey('student', 'email')]: { unique: true, notNull: false },
    });
    setColumnSetting(doc, '학생', '이름', { type: undefined });
    expect(readColumnSettings(doc)[key]).toEqual({ notNull: true });
    setColumnSetting(doc, '학생', '이름', { type: '' });
    expect(readColumnSettings(doc)[key]).toEqual({ notNull: true });
    setColumnSetting(doc, '학생', '이름', { notNull: undefined });
    expect(getColumnSettingsMap(doc).has(key)).toBe(false);
    setColumnSetting(doc, 'student', 'email', null);
    expect(readColumnSettings(doc)).toEqual({});
  });

  it('틀린 값은 쓰지 않는다', () => {
    const doc = new Y.Doc();
    expect(setColumnSetting(doc, '학생', '이름', { type: 'INT; DROP TABLE x' })).toBe(false);
    expect(setColumnSetting(doc, '학생', '이름', { type: 'INT -- x' })).toBe(false);
    expect(setColumnSetting(doc, '학생', '이름', { type: 'x'.repeat(101) })).toBe(false);
    expect(setColumnSetting(doc, '학생', '이름', { notNull: 'yes' as never })).toBe(false);
    expect(setColumnSetting(doc, '', '이름', { type: 'INT' })).toBe(false);
    expect(setColumnSetting(doc, '학생', '  ', { type: 'INT' })).toBe(false);
    expect(getColumnSettingsMap(doc).size).toBe(0);
  });

  it('같은 값을 다시 쓰면 문서를 건드리지 않는다', () => {
    const doc = new Y.Doc();
    setColumnSetting(doc, 't', 'c', { type: 'INT' });
    let updates = 0;
    doc.on('update', () => updates++);
    setColumnSetting(doc, 't', 'c', { type: 'INT' });
    setColumnSetting(doc, 'x', 'y', null);
    expect(updates).toBe(0);
  });

  it('이미 들어 있는 틀린 키와 값은 읽을 때 무시한다', () => {
    const doc = new Y.Doc();
    const map = getColumnSettingsMap(doc);
    map.set(columnKey('t', 'a'), { type: 'INT', notNull: 'yes', unique: 1 });
    map.set(columnKey('t', 'b'), 'INT');
    map.set(columnKey('t', 'c'), { type: 'a;b' });
    map.set(columnKey('t', 'd'), null);
    map.set('["T","a"]', { type: 'INT' }); // 맞추지 않은 이름
    map.set('t/a', { type: 'INT' });
    map.set('["t"]', { type: 'INT' });
    map.set('__proto__', { type: 'INT' });
    expect(readColumnSettings(doc)).toEqual({ [columnKey('t', 'a')]: { type: 'INT' } });
  });

  it('두 사람이 서로 다른 컬럼을 동시에 고치면 둘 다 남는다', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    setColumnSetting(a, '학생', '학번', { type: 'CHAR(8)' });
    sync(a, b);
    setColumnSetting(a, '학생', '이름', { type: 'VARCHAR(20)' });
    setColumnSetting(b, '학생', '학번', { notNull: true, type: 'CHAR(10)' });
    sync(a, b);
    const expected = {
      [columnKey('학생', '학번')]: { type: 'CHAR(10)', notNull: true },
      [columnKey('학생', '이름')]: { type: 'VARCHAR(20)' },
    };
    expect(readColumnSettings(a)).toEqual(expected);
    expect(readColumnSettings(b)).toEqual(expected);
  });

  it('모델 텍스트 반영(applyChange)은 관계 모델 글과 컬럼 설정을 건드리지 않는다', () => {
    const doc = new Y.Doc();
    setRelationalText(doc, '학생(_학번_)\n');
    setColumnSetting(doc, '학생', '학번', { type: 'CHAR(8)' });
    // 다이어그램을 그렸다가(제목 포함) 도형을 모두 지운다
    for (const model of ['title "수강"\nentity 학생 { 학번 key }\nentity 과목 { 코드 key }\nrelationship 수강 (학생 M, 과목 N)', '']) {
      const r = applyModel(parseModel(model), getNodes(doc), getEdges(doc), getTitle(doc));
      applyChange(doc, r.change, 'api');
    }
    expect(getNodes(doc)).toEqual([]);
    expect(getTitle(doc)).toBe('수강');
    expect(getRelationalText(doc).toString()).toBe('학생(_학번_)\n');
    expect(readColumnSettings(doc)).toEqual({ [columnKey('학생', '학번')]: { type: 'CHAR(8)' } });
  });
});

describe('관계 모델 글', () => {
  it('setRelationalText는 달라진 가운데만 바꾸어 다른 사람이 동시에 고친 곳을 남긴다', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    setRelationalText(a, '학생(_학번_)\n과목(_코드_)\n');
    sync(a, b);
    // a는 첫 줄을, b는 끝에 한 줄을 더한다
    setRelationalText(a, '학생(_학번_, 이름)\n과목(_코드_)\n');
    getRelationalText(b).insert(getRelationalText(b).length, '교수(_사번_)\n');
    sync(a, b);
    expect(getRelationalText(a).toString()).toBe('학생(_학번_, 이름)\n과목(_코드_)\n교수(_사번_)\n');
    expect(getRelationalText(b).toString()).toBe(getRelationalText(a).toString());
  });

  it('같은 글이면 아무것도 하지 않고, 이모지(서로게이트 쌍)를 가르지 않는다', () => {
    const doc = new Y.Doc();
    setRelationalText(doc, 'a😀b');
    let updates = 0;
    doc.on('update', () => updates++);
    setRelationalText(doc, 'a😀b');
    expect(updates).toBe(0);
    setRelationalText(doc, 'a😃b');
    expect(getRelationalText(doc).toString()).toBe('a😃b');
    setRelationalText(doc, '');
    expect(getRelationalText(doc).toString()).toBe('');
  });
});

describe('밑줄이 있는 관계 모델 글', () => {
  const src = (markup: string): RelationalSource => fromMarkup(markup);

  it('Y.Text의 delta를 글과 합친 밑줄 구간으로 읽는다', () => {
    const doc = new Y.Doc();
    const ytext = getRelationalText(doc);
    ytext.insert(0, 'T(ab, c)');
    ytext.format(2, 1, { [UNDERLINE_ATTR]: true });
    ytext.format(3, 1, { [UNDERLINE_ATTR]: true, bold: true });
    ytext.format(6, 1, { bold: true });
    expect(readRelationalSource(doc)).toEqual({ text: 'T(ab, c)', underlines: [{ from: 2, to: 4 }] });
    expect(readRelationalSource(new Y.Doc())).toEqual({ text: '', underlines: [] });
  });

  it('쓰고 읽으면 같다. 같은 내용을 다시 쓰면 문서를 건드리지 않는다', () => {
    const doc = new Y.Doc();
    const a = src('Player (_SSN_, Name)\nFilm (_Film_ID_, Title)\nForeign Key (Title) references Film');
    setRelationalSource(doc, a);
    expect(readRelationalSource(doc)).toEqual(a);
    let updates = 0;
    doc.on('update', () => updates++);
    setRelationalSource(doc, a);
    expect(updates).toBe(0);
    // 밑줄만 바꾸면 글은 그대로, 바뀐 서식만 고친다
    const b = src('Player (_SSN_, _Name_)\nFilm (Film_ID, Title)\nForeign Key (Title) references Film');
    setRelationalSource(doc, b);
    expect(updates).toBe(1);
    expect(readRelationalSource(doc)).toEqual(b);
    expect(toMarkup(readRelationalSource(doc))).toBe('Player (_SSN_, _Name_)\nFilm (Film_ID, Title)\nForeign Key (Title) references Film');
  });

  it('글과 밑줄을 함께 바꾸고, 밑줄 친 글자 옆에 넣은 글자는 밑줄을 물려받지 않는다', () => {
    const doc = new Y.Doc();
    setRelationalSource(doc, src('T(_a_)'));
    const next = { text: 'T(abc)', underlines: [{ from: 2, to: 3 }] };
    setRelationalSource(doc, next);
    expect(readRelationalSource(doc)).toEqual(next);
    setRelationalSource(doc, src('T(_abc_, d)'));
    expect(toMarkup(readRelationalSource(doc))).toBe('T(_abc_, d)');
    setRelationalSource(doc, { text: '', underlines: [{ from: 0, to: 3 }] });
    expect(readRelationalSource(doc)).toEqual({ text: '', underlines: [] });
  });

  it('서로게이트 쌍을 가르지 않는다(글을 바꿀 때도, 밑줄 경계가 쌍 가운데에 있을 때도)', () => {
    const doc = new Y.Doc();
    setRelationalSource(doc, src('T(_a😀b_)'));
    setRelationalSource(doc, src('T(_a😃b_)'));
    expect(readRelationalSource(doc)).toEqual(src('T(_a😃b_)'));
    // 😃(2..4)의 가운데에서 끝나는 밑줄은 쌍 전체로 넓힌다
    setRelationalSource(doc, { text: 'T(😃x)', underlines: [{ from: 2, to: 3 }] });
    expect(getRelationalText(doc).toString()).toBe('T(😃x)');
    expect(readRelationalSource(doc).underlines).toEqual([{ from: 2, to: 4 }]);
    setRelationalSource(doc, { text: 'T(😃x)', underlines: [{ from: 3, to: 5 }] });
    expect(readRelationalSource(doc).underlines).toEqual([{ from: 2, to: 5 }]);
    expect(getRelationalText(doc).toString()).not.toContain('\uFFFD');
  });

  it('한 트랜잭션으로 쓰고 origin을 넘긴다', () => {
    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin));
    setRelationalSource(doc, src('A(_a_, b)\nB(_c_)'), 'api');
    expect(origins).toEqual(['api']);
  });

  it('두 사람이 동시에 고치면 글과 밑줄이 모두 남고 양쪽이 같아진다', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    setRelationalSource(a, src('Player (SSN, Name)\nFilm (Film_ID, Title)'));
    sync(a, b);
    // a는 SSN에 밑줄을 긋고, b는 Film_ID에 밑줄을 긋고 줄을 더한다
    setRelationalSource(a, src('Player (_SSN_, Name)\nFilm (Film_ID, Title)'));
    setRelationalSource(b, src('Player (SSN, Name)\nFilm (_Film_ID_, Title)\nForeign Key (Title) references Film'));
    sync(a, b);
    const expected = 'Player (_SSN_, Name)\nFilm (_Film_ID_, Title)\nForeign Key (Title) references Film';
    expect(toMarkup(readRelationalSource(a))).toBe(expected);
    expect(readRelationalSource(b)).toEqual(readRelationalSource(a));
    // 한 사람이 밑줄 친 이름을 고치는 동안 다른 사람이 다른 곳의 밑줄을 지운다
    setRelationalSource(a, src('Player (_SSN_, Name)\nFilm (_Film_Code_, Title)\nForeign Key (Title) references Film'));
    setRelationalSource(b, src('Player (SSN, Name)\nFilm (_Film_ID_, Title)\nForeign Key (Title) references Film'));
    sync(a, b);
    expect(toMarkup(readRelationalSource(a))).toBe('Player (SSN, Name)\nFilm (_Film_Code_, Title)\nForeign Key (Title) references Film');
    expect(readRelationalSource(b)).toEqual(readRelationalSource(a));
  });

  it('글 아닌 것(임베드)이 섞여 있으면 통째로 다시 쓴다', () => {
    const doc = new Y.Doc();
    const ytext = getRelationalText(doc);
    ytext.insert(0, 'T(a)');
    ytext.insertEmbed(1, { x: 1 });
    setRelationalSource(doc, src('T(_a_)'));
    expect(ytext.toDelta()).toEqual([{ insert: 'T(' }, { insert: 'a', attributes: { [UNDERLINE_ATTR]: true } }, { insert: ')' }]);
  });
});
