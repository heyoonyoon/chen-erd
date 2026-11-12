/**
 * 관계 모델 글에서 유도한 IE(까마귀발) 그림. 테이블 상자는 엔진의 layoutIe 자리(이름으로 찾는다)에 놓고,
 * 기본키 묶음(구분선 위)과 나머지 묶음(구분선 아래)으로 나눈다. 각 행은 [키 표시 | 이름 | 타입 | NULL] 네 칸이고,
 * 칸 경계는 테이블 안에서 모두 같다(ieColumnGrid). 타입은 사람이 정한 것만 적고, 외래키 컬럼이 가리키는 컬럼에서
 * 물려받은 타입은 흐리게 적는다. NULL 칸은 NOT NULL, NULL, 빈칸(미지정) 셋 중 하나다.
 * 선은 외래키 하나에 하나이고, 식별 관계는 실선, 비식별 관계는 점선이다. 선 끝은 아는 것만 그린다.
 * 끌기와 휠로 화면을 옮기고 확대한다.
 *
 * editor가 있으면 그림 안에서 고친다. 그림은 언제나 글과 설정에서 다시 유도한다.
 *   타입 칸 누르기: 그 자리에 콤보박스. 고른 DBMS의 흔한 타입에서 고르거나 직접 적는다. Enter나 칸을 떠나면 쓰고 Esc는 버린다.
 *                   빈 값은 미지정. 틀린 값은 쓰지 않고 표시한다.
 *   NULL 칸 누르기: 미지정, NOT NULL, NULL 중에 고르는 메뉴. 기본키는 언제나 NOT NULL이라 바꿀 수 없다.
 *   키 칸 누르기: 없음, PK, FK, PK+FK 중에 고르는 메뉴. PK는 글의 그 이름에 밑줄, FK는 가리킬 테이블과 컬럼을 골라
 *                 'Foreign Key (컬럼) references 테이블 (컬럼)' 줄을 더하거나 지운다(planSetKeys).
 *   이름 칸, 테이블 이름 두 번 누르기: 이름 바꾸기(글의 테이블 줄, Foreign Key 줄, references를 함께 고친다).
 *   키보드로는 칸에 포커스를 두고 Enter(또는 F2)를 누른다. 그림에 포커스가 있을 때 ⌘Z, Ctrl+Z는 그림에서 고친 것만 되돌린다.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { ColumnSetting, IeColumn, IeLayout, IeModel, IeTable } from '../../shared/relational/userSchema';
import type { Viewport } from '../../shared/types';
import { clampZoom, fitRect, panViewport, wheelDeltaPx, wheelPan, wheelZoomFactor, zoomViewportAt } from '../canvas/viewportMath';
import { useT } from '../i18n';
import { approximateLineWidth } from '../../shared/measure';
import { toast } from '../ui/toast';
import { icons, stopKeys } from './common';
import type { ForeignKeyTarget } from './engine';
import { CellMenu, TypeCombo } from './pickers';
import { IE_BOX, ieBoxSize, ieColumnGrid, ieSectionHeight, type IeColumnGrid } from './engine';
import { endKind, endMarks, polylinePath, routeLinks, type Box, type Mark } from './ieGeometry';

const B = IE_BOX;

/** 그림 안 편집. 이름과 기본키는 글을 고치고, 타입과 NULL은 컬럼 설정을 고친다. 실패하면 이유 글자를 돌려준다 */
export interface IeEditor {
  setColumn(table: string, column: string, patch: ColumnSetting): string | null;
  renameColumn(table: string, column: string, next: string): string | null;
  renameTable(table: string, next: string): string | null;
  /** 키 고르기(없음, PK, FK, PK+FK). FK를 새로 켜면 ref가 있어야 한다 */
  setKeys(table: string, column: string, want: { primaryKey: boolean; foreignKey: boolean; ref?: ForeignKeyTarget }): string | null;
  /** 그림에서 고친 것 되돌리기(redo면 다시 실행) */
  undo(redo: boolean): void;
}

/** 고치고 있는 칸 */
interface EditingCell {
  kind: 'type' | 'name' | 'table';
  table: string;
  column: string | null;
}

/** 칸 테스트 아이디에 쓰는 '테이블.컬럼' */
const cellId = (table: string, column: string) => `${table}.${column}`;
const testIdOf = (cell: EditingCell) => (cell.kind === 'table' ? `ie-table-name-${cell.table}` : `ie-${cell.kind}-${cellId(cell.table, cell.column!)}`);

/** 열린 칸 메뉴(NULL, 키). fk가 있으면 외래키가 가리킬 곳을 고르는 중이다 */
interface OpenMenu {
  kind: 'null' | 'key';
  table: string;
  column: string;
  fk?: { primaryKey: boolean };
}

function MarkShape({ mark }: { mark: Mark }) {
  if (mark.type === 'bar') return <line className="ie-mark ie-mark-bar" x1={mark.x1} y1={mark.y1} x2={mark.x2} y2={mark.y2} />;
  if (mark.type === 'circle') return <circle className="ie-mark ie-mark-circle" cx={mark.cx} cy={mark.cy} r={mark.r} />;
  return <path className="ie-mark ie-mark-crow" d={mark.d} />;
}

