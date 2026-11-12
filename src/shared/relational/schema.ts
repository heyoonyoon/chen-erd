/**
 * 읽은 관계 모델(RelSchema)을 이름으로 찾아보는 색인. 파싱의 내용 검사, IE 유도, SQL이 같은 규칙을 쓴다.
 *
 * 이름은 nameKey로 비교한다. 같은 이름의 테이블이나 컬럼이 둘 이상이면 처음 것만 쓴다
 * (parseRelational은 중복을 오류로 알리고 처음 것만 남기지만, 다른 곳에서 만든 RelSchema가 들어올 수도 있다).
 */
import { nameKey } from './names';
import type { RelColumnDef, RelForeignKeyDef, RelSchema, RelTableDef } from './userSchema';

export interface IndexedTable {
  def: RelTableDef;
  /** 중복을 뺀 컬럼(글에 적은 순서) */
  columns: RelColumnDef[];
  /** nameKey(컬럼 이름) → 컬럼 */
  byName: Map<string, RelColumnDef>;
  /** 기본키 컬럼(글에 적은 순서) */
  primaryKey: RelColumnDef[];
}

export interface SchemaIndex {
  /** 중복을 뺀 테이블(글에 적은 순서) */
  tables: IndexedTable[];
  byName: Map<string, IndexedTable>;
}

export function indexSchema(schema: RelSchema): SchemaIndex {
  const tables: IndexedTable[] = [];
  const byName = new Map<string, IndexedTable>();
  for (const def of schema.tables) {
    const key = nameKey(def.name);
    if (key === '' || byName.has(key)) continue;
    const columns: RelColumnDef[] = [];
    const cols = new Map<string, RelColumnDef>();
    for (const c of def.columns) {
      const k = nameKey(c.name);
      if (k === '' || cols.has(k)) continue;
      cols.set(k, c);
      columns.push(c);
    }
    const table: IndexedTable = { def, columns, byName: cols, primaryKey: columns.filter((c) => c.primaryKey) };
    tables.push(table);
    byName.set(key, table);
  }
  return { tables, byName };
}

export type ResolvedForeignKey =
  | {
      ok: true;
      ref: IndexedTable;
      /** fk.columns와 같은 순서로 짝지은 가리키는 쪽 기본키 컬럼 */
      refColumns: RelColumnDef[];
    }
  | { ok: false; reason: 'unknown-table' }
  | { ok: false; reason: 'no-primary-key'; ref: IndexedTable }
  | { ok: false; reason: 'arity'; ref: IndexedTable; expected: number }
  /** (추가) refColumns의 개수가 columns와 다르다 */
  | { ok: false; reason: 'ref-count'; ref: IndexedTable }
  /** (추가) refColumns[at]이 가리키는 테이블에 없다 */
  | { ok: false; reason: 'unknown-ref-column'; ref: IndexedTable; at: number }
  /** (추가) refColumns[at]이 가리키는 테이블의 기본키 컬럼이 아니다. 기본키를 가리키는 외래키만 받는다(IE와 SQL이 어긋나지 않게) */
  | { ok: false; reason: 'ref-not-primary-key'; ref: IndexedTable; at: number };

/**
 * 외래키가 가리키는 테이블과 컬럼을 찾는다.
 * refColumns가 없으면 기본키 컬럼을 글에 적은 순서대로 짝짓는다.
 * refColumns가 있으면 그 이름들이 가리키는 테이블의 기본키 컬럼과 개수와 이름이 같아야 하고(순서는 상관없다), 적은 순서대로 짝짓는다.
 */
export function resolveForeignKey(index: SchemaIndex, fk: RelForeignKeyDef): ResolvedForeignKey {
  const ref = index.byName.get(nameKey(fk.refTable));
  if (!ref) return { ok: false, reason: 'unknown-table' };
  if (ref.primaryKey.length === 0) return { ok: false, reason: 'no-primary-key', ref };
  if (fk.refColumns) {
    if (fk.refColumns.length !== fk.columns.length) return { ok: false, reason: 'ref-count', ref };
    const cols: RelColumnDef[] = [];
    for (let at = 0; at < fk.refColumns.length; at++) {
      const c = ref.byName.get(nameKey(fk.refColumns[at]));
      if (!c) return { ok: false, reason: 'unknown-ref-column', ref, at };
      if (!c.primaryKey) return { ok: false, reason: 'ref-not-primary-key', ref, at };
      cols.push(c);
    }
    if (cols.length !== ref.primaryKey.length || new Set(cols).size !== cols.length) return { ok: false, reason: 'arity', ref, expected: ref.primaryKey.length };
    return { ok: true, ref, refColumns: cols };
  }
  if (ref.primaryKey.length !== fk.columns.length) return { ok: false, reason: 'arity', ref, expected: ref.primaryKey.length };
  return { ok: true, ref, refColumns: ref.primaryKey };
}
