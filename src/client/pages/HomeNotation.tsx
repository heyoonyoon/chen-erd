/**
 * 지원하는 표기를 실제 모양으로 보여 주는 표. 강의 자료의 표기법 요약처럼 모양과 이름을 나란히 둔다.
 * 표기는 네 묶음(ERD, 관계 모델, IE 다이어그램, SQL)이고 탭으로 고른다. 고른 묶음만 그린다.
 * 화면에 들어오면 줄마다 도형의 선이 그려지고 글은 한 줄씩 나타난다(탭을 바꾸면 새 묶음이 다시 그려진다).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { ieColumnGrid, ieSectionHeight, IE_BOX } from '../../shared/relational/layout';
import { dialectType, quoteIdentifier, TYPE_PLACEHOLDER } from '../../shared/relational/sql';
import { formatName } from '../../shared/relational/text';
import type { IeColumn, IeEnd, IeTable, SqlDialect } from '../../shared/relational/userSchema';
import { approximateLineWidth } from '../../shared/measure';
import { STYLE, type ErdNode } from '../../shared/types';
import { NodeShape } from '../canvas/NodeShape';
import { useLocale, useT, type MessageKey, type TFunction } from '../i18n';
import { endMarks, type Mark } from '../relational/ieGeometry';
import { tokenizeSql } from '../relational/sqlHighlight';
import { canAnimate, useInView } from './motion';

const BOX = { w: 148, h: 72 };

/** 관계 모델 편집기의 밑줄 단축키(편집기와 같은 판단) */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
const UNDERLINE_KEYS = IS_MAC ? '⌘U' : 'Ctrl+U';

function shape(id: string, kind: ErdNode['kind'], w: number, h: number, text: string, extra: Partial<ErdNode> = {}): ReactNode {
  const node: ErdNode = { id, kind, x: (BOX.w - w) / 2, y: (BOX.h - h) / 2, w, h, text, ...extra };
  return <NodeShape node={node} />;
}

/** 선 표기 예시. 두 도형 사이의 선 한 토막과 카디널리티 글자 */
function line(double: boolean, label: string): ReactNode {
  const y = BOX.h / 2 + 4;
  const ys = double ? [y - STYLE.doubleGap / 2, y + STYLE.doubleGap / 2] : [y];
  return (
    <g>
      {ys.map((v) => (
        <line key={v} x1="22" y1={v} x2={BOX.w - 22} y2={v} stroke={STYLE.stroke} strokeWidth={STYLE.strokeWidth} />
      ))}
      <text x={BOX.w / 2} y={y - 12} textAnchor="middle" fontSize={STYLE.labelFontSize} fontFamily={STYLE.fontFamily} fill={STYLE.stroke}>
        {label}
      </text>
    </g>
  );
}

// ───────────────────────── IE ─────────────────────────

function MarkShape({ mark }: { mark: Mark }) {
  if (mark.type === 'bar') return <line className="home-ie-mark" x1={mark.x1} y1={mark.y1} x2={mark.x2} y2={mark.y2} />;
  if (mark.type === 'circle') return <circle className="home-ie-mark is-circle" cx={mark.cx} cy={mark.cy} r={mark.r} />;
  return <path className="home-ie-mark" d={mark.d} />;
}

/** IE 선 끝 기호. 방 화면의 기호 설명(IeLegend)처럼 오른쪽 끝이 테이블 쪽이다 */
function ieEnd(end: Pick<IeEnd, 'min' | 'max'>): ReactNode {
  const y = BOX.h / 2;
  const x = BOX.w - 28;
  return (
    <g>
      <line className="home-ie-mark" x1={28} y1={y} x2={x} y2={y} />
      {endMarks(end, { x, y }, { x: -1, y: 0 }).map((m, i) => (
        <MarkShape key={i} mark={m} />
      ))}
    </g>
  );
}