/** 칸 자리의 입력칸. 열리면 바로 글자를 모두 고른다 */
function CellEditor({
  value,
  placeholder,
  label,
  testId,
  className,
  x,
  y,
  w,
  h,
  onCommit,
  onClose,
}: {
  value: string;
  placeholder?: string | null;
  label: string;
  testId: string;
  className: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 쓴다. 쓸 수 없으면 이유 글자 */
  onCommit: (next: string) => string | null;
  /** 입력칸을 닫는다. refocus면 그 칸으로 포커스를 돌린다(키보드로 닫았을 때) */
  onClose: (refocus: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
  }, []);
  /** 쓰고 닫는다. 쓸 수 없으면 Enter일 때는 열어 두고, 칸을 떠날 때는 버리고 알린다 */
  const commit = (how: 'enter' | 'blur') => {
    if (done.current) return;
    const next = draft.trim();
    if (next !== value) {
      const problem = onCommit(next);
      if (problem !== null) {
        setError(problem);
        if (how === 'enter') return;
        toast(problem, 'error');
      }
    }
    done.current = true;
    onClose(how === 'enter');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 입력칸의 키는 그림(화면 이동, 확대, 되돌리기)과 캔버스 단축키로 가지 않는다
    stopKeys(e);
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      commit('enter');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      done.current = true;
      onClose(true);
    }
  };
  return (
    <foreignObject className="ie-edit" x={x} y={y} width={w} height={h}>
      <input
        ref={ref}
        className={`input ie-input ${className}${error ? ' is-invalid' : ''}`}
        data-testid={testId}
        value={draft}
        placeholder={placeholder ?? undefined}
        spellCheck={false}
        autoComplete="off"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        title={error ?? undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onBlur={() => commit('blur')}
        onKeyDown={onKeyDown}
        onKeyUp={stopKeys}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </foreignObject>
  );
}

/** 누를 수 있는 칸(hover 바탕과 포커스 테두리를 그릴 사각형을 깐다) */
function Cell({
  kind,
  testId,
  label,
  hint,
  x,
  y,
  w,
  h,
  active,
  className = '',
  value,
  onActivate,
  children,
}: {
  kind: 'type' | 'null' | 'key' | 'name' | 'table';
  testId: string;
  label: string;
  hint?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 고칠 수 있는 칸인지 */
  active: boolean;
  className?: string;
  value?: string;
  onActivate: () => void;
  children?: ReactNode;
}) {
  return (
    <g
      className={`ie-cell ie-cell-${kind}${active ? ' is-editable' : ''}${className ? ` ${className}` : ''}`}
      data-edit={active ? kind : undefined}
      data-testid={testId}
      data-value={value}
      role={active ? 'button' : undefined}
      tabIndex={active ? 0 : undefined}
      aria-label={active ? label : undefined}
      onKeyDown={
        active
          ? (e) => {
              if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'F2') return;
              e.preventDefault();
              e.stopPropagation();
              onActivate();
            }
          : undefined
      }
    >
      <rect className="ie-cell-hit" x={x} y={y} width={w} height={h} />
      {children}
      {active && hint && <title>{hint}</title>}
    </g>
  );
}

interface TableBoxProps {
  table: IeTable;
  typeOptions: readonly string[];
  box: Box;
  editor?: IeEditor;
  /** 이 테이블에서 고치고 있는 칸 */
  editing: EditingCell | null;
  onEdit: (cell: EditingCell | null, refocus?: boolean) => void;
  /** 칸 하나를 누른 것처럼 한다(키보드) */
  onActivate: (cell: { kind: string; table: string; column: string | null }) => void;
}

/** 칸 x 경계 */
function gridX(box: Box, g: IeColumnGrid) {
  const name = box.x + g.key;
  const type = name + g.name;
  const nullable = type + g.type;
  return { key: box.x, name, type, nullable };
}

