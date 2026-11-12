/**
 * SQL pane의 부품. 고른 방언의 CREATE TABLE 문을 읽기 전용으로 색칠해 보여 주고, 컬럼마다 설정(타입, NULL, UNIQUE)을 고르게 한다.
 * 설정은 방 문서에 써서 같은 방의 모두가 같은 IE와 SQL을 본다. 정하지 않은 것은 정하지 않은 채로 둔다(추측하지 않는다).
 */
import { useMemo } from 'react';
import type { ColumnSetting } from '../../shared/relational/userSchema';
import { useT } from '../i18n';
import { stopKeys } from './common';
import { TypeCombo } from './pickers';
import { tokenizeSql } from './sqlHighlight';
export function SqlCode({ sql }: { sql: string }) {
  const t = useT();
  const tokens = useMemo(() => tokenizeSql(sql), [sql]);
  return (
    <pre className="sql-code" data-testid="sql-code" tabIndex={0} aria-label={t('sqlView.codeLabel')}>
      <code>
        {tokens.map((tk, i) =>
          tk.kind === 'text' || tk.kind === 'punct' ? (
            tk.text
          ) : (
            <span key={i} className={`sql-${tk.kind}`}>
              {tk.text}
            </span>
          ),
        )}
      </code>
    </pre>
  );
}

/** 표의 한 줄(컬럼 하나) */
export interface SettingsColumn {
  name: string;
  primaryKey: boolean;
  setting: ColumnSetting;
  /** 타입을 정하지 않은 외래키 컬럼이 가리키는 컬럼에서 물려받는 타입(칸에 흐리게 보인다). 없으면 null */
  inheritedType: string | null;
  /** SQL에 타입이 자리 표시로 들어간 컬럼 */
  missingType: boolean;
}

export interface SettingsTable {
  name: string;
  columns: SettingsColumn[];
}

/** 설정 하나를 바꾼다. 값이 undefined인 키는 지운다(미지정으로 돌아간다). 쓰지 못했으면 false */
export type SettingWriter = (table: string, column: string, patch: ColumnSetting) => boolean | void;

type NullChoice = 'unset' | 'not-null' | 'null';

const nullChoiceOf = (setting: ColumnSetting): NullChoice => (setting.notNull === true ? 'not-null' : setting.notNull === false ? 'null' : 'unset');

/**
 * 컬럼 설정 표. 타입(자유 입력, 기본값 없음), NULL(미지정, NOT NULL, NULL 허용 셋 중 하나), UNIQUE.
 * 기본키 컬럼은 언제나 NOT NULL이라서 NULL 칸을 NOT NULL로 잠근다.
 */
export function ColumnSettingsTable({
  tables,
  onChange,
  typeOptions = [],
}: {
  tables: SettingsTable[];
  onChange: SettingWriter;
  /** 타입 칸에서 고를 흔한 타입(고른 DBMS의 것) */
  typeOptions?: readonly string[];
}) {
  const t = useT();
  return (
    <section className="sql-types" aria-labelledby="sql-types-title" data-testid="sql-settings">
      <h2 id="sql-types-title" className="rel-h2">
        {t('sqlView.settings.title')}
      </h2>
      <div className="sql-types-scroll">
        <table className="sql-types-table">
          <thead>
            <tr>
              <th scope="col">{t('sqlView.settings.column')}</th>
              <th scope="col">{t('sqlView.settings.type')}</th>
              <th scope="col">NULL</th>
              <th scope="col" className="sql-types-unique">
                UNIQUE
              </th>
            </tr>
          </thead>
          {tables.map((table) => (
            <tbody key={table.name} data-table={table.name}>
              <tr className="sql-types-group">
                <th scope="rowgroup" colSpan={4}>
                  {table.name}
                </th>
              </tr>
              {table.columns.map((c) => {
                const choice: NullChoice = c.primaryKey ? 'not-null' : nullChoiceOf(c.setting);
                return (
                  <tr key={c.name} data-column={`${table.name}.${c.name}`} data-missing-type={c.missingType || undefined}>
                    <th scope="row" className="sql-types-name">
                      <span className={c.primaryKey ? 'rel-pk' : undefined}>{c.name}</span>
                    </th>
                    <td className="sql-types-cell">
                      <TypeCombo
                        value={c.setting.type ?? ''}
                        options={typeOptions}
                        label={t('sqlView.typeLabel', { table: table.name, column: c.name })}
                        testId={`type-input-${table.name}.${c.name}`}
                        className={`sql-type-input${c.inheritedType ? ' is-inherited' : ''}`}
                        placeholder={c.inheritedType ?? t('sqlView.settings.type')}
                        attrs={{ 'data-missing': c.missingType || undefined }}
                        onCommit={(next) => (onChange(table.name, c.name, { type: next === '' ? undefined : next }) === false ? t('relView.ie.typeInvalid') : null)}
                      />
                    </td>
                    <td className="sql-types-cell">
                      <select
                        className="input sql-null-select"
                        data-testid={`null-select-${table.name}.${c.name}`}
                        aria-label={t('sqlView.nullLabel', { table: table.name, column: c.name })}
                        value={choice}
                        disabled={c.primaryKey}
                        data-locked={c.primaryKey || undefined}
                        onKeyDown={stopKeys}
                        onChange={(e) => {
                          const v = e.target.value as NullChoice;
                          onChange(table.name, c.name, { notNull: v === 'not-null' ? true : v === 'null' ? false : undefined });
                        }}
                      >
                        <option value="unset">{t('sqlView.settings.unset')}</option>
                        <option value="not-null">NOT NULL</option>
                        <option value="null">{t('sqlView.settings.nullable')}</option>
                      </select>
                    </td>
                    <td className="sql-types-cell sql-types-unique">
                      <input
                        type="checkbox"
                        data-testid={`unique-${table.name}.${c.name}`}
                        aria-label={t('sqlView.uniqueLabel', { table: table.name, column: c.name })}
                        checked={c.setting.unique === true}
                        onKeyDown={stopKeys}
                        onChange={(e) => onChange(table.name, c.name, { unique: e.target.checked ? true : undefined })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}
