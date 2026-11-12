/**
 * 관계 모델 쪽 pane 세 가지(관계 모델, IE 다이어그램, SQL). ERD pane은 캔버스 쪽에 있다.
 * 흐름: 사람이 적은 관계 모델 글(방의 Y.Text) → IE(글과 컬럼 설정에서 유도) → SQL(같은 것에서 변환).
 * ERD에서 관계 모델을 자동으로 만들지 않고, 글에 없는 것(타입, NULL 허용 여부)은 추측하지 않는다.
 * 각 pane은 어떤 크기의 틀에 넣어도 부모를 가득 채우고, 다른 pane이 열려 있다고 가정하지 않는다.
 *
 * 이 파일은 엔진을 함께 가져온다. 방 화면은 이 파일을 따로 내려받고(lazy), 탭 제목과 아이콘은 paneMeta.tsx 에서 바로 가져온다.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import * as Y from 'yjs';
import { copyText } from '../ai';
import { useRoom, useTitle } from '../collab/hooks';
import { safeFilename } from '../export/exporters';
import { useT, type MessageKey } from '../i18n';
import { toast } from '../ui/toast';
import { downloadText, icons, ProblemIcon, stopKeys } from './common';
import {
  applyRelationalEdit,
  columnKey,
  deriveIe,
  getColumnSettingsMap,
  getRelationalText,
  layoutIe,
  parseRelational,
  planRenameColumn,
  planRenameTable,
  planSetKeys,
  readColumnSettings,
  readRelationalSource,
  readRoomDialect,
  RELATIONAL_META,
  setColumnSetting,
  setRoomDialect,
  toSql,
  type ColumnSettings,
  type RelEditError,
  type RelEditPlan,
  type IeModel,
  type ParseResult,
  type RelProblem,
  type SqlDialect,
} from './engine';
import { IeDiagram, type IeEditor } from './IeDiagram';
import { PaneFrame, isNarrow, useFrame } from './paneParts';
import { revealInEditor, setDialect, useRelPanes } from './paneStore';
import { RelationalEditor, useYSource, type EditorHandle } from './RelationalEditor';
import { CellMenu, TYPE_OPTIONS } from './pickers';
import { ColumnSettingsTable, SqlCode, type SettingsTable } from './SqlParts';
import { DIALECTS } from './storage';
import { UNDERLINE_KEYS } from './yTextBinding';

export { paneTitleKey, PaneIcon } from './paneMeta';

/** IE 다이어그램 pane에서 기호 설명을 기호 버튼으로 접는 너비 */
const IE_COMPACT = 520;
/** SQL pane에서 SQL과 컬럼 설정 표를 나란히 두는 너비 */
const SQL_SIDE = 820;

const DIALECT_LABEL: Record<SqlDialect, string> = { mysql: 'MySQL', postgresql: 'PostgreSQL', oracle: 'Oracle' };

/**
 * 방에서 고른 DBMS. 방 문서에 있어 팀원과 함께 쓴다. 아직 아무도 고르지 않은 방이면
 * 이 브라우저에서 마지막으로 고른 값(없으면 기본값)을 보여 준다.
 */
function useDialect(): SqlDialect {
  const room = useRoom();
  const local = useRelPanes((s) => s.dialect);
  const [shared, setShared] = useState<SqlDialect | null>(() => readRoomDialect(room.doc));
  useEffect(() => {
    const update = () => setShared(readRoomDialect(room.doc));
    update();
    const meta = room.doc.getMap(RELATIONAL_META);
    meta.observe(update);
    return () => meta.unobserve(update);
  }, [room]);
  return shared ?? local;
}

/**
 * DBMS 고르기. IE와 SQL이 같은 값을 쓰고, 방 문서에 저장해 팀원 화면에도 바로 바뀐다.
 * 운영체제 select 대신 앱의 메뉴를 펼친다(지금 값에 체크, 방향키와 Enter, Esc나 바깥 누르기로 닫기).
 */
function DialectSelect({ testId }: { testId: string }) {
  const t = useT();
  const room = useRoom();
  const dialect = useDialect();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const labelId = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-dialect`;
  const choose = (d: SqlDialect) => {
    setRoomDialect(room.doc, d);
    // 새 방에서 처음 보여 줄 값으로도 기억한다
    setDialect(d);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };
  const onButtonKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    stopKeys(e);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      close(true);
    }
  };
  return (
    <div className="rp-select">
      <span className="rp-select-label" id={labelId}>
        {t('sqlView.dialect')}
      </span>
      <button
        ref={buttonRef}
        type="button"
        className={`btn btn-ghost rp-btn rp-select-button${open ? ' is-active' : ''}`}
        data-testid={testId}
        data-value={dialect}
        title={t('sqlView.dialect')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${labelId}-value`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onButtonKeyDown}
        onKeyUp={stopKeys}
      >
        <span id={`${labelId}-value`}>{DIALECT_LABEL[dialect]}</span>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <CellMenu
          anchor={() => buttonRef.current}
          label={t('sqlView.dialect')}
          choices={DIALECTS.map((d) => ({ value: d, label: DIALECT_LABEL[d] }))}
          current={dialect}
          testId={`${testId}-menu`}
          onPick={(v) => {
            choose(v as SqlDialect);
            close(true);
          }}
          onClose={close}
        />
      )}
    </div>
  );
}