function TableBox({ table, typeOptions, box, editor, editing, onEdit, onActivate }: TableBoxProps) {
  const t = useT();
  const { headerHeight: header, rowHeight: row, cellPadX: pad } = B;
  const pkCols = table.columns.filter((c) => c.primaryKey);
  const otherCols = table.columns.filter((c) => !c.primaryKey);
  const dividerY = box.y + header + ieSectionHeight(pkCols.length);
  const g = ieColumnGrid(table, box.w);
  const X = gridX(box, g);
  const active = Boolean(editor);
  const editingTable = editing?.kind === 'table';

  const rowEl = (c: IeColumn, i: number, y: number, last: boolean) => {
    const tags = [c.primaryKey ? 'PK' : '', c.foreignKey ? 'FK' : ''].filter(Boolean);
    const mid = y + row / 2;
    const id = cellId(table.name, c.name);
    const editingType = editing?.kind === 'type' && editing.column === c.name;
    const editingName = editing?.kind === 'name' && editing.column === c.name;
    const nullText = c.notNull === true ? 'NOT NULL' : c.notNull === false ? 'NULL' : '';
    const nullActive = active && !c.primaryKey;
    const keyMid = X.key + g.key / 2;
    const names = { table: table.name, column: c.name };
    const act = (kind: string) => () => onActivate({ kind, table: table.name, column: c.name });
    return (
      <g
        key={`${i}:${c.name}`}
        className="ie-row"
        data-column={c.name}
        data-type={c.type ?? undefined}
        data-inherited-type={c.type ? undefined : (c.inheritedType ?? undefined)}
        data-not-null={c.notNull === null ? undefined : String(c.notNull)}
      >
        {/* 행 사이 옅은 선(묶음의 마지막 행 아래는 구분선이나 상자 테두리) */}
        {!last && <line className="ie-row-line" x1={box.x} x2={box.x + box.w} y1={y + row} y2={y + row} />}
        <Cell
          kind="key"
          testId={`ie-key-${id}`}
          label={t('relView.ie.keyLabel', names)}
          hint={t('relView.ie.keyHint')}
          x={X.key}
          y={y}
          w={g.key}
          h={row}
          active={active}
          value={c.primaryKey ? 'pk' : 'none'}
          onActivate={act('key')}
        >
          {/* 기본키이면서 외래키인 컬럼은 두 표시를 위아래로 겹친다 */}
          <text className={`ie-tag${tags.length > 1 ? ' is-stacked' : ''}`} x={keyMid} y={mid}>
            {tags.length > 1 ? (
              <>
                <tspan x={keyMid} y={mid - 5}>
                  {tags[0]}
                </tspan>
                <tspan x={keyMid} y={mid + 6}>
                  {tags[1]}
                </tspan>
              </>
            ) : (
              tags[0]
            )}
          </text>
        </Cell>
        <Cell
          kind="name"
          testId={`ie-name-${id}`}
          label={t('relView.ie.columnNameLabel', names)}
          hint={t('relView.ie.renameHint')}
          x={X.name}
          y={y}
          w={g.name}
          h={row}
          active={active && !editingName}
          onActivate={act('name')}
        >
          {!editingName && (
            <>
              <text className={`ie-col${c.primaryKey ? ' is-pk' : ''}`} x={X.name + pad} y={mid}>
                {c.name}
              </text>
              {/* SVG 글자의 밑줄은 브라우저마다 자리가 달라서 기본키 밑줄은 직접 긋는다 */}
              {c.primaryKey && (
                <line className="ie-pk-line" x1={X.name + pad} x2={X.name + pad + approximateLineWidth(c.name, B.fontSize)} y1={mid + 8} y2={mid + 8} />
              )}
            </>
          )}
        </Cell>
        <Cell
          kind="type"
          testId={`ie-type-${id}`}
          label={t('sqlView.typeLabel', names)}
          x={X.type}
          y={y}
          w={g.type}
          h={row}
          active={active && !editingType}
          className={c.type ?? c.inheritedType ? '' : 'is-empty'}
          onActivate={act('type')}
        >
          {!editingType &&
            (c.type ? (
              <text className="ie-type" x={X.type + pad} y={mid}>
                {c.type}
              </text>
            ) : c.inheritedType ? (
              <text className="ie-type is-inherited" x={X.type + pad} y={mid}>
                {c.inheritedType}
              </text>
            ) : active ? (
              // 빈 칸: 평소엔 글자가 없고, 올려 두거나 포커스가 있을 때만 옅게 보인다
              <text className="ie-type-hint" x={X.type + pad} y={mid} aria-hidden="true">
                {t('sqlView.settings.type')}
              </text>
            ) : null)}
        </Cell>
        <Cell
          kind="null"
          testId={`ie-null-${id}`}
          label={`${t('sqlView.nullLabel', names)}: ${nullText || t('sqlView.settings.unset')}`}
          hint={t('relView.ie.nullHint')}
          x={X.nullable}
          y={y}
          w={g.nullable}
          h={row}
          active={nullActive}
          className={c.primaryKey ? 'is-locked' : ''}
          value={c.notNull === true ? 'not-null' : c.notNull === false ? 'null' : 'unset'}
          onActivate={act('null')}
        >
          {nullText && (
            <text className="ie-null" x={X.nullable + pad} y={mid}>
              {nullText}
            </text>
          )}
        </Cell>
        {editor && editingType && (
          // 좁은 타입 칸이면 NULL 칸 위까지 넓혀 적기 쉽게 한다(상자 밖으로는 나가지 않는다)
          <foreignObject className="ie-edit" x={X.type + 2} y={y + 2} width={Math.max(g.type, Math.min(140, g.type + g.nullable)) - 4} height={row - 4}>
            <TypeCombo
              value={c.type ?? ''}
              options={typeOptions}
              placeholder={c.inheritedType ?? t('sqlView.settings.type')}
              label={t('sqlView.typeLabel', names)}
              testId={`ie-type-input-${id}`}
              className="ie-input ie-input-type"
              autoFocus
              onCommit={(next) => editor.setColumn(table.name, c.name, { type: next === '' ? undefined : next })}
              onDone={(how) => onEdit(null, how !== 'blur')}
            />
          </foreignObject>
        )}
        {editor && editingName && (
          <CellEditor
            value={c.name}
            label={t('relView.ie.columnNameLabel', names)}
            testId={`ie-name-input-${id}`}
            className="ie-input-name"
            x={X.name + 2}
            y={y + 2}
            w={Math.max(g.name, Math.min(160, g.name + g.type)) - 4}
            h={row - 4}
            onCommit={(next) => editor.renameColumn(table.name, c.name, next)}
            onClose={(refocus) => onEdit(null, refocus)}
          />
        )}
      </g>
    );
  };
  const bottom = box.y + box.h;
  return (
    <g className="ie-table" data-table={table.name} role="group" aria-label={t('relView.ie.tableLabel', { name: table.name })}>
      <rect className="ie-box" x={box.x} y={box.y} width={box.w} height={box.h} rx={4} />
      <path className="ie-head" d={`M${box.x} ${box.y + header}V${box.y + 4}a4 4 0 0 1 4 -4H${box.x + box.w - 4}a4 4 0 0 1 4 4V${box.y + header}Z`} />
      <Cell
        kind="table"
        testId={`ie-table-name-${table.name}`}
        label={t('relView.ie.tableNameLabel', { table: table.name })}
        hint={t('relView.ie.renameHint')}
        x={box.x}
        y={box.y}
        w={box.w}
        h={header}
        active={active && !editingTable}
        onActivate={() => onActivate({ kind: 'table', table: table.name, column: null })}
      >
        {!editingTable && (
          <text className="ie-name" x={box.x + B.paddingX} y={box.y + header / 2}>
            {table.name}
          </text>
        )}
      </Cell>
      {/* 칸 경계(세로, 옅게) */}
      {[X.name, X.type, X.nullable].map((x) => (
        <line key={x} className="ie-grid-line" x1={x} x2={x} y1={box.y + header} y2={bottom} />
      ))}
      <line className="ie-head-line" x1={box.x} y1={box.y + header} x2={box.x + box.w} y2={box.y + header} />
      {pkCols.map((c, i) => rowEl(c, i, box.y + header + i * row, i === pkCols.length - 1))}
      <line className="ie-divider" x1={box.x} y1={dividerY} x2={box.x + box.w} y2={dividerY} />
      {otherCols.map((c, i) => rowEl(c, pkCols.length + i, dividerY + i * row, i === otherCols.length - 1))}
      {editor && editingTable && (
        <CellEditor
          value={table.name}
          label={t('relView.ie.tableNameLabel', { table: table.name })}
          testId={`ie-table-name-input-${table.name}`}
          className="ie-input-table"
          x={box.x + 6}
          y={box.y + 6}
          w={box.w - 12}
          h={header - 12}
          onCommit={(next) => editor.renameTable(table.name, next)}
          onClose={(refocus) => onEdit(null, refocus)}
        />
      )}
    </g>
  );
}

