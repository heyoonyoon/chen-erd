/**
 * 관계 모델 글과 컬럼 설정을 방 문서(Yjs)에 저장한다. 팀원이 실시간으로 함께 고친다.
 *
 *   doc.getText('relational-text')   관계 모델 글
 *   doc.getMap('relational-columns') 컬럼 설정. 키는 columnKey(table, column), 값은 ColumnSetting(평범한 JSON 객체)
 *
 * 컬럼마다 키가 따로라서 두 사람이 서로 다른 컬럼을 고치면 둘 다 남는다. 같은 컬럼을 동시에 고치면 나중에 반영된 쪽이 남는다.
 * 모양이 틀린 키와 값은 읽을 때 무시한다. 도형과 선(nodes, edges)과는 다른 자리라서 모델 텍스트 반영(applyChange)이 건드리지 않는다.
 * 예전의 자동 변환 선택(doc.getMap('relational'))은 더 읽지 않는다. 남아 있어도 해가 없다.
 */
import * as Y from 'yjs';
import { cleanSetting, cleanType, columnKey, isColumnKey } from './settings';
import { underlineMask } from './lexer';
import { normalizeRanges } from './markup';
import { UNDERLINE_ATTR, type ColumnSetting, type ColumnSettings, type RelationalSource, type SqlDialect, type TextRange } from './userSchema';

export const RELATIONAL_TEXT = 'relational-text';
export const RELATIONAL_COLUMNS = 'relational-columns';
/** 방 단위 관계 모델 설정(지금은 DBMS 하나). 팀원과 함께 쓴다 */
export const RELATIONAL_META = 'relational-meta';
const DIALECT_FIELD = 'dialect';

/** 방에서 고른 DBMS. 아직 아무도 고르지 않았으면 null */
export function readRoomDialect(doc: Y.Doc): SqlDialect | null {
  const v = doc.getMap(RELATIONAL_META).get(DIALECT_FIELD);
  return v === 'mysql' || v === 'postgresql' || v === 'oracle' ? v : null;
}

/** 방의 DBMS를 바꾼다. 같은 값이면 문서를 건드리지 않는다 */
export function setRoomDialect(doc: Y.Doc, dialect: SqlDialect, origin?: unknown): void {
  if (readRoomDialect(doc) === dialect) return;
  doc.transact(() => doc.getMap(RELATIONAL_META).set(DIALECT_FIELD, dialect), origin);
}

export function getRelationalText(doc: Y.Doc): Y.Text {
  return doc.getText(RELATIONAL_TEXT);
}

export function getColumnSettingsMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(RELATIONAL_COLUMNS);
}

export function readColumnSettings(doc: Y.Doc): ColumnSettings {
  const out: ColumnSettings = {};
  for (const [key, raw] of getColumnSettingsMap(doc).entries()) {
    if (!isColumnKey(key)) continue;
    const setting = cleanSetting(raw);
    if (setting) out[key] = setting;
  }
  return out;
}

/**
 * 컬럼 하나의 설정을 고친다. patch에 적은 키만 바꾸고, 값이 undefined인 키(빈 타입 글자도)는 지운다. patch가 null이면 그 컬럼 설정을 통째로 지운다.
 * 쓸 수 없는 값(틀린 타입 글자, 빈 이름)이면 아무것도 쓰지 않고 false. 바뀌는 것이 없으면 문서를 건드리지 않는다.
 */
export function setColumnSetting(doc: Y.Doc, table: string, column: string, patch: ColumnSetting | null, origin?: unknown): boolean {
  const key = columnKey(table, column);
  if (!isColumnKey(key)) return false;
  const map = getColumnSettingsMap(doc);
  if (patch === null) {
    if (map.has(key)) doc.transact(() => map.delete(key), origin);
    return true;
  }
  const next: ColumnSetting = { ...(cleanSetting(map.get(key)) ?? {}) };
  if ('type' in patch) {
    if (patch.type === undefined || (typeof patch.type === 'string' && patch.type.trim() === '')) delete next.type;
    else {
      const type = cleanType(patch.type);
      if (type === null) return false;
      next.type = type;
    }
  }
  for (const field of ['notNull', 'unique'] as const) {
    if (!(field in patch)) continue;
    const v = patch[field];
    if (v === undefined) delete next[field];
    else if (typeof v === 'boolean') next[field] = v;
    else return false;
  }
  const empty = Object.keys(next).length === 0;
  if (empty) {
    if (map.has(key)) doc.transact(() => map.delete(key), origin);
    return true;
  }
  if (JSON.stringify(map.get(key)) === JSON.stringify(next)) return true;
  doc.transact(() => map.set(key, next), origin);
  return true;
}

/**
 * (추가) 관계 모델 글 전체를 바꾼다. 앞뒤로 같은 부분은 두고 달라진 가운데만 지우고 넣어서,
 * 다른 사람이 보고 있는 커서와 동시에 고친 내용이 덜 흔들린다. 같은 글이면 아무것도 하지 않는다.
 */