// ───────────────────────── 방 문서 읽기 ─────────────────────────

/** 방 문서의 컬럼 설정. 내용이 바뀔 때만 새 객체가 된다 */
export function useColumnSettings(): ColumnSettings {
  const room = useRoom();
  const [state, setState] = useState(() => {
    const settings = readColumnSettings(room.doc);
    return { settings, json: JSON.stringify(settings) };
  });
  useEffect(() => {
    const update = () => {
      const settings = readColumnSettings(room.doc);
      const json = JSON.stringify(settings);
      setState((cur) => (cur.json === json ? cur : { settings, json }));
    };
    update();
    room.doc.on('update', update);
    return () => room.doc.off('update', update);
  }, [room]);
  return state.settings;
}

export interface RelationalModel {
  text: string;
  parsed: ParseResult;
  settings: ColumnSettings;
  /** 글이 비어 있지 않은지(비었으면 빈 화면 한 줄을 보여 준다) */
  hasText: boolean;
}

/** 관계 모델 글을 읽고 컬럼 설정과 함께 돌려준다. 누가 고치든 바로 다시 읽는다 */
export function useRelationalModel(): RelationalModel {
  const room = useRoom();
  const ytext = useMemo(() => getRelationalText(room.doc), [room]);
  // 밑줄(기본키)도 함께 읽는다. 밑줄만 바꿔도 IE와 SQL이 따라온다
  const source = useYSource(ytext);
  const parsed = useMemo(() => parseRelational(source), [source]);
  const settings = useColumnSettings();
  const text = source.text;
  return { text, parsed, settings, hasText: text.trim() !== '' };
}

async function copyWithToast(text: string, done: string, failed: string): Promise<void> {
  if (await copyText(text)) toast(done);
  else toast(failed, 'error');
}

/** 머리 줄의 아이콘 버튼(좁은 머리 줄에서는 글자를 숨긴다) */
function HeadButton({ icon, label, testId, disabled, onClick }: { icon: ReactNode; label: string; testId: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn btn-ghost rp-btn" data-testid={testId} title={label} aria-label={label} disabled={disabled} onClick={onClick}>
      {icon}
      <span className="rp-btn-label">{label}</span>
    </button>
  );
}

/** 글이 없을 때의 한 줄 */
function EmptyLine({ testId }: { testId: string }) {
  const t = useT();
  return (
    <p className="rel-empty" data-testid={testId}>
      {t('relView.empty')}
    </p>
  );
}

// ───────────────────────── 관계 모델(글) ─────────────────────────

/**
 * 관계 모델을 수업 표기로 적는 편집기. 팀원과 같은 글을 함께 고친다.
 * 머리 줄에는 밑줄 버튼 하나만 있다(기본키에 밑줄을 긋는다). 그 밖의 안내는 두지 않는다.
 */
export function RelationalTextPane() {
  const t = useT();
  const room = useRoom();
  const ytext = useMemo(() => getRelationalText(room.doc), [room]);
  const source = useYSource(ytext);
  const problems = useMemo(() => parseRelational(source).problems, [source]);
  const { frameRef, width } = useFrame();
  const editor = useRef<EditorHandle>(null);
  const [underlined, setUnderlined] = useState(false);
  const label = t('relView.editor.underline');
  const tools = (
    <button
      type="button"
      className={`btn btn-ghost rp-btn rel-ul-btn${underlined ? ' is-active' : ''}`}
      data-testid="relational-underline"
      aria-label={label}
      aria-pressed={underlined}
      title={t('relView.editor.underlineHint', { keys: UNDERLINE_KEYS })}
      // 누를 때 편집기의 캐럿과 고른 구간을 그대로 둔다
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => editor.current?.toggleUnderline()}
    >
      {icons.underline}
      <span className="rp-btn-label">{label}</span>
    </button>
  );
  return (
    <PaneFrame pane="relational" frameRef={frameRef} width={width} narrow={false} tools={tools} toolsLabel={t('relPane.title.relational')} bodyClass="rp-body-flush">
      <RelationalEditor
        ytext={ytext}
        source={source}
        problems={problems}
        placeholder={t('relView.editor.placeholder')}
        label={t('relPane.title.relational')}
        handle={editor}
        onUnderlineState={setUnderlined}
      />
    </PaneFrame>
  );
}