/** IE 관계 선. 두 테이블 상자 사이의 실선(식별 관계)이나 점선(비식별 관계) */
function ieLink(identifying: boolean): ReactNode {
  const y = BOX.h / 2;
  return (
    <g>
      <rect className="home-ie-box" x={14} y={y - 14} width={28} height={28} rx={3} />
      <rect className="home-ie-box" x={BOX.w - 42} y={y - 14} width={28} height={28} rx={3} />
      <line className={identifying ? 'home-ie-mark' : 'home-ie-link'} x1={42} y1={y} x2={BOX.w - 42} y2={y} />
    </g>
  );
}

/** IE 테이블 상자 하나. 방 화면의 상자처럼 기본키 묶음과 나머지 묶음을 나누고 [키 | 이름 | 타입 | NULL] 네 칸으로 그린다 */
function ieTableBox(table: IeTable): { figure: ReactNode; w: number; h: number } {
  const { headerHeight: head, rowHeight: row, cellPadX: pad } = IE_BOX;
  const g = ieColumnGrid(table);
  const pkCols = table.columns.filter((c) => c.primaryKey);
  const otherCols = table.columns.filter((c) => !c.primaryKey);
  const h = head + ieSectionHeight(pkCols.length) + ieSectionHeight(otherCols.length);
  const x0 = 1;
  const y0 = 1;
  const X = { key: x0, name: x0 + g.key, type: x0 + g.key + g.name, nullable: x0 + g.key + g.name + g.type };
  const dividerY = y0 + head + ieSectionHeight(pkCols.length);
  const rowEl = (c: IeColumn, y: number, last: boolean) => {
    const mid = y + row / 2;
    const tags = [c.primaryKey ? 'PK' : '', c.foreignKey ? 'FK' : ''].filter(Boolean);
    const nullText = c.notNull === true ? 'NOT NULL' : c.notNull === false ? 'NULL' : '';
    return (
      <g key={c.name}>
        {!last && <line className="home-ie-grid" x1={x0} x2={x0 + g.w} y1={y + row} y2={y + row} />}
        {tags.length > 0 && (
          <text className="home-ie-tag" x={X.key + g.key / 2} y={mid}>
            {tags.join('/')}
          </text>
        )}
        <text className={c.primaryKey ? 'home-ie-col is-pk' : 'home-ie-col'} x={X.name + pad} y={mid}>
          {c.name}
        </text>
        {c.primaryKey && <line className="home-ie-pk" x1={X.name + pad} x2={X.name + pad + approximateLineWidth(c.name, 12)} y1={mid + 8} y2={mid + 8} />}
        {c.type && (
          <text className="home-ie-type" x={X.type + pad} y={mid}>
            {c.type}
          </text>
        )}
        {nullText && (
          <text className="home-ie-null is-set" x={X.nullable + pad} y={mid}>
            {nullText}
          </text>
        )}
      </g>
    );
  };
  const bottom = y0 + h;
  const figure = (
    <g>
      <rect className="home-ie-box" x={x0} y={y0} width={g.w} height={h} rx={4} />
      <path className="home-ie-head" d={`M${x0} ${y0 + head}V${y0 + 4}a4 4 0 0 1 4 -4H${x0 + g.w - 4}a4 4 0 0 1 4 4V${y0 + head}Z`} />
      <text className="home-ie-name" x={x0 + IE_BOX.paddingX} y={y0 + head / 2}>
        {table.name}
      </text>
      {[X.name, X.type, X.nullable].map((x) => (
        <line key={x} className="home-ie-grid" x1={x} x2={x} y1={y0 + head} y2={bottom} />
      ))}
      <line className="home-ie-line" x1={x0} x2={x0 + g.w} y1={y0 + head} y2={y0 + head} />
      {pkCols.map((c, i) => rowEl(c, y0 + head + i * row, i === pkCols.length - 1))}
      <line className="home-ie-line" x1={x0} x2={x0 + g.w} y1={dividerY} y2={dividerY} />
      {otherCols.map((c, i) => rowEl(c, dividerY + i * row, i === otherCols.length - 1))}
    </g>
  );
  return { figure, w: g.w + 2, h: h + 2 };
}