export function setRelationalText(doc: Y.Doc, text: string, origin?: unknown): void {
  const ytext = getRelationalText(doc);
  const current = ytext.toString();
  if (current === text) return;
  let start = 0;
  const max = Math.min(current.length, text.length);
  while (start < max && current.charCodeAt(start) === text.charCodeAt(start)) start++;
  let end = 0;
  while (end < max - start && current.charCodeAt(current.length - 1 - end) === text.charCodeAt(text.length - 1 - end)) end++;
  // 서로게이트 쌍을 가르지 않도록 경계를 맞춘다
  const isLow = (s: string, i: number) => i > 0 && i < s.length && s.charCodeAt(i) >= 0xdc00 && s.charCodeAt(i) <= 0xdfff;
  while (start > 0 && (isLow(current, start) || isLow(text, start))) start--;
  while (end > 0 && (isLow(current, current.length - end) || isLow(text, text.length - end))) end--;
  doc.transact(() => {
    const removed = current.length - start - end;
    if (removed > 0) ytext.delete(start, removed);
    const inserted = text.slice(start, text.length - end);
    if (inserted !== '') ytext.insert(start, inserted);
  }, origin);
}

// ───────────────────────── (추가) 밑줄이 있는 글 ─────────────────────────

const isLowSurrogate = (s: string, i: number) => i > 0 && i < s.length && s.charCodeAt(i) >= 0xdc00 && s.charCodeAt(i) <= 0xdfff;

/** 방 문서의 관계 모델 글과 밑줄 구간(UNDERLINE_ATTR가 참인 곳). 글이 아닌 것(임베드)은 건너뛴다 */
export function readRelationalSource(doc: Y.Doc): RelationalSource {
  return readSource(getRelationalText(doc)).source;
}

function readSource(ytext: Y.Text): { source: RelationalSource; plain: boolean } {
  let text = '';
  let plain = true;
  const ranges: TextRange[] = [];
  for (const op of ytext.toDelta() as Array<{ insert?: unknown; attributes?: Record<string, unknown> }>) {
    if (typeof op.insert !== 'string') {
      plain = false;
      continue;
    }
    const from = text.length;
    text += op.insert;
    if (op.attributes?.[UNDERLINE_ATTR]) ranges.push({ from, to: text.length });
  }
  return { source: { text, underlines: normalizeRanges(ranges, text.length) }, plain };
}

/** 밑줄 구간을 서로게이트 쌍이 갈리지 않게 넓힌다 */
function snapRanges(text: string, ranges: ReadonlyArray<TextRange>): TextRange[] {
  const snapped = normalizeRanges(ranges, text.length).map(({ from, to }) => ({
    from: isLowSurrogate(text, from) ? from - 1 : from,
    to: isLowSurrogate(text, to) ? to + 1 : to,
  }));
  return normalizeRanges(snapped, text.length);
}

/**
 * (추가) 관계 모델 글과 밑줄을 source대로 맞춘다. 한 트랜잭션 안에서
 *   1. 글은 앞뒤로 같은 부분을 두고 달라진 가운데만 지우고 넣는다(넣은 글자는 왼쪽 글자의 밑줄을 물려받지 않게 넣는다).
 *   2. 밑줄은 지금과 달라진 구간만 format(자리, 길이, { underline: true | null })으로 고친다.
 * 서로게이트 쌍을 가르지 않는다. 같은 내용이면 아무것도 하지 않는다.
 */
export function setRelationalSource(doc: Y.Doc, source: RelationalSource, origin?: unknown): void {
  const ytext = getRelationalText(doc);
  const text = source.text;
  const want = underlineMask(text.length, snapRanges(text, source.underlines));
  const { source: current, plain } = readSource(ytext);
  const cur = current.text;

  // 지금 글에서 바뀌지 않을 앞부분과 뒷부분
  let start = 0;
  let end = 0;
  if (plain) {
    const max = Math.min(cur.length, text.length);
    while (start < max && cur.charCodeAt(start) === text.charCodeAt(start)) start++;
    while (end < max - start && cur.charCodeAt(cur.length - 1 - end) === text.charCodeAt(text.length - 1 - end)) end++;
    while (start > 0 && (isLowSurrogate(cur, start) || isLowSurrogate(text, start))) start--;
    while (end > 0 && (isLowSurrogate(cur, cur.length - end) || isLowSurrogate(text, text.length - end))) end--;
  }
  // 글을 고친 뒤의 밑줄: 남긴 앞뒤는 지금 그대로, 넣은 가운데는 없음
  const curMask = underlineMask(cur.length, current.underlines);
  const after = new Uint8Array(text.length);
  after.set(curMask.subarray(0, start), 0);
  after.set(curMask.subarray(cur.length - end), text.length - end);
  const removed = plain ? cur.length - start - end : ytext.length;
  const inserted = text.slice(start, text.length - end);

  const runs: Array<{ from: number; to: number; on: boolean }> = [];
  for (let i = 0; i < text.length; ) {
    if (after[i] === want[i]) {
      i++;
      continue;
    }
    let from = i;
    const on = want[i] === 1;
    while (i < text.length && after[i] !== want[i] && (want[i] === 1) === on) i++;
    let to = i;
    if (isLowSurrogate(text, from)) from--;
    if (isLowSurrogate(text, to)) to++;
    runs.push({ from, to, on });
    i = to;
  }
  if (removed === 0 && inserted === '' && runs.length === 0) return;

  doc.transact(() => {
    if (removed > 0) ytext.delete(start, removed);
    if (inserted !== '') ytext.insert(start, inserted, { [UNDERLINE_ATTR]: null });
    for (const r of runs) ytext.format(r.from, r.to - r.from, { [UNDERLINE_ATTR]: r.on ? true : null });
  }, origin);
}
