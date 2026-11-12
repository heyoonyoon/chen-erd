/**
 * 사람이 정하는 컬럼 설정(타입, NOT NULL, UNIQUE)의 키와 값 다듬기. Yjs를 모르는 순수 함수다(저장은 ./ydoc.ts).
 *
 * 키: columnKey(table, column) = JSON 배열 글자 '["테이블","컬럼"]'. 두 이름은 nameKey로 맞춘다
 *   (NFC, 연속 공백을 공백 하나로, 앞뒤 공백 제거, 소문자). 그래서 글에서 'Student'를 'student'로 고쳐 적거나
 *   공백을 더 넣어도 설정이 따라간다. 이름을 다른 말로 바꾸면 새 컬럼으로 보고 이전 설정은 쓰이지 않은 채 남는다.
 * 값: 타입은 앞뒤 공백을 떼고 연속 공백을 하나로 줄인다. 대소문자는 적은 그대로 둔다.
 *   SQL 문 안에 그대로 들어가므로 세미콜론, 줄바꿈, 주석 기호(--, /*, *\/)가 든 타입과 100자가 넘는 타입은 받지 않는다.
 */
import { nameKey } from './names';
import type { ColumnSetting } from './userSchema';

/** 타입 글자의 최대 길이 */
export const MAX_TYPE_LENGTH = 100;

export function columnKey(table: string, column: string): string {
  return JSON.stringify([nameKey(table), nameKey(column)]);
}

/** 쓸 수 있는 타입 글자로 다듬는다. 쓸 수 없으면 null */
export function cleanType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (/[;\r\n]|--|\/\*|\*\//.test(value)) return null;
  const t = value.replace(/\s+/g, ' ').trim();
  if (t === '' || t.length > MAX_TYPE_LENGTH) return null;
  return t;
}

/** 저장된 값을 확인한다. 틀린 필드는 빼고, 남는 것이 없으면 null */
export function cleanSetting(value: unknown): ColumnSetting | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const out: ColumnSetting = {};
  const type = cleanType(o.type);
  if (type !== null) out.type = type;
  if (typeof o.notNull === 'boolean') out.notNull = o.notNull;
  if (typeof o.unique === 'boolean') out.unique = o.unique;
  return Object.keys(out).length > 0 ? out : null;
}

/** 저장된 키가 columnKey 모양인지(두 이름이 이미 맞춰져 있는지까지 본다) */
export function isColumnKey(key: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    return false;
  }
  return (
    Array.isArray(parsed) &&
    parsed.length === 2 &&
    typeof parsed[0] === 'string' &&
    typeof parsed[1] === 'string' &&
    parsed[0] !== '' &&
    parsed[1] !== '' &&
    columnKey(parsed[0], parsed[1]) === key
  );
}