/** 외래키가 가리킬 테이블과 컬럼(그 테이블의 기본키 중에서) 고르기 */
function ForeignKeyForm({
  model,
  table,
  onConfirm,
  onCancel,
}: {
  model: IeModel;
  table: string;
  /** 쓴다. 쓸 수 없으면 이유 글자 */
  onConfirm: (ref: ForeignKeyTarget) => string | null;
  onCancel: () => void;
}) {
  const t = useT();
  const keysOf = (name: string) => model.tables.find((tb) => tb.name === name)?.columns.filter((c) => c.primaryKey).map((c) => c.name) ?? [];
  // 처음엔 기본키가 있는 다른 테이블
  const first = model.tables.find((tb) => tb.name !== table && tb.columns.some((c) => c.primaryKey)) ?? model.tables[0];
  const [refTable, setRefTable] = useState(first?.name ?? '');
  const keys = keysOf(refTable);
  const [refColumn, setRefColumn] = useState(keys[0] ?? '');
  const [error, setError] = useState<string | null>(null);
  const tableRef = useRef<HTMLSelectElement>(null);
  useEffect(() => tableRef.current?.focus({ preventScroll: true }), []);
  return (
    <form
      className="ie-fk-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!refTable || !refColumn) return;
        setError(onConfirm({ table: refTable, column: refColumn }));
      }}
    >
      <label className="ie-fk-field">
        <span>{t('relView.ie.fkTable')}</span>
        <select
          ref={tableRef}
          className="input"
          data-testid="ie-fk-table"
          value={refTable}
          onChange={(e) => {
            setRefTable(e.target.value);
            setRefColumn(keysOf(e.target.value)[0] ?? '');
            setError(null);
          }}
        >
          {model.tables.map((tb) => (
            <option key={tb.name} value={tb.name}>
              {tb.name}
            </option>
          ))}
        </select>
      </label>
      <label className="ie-fk-field">
        <span>{t('relView.ie.fkColumn')}</span>
        <select
          className="input"
          data-testid="ie-fk-column"
          value={refColumn}
          disabled={keys.length === 0}
          onChange={(e) => {
            setRefColumn(e.target.value);
            setError(null);
          }}
        >
          {keys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      {(keys.length === 0 || error) && (
        <p className="ie-fk-note" role="alert" data-testid="ie-fk-error">
          {keys.length === 0 ? t('relView.ie.fkNoKey') : error}
        </p>
      )}
      <div className="ie-fk-actions">
        <button type="button" className="btn btn-ghost" data-testid="ie-fk-cancel" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary" data-testid="ie-fk-confirm" disabled={keys.length === 0}>
          {t('common.confirm')}
        </button>
      </div>
    </form>
  );
}