// ───────────────────────── 글 표기(관계 모델, SQL) ─────────────────────────

/** 고정폭 글꼴의 글 몇 줄. 줄마다 순번(--l)을 넣어 한 줄씩 나타나게 한다 */
function code(lines: ReactNode[]): ReactNode {
  return (
    <div className="home-sheet-code">
      {lines.map((l, i) => (
        <div key={i} className="home-sheet-line" style={{ '--l': i } as CSSProperties}>
          {l}
        </div>
      ))}
    </div>
  );
}

/** 관계 모델 글의 테이블 한 줄. 기본키 컬럼은 편집기처럼 이름에 밑줄을 긋는다 */
function relLine(table: string, columns: string[], keys: string[]): ReactNode {
  return (
    <>
      {formatName(table)} (
      {columns.map((c, i) => (
        <span key={c}>
          {i > 0 && ', '}
          {keys.includes(c) ? <span className="home-sheet-ul">{formatName(c)}</span> : formatName(c)}
        </span>
      ))}
      )
    </>
  );
}

/** 관계 모델 글의 외래키 한 줄. 가리키는 컬럼 목록은 뺄 수 있다(그러면 기본키를 가리킨다) */
function fkLine(columns: string[], refTable: string, refColumns?: string[]): string {
  const list = (names: string[]) => `(${names.map(formatName).join(', ')})`;
  return `Foreign Key ${list(columns)} references ${formatName(refTable)}${refColumns ? ` ${list(refColumns)}` : ''}`;
}

/** SQL 한 줄을 방 화면처럼 색칠한다 */
function sqlLine(text: string): ReactNode {
  return tokenizeSql(text).map((tk, i) =>
    tk.kind === 'text' || tk.kind === 'punct' ? (
      tk.text
    ) : (
      <span key={i} className={`home-sql-${tk.kind}`}>
        {tk.text}
      </span>
    ),
  );
}

// ───────────────────────── 표의 내용 ─────────────────────────

interface Item {
  key: string;
  /** 보여 줄 이름(현재 언어) */
  name: string;
  /** 영어 용어. 영어 화면에서는 이름과 겹치므로 보여 주지 않는다. 이름이 곧 용어(MySQL 등)면 없다 */
  en?: string;
  /** svg 도형이면 그림의 크기, 글이면 null */
  box: { w: number; h: number } | null;
  figure: ReactNode;
}

interface Group {
  id: string;
  title: string;
  items: Item[];
}

export type NotationTab = 'erd' | 'rel' | 'ie' | 'sql';
export const NOTATION_TABS: ReadonlyArray<{ id: NotationTab; label: MessageKey }> = [
  { id: 'erd', label: 'relPane.title.erd' },
  { id: 'rel', label: 'relPane.title.relational' },
  { id: 'ie', label: 'relPane.title.ie' },
  { id: 'sql', label: 'relPane.title.sql' },
];

/** 도형 칸 하나 */
const fig = (key: string, name: string, en: string | undefined, figure: ReactNode): Item => ({ key, name, en, box: BOX, figure });
/** 글 칸 하나 */
const text = (key: string, name: string, en: string | undefined, lines: ReactNode[]): Item => ({ key, name, en, box: null, figure: code(lines) });

