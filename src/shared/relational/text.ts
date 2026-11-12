/**
 * 사람이 적는 관계 모델 글(학교 수업 표기)을 읽는다. 계약은 ./userSchema.ts에 있다.
 *
 *   Player (SSN, Name, DOB)                                  ← SSN에 밑줄(문서 편집기의 밑줄 서식)
 *   Performs_In (Performer_ID, Film_ID, Role)               ← Performer_ID, Film_ID에 밑줄
 *   Foreign Key (Performer_ID) references Performer (ID)
 *   Foreign Key (Film_ID) references Film
 *
 * 규칙
 *   한 줄에 테이블 하나: 이름(컬럼, 컬럼, ...). 이름과 ( 사이에 공백이 있어도 된다. 괄호 안에서는 줄을 바꿔도 된다.
 *   기본키 컬럼은 이름에 밑줄을 긋는다(RelationalSource.underlines). 이름의 일부만 그었으면 경고하고 기본키로 본다.
 *     밑줄 문자(_)는 이름의 글자일 뿐이다. _SSN_ 이라고 적으면 이름이 '_SSN_'인 보통 컬럼이 되고, 밑줄을 그으라고 경고한다.
 *     테이블 이름, Foreign Key 줄, 공백, 구두점에 그은 밑줄은 무시한다(이름에 걸렸으면 경고).
 *   외래키는 테이블 바로 아래(빈 줄이 있어도 된다)에 한 줄씩: Foreign Key (컬럼, ...) references 테이블 [(컬럼, ...)]
 *     낱말은 대소문자를 따지지 않는다. 가리키는 컬럼 목록을 빼면 그 테이블의 기본키를 글에 적은 순서대로 가리킨다.
 *     목록을 적으면 그 테이블의 기본키 컬럼과 개수와 이름이 같아야 한다(순서는 상관없고, 적은 순서대로 짝짓는다).
 *   화살표 표기(컬럼 -> 테이블, (a, b) -> 테이블)는 받지 않는다. Foreign Key 줄로 적으라고 오류를 낸다.
 *   공백이나 ( ) , " # 이 든 이름, ->가 든 이름은 큰따옴표로 묶는다(안의 " 는 \"). 빈 줄과 # 뒤의 글은 무시한다.
 *   이름의 같고 다름은 names.ts의 nameKey로 따진다(대소문자와 연속 공백은 따지지 않는다).
 *
 * 문자열을 받으면 밑줄이 없는 글로 읽는다(_이름_ 을 기본키로 읽지 않는다). 일반 텍스트 교환 표기(_이름_)는
 * fromMarkup으로 바꾼 뒤 읽거나 parseMarkup을 쓴다.
 *
 * 읽다가 틀린 곳을 만나도 멈추지 않는다. 문제를 적고, 다음 테이블 줄이나 Foreign Key 줄부터 다시 읽는다.
 * 문제의 위치: line, column은 1부터 센다(원래 글 기준). endColumn은 밑줄의 끝 바로 다음 칸이다(끝을 포함하지 않는다).
 */
import { msg, type Message, type RelationalMessageKey } from '../messages';
import { isMarkerWord, lex, underlineMask, underlineState, type LexToken, type UnderlineState } from './lexer';
import { convertMarkup } from './markup';
import { cleanName, nameKey, quotedName } from './names';
import { indexSchema, resolveForeignKey } from './schema';
import type { ParseResult, RelationalSource, RelColumnDef, RelForeignKeyDef, RelProblem, RelTableDef } from './userSchema';

/** 도움말에 보여 줄 예시. 일반 텍스트 교환 표기라서 밑줄은 _이름_ 으로 적혀 있다(fromMarkup으로 읽는다) */
export const RELATIONAL_SYNTAX_EXAMPLE = [
  'Department (_Dept_ID_, Name)',
  'Student (_Student_ID_, Name, Dept_ID)',
  'Foreign Key (Dept_ID) references Department (Dept_ID)',
  'Course (_Course_ID_, Title)',
  'Section (_Course_ID_, _Section_No_, Room)',
  'Foreign Key (Course_ID) references Course',
  'Enrolls (_Student_ID_, _Course_ID_, _Section_No_, Grade)',
  'Foreign Key (Student_ID) references Student (Student_ID)',
  'Foreign Key (Course_ID, Section_No) references Section (Course_ID, Section_No)',
  'Employee (_Emp_ID_, Name, Manager_ID)',
  'Foreign Key (Manager_ID) references Employee (Emp_ID)',
].join('\n');