// ───────────────────────── IE 다이어그램 ─────────────────────────

/** 문제 개수 배지. 누르면 편집기의 첫 문제로 간다 */
export function ProblemBadge({ problems }: { problems: readonly RelProblem[] }) {
  const t = useT();
  if (problems.length === 0) return null;
  const errors = problems.filter((p) => p.severity === 'error').length;
  const first = [...problems].sort((a, b) => a.line - b.line || a.column - b.column)[0];
  const warnings = problems.length - errors;
  const label = `${t('count.errors', { count: errors })}, ${t('count.warnings', { count: warnings })}`;
  return (
    <button
      type="button"
      className={`rel-problem-badge is-${errors > 0 ? 'error' : 'warning'}`}
      data-testid="ie-problem-badge"
      aria-label={label}
      title={label}
      onClick={() => revealInEditor({ line: first.line, column: first.column, endColumn: first.endColumn })}
    >
      <span className={`rel-problem-count${errors > 0 ? ' is-on' : ''}`}>
        <ProblemIcon severity="error" />
        {errors}
      </span>
      <span className={`rel-problem-count${warnings > 0 ? ' is-on' : ''}`}>
        <ProblemIcon severity="warning" />
        {warnings}
      </span>
    </button>
  );
}

/** IE 그림에서 고친 것의 origin. 그림의 되돌리기(⌘Z)는 이 origin의 변경만 되돌린다 */
export const IE_ORIGIN = 'ie-edit';

const EDIT_ERROR_KEY: Record<RelEditError, MessageKey> = {
  'text-errors': 'relView.ie.error.textErrors',
  'not-found': 'relView.ie.error.notFound',
  empty: 'relView.ie.error.empty',
  chars: 'relView.ie.error.chars',
  duplicate: 'relView.ie.error.duplicate',
  breaks: 'relView.ie.error.breaks',
  composite: 'relView.ie.error.composite',
};

/**
 * IE 그림 안 편집. 이름과 기본키는 관계 모델 글을 고치고(글이 원본, IE는 글에서 다시 유도된다),
 * 타입과 NULL은 컬럼 설정을 고친다. 모두 방 문서라 팀원에게 바로 보인다. 그림 전용 되돌리기를 둔다.
 */
function useIeEditor(): IeEditor {
  const t = useT();
  const room = useRoom();
  const undoRef = useRef<Y.UndoManager | null>(null);
  useEffect(() => {
    const undo = new Y.UndoManager([getRelationalText(room.doc), getColumnSettingsMap(room.doc)], {
      trackedOrigins: new Set([IE_ORIGIN]),
      captureTimeout: 0,
    });
    undoRef.current = undo;
    return () => {
      undo.destroy();
      if (undoRef.current === undo) undoRef.current = null;
    };
  }, [room]);
  return useMemo(() => {
    const run = (plan: RelEditPlan): string | null => {
      if (!plan.ok) return t(EDIT_ERROR_KEY[plan.error]);
      applyRelationalEdit(room.doc, plan, IE_ORIGIN);
      return null;
    };
    const source = () => readRelationalSource(room.doc);
    return {
      setColumn: (table, column, patch) => (setColumnSetting(room.doc, table, column, patch, IE_ORIGIN) ? null : t('relView.ie.typeInvalid')),
      renameColumn: (table, column, next) => run(planRenameColumn(source(), table, column, next)),
      renameTable: (table, next) => run(planRenameTable(source(), table, next)),
      setKeys: (table, column, want) => run(planSetKeys(source(), table, column, want)),
      undo: (redo) => {
        const u = undoRef.current;
        if (!u) return;
        if (redo) u.redo();
        else u.undo();
      },
    };
  }, [room, t]);
}

/** 관계 모델 글에서 유도한 IE(까마귀발) 그림. 확대 버튼과 기호 설명은 그림 위에 있다. 그림 안에서 타입, NULL, 기본키, 이름을 고친다 */
export function IePane() {
  const { parsed, settings, hasText } = useRelationalModel();
  const model = useMemo(() => deriveIe(parsed.schema, settings), [parsed.schema, settings]);
  const layout = useMemo(() => layoutIe(model), [model]);
  const editor = useIeEditor();
  const t = useT();
  const dialect = useDialect();
  const { frameRef, width } = useFrame();
  const compact = isNarrow(width, IE_COMPACT);
  return (
    <PaneFrame
      pane="ie"
      frameRef={frameRef}
      width={width}
      narrow={compact}
      tools={<DialectSelect testId="ie-dialect" />}
      toolsLabel={t('relPane.title.ie')}
      bodyClass="rp-body-fill"
      attrs={{ 'data-dialect': dialect }}
    >
      {!hasText ? (
        <EmptyLine testId="ie-empty" />
      ) : (
        <IeDiagram
          model={model}
          layout={layout}
          editor={editor}
          typeOptions={TYPE_OPTIONS[dialect]}
          compactLegend={compact}
          overlay={<ProblemBadge problems={parsed.problems} />}
        />
      )}
    </PaneFrame>
  );
}

