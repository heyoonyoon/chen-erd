/**
 * 관계 모델과 SQL 화면이 이 브라우저에만 기억하는 값(마지막으로 고른 방언).
 * 저장소를 쓸 수 없는 환경(사생활 보호 모드, 막힌 저장소)에서도 화면이 그대로 동작하게 모든 접근을 감싼다.
 */
import type { SqlDialect } from '../../shared/relational/userSchema';

const PREFIX = 'chen-erd.';

export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    /* 저장하지 못해도 화면은 계속 쓸 수 있다 */
  }
}

export const DIALECT_KEY = 'sql.dialect';

export const DIALECTS: readonly SqlDialect[] = ['mysql', 'postgresql', 'oracle'];

export function readDialect(): SqlDialect {
  const v = readLocal(DIALECT_KEY);
  return DIALECTS.includes(v as SqlDialect) ? (v as SqlDialect) : 'mysql';
}