export function IeLegend({ id }: { id?: string }) {
  const t = useT();
  const kinds = [
    { kind: 'exactly-one', end: { min: 1, max: '1' }, label: t('relView.ie.exactlyOne') },
    { kind: 'zero-or-one', end: { min: 0, max: '1' }, label: t('relView.ie.zeroOrOne') },
    { kind: 'one-or-many', end: { min: 1, max: 'N' }, label: t('relView.ie.oneOrMany') },
    { kind: 'zero-or-many', end: { min: 0, max: 'N' }, label: t('relView.ie.zeroOrMany') },
    { kind: 'max-one', end: { min: null, max: '1' }, label: t('relView.ie.maxOne') },
    { kind: 'max-many', end: { min: null, max: 'N' }, label: t('relView.ie.maxMany') },
  ] as const;
  return (
    <div className="ie-legend" id={id} data-testid="ie-legend" role="group" aria-label={t('relPane.legend.label')}>
      <ul>
        {kinds.map((k) => (
          <li key={k.kind}>
            <svg width="44" height="18" viewBox="0 0 44 18" aria-hidden="true">
              <line className="ie-link-line" x1="2" y1="9" x2="42" y2="9" />
              {endMarks(k.end, { x: 42, y: 9 }, { x: -1, y: 0 }).map((m, i) => (
                <MarkShape key={i} mark={m} />
              ))}
            </svg>
            <span>{k.label}</span>
          </li>
        ))}
        <li>
          <svg width="44" height="18" viewBox="0 0 44 18" aria-hidden="true">
            <line className="ie-link-line" x1="2" y1="9" x2="42" y2="9" />
          </svg>
          <span>{t('relView.ie.identifying')}</span>
        </li>
        <li>
          <svg width="44" height="18" viewBox="0 0 44 18" aria-hidden="true">
            <line className="ie-link-line is-dashed" x1="2" y1="9" x2="42" y2="9" />
          </svg>
          <span>{t('relView.ie.nonIdentifying')}</span>
        </li>
      </ul>
    </div>
  );
}

/** 상자 자리(엔진의 배치 자리에, 칸 수와 타입에 맞춘 크기). 배치에 없는 테이블은 빠진다 */
function useBoxes(model: IeModel, layout: IeLayout): Record<string, Box> {
  return useMemo(() => {
    const out: Record<string, Box> = {};
    for (const table of model.tables) {
      const at = layout.tables[table.name];
      if (!at || out[table.name]) continue;
      const size = ieBoxSize(table);
      out[table.name] = { x: at.x, y: at.y, w: Math.max(at.w, size.w), h: size.h };
    }
    return out;
  }, [model, layout]);
}

function bounds(boxes: Record<string, Box>): Box | null {
  const list = Object.values(boxes);
  if (list.length === 0) return null;
  const x = Math.min(...list.map((b) => b.x));
  const y = Math.min(...list.map((b) => b.y));
  return { x, y, w: Math.max(...list.map((b) => b.x + b.w)) - x, h: Math.max(...list.map((b) => b.y + b.h)) - y };
}

const FIT_MAX = 1.25;
/** 그림 칸이 이보다 낮으면(px) 기호 설명을 접는다 */
const LOW_STAGE = 460;
/** 이만큼(px) 넘게 움직이면 누르기가 아니라 끌기로 본다 */
const CLICK_SLOP = 4;
/** 두 번 누르기로 보는 간격(ms) */
const DOUBLE_CLICK_MS = 450;

interface Props {
  model: IeModel;
  layout: IeLayout;
  /** 있으면 그림 안에서 고친다(타입, NULL, 키, 이름). 없으면 보기만 한다 */
  editor?: IeEditor;
  /** 타입 칸에서 고를 흔한 타입(고른 DBMS의 것) */
  typeOptions?: readonly string[];
  /** 좁은 pane: 기호 설명을 그림 위에 띄우지 않고 기호 버튼으로 접어 둔다 */
  compactLegend?: boolean;
  /** 그림 위 왼쪽 위에 띄울 것(오류 배지) */
  overlay?: ReactNode;
}

