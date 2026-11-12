/**
 * (추가) IE 그림에서 고친 것을 관계 모델 글에 되써 넣는다. 글이 원본이고, IE는 계속 글에서 유도한다.
 *
 *   컬럼 이름 바꾸기: 테이블 줄의 그 컬럼 + 그 테이블의 Foreign Key (컬럼, ...) 목록의 같은 이름
 *                     + 이 테이블을 가리키는 Foreign Key 줄의 references 이테이블 (컬럼, ...) 목록의 같은 이름. 그 컬럼의 설정 키도 옮긴다.
 *   테이블 이름 바꾸기: 테이블 줄의 이름 + 모든 references 옛이름. 그 테이블 컬럼들의 설정 키도 옮긴다.
 *   기본키 켜고 끄기: 테이블 줄의 그 컬럼 이름에 밑줄 서식(UNDERLINE_ATTR)을 긋거나 지운다.
 *
 * 자리는 parseRelational이 준 위치(이름 시작의 줄, 칸)와 같은 규칙의 낱말(lex)로 찾고, 그 낱말만 바꾼다.
 * 이름 바꾸기는 글에 오류가 있으면(위치를 확실히 알 수 없으므로) 고치지 않고, 바꾼 결과에 오류가 생겨도 고치지 않는다.
 * 기본키 켜고 끄기는 그 컬럼 낱말이 제자리에 있는 것만 확인한다(planTogglePrimaryKey).
 * 새 이름은 cleanName으로 다듬고 필요하면 formatName처럼 큰따옴표로 묶는다. 비교는 nameKey로 한다.
 * 쉼표, 괄호, 큰따옴표, #, 줄바꿈, 화살표(->, →)가 든 이름은 받지 않는다(글이 읽기 어려워진다).
 * 바꾼 이름 글자의 밑줄은 바꾸기 전 이름 첫 글자의 밑줄을 따른다(따옴표에는 긋지 않는다).
 */
import * as Y from 'yjs';
import { lex, underlineMask, type LexToken } from './lexer';
import { maskToRanges } from './markup';
import { cleanName, nameKey } from './names';
import { columnKey } from './settings';
import { formatName, parseRelational } from './text';
import { getColumnSettingsMap, getRelationalText } from './ydoc';
import { UNDERLINE_ATTR, type RelationalSource, type RelTableDef } from './userSchema';

/** 고칠 수 없는 이유 */
export type RelEditError =
  /** 글에 오류가 있어 자리를 확실히 알 수 없다 */
  | 'text-errors'
  /** 글에서 그 테이블이나 컬럼을 찾지 못했다 */
  | 'not-found'
  /** 빈 이름 */
  | 'empty'
  /** 쓸 수 없는 글자가 들었다 */
  | 'chars'
  /** 같은 이름이 이미 있다 */
  | 'duplicate'
  /** 바꾸면 글에 오류가 생긴다 */
  | 'breaks'
  /** (추가) 여러 컬럼으로 된 외래키라서 이 컬럼만 뺄 수 없다 */
  | 'composite';

/** 글의 한 구간을 바꾼다. underline은 넣는 글자 안에서 밑줄을 그을 구간(없으면 긋지 않음) */
export interface TextReplace {
  from: number;
  to: number;
  text: string;
  underline: { from: number; to: number } | null;
}

/** 글 구간의 밑줄을 켜거나 끈다 */
export interface TextFormat {
  from: number;
  to: number;
  on: boolean;
}

/** 설정 키를 옮길 것 */
export type SettingsMove = { kind: 'column'; table: string; from: string; to: string } | { kind: 'table'; from: string; to: string };

export type RelEditPlan =
  | { ok: true; replaces: TextReplace[]; formats: TextFormat[]; settings: SettingsMove | null }
  | { ok: false; error: RelEditError };

const fail = (error: RelEditError): RelEditPlan => ({ ok: false, error });
const NOTHING: RelEditPlan = { ok: true, replaces: [], formats: [], settings: null };

