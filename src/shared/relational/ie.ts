/**
 * 관계 모델 글(RelSchema)과 사람이 정한 컬럼 설정에서 IE 그림의 모델을 유도한다. 글과 설정에 없는 것은 추측하지 않는다.
 * 선 끝의 규칙은 userSchema.ts의 IeLink 설명을 따른다.
 *
 * 세부
 *   같은 이름의 테이블이나 컬럼이 둘 이상이면 처음 것만 그린다(키가 겹치지 않게).
 *   가리키는 테이블이 없거나, 그 테이블에 기본키가 없거나, 컬럼 수가 맞지 않는 외래키는 선을 긋지 않는다(컬럼의 FK 표시는 남는다).
 *   child.max: 외래키 컬럼 묶음에 자식의 기본키 컬럼이 모두 들어 있거나(같은 경우 포함), 묶음 안의 컬럼 하나라도 UNIQUE로 정해졌으면 '1'.
 *     기본키나 UNIQUE 컬럼을 품은 묶음은 언제나 행마다 다르기 때문이다. 한 컬럼짜리 외래키에서는 계약의 규칙과 정확히 같다.
 *   inheritedType: 외래키 컬럼에 타입이 없으면 가리키는 컬럼의 타입을 물려받는다. 가리키는 컬럼도 외래키면 끝까지 따라간다.
 */
import { nameKey } from './names';
import { indexSchema, resolveForeignKey, type IndexedTable, type SchemaIndex } from './schema';
import { cleanType, columnKey } from './settings';
import type { ColumnSetting, ColumnSettings, IeColumn, IeLink, IeModel, RelColumnDef, RelSchema } from './userSchema';

/** 컬럼 설정 하나. 타입은 다시 확인한다(설정이 문서 밖에서 들어올 수도 있다) */
export function settingOf(settings: ColumnSettings, table: string, column: string): ColumnSetting {
  const s = Object.hasOwn(settings, columnKey(table, column)) ? settings[columnKey(table, column)] : undefined;
  if (!s || typeof s !== 'object') return {};
  const out: ColumnSetting = {};
  const type = cleanType(s.type);
  if (type !== null) out.type = type;
  if (typeof s.notNull === 'boolean') out.notNull = s.notNull;
  if (typeof s.unique === 'boolean') out.unique = s.unique;
  return out;
}

/**
 * 컬럼마다 쓸 타입을 구한다: 사람이 정한 타입, 없으면 외래키로 가리키는 컬럼의 타입(끝까지 따라간다).
 * 돌려주는 함수는 (테이블, 컬럼) → { own, inherited }.
 */
export function typeResolver(index: SchemaIndex, settings: ColumnSettings): (table: IndexedTable, column: RelColumnDef) => { own: string | null; inherited: string | null } {
  // 외래키 컬럼 → 가리키는 컬럼
  const target = new Map<RelColumnDef, { table: IndexedTable; column: RelColumnDef }>();
  for (const table of index.tables) {
    for (const fk of table.def.foreignKeys) {
      const resolved = resolveForeignKey(index, fk);
      if (!resolved.ok) continue;
      fk.columns.forEach((name, i) => {
        const col = table.byName.get(nameKey(name));
        if (col && !target.has(col)) target.set(col, { table: resolved.ref, column: resolved.refColumns[i] });
      });
    }
  }
  const own = (table: IndexedTable, column: RelColumnDef) => settingOf(settings, table.def.name, column.name).type ?? null;
  return (table, column) => {
    const mine = own(table, column);
    if (mine !== null) return { own: mine, inherited: null };
    const seen = new Set<RelColumnDef>([column]);
    let at = target.get(column);
    while (at && !seen.has(at.column)) {
      const t = own(at.table, at.column);
      if (t !== null) return { own: null, inherited: t };
      seen.add(at.column);
      at = target.get(at.column);
    }
    return { own: null, inherited: null };
  };
}

export function deriveIe(schema: RelSchema, settings: ColumnSettings): IeModel {
  const index = indexSchema(schema);
  const typeOf = typeResolver(index, settings);
  const tables = index.tables.map((table) => {
    const fkColumns = new Set(table.def.foreignKeys.flatMap((fk) => fk.columns.map(nameKey)));
    const columns: IeColumn[] = table.columns.map((c) => {
      const s = settingOf(settings, table.def.name, c.name);
      const type = typeOf(table, c);
      return {
        name: c.name,
        primaryKey: c.primaryKey,
        foreignKey: fkColumns.has(nameKey(c.name)),
        type: type.own,
        notNull: c.primaryKey ? true : (s.notNull ?? null),
        inheritedType: type.inherited,
        unique: s.unique === true,
      };
    });
    return { table, columns };
  });

  const links: IeLink[] = [];
  for (const { table, columns } of tables) {
    const byKey = new Map(columns.map((c) => [nameKey(c.name), c]));
    table.def.foreignKeys.forEach((fk, i) => {
      const resolved = resolveForeignKey(index, fk);
      if (!resolved.ok) return;
      const cols = fk.columns.map((name) => byKey.get(nameKey(name))).filter((c): c is IeColumn => c !== undefined);
      if (cols.length !== fk.columns.length) return;
      const keys = new Set(cols.map((c) => nameKey(c.name)));
      const pk = table.primaryKey.map((c) => nameKey(c.name));
      const parentMin = cols.every((c) => c.notNull === true) ? 1 : cols.some((c) => c.notNull === false) ? 0 : null;
      const coversKey = pk.length > 0 && pk.every((k) => keys.has(k));
      links.push({
        id: `${table.def.name}#fk${i + 1}`,
        child: { table: table.def.name, min: null, max: coversKey || cols.some((c) => c.unique) ? '1' : 'N' },
        parent: { table: resolved.ref.def.name, min: parentMin, max: '1' },
        identifying: cols.every((c) => c.primaryKey),
        columns: cols.map((c) => c.name),
      });
    });
  }
  return { tables: tables.map(({ table, columns }) => ({ name: table.def.name, columns })), links };
}