// ───────────────────────── SQL ─────────────────────────

/** 표에 넣을 테이블과 컬럼(글에 적은 순서, 같은 이름은 처음 것만) */
function settingsTables(parsed: ParseResult, settings: ColumnSettings, ie: IeModel, missing: Set<string>): SettingsTable[] {
  const inherited = new Map<string, string>();
  for (const table of ie.tables) for (const c of table.columns) if (c.inheritedType) inherited.set(columnKey(table.name, c.name), c.inheritedType);
  const seen = new Set<string>();
  const out: SettingsTable[] = [];
  for (const table of parsed.schema.tables) {
    if (seen.has(table.name)) continue;
    seen.add(table.name);
    const cols = new Set<string>();
    const columns = [];
    for (const c of table.columns) {
      if (cols.has(c.name)) continue;
      cols.add(c.name);
      const key = columnKey(table.name, c.name);
      columns.push({
        name: c.name,
        primaryKey: c.primaryKey,
        setting: settings[key] ?? {},
        inheritedType: inherited.get(key) ?? null,
        missingType: missing.has(key),
      });
    }
    out.push({ name: table.name, columns });
  }
  return out;
}

/** 타입을 정하지 않은 컬럼 수. 누르면 표의 첫 칸으로 간다 */
export function MissingTypesLine({ count, onGo }: { count: number; onGo: () => void }) {
  const t = useT();
  if (count === 0) return null;
  return (
    <button type="button" className="sql-missing" data-testid="sql-missing-types" onClick={onGo}>
      {icons.info}
      {t('sqlView.missingTypes', { count })}
    </button>
  );
}

/** CREATE TABLE 문과 컬럼 설정 표. 넓으면 나란히, 좁으면 위아래로 쌓는다 */
export function SqlPane() {
  const t = useT();
  const room = useRoom();
  const title = useTitle();
  const { parsed, settings, hasText } = useRelationalModel();
  const dialect = useDialect();
  const result = useMemo(() => toSql(parsed.schema, settings, dialect, { title }), [parsed.schema, settings, dialect, title]);
  const missing = useMemo(() => new Set(result.missingTypes.map((m) => columnKey(m.table, m.column))), [result]);
  const ie = useMemo(() => deriveIe(parsed.schema, settings), [parsed.schema, settings]);
  const tables = useMemo(() => settingsTables(parsed, settings, ie, missing), [parsed, settings, ie, missing]);
  const { frameRef, width } = useFrame();
  const stacked = isNarrow(width, SQL_SIDE);
  const empty = !hasText;

  const goMissing = () => {
    const input = frameRef.current?.querySelector<HTMLInputElement>('.sql-type-input[data-missing]');
    if (!input) return;
    input.scrollIntoView?.({ block: 'center' });
    input.focus({ preventScroll: true });
  };

  const tools = (
    <>
      <DialectSelect testId="sql-dialect" />
      <HeadButton
        icon={icons.copy}
        label={t('sqlView.copy')}
        testId="sql-copy"
        disabled={empty}
        onClick={() => copyWithToast(result.sql, t('sqlView.copied'), t('toast.clipboardFailed'))}
      />
      <HeadButton
        icon={icons.download}
        label={t('sqlView.download')}
        testId="sql-download"
        disabled={empty}
        onClick={() => {
          const name = `${safeFilename(title)}.sql`;
          if (downloadText(result.sql, name, 'application/sql')) toast(t('sqlView.downloaded', { file: name }));
          else toast(t('sqlView.downloadFailed'), 'error');
        }}
      />
    </>
  );

  return (
    <PaneFrame
      pane="sql"
      frameRef={frameRef}
      width={width}
      narrow={stacked}
      tools={tools}
      toolsLabel={t('relPane.title.sql')}
      bodyClass={stacked || empty ? undefined : 'rp-body-fill'}
      attrs={{ 'data-dialect': dialect }}
    >
      {empty ? (
        <EmptyLine testId="sql-empty" />
      ) : (
        <>
          <MissingTypesLine count={result.missingTypes.length} onGo={goMissing} />
          <div className="sql-body" data-testid="sql-body" data-layout={stacked ? 'stack' : 'side'}>
            <section className="sql-main" aria-label={DIALECT_LABEL[dialect]}>
              <SqlCode sql={result.sql} />
            </section>
            <ColumnSettingsTable
              tables={tables}
              typeOptions={TYPE_OPTIONS[dialect]}
              onChange={(table, column, patch) => setColumnSetting(room.doc, table, column, patch)}
            />
          </div>
        </>
      )}
    </PaneFrame>
  );
}