function erdGroups(t: TFunction): Group[] {
  return [
    {
      id: 'entity',
      title: t('legend.section.entity'),
      items: [
        fig('entity', t('preset.entity.label'), 'Entity type', shape('n-entity', 'entity', 96, 44, t('home.sample.student'))),
        fig('weak', t('preset.weak-entity.label'), 'Weak entity type', shape('n-weak', 'entity', 100, 48, t('home.sample.section'), { weak: true })),
      ],
    },
    {
      id: 'relationship',
      title: t('legend.section.relationship'),
      items: [
        fig('rel', t('preset.relationship.label'), 'Relationship type', shape('n-rel', 'relationship', 108, 56, t('home.sample.enroll'))),
        fig(
          'idrel',
          t('preset.identifying-relationship.label'),
          'Identifying relationship',
          shape('n-idrel', 'relationship', 116, 62, t('home.sample.offer'), { identifying: true }),
        ),
      ],
    },
    {
      id: 'attribute',
      title: t('legend.section.attribute'),
      items: [
        fig('attr', t('preset.attribute.label'), 'Attribute', shape('n-attr', 'attribute', 100, 44, t('home.sample.name'))),
        fig('key', t('term.key'), 'Identifier', shape('n-key', 'attribute', 100, 44, t('home.sample.studentId'), { keyType: 'key' })),
        fig('pkey', t('term.partialKey'), 'Partial key', shape('n-pkey', 'attribute', 108, 44, t('home.sample.sectionNo'), { keyType: 'partial' })),
        fig(
          'multi',
          t('preset.multivalued-attribute.label'),
          'Multivalued attribute',
          shape('n-multi', 'attribute', 112, 50, t('home.sample.phone'), { multivalued: true }),
        ),
      ],
    },
    {
      id: 'line',
      title: t('legend.section.line'),
      items: [
        fig('single', t('term.singleLine'), 'Partial participation', line(false, '1')),
        fig('double', t('term.doubleLine'), 'Total participation', line(true, 'M')),
      ],
    },
    {
      id: 'spec',
      title: t('legend.section.spec'),
      items: [
        fig('disjoint', t('home.notation.disjoint'), 'Disjoint', shape('n-spec-d', 'spec', 34, 34, '', { specType: 'd' })),
        fig('overlap', t('home.notation.overlap'), 'Overlap', shape('n-spec-o', 'spec', 34, 34, '', { specType: 'o' })),
      ],
    },
  ];
}

/** 예시에 쓰는 이름(현재 언어) */
function sampleNames(t: TFunction) {
  return {
    student: t('home.sample.student'),
    sid: t('home.sample.studentId'),
    name: t('home.sample.name'),
    dept: t('home.sample.dept'),
    dcode: t('home.sample.deptCode'),
    enroll: t('home.sample.enroll'),
    ccode: t('home.sample.courseCode'),
    grade: t('home.sample.grade'),
    phone: t('home.sample.phone'),
    credits: t('home.sample.credits'),
  };
}

function relGroups(t: TFunction): Group[] {
  const s = sampleNames(t);
  return [
    {
      id: 'rel-table',
      title: t('home.notation.tableRow'),
      items: [
        text('pk', t('home.notation.rel.primaryKey', { keys: UNDERLINE_KEYS }), 'Primary key', [relLine(s.student, [s.sid, s.name, s.dcode], [s.sid])]),
        text('composite', t('home.notation.rel.compositeKey'), 'Composite key', [relLine(s.enroll, [s.sid, s.ccode, s.grade], [s.sid, s.ccode])]),
      ],
    },
    {
      id: 'rel-fk',
      title: t('home.notation.fkRow'),
      items: [
        text('fk', t('home.notation.rel.foreignKey'), 'Foreign key', [
          relLine(s.student, [s.sid, s.name, s.dcode], [s.sid]),
          fkLine([s.dcode], s.dept, [s.dcode]),
        ]),
        text('fk-short', t('home.notation.rel.refOmitted'), 'References the primary key', [fkLine([s.dcode], s.dept)]),
      ],
    },
  ];
}

