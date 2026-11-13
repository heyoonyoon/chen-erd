/**
 * 관계 모델 글과 컬럼 설정에서 CREATE TABLE 문을 만든다.
 *
 * 타입은 추측하지 않는다. 사람이 정한 타입을 쓰고, 없으면 외래키 컬럼에 한해 가리키는 컬럼의 타입을 물려받는다(유도이지 추측이 아니다).
 * 그래도 없으면 타입 자리에 TYPE_PLACEHOLDER를 넣고 missingTypes에 적는다. 이 자리 표시가 든 SQL은 어느 DBMS에서도 실행되지 않으므로 빈 곳이 바로 드러난다.
 * NOT NULL은 기본키 컬럼과 사람이 NOT NULL로 정한 컬럼에만 붙인다. UNIQUE는 사람이 정한 컬럼에만 붙인다(그 컬럼 하나가 기본키 전체이면 뺀다).
 * 타입 글자는 표준 이름(VARCHAR(n), CHAR(n), INT, DECIMAL(p,s), TIMESTAMP, BOOLEAN, TEXT 등)이면 방언에 맞게 바꾸고, 모르는 글자는 적은 그대로 쓴다.
 */
import { indexSchema, resolveForeignKey, type IndexedTable, type ResolvedForeignKey } from './schema';
import { settingOf, typeResolver } from './ie';
import { nameKey } from './names';
import type { ColumnSettings, RelForeignKeyDef, RelSchema, SqlDialect, SqlOptions, SqlResult } from './userSchema';

/** 타입을 정하지 않은 컬럼의 타입 자리에 넣는 표시 */
export const TYPE_PLACEHOLDER = '/* 타입 미지정 */';

// ───────────────────────── 방언 ─────────────────────────

const DIALECT_LABEL: Record<SqlDialect, string> = { mysql: 'MySQL', postgresql: 'PostgreSQL', oracle: 'Oracle' };

export const SQL_DIALECTS: readonly SqlDialect[] = ['postgresql', 'mysql', 'oracle'];

export function isSqlDialect(value: unknown): value is SqlDialect {
  return value === 'mysql' || value === 'postgresql' || value === 'oracle';
}