export function IeDiagram({ model, layout, editor, typeOptions = [], compactLegend = false, overlay }: Props) {
  const t = useT();
  const [legendOpen, setLegendOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const boxes = useBoxes(model, layout);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  // 고치던 테이블이나 컬럼이 글에서 없어지면(팀원이 지우거나 이름을 바꾸면) 입력칸을 닫는다
  const editingAlive =
    editing !== null &&
    model.tables.some((tb) => tb.name === editing.table && (editing.column === null || tb.columns.some((c) => c.name === editing.column)));
  const onEdit = (cell: EditingCell | null, refocus = false) => {
    const prev = editing;
    setEditing(cell);
    if (cell === null && prev && refocus) {
      // 키보드로 닫았으면 그 칸으로 포커스를 돌린다(입력칸이 사라진 뒤에). 이름을 바꿨으면 새 이름의 칸은 찾지 못하고 그림에 둔다
      const later = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn: () => void) => setTimeout(fn, 0);
      later(() => {
        const want = testIdOf(prev);
        const el = [...(rootRef.current?.querySelectorAll<SVGGElement>('[data-testid]') ?? [])].find((n) => n.getAttribute('data-testid') === want);
        if (el) el.focus({ preventScroll: true });
        else rootRef.current?.focus({ preventScroll: true });
      });
    }
  };
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const columnOf = (table: string, column: string) => model.tables.find((tb) => tb.name === table)?.columns.find((col) => col.name === column);
  const cellEl = (testId: string) =>
    [...(rootRef.current?.querySelectorAll<SVGGElement>('[data-testid]') ?? [])].find((n) => n.getAttribute('data-testid') === testId) ?? null;
  const closeMenu = (refocus: boolean) => {
    const prev = menu;
    setMenu(null);
    if (prev && refocus) cellEl(`ie-${prev.kind}-${cellId(prev.table, prev.column)}`)?.focus({ preventScroll: true });
  };
  /** 칸 하나를 누른다(포인터나 키보드). NULL과 키 칸은 메뉴를 열고 닫는다 */
  const activate = ({ kind, table, column }: { kind: string; table: string; column: string | null }) => {
    if (!editor) return;
    if (kind === 'type' || kind === 'name') {
      if (column !== null) onEdit({ kind, table, column });
    } else if (kind === 'table') onEdit({ kind, table, column: null });
    else if ((kind === 'null' || kind === 'key') && column !== null) {
      const c = columnOf(table, column);
      if (!c || (kind === 'null' && c.primaryKey)) return;
      const same = menu && menu.kind === kind && menu.table === table && menu.column === column;
      setMenu(same ? null : { kind, table, column });
    }
  };
  const menuColumn = menu ? columnOf(menu.table, menu.column) : undefined;
  const pickMenu = (value: string) => {
    if (!editor || !menu || !menuColumn) return;
    let problem: string | null = null;
    if (menu.kind === 'null') {
      problem = editor.setColumn(menu.table, menu.column, { notNull: value === 'not-null' ? true : value === 'null' ? false : undefined });
    } else {
      const primaryKey = value === 'pk' || value === 'pkfk';
      const foreignKey = value === 'fk' || value === 'pkfk';
      if (foreignKey && !menuColumn.foreignKey) {
        // 새 외래키: 가리킬 곳을 먼저 고른다
        setMenu({ ...menu, fk: { primaryKey } });
        return;
      }
      problem = editor.setKeys(menu.table, menu.column, { primaryKey, foreignKey });
    }
    if (problem) toast(problem, 'error');
    closeMenu(true);
  };
  /** 이름 칸과 테이블 이름은 두 번 눌러야 고친다(한 번 누르기는 그냥 고르기와 끌기) */
  const lastClick = useRef<{ key: string; at: number } | null>(null);
  // 그림 칸이 낮아도 기호 설명을 접는다(펼쳐 두면 그림이 너무 작아진다)
  const compact = compactLegend || (size.h > 0 && size.h < LOW_STAGE);

  const links = useMemo(() => model.links.filter((l) => boxes[l.child.table] && boxes[l.parent.table]), [model, boxes]);
  const routes = useMemo(
    () => routeLinks(links.map((l) => ({ id: l.id, from: l.child.table, to: l.parent.table })), boxes),
    [links, boxes],
  );

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (s.w === Math.round(r.width) && s.h === Math.round(r.height) ? s : { w: Math.round(r.width), h: Math.round(r.height) }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** 전체가 보이게 맞춘다 */
  const fit = () => {
    const b = bounds(boxes);
    if (!b || size.w === 0 || size.h === 0) return;
    // 위쪽은 상자 위로 돌아가는 선과 그 이름표가 잘리지 않게 더 넉넉히 둔다
    const fitIn = (area: { w: number; h: number }): Viewport => {
      const v = fitRect({ x: b.x - 40, y: b.y - 60, w: b.w + 80, h: b.h + 80 }, area, 24);
      const zoom = clampZoom(Math.min(v.zoom, FIT_MAX));
      return { zoom, x: area.w / 2 - (b.x + b.w / 2) * zoom, y: area.h / 2 - (b.y + b.h / 2) * zoom };
    };
    let next = fitIn(size);
    // 기호 설명이 그림 위 왼쪽 아래에 떠 있을 때, 맞춘 그림이 그 자리에 겹치면 그 높이만큼 아래를 비우고 다시 맞춘다
    const legend = compact ? null : rootRef.current?.parentElement?.querySelector<HTMLElement>('.ie-legend');
    if (legend && getComputedStyle(legend).position === 'absolute') {
      const reserveH = legend.offsetHeight + 16;
      const reserveW = legend.offsetWidth + 16;
      const left = next.x + b.x * next.zoom;
      const bottom = next.y + (b.y + b.h) * next.zoom;
      if (left < reserveW && bottom > size.h - reserveH) next = fitIn({ w: size.w, h: Math.max(size.h - reserveH, size.h / 2) });
    }
    setViewport(next);
  };
  // 테이블이 생기거나 없어질 때만 다시 맞춘다(글자 하나 고칠 때마다 화면이 움직이지 않게)
  const fitKey = `${size.w}x${size.h}|${model.tables.map((tb) => tb.name).join('\u0000')}`;
  const fittedKey = useRef('');
  useEffect(() => {
    if (size.w === 0 || fittedKey.current === fitKey) return;
    fittedKey.current = fitKey;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // 휠: 화면 이동, Ctrl/Cmd+휠과 핀치: 확대(캔버스와 같은 규칙)
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const dy = wheelDeltaPx(e.deltaY, e.deltaMode, r.height);
        setViewport(zoomViewportAt(v, { x: e.clientX - r.left, y: e.clientY - r.top }, wheelZoomFactor(dy)));
        return;
      }
      const d = wheelPan(wheelDeltaPx(e.deltaX, e.deltaMode, r.width), wheelDeltaPx(e.deltaY, e.deltaMode, r.height), e.shiftKey);
      setViewport(panViewport(v, d.x, d.y));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const drag = useRef<{ id: number; x: number; y: number; moved: number; target: EventTarget | null } | null>(null);
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== undefined) return;
    // 입력칸 안의 누르기는 글자 고르기다(화면을 끌지 않는다)
    const el = e.target as Element | null;
    if (el && typeof el.closest === 'function' && el.closest('.ie-edit')) return;
    drag.current = { id: e.pointerId, x: e.clientX || 0, y: e.clientY || 0, moved: 0, target: e.target };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = (e.clientX || 0) - d.x;
    const dy = (e.clientY || 0) - d.y;
    drag.current = { ...d, x: e.clientX || 0, y: e.clientY || 0, moved: d.moved + Math.abs(dx) + Math.abs(dy) };
    setViewport((v) => panViewport(v, dx, dy));
  };
  const endDrag = () => {
    drag.current = null;
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || d.moved > CLICK_SLOP) return;
    // 누르기: 누른 자리(끌기를 위해 포인터를 잡기 전의 대상)의 칸을 고친다
    const el = d.target as Element | null;
    if (!editor || !el || typeof el.closest !== 'function') return;
    const cell = el.closest('[data-edit]');
    const table = cell?.closest('[data-table]')?.getAttribute('data-table');
    if (!cell || table == null) return;
    const kind = cell.getAttribute('data-edit')!;
    const column = cell.closest('[data-column]')?.getAttribute('data-column') ?? null;
    if (kind === 'name' || kind === 'table') {
      const key = `${kind}|${table}|${column ?? ''}`;
      const now = performance.now();
      const prev = lastClick.current;
      lastClick.current = { key, at: now };
      if (!prev || prev.key !== key || now - prev.at > DOUBLE_CLICK_MS) return;
      lastClick.current = null;
    }
    activate({ kind, table, column });
  };

  const zoomCenter = (factor: number) => setViewport((v) => zoomViewportAt(v, { x: size.w / 2, y: size.h / 2 }, factor));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && editor && (e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z' || (e.ctrlKey && (e.code === 'KeyY' || e.key === 'y')))) {
      e.preventDefault();
      e.stopPropagation();
      editor.undo(e.shiftKey || e.code === 'KeyY' || e.key === 'y');
      return;
    }
    if (mod || e.altKey) return;
    const step = 48;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const m = moves[e.key];
    if (m) setViewport((v) => panViewport(v, m[0], m[1]));
    else if (e.key === '+' || e.key === '=') zoomCenter(1.25);
    else if (e.key === '-' || e.key === '_') zoomCenter(0.8);
    else if (e.key === '0') fit();
    else return;
    e.preventDefault();
  };

  return (
    <div className="ie-wrap" data-testid="ie-diagram">
      <div
        ref={rootRef}
        className="ie-stage"
        tabIndex={0}
        role="group"
        aria-label={t('relView.ie.label')}
        aria-describedby="ie-keys-hint"
        onKeyDown={onKeyDown}
      >
        <span id="ie-keys-hint" className="sr-only">
          {t('relView.ie.keysHint')}
        </span>
        <svg
          className="ie-svg"
          width="100%"
          height="100%"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={endDrag}
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
            <g className="ie-links">
              {links.map((l) => {
                const route = routes.get(l.id);
                if (!route) return null;
                const first = route.points[0];
                const last = route.points[route.points.length - 1];
                return (
                  <g
                    key={l.id}
                    className="ie-link"
                    data-link-id={l.id}
                    data-child={l.child.table}
                    data-parent={l.parent.table}
                    data-identifying={l.identifying ? 'true' : 'false'}
                    data-child-end={endKind(l.child)}
                    data-parent-end={endKind(l.parent)}
                  >
                    <path className={`ie-link-line${l.identifying ? '' : ' is-dashed'}`} d={polylinePath(route.points)} />
                    <g className="ie-end" data-end="child" data-kind={endKind(l.child)}>
                      {endMarks(l.child, first, route.fromDir).map((m, i) => (
                        <MarkShape key={i} mark={m} />
                      ))}
                    </g>
                    <g className="ie-end" data-end="parent" data-kind={endKind(l.parent)}>
                      {endMarks(l.parent, last, route.toDir).map((m, i) => (
                        <MarkShape key={i} mark={m} />
                      ))}
                    </g>
                  </g>
                );
              })}
            </g>
            {model.tables.map((table) =>
              boxes[table.name] ? (
                <TableBox
                  key={table.name}
                  table={table}
                  typeOptions={typeOptions}
                  box={boxes[table.name]}
                  editor={editor}
                  editing={editingAlive && editing!.table === table.name ? editing : null}
                  onEdit={onEdit}
                  onActivate={activate}
                />
              ) : null,
            )}
          </g>
        </svg>
      </div>
      {overlay && <div className="ie-overlay">{overlay}</div>}
      {editor && menu && menuColumn && (
        <CellMenu
          key={`${menu.kind}|${menu.table}|${menu.column}|${menu.fk ? 'fk' : ''}`}
          anchor={() => cellEl(`ie-${menu.kind}-${cellId(menu.table, menu.column)}`)}
          label={
            menu.kind === 'null'
              ? t('sqlView.nullLabel', { table: menu.table, column: menu.column })
              : menu.fk
                ? t('relView.ie.fkTable')
                : t('relView.ie.keyLabel', { table: menu.table, column: menu.column })
          }
          testId={menu.fk ? 'ie-fk-form' : `ie-${menu.kind}-menu`}
          choices={
            menu.kind === 'null'
              ? [
                  { value: 'unset', label: t('sqlView.settings.unset') },
                  { value: 'not-null', label: 'NOT NULL' },
                  { value: 'null', label: 'NULL' },
                ]
              : [
                  { value: 'none', label: t('common.none') },
                  { value: 'pk', label: 'PK' },
                  { value: 'fk', label: 'FK' },
                  { value: 'pkfk', label: 'PK + FK' },
                ]
          }
          current={
            menu.kind === 'null'
              ? menuColumn.notNull === true
                ? 'not-null'
                : menuColumn.notNull === false
                  ? 'null'
                  : 'unset'
              : menuColumn.primaryKey && menuColumn.foreignKey
                ? 'pkfk'
                : menuColumn.primaryKey
                  ? 'pk'
                  : menuColumn.foreignKey
                    ? 'fk'
                    : 'none'
          }
          onPick={pickMenu}
          onClose={closeMenu}
        >
          {menu.fk && (
            <ForeignKeyForm
              model={model}
              table={menu.table}
              onCancel={() => closeMenu(true)}
              onConfirm={(ref) => {
                const problem = editor.setKeys(menu.table, menu.column, { primaryKey: menu.fk!.primaryKey, foreignKey: true, ref });
                if (problem === null) closeMenu(true);
                return problem;
              }}
            />
          )}
        </CellMenu>
      )}
      <div className="ie-zoom" role="group" aria-label={t('relView.ie.zoomLabel')}>
        <button type="button" className="btn btn-icon" aria-label={t('common.zoomIn')} title={t('common.zoomIn')} onClick={() => zoomCenter(1.25)}>
          {icons.plus}
        </button>
        <button type="button" className="btn btn-icon" aria-label={t('common.zoomOut')} title={t('common.zoomOut')} onClick={() => zoomCenter(0.8)}>
          {icons.minus}
        </button>
        <button type="button" className="btn btn-icon" aria-label={t('common.fit')} title={t('common.fit')} onClick={fit}>
          {icons.fit}
        </button>
      </div>
      {compact ? (
        <div className="ie-legend-compact">
          {legendOpen && <IeLegend id="ie-legend-pop" />}
          <button
            type="button"
            className={`btn ie-legend-toggle${legendOpen ? ' is-active' : ''}`}
            data-testid="ie-legend-toggle"
            aria-expanded={legendOpen}
            aria-controls={legendOpen ? 'ie-legend-pop' : undefined}
            onClick={() => setLegendOpen((o) => !o)}
          >
            {t('relPane.legend.toggle')}
          </button>
        </div>
      ) : (
        <IeLegend />
      )}
    </div>
  );
}