/** CLI와 AI에게 보여 줄 영어 설명 */
export const RELATIONAL_SYNTAX = [
  'Relational model notation (the course notation). The app editor uses real underline formatting;',
  'in plain text (API, CLI, MCP, plain-text clipboard) an underlined name is written between underscores: _name_.',
  '',
  'One table per line: Table (column, column, ...). A space before "(" is fine; a list may span lines.',
  'Underline the primary-key columns: Player (_SSN_, Name). Several underlined columns form one composite key.',
  'Write each foreign key on its own line under its table (blank lines between are fine):',
  '  Foreign Key (column, ...) references Table (column, ...)',
  "  Without the list after Table, the foreign key points to Table's primary key, paired in the key's order.",
  "  With the list, it must name exactly Table's primary-key columns (any order; paired as written).",
  '  References to columns that are not the primary key are not supported.',
  '  Keywords are case-insensitive. A composite foreign key lists several columns; a table may have several lines.',
  'Underscores inside a name are part of it (Film_ID). Only a whole name wrapped in underscores (_Film_ID_) means',
  'underlined, and only in plain text. Quote names with spaces or punctuation: "first name"; a name that really',
  'starts and ends with "_" is quoted too: "_x_".',
  'Blank lines and text after # are ignored; letter case and repeated spaces in names do not matter.',
  'Example:',
  ...RELATIONAL_SYNTAX_EXAMPLE.split('\n').map((line) => `  ${line}`),
].join('\n');

// ───────────────────────── 쓰기 ─────────────────────────