function ieGroups(t: TFunction): Group[] {
  const s = sampleNames(t);
  const ends = [
    { key: 'exactly-one', end: { min: 1, max: '1' }, name: 'relView.ie.exactlyOne', en: 'Exactly one' },
    { key: 'one-or-many', end: { min: 1, max: 'N' }, name: 'relView.ie.oneOrMany', en: 'One or many' },
    { key: 'zero-or-one', end: { min: 0, max: '1' }, name: 'relView.ie.zeroOrOne', en: 'Zero or one' },
    { key: 'zero-or-many', end: { min: 0, max: 'N' }, name: 'relView.ie.zeroOrMany', en: 'Zero or many' },
    { key: 'max-one', end: { min: null, max: '1' }, name: 'relView.ie.maxOne', en: 'One (minimum not set)' },
    { key: 'max-many', end: { min: null, max: 'N' }, name: 'relView.ie.maxMany', en: 'Many (minimum not set)' },
  ] as const;
  const col = (name: string, extra: Partial<IeColumn>): IeColumn => ({
    name,
    primaryKey: false,
    foreignKey: false,
    type: null,
    notNull: null,
    inheritedType: null,
    unique: false,
    ...extra,
  });
  const table = ieTableBox({
    name: s.student,
    columns: [
      col(s.sid, { primaryKey: true, type: 'CHAR(10)', notNull: true }),
      col(s.name, { type: 'VARCHAR(50)', notNull: true }),
      col(s.dcode, { foreignKey: true, type: 'CHAR(4)', notNull: false }),
    ],
  });
  return [
    // 최소 개수를 아는 네 가지와 최소 개수를 모르는 두 가지를 줄을 나눠 둔다
    {
      id: 'ie-end',
      title: t('home.notation.ie.endRow'),
      items: ends.slice(0, 4).map((e) => fig(e.key, t(e.name), e.en, ieEnd(e.end))),
    },
    {
      id: 'ie-end-open',
      title: t('home.notation.ie.endOpenRow'),
      items: ends.slice(4).map((e) => fig(e.key, t(e.name), e.en, ieEnd(e.end))),
    },
    {
      id: 'ie-link',
      title: t('home.notation.ie.linkRow'),
      items: [
        fig('identifying', t('relView.ie.identifying'), 'Identifying relationship', ieLink(true)),
        fig('non-identifying', t('relView.ie.nonIdentifying'), 'Non-identifying relationship', ieLink(false)),
      ],
    },
    {
      id: 'ie-table',
      title: t('home.notation.tableRow'),
      items: [{ key: 'table', name: t('home.notation.ie.table'), en: 'Table (key, name, type, null)', box: { w: table.w, h: table.h }, figure: table.figure }],
    },
  ];
}

const DIALECTS: ReadonlyArray<{ id: SqlDialect; label: string }> = [
  { id: 'mysql', label: 'MySQL' },
  { id: 'postgresql', label: 'PostgreSQL' },
  { id: 'oracle', label: 'Oracle' },
];

function sqlGroups(t: TFunction): Group[] {
  const s = sampleNames(t);
  // 만드는 문의 예시는 기본 DBMS(PostgreSQL)의 꼴로 적는다. 식별자는 언제나 따옴표로 묶는다(sql.ts)
  const q = (name: string) => quoteIdentifier(name, 'postgresql');
  return [
    {
      id: 'sql-dbms',
      title: t('sqlView.dialect'),
      items: DIALECTS.map((d) => {
        const dq = (name: string) => quoteIdentifier(name, d.id);
        return text(d.id, d.label, undefined, [
          sqlLine(`CREATE TABLE ${dq(s.student)} (`),
          sqlLine(`  ${dq(s.name)} ${dialectType('VARCHAR(50)', d.id)},`),
          sqlLine(`  ${dq(s.credits)} ${dialectType('INT', d.id)}`),
        ]);
      }),
    },
    {
      id: 'sql-parts',
      title: t('home.notation.sql.partsRow'),
      items: [
        text('create', t('home.notation.sql.table'), 'Create table', [sqlLine(`CREATE TABLE ${q(s.student)} (`), sqlLine('  …'), sqlLine(');')]),
        text('pk', t('home.notation.sql.primaryKey'), 'Primary key', [sqlLine(`PRIMARY KEY (${q(s.sid)})`)]),
        text('fk', t('home.notation.sql.foreignKey'), 'Foreign key', [
          sqlLine(`CONSTRAINT ${q(`${s.student}_fk1`)}`),
          sqlLine(`  FOREIGN KEY (${q(s.dcode)})`),
          sqlLine(`  REFERENCES ${q(s.dept)} (${q(s.dcode)})`),
        ]),
        text('not-null', t('home.notation.sql.notNull'), 'Not null', [sqlLine(`${q(s.sid)} CHAR(10) NOT NULL`)]),
        text('unique', t('home.notation.sql.unique'), 'Unique', [sqlLine(`UNIQUE (${q(s.phone)})`)]),
        text('unset', t('home.notation.sql.typeUnset'), 'Type not set', [
          // 자리 표시는 앱이 어느 언어에서나 그대로 내보내는 글자다(번역하지 않는다)
          <>
            {sqlLine(`${q(s.dcode)} `)}
            <span data-verbatim="">{sqlLine(TYPE_PLACEHOLDER)}</span>
          </>,
        ]),
      ],
    },
  ];
}