/** 식별자를 방언의 따옴표로 묶는다. 한글 이름과 예약어가 그대로 쓰이도록 언제나 묶는다 */
export function quoteIdentifier(name: string, dialect: SqlDialect): string {
  // 어느 DBMS도 식별자에 NUL을 받지 않는다. 줄바꿈은 주석 줄에 이름이 들어갈 때 주석을 끝내므로 공백으로 바꾼다
  const clean = name.replace(/\u0000/g, '').replace(LINE_BREAKS, ' ');
  if (dialect === 'mysql') return '`' + clean.replace(/`/g, '``') + '`';
  // Oracle의 따옴표 식별자에는 큰따옴표를 넣을 방법이 없다(두 번 적기를 받지 않는다). 빼고 묶는다
  if (dialect === 'oracle') return '"' + clean.replace(/"/g, '') + '"';
  return '"' + clean.replace(/"/g, '""') + '"';
}

/** 줄 주석(--)을 끝낼 수 있는 글자. PostgreSQL은 \r도 줄 끝으로 본다 */
const LINE_BREAKS = /[\r\n\v\f\u0085\u2028\u2029]/g;

/** 주석 줄에 넣는 사람이 적은 글자. 줄을 끝내는 글자를 공백으로 바꿔 주석 밖으로 나가지 못하게 한다 */
function commentText(text: string): string {
  return text.replace(/\u0000/g, '').replace(LINE_BREAKS, ' ');
}

/** 표준 타입 이름을 방언의 타입으로. 모르는 글자(사용자가 적은 타입)는 그대로 둔다 */
export function dialectType(type: string, dialect: SqlDialect): string {
  const t = type.trim();
  const upper = t.toUpperCase().replace(/\s+/g, ' ');
  let m: RegExpMatchArray | null;
  if (upper === 'BOOLEAN' || upper === 'BOOL') return dialect === 'oracle' ? 'NUMBER(1)' : 'BOOLEAN';
  if (upper === 'TEXT' || upper === 'CLOB') return dialect === 'oracle' ? 'CLOB' : 'TEXT';
  if (upper === 'INT' || upper === 'INTEGER') return dialect === 'oracle' ? 'NUMBER(10)' : dialect === 'mysql' ? 'INT' : 'INTEGER';
  if (upper === 'BIGINT') return dialect === 'oracle' ? 'NUMBER(19)' : 'BIGINT';
  if (upper === 'TIMESTAMP' || upper === 'DATETIME') return dialect === 'mysql' ? 'DATETIME' : 'TIMESTAMP';
  if ((m = upper.match(/^(?:DECIMAL|NUMERIC|NUMBER)\s*\((\d+)\s*(?:,\s*(\d+))?\)$/))) {
    const args = m[2] !== undefined ? `${m[1]},${m[2]}` : m[1];
    return dialect === 'oracle' ? `NUMBER(${args})` : `DECIMAL(${args})`;
  }
  if ((m = upper.match(/^(?:VARCHAR2?|CHARACTER VARYING)\s*\((\d+)(?:\s+(?:CHAR|BYTE))?\)$/))) {
    return dialect === 'oracle' ? `VARCHAR2(${m[1]} CHAR)` : `VARCHAR(${m[1]})`;
  }
  if ((m = upper.match(/^(?:CHAR|CHARACTER)\s*\((\d+)(?:\s+(?:CHAR|BYTE))?\)$/))) {
    return dialect === 'oracle' ? `CHAR(${m[1]} CHAR)` : `CHAR(${m[1]})`;
  }
  return t;
}

// ───────────────────────── CREATE TABLE ─────────────────────────

interface TableFks {
  table: IndexedTable;
  fks: Array<{ fk: RelForeignKeyDef; index: number; resolved: ResolvedForeignKey }>;
}

/**
 * CREATE TABLE 문을 만든다. 참조당하는 테이블을 먼저 만든다.
 * 서로를 가리키는 고리가 있으면 고리를 끊는 외래키만 테이블을 다 만든 뒤 ALTER TABLE로 더한다.
 * 자기 자신을 가리키는 외래키(재귀 관계)는 CREATE TABLE 안에 그대로 둔다.
 * 가리키는 테이블이 없거나 기본키가 없거나 컬럼 수가 맞지 않거나 기본키가 아닌 컬럼을 가리키는 외래키는 넣지 않고 주석으로 남긴다.
 * 외래키에 가리키는 컬럼(refColumns)을 적었으면 적은 순서대로 짝짓는다(resolveForeignKey).
 */
export function toSql(schema: RelSchema, settings: ColumnSettings, dialect: SqlDialect, options: SqlOptions = {}): SqlResult {
  const q = (name: string) => quoteIdentifier(name, dialect);
  const index = indexSchema(schema);
  const typeOf = typeResolver(index, settings);
  const all: TableFks[] = index.tables.map((table) => ({
    table,
    fks: table.def.foreignKeys.map((fk, i) => ({ fk, index: i, resolved: resolveForeignKey(index, fk) })),
  }));
  const refOf = (r: ResolvedForeignKey) => (r.ok ? r.ref : null);

  // 만드는 순서: 아직 만들지 않은 다른 테이블을 가리키지 않는 것부터, 같으면 글에 적은 순서대로
  const created = new Set<IndexedTable>();
  const order: TableFks[] = [];
  const deferred = new Set<string>();
  const remaining = [...all];
  while (remaining.length > 0) {
    let at = remaining.findIndex((t) =>
      t.fks.every(({ resolved }) => {
        const ref = refOf(resolved);
        return ref === null || ref === t.table || created.has(ref);
      }),
    );
    if (at < 0) at = 0; // 고리: 첫 테이블을 먼저 만들고 막힌 외래키는 뒤로 미룬다
    const entry = remaining.splice(at, 1)[0];
    for (const { resolved, index: i } of entry.fks) {
      const ref = refOf(resolved);
      if (ref !== null && ref !== entry.table && !created.has(ref)) deferred.add(`${nameKey(entry.table.def.name)}#${i}`);
    }
    created.add(entry.table);
    order.push(entry);
  }
  const isDeferred = (t: IndexedTable, i: number) => deferred.has(`${nameKey(t.def.name)}#${i}`);

  /** 외래키 제약 하나. 쓸 수 없는 외래키면 null */
  const fkClause = (t: IndexedTable, fk: RelForeignKeyDef, i: number, resolved: ResolvedForeignKey): string | null => {
    if (!resolved.ok) return null;
    const cols = fk.columns.map((name) => q(t.byName.get(nameKey(name))?.name ?? name)).join(', ');
    const refCols = resolved.refColumns.map((c) => q(c.name)).join(', ');
    return `CONSTRAINT ${q(`${t.def.name}_fk${i + 1}`)} FOREIGN KEY (${cols}) REFERENCES ${q(resolved.ref.def.name)} (${refCols})`;
  };
  const skippedReason = (resolved: ResolvedForeignKey): string => {
    if (resolved.ok) return '';
    switch (resolved.reason) {
      case 'unknown-table':
        return '가리키는 테이블이 없습니다';
      case 'no-primary-key':
        return '가리키는 테이블에 기본키가 없습니다';
      case 'ref-count':
        return '외래키 컬럼 수와 가리키는 컬럼 수가 다릅니다';
      case 'unknown-ref-column':
        return '가리키는 컬럼이 그 테이블에 없습니다';
      case 'ref-not-primary-key':
        return '가리키는 컬럼이 그 테이블의 기본키가 아닙니다';
      case 'arity':
        return '컬럼 수가 가리키는 테이블의 기본키와 다릅니다';
    }
  };

  const missingTypes: SqlResult['missingTypes'] = [];
  const blocks: string[] = [];
  for (const { table, fks } of order) {
    const name = table.def.name;
    if (table.columns.length === 0) {
      blocks.push('', `-- 만들지 않은 테이블: ${q(name)}. 컬럼이 없습니다.`);
      continue;
    }
    const lines: string[] = [];
    for (const c of table.columns) {
      const s = settingOf(settings, name, c.name);
      const t = typeOf(table, c);
      const type = t.own ?? t.inherited;
      if (type === null) missingTypes.push({ table: name, column: c.name });
      const notNull = c.primaryKey || s.notNull === true;
      lines.push(`${q(c.name)} ${type === null ? TYPE_PLACEHOLDER : dialectType(type, dialect)}${notNull ? ' NOT NULL' : ''}`);
    }
    if (table.primaryKey.length > 0) lines.push(`PRIMARY KEY (${table.primaryKey.map((c) => q(c.name)).join(', ')})`);
    for (const c of table.columns) {
      if (settingOf(settings, name, c.name).unique !== true) continue;
      if (table.primaryKey.length === 1 && table.primaryKey[0] === c) continue;
      lines.push(`UNIQUE (${q(c.name)})`);
    }
    const skipped: string[] = [];
    for (const { fk, index: i, resolved } of fks) {
      const clause = fkClause(table, fk, i, resolved);
      if (clause === null) {
        skipped.push(
          `-- 넣지 않은 외래키: ${q(name)} (${fk.columns.map(q).join(', ')}) REFERENCES ${q(fk.refTable)}${fk.refColumns ? ` (${fk.refColumns.map(q).join(', ')})` : ''}. ${skippedReason(resolved)}.`,
        );
      } else if (!isDeferred(table, i)) {
        lines.push(clause);
      }
    }
    blocks.push('', `CREATE TABLE ${q(name)} (`, lines.map((l) => `  ${l}`).join(',\n'), ');', ...skipped);
  }
  const alters: string[] = [];
  for (const { table, fks } of order) {
    if (table.columns.length === 0) continue;
    for (const { fk, index: i, resolved } of fks) {
      if (!isDeferred(table, i)) continue;
      const clause = fkClause(table, fk, i, resolved);
      if (clause) alters.push(`ALTER TABLE ${q(table.def.name)} ADD ${clause};`);
    }
  }
  if (alters.length > 0) blocks.push('', ...alters);

  const out: string[] = [];
  const title = options.title ? options.title.replace(/\s+/g, ' ').trim() : '';
  out.push(title ? `-- ${title} (${DIALECT_LABEL[dialect]})` : `-- ${DIALECT_LABEL[dialect]}`);
  if (options.textErrors && options.textErrors > 0) {
    out.push(`-- 관계 모델 글에 오류가 ${options.textErrors}개 있어 읽은 부분만 옮겼습니다. 글의 오류를 먼저 고칩니다.`);
  }
  if (options.listMissingTypes && missingTypes.length > 0) {
    out.push(`-- 타입을 정하지 않은 컬럼이 ${missingTypes.length}개 있습니다. 타입을 정하기 전에는 이 SQL이 실행되지 않습니다.`);
    for (const m of missingTypes) out.push(`--   ${commentText(m.table)}.${commentText(m.column)}`);
  }
  if (index.tables.length === 0) out.push('', '-- 관계 모델 글에 테이블이 없습니다.');
  out.push(...blocks);
  return { sql: out.join('\n') + '\n', missingTypes };
}