/** 따옴표 없이 쓸 수 있는 이름인지 */
function isBare(name: string): boolean {
  if (name === '' || /[\s(),"#]/.test(name)) return false;
  if (name.includes('->') || name.includes('→')) return false;
  if (name.startsWith('_') || name.endsWith('_')) return false;
  return true;
}

/** 이름을 글에 적는 꼴로. 필요하면 큰따옴표로 묶는다 */
export function formatName(name: string): string {
  if (isBare(name)) return name;
  return '"' + name.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// ───────────────────────── 읽기 ─────────────────────────

interface Token {
  type: LexToken['type'] | 'eof';
  value: string;
  quoted: boolean;
  /** 이름에 그은 밑줄 */
  under: UnderlineState;
  line: number;
  column: number;
  /** 토큰 끝 바로 다음 칸 */
  endColumn: number;
}

/** 위치 하나(밑줄 범위) */
interface Span {
  line: number;
  column: number;
  endColumn?: number;
}

function spanOf(t: Token): Span {
  return { line: t.line, column: t.column, endColumn: t.endColumn };
}

/** 같은 줄이면 a부터 b까지, 아니면 b */
function spanFrom(a: Token, b: Token): Span {
  return a.line === b.line ? { line: a.line, column: a.column, endColumn: b.endColumn } : spanOf(b);
}

/** 외래키 하나의 위치들 */
interface FkSpans {
  /** 외래키 전체(내용 검사에서 개수가 틀렸을 때) */
  item: Span;
  /** 가리키는 테이블 이름 */
  ref: Span;
  /** 가리키는 컬럼 목록 전체와 컬럼 하나하나 */
  refList?: Span;
  refColumns?: Span[];
}

/** 읽는 도중의 테이블. 내용 검사에 쓸 위치를 함께 둔다 */
interface Draft {
  def: RelTableDef;
  name: Span;
  /** 괄호를 끝까지 닫았는지 */
  complete: boolean;
  /** foreignKeys와 같은 순서 */
  fkSpans: FkSpans[];
}

/** 읽기를 멈추고 다음 줄부터 다시 읽게 하는 신호 */
class Stop {
  constructor(readonly at: number) {}
}

const isKeyword = (t: Token | undefined, word: string) => t !== undefined && t.type === 'name' && !t.quoted && t.value.toLowerCase() === word;

/**
 * 관계 모델 글을 읽는다. 던지지 않는다. 읽은 구조와 문제(문법, 내용)를 함께 돌려준다.
 * 문자열은 밑줄이 없는 글이다(_이름_ 을 밑줄로 읽지 않는다. 그러려면 parseMarkup).
 */
export function parseRelational(input: string | RelationalSource): ParseResult {
  const source: RelationalSource = typeof input === 'string' ? { text: input, underlines: [] } : input;
  const text = typeof source.text === 'string' ? source.text : '';
  const mask = underlineMask(text.length, Array.isArray(source.underlines) ? source.underlines : []);
  const problems: RelProblem[] = [];
  const lexed = lex(text);
  const tokens: Token[] = lexed.map((t) => ({
    type: t.type,
    value: t.value,
    quoted: t.quoted,
    under: underlineState(text, mask, t),
    line: t.line,
    column: t.column,
    endColumn: t.endColumn,
  }));
  {
    const lineStart = text.lastIndexOf('\n') + 1;
    const line = text.split('\n').length;
    const column = text.length - lineStart + 1;
    tokens.push({ type: 'eof', value: '', quoted: false, under: 'none', line, column, endColumn: column });
  }
  for (const t of lexed) {
    if (t.unterminated) problems.push({ severity: 'error', message: msg('rel.syntax.unterminatedString'), line: t.line, column: t.column });
  }

  let pos = 0;
  const peek = (k = 0) => tokens[Math.min(pos + k, tokens.length - 1)];
  const next = () => tokens[Math.min(pos++, tokens.length - 1)];
  /** 줄바꿈을 건너뛴다. 건넜으면 true */
  const skipNl = (): boolean => {
    let crossed = false;
    while (peek().type === 'nl') {
      pos++;
      crossed = true;
    }
    return crossed;
  };
  const report = (severity: RelProblem['severity'], message: Message, span: Span) => {
    const p: RelProblem = { severity, message, line: span.line, column: span.column };
    if (span.endColumn !== undefined && span.endColumn > span.column) p.endColumn = span.endColumn;
    problems.push(p);
  };
  /** 문법 오류를 적고 멈춘다. t는 문제가 된 토큰(그 자리부터 다시 읽을 곳을 찾는다) */
  const fail = (key: RelationalMessageKey, t: Token, params?: Message['params'], span: Span = spanOf(t)): never => {
    report('error', msg(key, params), span);
    throw new Stop(tokens.indexOf(t));
  };
  const atLineStart = (index: number) => index === 0 || tokens[index - 1]?.type === 'nl';
  /** 줄 맨 앞의 '이름(': 새 테이블 */
  const isTableStart = (index: number): boolean =>
    atLineStart(index) && tokens[index]?.type === 'name' && tokens[index + 1]?.type === '(';
  /** 줄 맨 앞의 'Foreign Key': 외래키 줄 */
  const isForeignKeyStart = (index: number): boolean =>
    atLineStart(index) && isKeyword(tokens[index], 'foreign') && isKeyword(tokens[index + 1], 'key');
  /** 다시 읽기 시작할 수 있는 곳 */
  const isLineHead = (index: number) => isForeignKeyStart(index) || isTableStart(index);
  /** 밑줄이 의미 없는 자리의 이름에 그은 밑줄 */
  const ignoredUnderline = (t: Token) => {
    if (t.type === 'name' && t.under !== 'none') report('warning', msg('rel.syntax.underlineIgnored'), spanOf(t));
  };
  /** 화살표 표기를 적었다. first는 외래키로 적으려던 컬럼(또는 괄호), arrow는 화살표 */
  const failArrow = (first: Token, arrow: Token): never => {
    const after = tokens[tokens.indexOf(arrow) + 1];
    const end = after && after.type === 'name' && after.line === arrow.line ? after : arrow;
    return fail('rel.syntax.arrowNotSupported', arrow, undefined, spanFrom(first, end));
  };

  const drafts: Draft[] = [];
  const seenTables = new Set<string>();
  /** Foreign Key 줄이 붙을 테이블. 아직 없으면 null, 테이블 머리를 읽지 못했으면 'broken' */
  let current: Draft | null | 'broken' = null;

  const readTable = (): void => {
    current = 'broken';
    const head = next();
    if (head.type !== 'name') fail('rel.syntax.expectedTableName', head);
    const name = cleanName(head.value);
    if (name === '') fail('rel.syntax.emptyName', head);
    ignoredUnderline(head);
    const open = next();
    if (open.type !== '(') fail('rel.syntax.expectedOpenParen', open, { name: quotedName(name) });
    const draft: Draft = {
      def: { name, line: head.line, column: head.column, columns: [], foreignKeys: [] },
      name: spanOf(head),
      complete: false,
      fkSpans: [],
    };
    current = draft;
    const key = nameKey(name);
    if (seenTables.has(key)) {
      report('error', msg('rel.syntax.duplicateTable', { name: quotedName(name) }), spanOf(head));
    } else {
      seenTables.add(key);
      drafts.push(draft);
    }
    const table = draft.def;
    const seenColumns = new Set<string>();
    const addColumn = (t: Token): void => {
      const c: RelColumnDef = { name: cleanName(t.value), primaryKey: t.under !== 'none', line: t.line, column: t.column };
      if (c.name === '') fail('rel.syntax.emptyName', t);
      if (t.under === 'partial') report('warning', msg('rel.syntax.partialUnderline', { name: quotedName(c.name) }), spanOf(t));
      if (!c.primaryKey && !t.quoted && isMarkerWord(t.value)) report('warning', msg('rel.syntax.underscoreKey', { name: quotedName(c.name) }), spanOf(t));
      const k = nameKey(c.name);
      if (seenColumns.has(k)) {
        report('error', msg('rel.syntax.duplicateColumn', { table: quotedName(table.name), name: quotedName(c.name) }), spanOf(t));
      } else {
        seenColumns.add(k);
        table.columns.push(c);
      }
    };
    /** 괄호를 닫지 않고 다음 줄에서 새 테이블이나 Foreign Key 줄을 시작했으면, 이 테이블은 여기까지로 하고 true */
    const endsUnclosed = (crossed: boolean): boolean => {
      if (!crossed || !isLineHead(pos)) return false;
      report('error', msg('rel.syntax.unclosedParen'), spanOf(open));
      return true;
    };
    /** 괄호 묶음 뒤에 화살표가 오는지(예전의 복합 외래키 표기) */
    const arrowAfterGroup = (from: number): Token | null => {
      let depth = 0;
      for (let k = from; k < tokens.length; k++) {
        const t = tokens[k];
        if (t.type === 'eof') return null;
        if (t.type === '(') depth++;
        else if (t.type === ')' && --depth === 0) {
          let m = k + 1;
          while (tokens[m]?.type === 'nl') m++;
          return tokens[m]?.type === '->' ? tokens[m] : null;
        }
      }
      return null;
    };

    if (skipNl() && endsUnclosed(true)) return;
    if (peek().type === ')') {
      next();
    } else {
      for (;;) {
        if (endsUnclosed(skipNl())) return;
        const t = next();
        /** 이 항목 뒤에서 줄을 바꿨는지 */
        let crossed = false;
        if (t.type === 'name') {
          addColumn(t);
          crossed = skipNl();
          if (peek().type === '->') failArrow(t, peek());
        } else if (t.type === '(') {
          const arrow = arrowAfterGroup(tokens.indexOf(t));
          if (arrow) failArrow(t, arrow);
          fail('rel.syntax.expectedColumn', t);
        } else if (t.type === '->') {
          failArrow(t, t);
        } else if (t.type === 'eof') {
          fail('rel.syntax.unclosedParen', t, undefined, spanOf(open));
        } else {
          fail('rel.syntax.expectedColumn', t);
        }
        if (endsUnclosed(crossed)) return;
        const sep = next();
        if (sep.type === ')') break;
        if (sep.type === ',') continue;
        if (sep.type === 'eof') fail('rel.syntax.unclosedParen', sep, undefined, spanOf(open));
        fail('rel.syntax.expectedCommaOrClose', sep);
      }
    }
    draft.complete = true;
    const end = peek();
    if (end.type !== 'nl' && end.type !== 'eof') fail('rel.syntax.extraAfterTable', end);
  };

  /** ( 다음부터 ) 까지 이름 목록을 읽는다. 같은 이름이 두 번 나오면 오류 */
  const readList = (open: Token): Token[] => {
    const items: Token[] = [];
    const seen = new Set<string>();
    for (;;) {
      if (skipNl() && isLineHead(pos)) {
        report('error', msg('rel.syntax.unclosedParen'), spanOf(open));
        throw new Stop(pos);
      }
      const t = next();
      if (t.type === 'eof') fail('rel.syntax.unclosedParen', t, undefined, spanOf(open));
      if (t.type !== 'name') fail('rel.syntax.expectedColumn', t);
      const name = cleanName(t.value);
      if (name === '') fail('rel.syntax.emptyName', t);
      ignoredUnderline(t);
      if (seen.has(nameKey(name))) fail('rel.syntax.duplicateInList', t, { name: quotedName(name) });
      seen.add(nameKey(name));
      items.push(t);
      skipNl();
      const sep = next();
      if (sep.type === ')') return items;
      if (sep.type === 'eof') fail('rel.syntax.unclosedParen', sep, undefined, spanOf(open));
      if (sep.type !== ',') fail('rel.syntax.expectedCommaOrClose', sep);
    }
  };

  const readForeignKey = (): void => {
    const kwForeign = next();
    const kwKey = next();
    const keywords = spanFrom(kwForeign, kwKey);
    ignoredUnderline(kwForeign);
    ignoredUnderline(kwKey);
    const owner = current;
    if (owner === null) fail('rel.syntax.foreignKeyBeforeTable', kwForeign, undefined, keywords);
    const open = next();
    if (open.type !== '(') fail('rel.syntax.expectedForeignKeyColumns', open);
    const columns = readList(open);
    // references는 다음 줄에 적어도 된다
    const before = pos;
    skipNl();
    if (!isKeyword(peek(), 'references') || isLineHead(pos)) pos = before;
    const kwRef = next();
    if (!isKeyword(kwRef, 'references')) fail('rel.syntax.expectedReferences', kwRef);
    ignoredUnderline(kwRef);
    const ref = next();
    if (ref.type !== 'name') fail('rel.syntax.expectedRefTable', ref);
    const refName = cleanName(ref.value);
    if (refName === '') fail('rel.syntax.emptyName', ref);
    ignoredUnderline(ref);
    let refColumns: Token[] | undefined;
    let last = ref;
    let refList: Span | undefined;
    if (peek().type === '(') {
      const refOpen = next();
      refColumns = readList(refOpen);
      last = tokens[pos - 1];
      refList = spanFrom(refOpen, last);
    }
    const end = peek();
    if (end.type !== 'nl' && end.type !== 'eof') fail('rel.syntax.extraAfterTable', end);

    if (owner === null || owner === 'broken') return;
    const table = owner.def;
    const known = new Set(table.columns.map((c) => nameKey(c.name)));
    const unknown = columns.filter((t) => !known.has(nameKey(t.value)));
    if (unknown.length > 0) {
      // 괄호를 닫지 못한 테이블이면 컬럼을 다 읽지 못했으므로 따로 알리지 않는다(그 테이블의 오류가 이미 있다)
      if (owner.complete) {
        for (const t of unknown) {
          report('error', msg('rel.schema.unknownForeignKeyColumn', { table: quotedName(table.name), name: quotedName(cleanName(t.value)) }), spanOf(t));
        }
      }
      return;
    }
    const fk: RelForeignKeyDef = { columns: columns.map((t) => cleanName(t.value)), refTable: refName, line: kwForeign.line, column: kwForeign.column };
    if (refColumns) fk.refColumns = refColumns.map((t) => cleanName(t.value));
    table.foreignKeys.push(fk);
    owner.fkSpans.push({ item: spanFrom(kwForeign, last), ref: spanOf(ref), refList, refColumns: refColumns?.map(spanOf) });
  };

  for (;;) {
    skipNl();
    if (peek().type === 'eof') break;
    const startedAt = pos;
    try {
      if (isForeignKeyStart(pos)) readForeignKey();
      else readTable();
    } catch (err) {
      if (!(err instanceof Stop)) throw err;
      // 다음 테이블 줄이나 Foreign Key 줄까지 건너뛴다. 같은 자리에서 다시 시작하지 않도록 적어도 한 칸은 나아간다
      pos = Math.max(err.at, startedAt + 1);
      while (peek().type !== 'eof' && !isLineHead(pos)) pos++;
    }
  }

  const schema = { tables: drafts.map((d) => d.def) };
  checkSchema(drafts, schema, report);
  problems.sort((a, b) => a.line - b.line || a.column - b.column);
  return { schema, problems };
}

/**
 * (추가) 일반 텍스트 교환 표기(_이름_)를 읽는다. parseRelational(fromMarkup(markup))과 같고,
 * 위치(문제, 테이블, 컬럼, 외래키)만 markup 글 기준으로 옮긴다. API, CLI, MCP가 받은 글의 문제를 알릴 때 쓴다.
 */
export function parseMarkup(markup: string): ParseResult {
  const { source, toMarkupIndex } = convertMarkup(markup);
  const result = parseRelational(source);
  const starts = (s: string) => {
    const out = [0];
    for (let i = 0; i < s.length; i++) if (s[i] === '\n') out.push(i + 1);
    return out;
  };
  const srcStarts = starts(source.text);
  const mkStarts = starts(markup);
  const toLineCol = (offset: number) => {
    let lo = 0;
    let hi = mkStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (mkStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - mkStarts[lo] + 1 };
  };
  const offsetOf = (line: number, column: number) => Math.min((srcStarts[line - 1] ?? source.text.length) + column - 1, source.text.length);
  const move = (at: { line: number; column: number }) => {
    const to = toLineCol(toMarkupIndex[offsetOf(at.line, at.column)]);
    at.line = to.line;
    at.column = to.column;
  };
  for (const t of result.schema.tables) {
    move(t);
    t.columns.forEach(move);
    t.foreignKeys.forEach(move);
  }
  for (const p of result.problems) {
    const from = offsetOf(p.line, p.column);
    const start = toLineCol(toMarkupIndex[from]);
    if (p.endColumn !== undefined) {
      const to = offsetOf(p.line, p.endColumn);
      // 끝은 마지막 글자 다음 칸. 감싼 _ 를 밑줄에 넣지 않는다
      const end = to > from ? toLineCol(toMarkupIndex[to - 1] + 1) : start;
      if (end.line === start.line && end.column > start.column) p.endColumn = end.column;
      else delete p.endColumn;
    }
    p.line = start.line;
    p.column = start.column;
  }
  return result;
}

/** 내용 검사: 외래키가 가리키는 테이블과 컬럼, 컬럼 수, 기본키가 없는 테이블 */
function checkSchema(
  drafts: Draft[],
  schema: { tables: RelTableDef[] },
  report: (severity: RelProblem['severity'], message: Message, span: Span) => void,
): void {
  const index = indexSchema(schema);
  for (const draft of drafts) {
    const table = draft.def;
    if (draft.complete && !table.columns.some((c) => c.primaryKey)) {
      report('warning', msg('rel.schema.noPrimaryKey', { table: quotedName(table.name) }), draft.name);
    }
    table.foreignKeys.forEach((fk, i) => {
      const spans = draft.fkSpans[i];
      const resolved = resolveForeignKey(index, fk);
      if (resolved.ok) return;
      const ref = quotedName(fk.refTable);
      switch (resolved.reason) {
        case 'unknown-table':
          return report('error', msg('rel.schema.unknownTable', { name: ref }), spans.ref);
        case 'no-primary-key':
          return report('error', msg('rel.schema.refNoPrimaryKey', { table: ref }), spans.ref);
        case 'ref-count':
          return report('error', msg('rel.schema.refColumnCount', { count: fk.columns.length, refCount: fk.refColumns?.length ?? 0 }), spans.refList ?? spans.item);
        case 'unknown-ref-column':
          return report(
            'error',
            msg('rel.schema.unknownRefColumn', { table: quotedName(resolved.ref.def.name), name: quotedName(fk.refColumns?.[resolved.at] ?? '') }),
            spans.refColumns?.[resolved.at] ?? spans.item,
          );
        case 'ref-not-primary-key':
          return report(
            'error',
            msg('rel.schema.refNotPrimaryKey', { table: quotedName(resolved.ref.def.name), name: quotedName(fk.refColumns?.[resolved.at] ?? '') }),
            spans.refColumns?.[resolved.at] ?? spans.item,
          );
        case 'arity':
          return report('error', msg('rel.schema.foreignKeyArity', { table: ref, count: fk.columns.length, expected: resolved.expected }), spans.item);
      }
    });
  }
}