/** 새 이름 확인. 쓸 수 있으면 다듬은 이름 */
export function checkNewName(raw: string): { ok: true; name: string } | { ok: false; error: RelEditError } {
  if (/[\r\n]/.test(raw)) return { ok: false, error: 'chars' };
  const name = cleanName(raw);
  if (name === '') return { ok: false, error: 'empty' };
  if (/[(),"#]/.test(name) || name.includes('->') || name.includes('→')) return { ok: false, error: 'chars' };
  return { ok: true, name };
}

/** 글과 낱말의 자리 찾기 */
interface Located {
  source: RelationalSource;
  tables: RelTableDef[];
  tokens: LexToken[];
  /** '줄:칸' → 낱말 번호 */
  at: Map<string, number>;
  mask: Uint8Array;
}

/** strict면 글에 오류가 하나라도 있을 때 null(이름 바꾸기). 아니면 읽은 부분에서 찾는다(낱말이 그 자리에 있는지는 따로 확인한다) */
function locate(source: RelationalSource, strict = true): Located | null {
  const parsed = parseRelational(source);
  if (strict && parsed.problems.some((p) => p.severity === 'error')) return null;
  const tokens = lex(source.text);
  const at = new Map<string, number>();
  tokens.forEach((t, i) => at.set(`${t.line}:${t.column}`, i));
  return { source, tables: parsed.schema.tables, tokens, at, mask: underlineMask(source.text.length, source.underlines) };
}

function tokenAt(loc: Located, line: number, column: number, name: string): LexToken | null {
  const i = loc.at.get(`${line}:${column}`);
  if (i === undefined) return null;
  const t = loc.tokens[i];
  return t.type === 'name' && nameKey(t.value) === nameKey(name) ? t : null;
}

/** Foreign Key 줄의 낱말들: 이 테이블의 컬럼, 가리키는 테이블, 가리키는 컬럼(적었으면) */
function foreignKeyTokens(
  loc: Located,
  line: number,
  column: number,
): { start: number; end: number; columns: LexToken[]; ref: LexToken; refColumns: LexToken[] } | null {
  let i = loc.at.get(`${line}:${column}`);
  if (i === undefined) return null;
  const toks = loc.tokens;
  const skipNl = () => {
    while (i! < toks.length && toks[i!].type === 'nl') i!++;
  };
  const start = toks[i].start;
  i += 2; // Foreign Key
  skipNl();
  if (toks[i]?.type !== '(') return null;
  i++;
  const list = (): LexToken[] | null => {
    const out: LexToken[] = [];
    for (;;) {
      skipNl();
      const t = toks[i!];
      if (!t) return null;
      i!++;
      if (t.type === ')') return out;
      if (t.type === 'name') out.push(t);
      else if (t.type !== ',') return null;
    }
  };
  const columns = list();
  if (!columns) return null;
  skipNl();
  if (toks[i]?.type !== 'name' || toks[i].value.toLowerCase() !== 'references') return null;
  i++;
  const ref = toks[i];
  if (ref?.type !== 'name') return null;
  i++;
  let refColumns: LexToken[] = [];
  if (toks[i]?.type === '(') {
    i++;
    const l = list();
    if (!l) return null;
    refColumns = l;
  }
  // 문장의 끝: 가리키는 컬럼 목록을 적었으면 닫는 괄호, 아니면 테이블 이름
  return { start, end: toks[i - 1].end, columns, ref, refColumns };
}

/** 낱말 하나를 새 이름으로 바꾼다(이름 첫 글자의 밑줄을 따른다) */
function replaceToken(loc: Located, t: LexToken, name: string): TextReplace {
  const text = formatName(name);
  const underlined = t.nameEnd > t.nameStart && loc.mask[t.nameStart] === 1;
  const inner = text.startsWith('"') ? { from: 1, to: text.length - 1 } : { from: 0, to: text.length };
  return { from: t.start, to: t.end, text, underline: underlined ? inner : null };
}

/** 계획을 글(밑줄 포함)에 적용한 결과. 화면 밖(확인, 테스트)에서 쓴다 */
export function applyPlanToSource(source: RelationalSource, plan: Extract<RelEditPlan, { ok: true }>): RelationalSource {
  const mask = underlineMask(source.text.length, source.underlines);
  for (const f of plan.formats) mask.fill(f.on ? 1 : 0, f.from, f.to);
  const sorted = [...plan.replaces].sort((a, b) => a.from - b.from);
  let text = '';
  const parts: Uint8Array[] = [];
  let pos = 0;
  for (const r of sorted) {
    text += source.text.slice(pos, r.from) + r.text;
    parts.push(mask.subarray(pos, r.from));
    const m = new Uint8Array(r.text.length);
    if (r.underline) m.fill(1, r.underline.from, r.underline.to);
    parts.push(m);
    pos = r.to;
  }
  text += source.text.slice(pos);
  parts.push(mask.subarray(pos));
  const out = new Uint8Array(text.length);
  let k = 0;
  for (const p of parts) {
    out.set(p, k);
    k += p.length;
  }
  return { text, underlines: maskToRanges(out) };
}

/** 바꾼 글이 오류 없이 읽히는지 */
function stillValid(source: RelationalSource, plan: Extract<RelEditPlan, { ok: true }>): boolean {
  return !parseRelational(applyPlanToSource(source, plan)).problems.some((p) => p.severity === 'error');
}

const findTable = (loc: Located, table: string) => loc.tables.find((t) => nameKey(t.name) === nameKey(table));

export function planRenameColumn(source: RelationalSource, table: string, column: string, newName: string): RelEditPlan {
  const checked = checkNewName(newName);
  if (!checked.ok) return fail(checked.error);
  const loc = locate(source);
  if (!loc) return fail('text-errors');
  const def = findTable(loc, table);
  const col = def?.columns.find((c) => nameKey(c.name) === nameKey(column));
  if (!def || !col) return fail('not-found');
  const name = checked.name;
  if (name === col.name) return NOTHING;
  if (def.columns.some((c) => c !== col && nameKey(c.name) === nameKey(name))) return fail('duplicate');
  const head = tokenAt(loc, col.line, col.column, col.name);
  if (!head) return fail('not-found');
  const replaces: TextReplace[] = [replaceToken(loc, head, name)];
  const same = (t: LexToken) => nameKey(t.value) === nameKey(col.name);
  for (const other of loc.tables) {
    for (const fk of other.foreignKeys) {
      const own = other === def;
      const pointsHere = nameKey(fk.refTable) === nameKey(def.name);
      if (!own && !pointsHere) continue;
      const toks = foreignKeyTokens(loc, fk.line, fk.column);
      if (!toks) return fail('not-found');
      if (own) for (const t of toks.columns.filter(same)) replaces.push(replaceToken(loc, t, name));
      if (pointsHere) for (const t of toks.refColumns.filter(same)) replaces.push(replaceToken(loc, t, name));
    }
  }
  const plan: RelEditPlan = { ok: true, replaces, formats: [], settings: { kind: 'column', table: def.name, from: col.name, to: name } };
  return stillValid(source, plan) ? plan : fail('breaks');
}

export function planRenameTable(source: RelationalSource, table: string, newName: string): RelEditPlan {
  const checked = checkNewName(newName);
  if (!checked.ok) return fail(checked.error);
  const loc = locate(source);
  if (!loc) return fail('text-errors');
  const def = findTable(loc, table);
  if (!def) return fail('not-found');
  const name = checked.name;
  if (name === def.name) return NOTHING;
  if (loc.tables.some((t) => t !== def && nameKey(t.name) === nameKey(name))) return fail('duplicate');
  const head = tokenAt(loc, def.line, def.column, def.name);
  if (!head) return fail('not-found');
  const replaces: TextReplace[] = [replaceToken(loc, head, name)];
  for (const other of loc.tables) {
    for (const fk of other.foreignKeys) {
      if (nameKey(fk.refTable) !== nameKey(def.name)) continue;
      const toks = foreignKeyTokens(loc, fk.line, fk.column);
      if (!toks) return fail('not-found');
      replaces.push(replaceToken(loc, toks.ref, name));
    }
  }
  const plan: RelEditPlan = { ok: true, replaces, formats: [], settings: { kind: 'table', from: def.name, to: name } };
  return stillValid(source, plan) ? plan : fail('breaks');
}

/**
 * 기본키 켜고 끄기. 끄면 그 이름 낱말의 밑줄을 모두 지우고, 켜면 이름 글자(따옴표 제외)에 긋는다.
 * 밑줄만 바꾸고 글자는 그대로라서, 글의 다른 곳에 오류가 있어도 그 컬럼 낱말이 제자리에 있으면 고친다
 * (기본키를 켜서 생긴 오류, 예를 들어 references 목록과 기본키 수가 어긋난 것을 그림에서 다시 끌 수 있게).
 * 읽지 못한 테이블(괄호를 닫지 않은 것 등)의 컬럼은 찾지 못하므로 고치지 않는다.
 */
export function planTogglePrimaryKey(source: RelationalSource, table: string, column: string): RelEditPlan {
  const loc = locate(source, false);
  if (!loc) return fail('text-errors');
  const def = findTable(loc, table);
  const col = def?.columns.find((c) => nameKey(c.name) === nameKey(column));
  if (!def || !col) return fail('not-found');
  const t = tokenAt(loc, col.line, col.column, col.name);
  if (!t) return fail('not-found');
  const formats: TextFormat[] = col.primaryKey ? [{ from: t.start, to: t.end, on: false }] : [{ from: t.nameStart, to: t.nameEnd, on: true }];
  return { ok: true, replaces: [], formats, settings: null };
}

/** (추가) 외래키가 가리킬 곳. column이 null이면 references 테이블만 적는다(그 테이블의 기본키를 가리킨다) */
export interface ForeignKeyTarget {
  table: string;
  column: string | null;
}

/** 줄 머리(그 줄 첫 글자 자리)와 줄 끝(줄바꿈 자리 또는 글 끝) */
const lineStartOf = (text: string, pos: number) => text.lastIndexOf('\n', pos - 1) + 1;
const lineEndOf = (text: string, pos: number) => {
  const nl = text.indexOf('\n', pos);
  return nl < 0 ? text.length : nl;
};

/** 테이블 블록(테이블 줄과 그 테이블의 Foreign Key 줄들)의 마지막 줄 끝. 찾지 못하면 null */
function tableBlockEnd(loc: Located, def: RelTableDef): number | null {
  const head = loc.at.get(`${def.line}:${def.column}`);
  if (head === undefined) return null;
  let end = -1;
  let depth = 0;
  for (let i = head; i < loc.tokens.length; i++) {
    const t = loc.tokens[i];
    if (t.type === '(') depth++;
    else if (t.type === ')' && --depth === 0) {
      end = t.end;
      break;
    }
  }
  if (end < 0) return null;
  for (const fk of def.foreignKeys) {
    const toks = foreignKeyTokens(loc, fk.line, fk.column);
    if (!toks) return null;
    end = Math.max(end, toks.end);
  }
  return lineEndOf(loc.source.text, end);
}

/**
 * (추가) 컬럼의 키 고르기(없음, PK, FK, PK+FK).
 *   PK: planTogglePrimaryKey와 같이 그 이름 낱말의 밑줄을 긋거나 지운다.
 *   FK 켜기: 그 테이블 블록 아래에 'Foreign Key (컬럼) references 테이블 (컬럼)' 줄을 더한다(ref 필요).
 *   FK 끄기: 그 컬럼 하나로 된 Foreign Key 문장을 지운다(줄에 그것만 있으면 줄째로). 여러 컬럼으로 된 외래키에 들어 있으면 고치지 않는다('composite').
 * 외래키를 바꿀 때는 이름 바꾸기처럼 글에 오류가 없어야 하고, 바꾼 결과에도 오류가 없어야 한다.
 */
export function planSetKeys(
  source: RelationalSource,
  table: string,
  column: string,
  want: { primaryKey: boolean; foreignKey: boolean; ref?: ForeignKeyTarget },
): RelEditPlan {
  const loose = locate(source, false);
  if (!loose) return fail('text-errors');
  const def0 = findTable(loose, table);
  const col0 = def0?.columns.find((c) => nameKey(c.name) === nameKey(column));
  if (!def0 || !col0) return fail('not-found');
  const isFk = def0.foreignKeys.some((fk) => fk.columns.some((c) => nameKey(c) === nameKey(column)));
  const pkChange = col0.primaryKey !== want.primaryKey;
  if (isFk === want.foreignKey) return pkChange ? planTogglePrimaryKey(source, table, column) : NOTHING;

  const loc = locate(source);
  if (!loc) return fail('text-errors');
  const def = findTable(loc, table)!;
  const col = def.columns.find((c) => nameKey(c.name) === nameKey(column))!;
  const formats: TextFormat[] = [];
  if (pkChange) {
    const t = tokenAt(loc, col.line, col.column, col.name);
    if (!t) return fail('not-found');
    formats.push(col.primaryKey ? { from: t.start, to: t.end, on: false } : { from: t.nameStart, to: t.nameEnd, on: true });
  }
  const text = source.text;
  const replaces: TextReplace[] = [];
  if (want.foreignKey) {
    const ref = want.ref;
    const refDef = ref ? findTable(loc, ref.table) : undefined;
    if (!ref || !refDef) return fail('not-found');
    let refCol: string | null = null;
    if (ref.column !== null) {
      const found = refDef.columns.find((c) => nameKey(c.name) === nameKey(ref.column!));
      if (!found) return fail('not-found');
      refCol = found.name;
    }
    const at = tableBlockEnd(loc, def);
    if (at === null) return fail('not-found');
    const line = `Foreign Key (${formatName(col.name)}) references ${formatName(refDef.name)}${refCol !== null ? ` (${formatName(refCol)})` : ''}`;
    replaces.push({ from: at, to: at, text: `\n${line}`, underline: null });
  } else {
    for (const fk of def.foreignKeys) {
      if (!fk.columns.some((c) => nameKey(c) === nameKey(column))) continue;
      if (fk.columns.length > 1) return fail('composite');
      const toks = foreignKeyTokens(loc, fk.line, fk.column);
      if (!toks) return fail('not-found');
      const ls = lineStartOf(text, toks.start);
      const le = lineEndOf(text, toks.end);
      const alone = text.slice(ls, toks.start).trim() === '' && text.slice(toks.end, le).trim() === '';
      if (!alone) replaces.push({ from: toks.start, to: toks.end, text: '', underline: null });
      // 줄째로 지운다: 앞 줄바꿈과 함께(첫 줄이면 뒤 줄바꿈과 함께)
      else if (ls > 0) replaces.push({ from: ls - 1, to: le, text: '', underline: null });
      else replaces.push({ from: ls, to: Math.min(text.length, le + 1), text: '', underline: null });
    }
  }
  const plan: RelEditPlan = { ok: true, replaces, formats, settings: null };
  return stillValid(source, plan) ? plan : fail('breaks');
}

/** 설정 키 옮기기(한 트랜잭션 안에서 부른다) */
function moveSettings(doc: Y.Doc, move: SettingsMove): void {
  const map = getColumnSettingsMap(doc);
  const pairs: Array<[string, string]> = [];
  if (move.kind === 'column') {
    pairs.push([columnKey(move.table, move.from), columnKey(move.table, move.to)]);
  } else {
    const from = nameKey(move.from);
    for (const key of [...map.keys()]) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(key);
      } catch {
        continue;
      }
      if (!Array.isArray(parsed) || parsed[0] !== from || typeof parsed[1] !== 'string') continue;
      pairs.push([key, columnKey(move.to, parsed[1])]);
    }
  }
  for (const [from, to] of pairs) {
    if (from === to) continue;
    if (map.has(from)) {
      const v = map.get(from);
      map.delete(from);
      map.set(to, v);
    } else if (map.has(to)) {
      // 옛 이름에 설정이 없었는데 새 이름 자리에 예전 설정이 남아 있으면 지운다(바꾼 컬럼은 설정이 없는 그대로)
      map.delete(to);
    }
  }
}

