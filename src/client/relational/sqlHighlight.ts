/**
 * SQL 글을 색칠하기 위한 아주 작은 토큰 분리(순수 함수). 구문 분석은 하지 않고 낱말 종류만 가른다.
 */

export type SqlTokenKind = 'keyword' | 'type' | 'string' | 'ident' | 'number' | 'comment' | 'punct' | 'text';

export interface SqlToken {
  kind: SqlTokenKind;
  text: string;
}

const KEYWORDS = new Set(
  [
    'CREATE', 'TABLE', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'NOT', 'NULL', 'UNIQUE', 'CONSTRAINT', 'ON', 'DELETE',
    'UPDATE', 'CASCADE', 'SET', 'DEFAULT', 'CHECK', 'IN', 'AND', 'OR', 'INDEX', 'IF', 'EXISTS', 'DROP', 'ALTER', 'ADD',
    'RESTRICT', 'NO', 'ACTION', 'ENGINE', 'CHARSET', 'COLLATE', 'COMMENT', 'TRUE', 'FALSE', 'AUTO_INCREMENT', 'GENERATED',
    'ALWAYS', 'AS', 'IDENTITY', 'BY', 'WITH', 'TYPE',
  ],
);

const TYPES = new Set(
  [
    'INT', 'INTEGER', 'SMALLINT', 'BIGINT', 'TINYINT', 'DECIMAL', 'NUMERIC', 'NUMBER', 'FLOAT', 'REAL', 'DOUBLE', 'PRECISION',
    'CHAR', 'VARCHAR', 'VARCHAR2', 'NVARCHAR', 'NVARCHAR2', 'NCHAR', 'TEXT', 'CLOB', 'BLOB', 'DATE', 'TIME', 'TIMESTAMP',
    'DATETIME', 'BOOLEAN', 'BOOL', 'BIT', 'SERIAL', 'BYTEA', 'UUID', 'JSON', 'JSONB', 'YEAR', 'INTERVAL',
  ],
);

const TOKEN = /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^']|'')*')|("(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\])|(\d+(?:\.\d+)?)|([\p{L}_][\p{L}\p{N}_$#]*)|([(),;.=*])|(\s+|[\s\S])/gu;

export function tokenizeSql(sql: string): SqlToken[] {
  const out: SqlToken[] = [];
  const push = (kind: SqlTokenKind, text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind && (kind === 'text' || kind === 'punct')) last.text += text;
    else out.push({ kind, text });
  };
  for (const m of sql.matchAll(TOKEN)) {
    const [, comment, str, quoted, num, word, punct, other] = m;
    if (comment !== undefined) push('comment', comment);
    else if (str !== undefined) push('string', str);
    else if (quoted !== undefined) push('ident', quoted);
    else if (num !== undefined) push('number', num);
    else if (word !== undefined) {
      const upper = word.toUpperCase();
      push(KEYWORDS.has(upper) ? 'keyword' : TYPES.has(upper) ? 'type' : 'ident', word);
    } else if (punct !== undefined) push('punct', punct);
    else push('text', other ?? '');
  }
  return out;
}