const BUILD: Record<NotationTab, (t: TFunction) => Group[]> = { erd: erdGroups, rel: relGroups, ie: ieGroups, sql: sqlGroups };

// ───────────────────────── 그리기 ─────────────────────────

/** 선을 그리는 시간과 도형 사이, 겹선 사이의 시차(ms). Home.css의 값과 같아야 한다 */
const DRAW_MS = 700;
const ITEM_GAP_MS = 110;
const OUTLINE_GAP_MS = 140;
/** 한 도형 안에서 선을 차례로 그리는 단계 수의 상한(선이 많은 IE 상자도 길게 끌지 않는다) */
const MAX_STEPS = 3;
/** 그리기가 끝난 뒤 정리하기까지 두는 여유(ms) */
const SETTLE_MS = 300;

/**
 * 표의 한 줄. 처음에는 완성된 그림이고, 움직임을 쓸 수 있으면 그리기 전에 선과 글을 감춰 두었다가(armed)
 * 화면에 들어올 때 그린 뒤 감추는 데 쓴 값을 걷어 낸다(done).
 */
function SheetRow({ group, active }: { group: Group; active: boolean }) {
  const locale = useLocale();
  const [ref, seen] = useInView<HTMLDivElement>();
  // 감춰 둔 탭의 줄은 화면 안에 있어도 그리지 않고, 그 탭을 처음 볼 때 한 번만 그린다.
  // 한 번 그리기 시작하면 다른 탭으로 갔다 와도 다시 그리지 않는다(그리는 중에 떠나도 이어서 끝낸다)
  const [started, setStarted] = useState(false);
  if (seen && active && !started) setStarted(true);
  const inView = started;
  const [phase, setPhase] = useState<'still' | 'armed' | 'done'>('still');

  // 선마다 길이를 재서 CSS가 그 길이만큼 선을 감췄다가 풀 수 있게 한다. 첫 칠 전에 끝내야 완성된 그림이 번쩍이지 않는다
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row || !canAnimate()) return;
    for (const svg of row.querySelectorAll<SVGSVGElement>('.home-sheet-item > svg')) {
      const strokes = svg.querySelectorAll<SVGGeometryElement>('rect, polygon, ellipse, circle, line, path');
      strokes.forEach((el, k) => {
        if (typeof el.getTotalLength !== 'function') return;
        el.style.setProperty('--len', String(Math.ceil(el.getTotalLength()) + 1));
        el.style.setProperty('--k', String(Math.min(k, MAX_STEPS)));
        // 점선은 선 길이로 감추면 점선 무늬가 사라지므로 따로 표시해 두고 왼쪽부터 드러낸다
        const dash = getComputedStyle(el).strokeDasharray;
        if (el.hasAttribute('stroke-dasharray') || (dash && dash !== 'none')) el.classList.add('is-dashed');
      });
    }
    setPhase('armed');
  }, [ref]);

  // 다 그린 뒤에는 감추는 데 쓴 값을 걷어 낸다. 선 길이로 감춘 채로 두면 닫힌 도형의 시작 모서리가 덜 채워진다
  useEffect(() => {
    if (phase !== 'armed' || !inView) return;
    const total = (group.items.length - 1) * ITEM_GAP_MS + MAX_STEPS * OUTLINE_GAP_MS + DRAW_MS + SETTLE_MS;
    const timer = window.setTimeout(() => setPhase('done'), total);
    return () => window.clearTimeout(timer);
  }, [phase, inView, group.items.length]);

  const names = ['home-sheet-row', phase === 'armed' ? 'is-armed' : '', phase === 'armed' && inView ? 'is-in' : ''].filter(Boolean).join(' ');
  return (
    <div ref={ref} className={names}>
      <h3 className="home-sheet-group">{group.title}</h3>
      <ul className="home-sheet-items">
        {group.items.map((it, i) => (
          <li key={it.key} className={it.box && it.box.w <= BOX.w ? 'home-sheet-item' : 'home-sheet-item is-wide'} style={{ '--i': i } as CSSProperties}>
            {it.box ? (
              <svg viewBox={`0 0 ${it.box.w} ${it.box.h}`} width={it.box.w} height={it.box.h} aria-hidden="true">
                {it.figure}
              </svg>
            ) : (
              it.figure
            )}
            <span className="home-sheet-name">{it.name}</span>
            {locale !== 'en' && it.en && <span className="home-sheet-en">{it.en}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HomeNotation() {
  const t = useT();
  const [tab, setTab] = useState<NotationTab>('erd');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // 줄과 칸의 key는 언어와 상관없는 값이라 언어를 바꿔도 줄이 새로 만들어지지 않고 글자만 바뀐다(그리기 효과가 다시 돌지 않는다)
  const panels = useMemo(() => NOTATION_TABS.map((x) => ({ id: x.id, groups: BUILD[x.id](t) })), [t]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = NOTATION_TABS.findIndex((x) => x.id === tab);
    const next =
      e.key === 'ArrowRight' ? (at + 1) % NOTATION_TABS.length
      : e.key === 'ArrowLeft' ? (at - 1 + NOTATION_TABS.length) % NOTATION_TABS.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? NOTATION_TABS.length - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(NOTATION_TABS[next].id);
    tabRefs.current[next]?.focus();
  };
  return (
    <div className="home-sheet">
      <div className="home-sheet-tabs" role="tablist" aria-label={t('home.notation.tabsLabel')} onKeyDown={onKeyDown}>
        {NOTATION_TABS.map((x, i) => (
          <button
            key={x.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`home-notation-tab-${x.id}`}
            className="home-sheet-tab"
            data-testid={`notation-tab-${x.id}`}
            aria-selected={tab === x.id}
            aria-controls={`home-notation-panel-${x.id}`}
            tabIndex={tab === x.id ? 0 : -1}
            // 마우스로 누를 때는 탭에 포커스를 옮기지 않는다(포커스 테두리는 키보드로 옮길 때만 보인다)
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setTab(x.id)}
          >
            {t(x.label)}
          </button>
        ))}
      </div>
      {/* 네 묶음을 한 칸에 겹쳐 두고 고른 묶음만 보인다. 칸 높이는 가장 높은 묶음에 맞춰지므로 탭을 바꿔도 아래 내용이 움직이지 않는다 */}
      <div className="home-sheet-panels">
        {panels.map((p) => (
          <div
            key={p.id}
            className={p.id === tab ? 'home-sheet-panel is-active' : 'home-sheet-panel'}
            id={`home-notation-panel-${p.id}`}
            role="tabpanel"
            aria-labelledby={`home-notation-tab-${p.id}`}
            aria-hidden={p.id === tab ? undefined : true}
            inert={p.id !== tab}
            data-tab={p.id}
          >
            {p.groups.map((g) => (
              <SheetRow key={g.id} group={g} active={p.id === tab} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