/**
 * 계획을 방 문서에 한 트랜잭션으로 적용한다(뒤쪽 자리부터 바꿔 앞의 자리가 밀리지 않게). 팀원에게도 바로 간다.
 * 넣은 글자는 이웃 글자의 밑줄을 물려받지 않고, 계획의 underline 구간에만 밑줄을 긋는다.
 */
export function applyRelationalEdit(doc: Y.Doc, plan: Extract<RelEditPlan, { ok: true }>, origin?: unknown): void {
  if (plan.replaces.length === 0 && plan.formats.length === 0 && !plan.settings) return;
  const ytext = getRelationalText(doc);
  doc.transact(() => {
    for (const f of plan.formats) ytext.format(f.from, f.to - f.from, { [UNDERLINE_ATTR]: f.on ? true : null });
    for (const r of [...plan.replaces].sort((a, b) => b.from - a.from)) {
      ytext.delete(r.from, r.to - r.from);
      ytext.insert(r.from, r.text, { [UNDERLINE_ATTR]: null });
      if (r.underline && r.underline.to > r.underline.from) {
        ytext.format(r.from + r.underline.from, r.underline.to - r.underline.from, { [UNDERLINE_ATTR]: true });
      }
    }
    if (plan.settings) moveSettings(doc, plan.settings);
  }, origin);
}
