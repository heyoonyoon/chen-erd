/**
 * 첫 화면의 제품 화면 예시. 방 화면의 기본 분할 배치(왼쪽 ERD, 오른쪽 위 관계 모델, 오른쪽 아래 IE와 SQL 탭)를
 * 축소해 그리고, 두 팀원이 한 방에서 세 단계를 이어 가는 장면을 되풀이한다.
 * 장면은 heroScript.ts의 각본(사람별 이동과 누르기, 끌기, 치기)에서 나온다. 화면 상태는 오직 그 행동의 결과로만 바뀌고,
 * 포인터는 시간에 대한 연속 함수라서 칸을 옮겨 다녀도 끊기지 않는다. 화면 밖에 있거나 탭을 숨기면 시계가 멈춘다.
 * 장식용이라 조작은 받지 않는다.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { computeEdgeGeometry, diagramBounds } from '../../shared/geometry';
import type { ErdEdge, ErdNode, PresetId } from '../../shared/types';
import { EdgeShape } from '../canvas/EdgeShape';
import { NodeShape } from '../canvas/NodeShape';
import { PresetIcon } from '../canvas/PresetIcon';
import { APP_NAME, useT, type MessageKey, type TFunction } from '../i18n';
import { TYPE_OPTIONS } from '../relational/pickers';
import { tokenizeSql } from '../relational/sqlHighlight';
import { approximateLineWidth } from '../text/measure';
import { LogoMark } from '../ui/LogoMark';
import { TYPE_PLACEHOLDER } from '../../shared/relational/sql';
import {
  IE,
  MENU,
  NULL_ITEMS,
  TYPE_ITEMS,
  buildScript,
  cellKey,
  cursorAt,
  ieGeometry,
  stateAt,
  type Anchor,
  type CellRef,
  type HeroState,
  type Pt,
  type Script,
} from './heroScript';
import { canAnimate, useMosaic } from './motion';

// ───────────────────────── 예시: 학생은 한 학과에 소속된다 ─────────────────────────

/** 예시 다이어그램의 도형. 세로로 놓아 ERD 칸의 비율에 맞춘다. 글자는 SAMPLE_TEXT의 사전 키로 넣는다 */
export const NODES: ErdNode[] = [
  { id: 'stu', kind: 'entity', x: 104, y: 44, w: 112, h: 48, text: '' },
  { id: 'sid', kind: 'attribute', x: 0, y: 0, w: 96, h: 40, text: '', keyType: 'key' },
  { id: 'snm', kind: 'attribute', x: 232, y: 0, w: 88, h: 40, text: '' },
  { id: 'bel', kind: 'relationship', x: 104, y: 150, w: 112, h: 72, text: '' },
  { id: 'dep', kind: 'entity', x: 104, y: 280, w: 112, h: 48, text: '' },
  { id: 'dcd', kind: 'attribute', x: 0, y: 344, w: 104, h: 40, text: '', keyType: 'key' },
  { id: 'dnm', kind: 'attribute', x: 214, y: 344, w: 106, h: 40, text: '' },
];

/** 도형 id별 글자의 사전 키. 도형 크기가 고정이라 모든 언어에서 도형 안에 들어가는 짧은 낱말을 쓴다(Home.test.tsx가 확인한다) */
export const SAMPLE_TEXT: Record<string, MessageKey> = {
  stu: 'home.sample.student',
  sid: 'home.sample.studentId',
  snm: 'home.sample.name',
  bel: 'home.sample.belong',
  dep: 'home.sample.dept',
  dcd: 'home.sample.deptCode',
  dnm: 'home.sample.deptName',
};

const edge = (id: string, source: string, target: string, extra: Partial<ErdEdge> = {}): ErdEdge => ({
  id,
  source,
  target,
  double: false,
  label: '',
  role: '',
  ...extra,
});

/** 학생은 반드시 한 학과에 소속되고(전체 참여, 이중선) 학과에는 학생이 여럿이다 */
const EDGES: ErdEdge[] = [
  edge('a1', 'stu', 'sid'),
  edge('a2', 'stu', 'snm'),
  edge('a3', 'dep', 'dcd'),
  edge('a4', 'dep', 'dnm'),
  edge('r1', 'stu', 'bel', { label: 'N', double: true }),
  edge('r2', 'bel', 'dep', { label: '1' }),
];

/** 예시 화면에 함께 들어와 있는 팀원. 이름은 언어마다 그 언어권에서 흔한 이름으로 바꿔 보여 준다 */
const MATES: Array<{ name: MessageKey; color: string }> = [
  { name: 'home.sample.mate1', color: '#E5484D' },
  { name: 'home.sample.mate2', color: '#12A594' },
  { name: 'home.sample.mate3', color: '#8E4EC6' },
];

const TOOLS: PresetId[] = ['entity', 'weak-entity', 'relationship', 'identifying-relationship', 'attribute', 'key-attribute'];

function names(t: TFunction) {
  return {
    student: t('home.sample.student'),
    sid: t('home.sample.studentId'),
    name: t('home.sample.name'),
    dept: t('home.sample.dept'),
    dcode: t('home.sample.deptCode'),
    dname: t('home.sample.deptName'),
  };
}

/** 관계 모델 글 세 줄과 밑줄을 그을 기본키([줄 번호, 이름]) */
export function relationalLines(t: TFunction): { lines: string[]; keys: Array<[number, string]> } {
  const s = names(t);
  return {
    lines: [`${s.dept} (${s.dcode}, ${s.dname})`, `${s.student} (${s.sid}, ${s.name}, ${s.dcode})`, `Foreign Key (${s.dcode}) references ${s.dept} (${s.dcode})`],
    keys: [
      [0, s.dcode],
      [1, s.sid],
    ],
  };
}

/** IE에서 고른 타입과 NULL로 만든 MySQL 문. 고르지 않은 타입은 방 화면처럼 자리 표시만 남긴다 */
export function sqlExample(t: TFunction): string {
  const s = names(t);
  const q = (name: string) => '`' + name + '`';
  return [
    `CREATE TABLE ${q(s.student)} (`,
    `  ${q(s.sid)} CHAR(10) NOT NULL,`,
    `  ${q(s.name)} VARCHAR(255) NOT NULL,`,
    `  ${q(s.dcode)} ${TYPE_PLACEHOLDER},`,
    `  PRIMARY KEY (${q(s.sid)}),`,
    `  FOREIGN KEY (${q(s.dcode)})`,
    `    REFERENCES ${q(s.dept)} (${q(s.dcode)})`,
    ');',
  ].join('\n');
}

/** 메뉴 항목: 타입이면 MySQL 타입 목록 앞부분, NULL이면 미지정, NOT NULL, NULL */
function menuItems(t: TFunction, cell: CellRef): string[] {
  return cell[2] === 'type' ? TYPE_OPTIONS.mysql.slice(0, TYPE_ITEMS) : [t('sqlView.settings.unset'), 'NOT NULL', 'NULL'].slice(0, NULL_ITEMS);
}

function ieTables(t: TFunction) {
  const s = names(t);
  return [
    { name: s.dept, cols: [{ name: s.dcode, key: 0 }, { name: s.dname }] as IeCol[] },
    { name: s.student, cols: [{ name: s.sid, key: 1 }, { name: s.name }, { name: s.dcode, fk: true }] as IeCol[] },
  ];
}

interface IeCol {
  name: string;
  /** 기본키 번호. 밑줄이 그어지면 PK가 된다 */
  key?: number;
  fk?: boolean;
}

// ───────────────────────── ERD ─────────────────────────

const ERD_BOUNDS = diagramBounds(NODES, 20) ?? { x: 0, y: 0, w: 340, h: 400 };

function ErdCanvas({ state, animated }: { state: HeroState; animated: boolean }) {
  const t = useT();
  const nodes = NODES.filter((n) => state.shown.has(n.id)).map((n) => ({ ...n, text: t(SAMPLE_TEXT[n.id]) }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // 카디널리티 글자는 따로 적힌다
  const edges = EDGES.filter((e) => state.shown.has(e.id)).map((e) => (e.label && !state.shown.has(`${e.id}L`) ? { ...e, label: '' } : e));
  const b = ERD_BOUNDS;
  return (
    <svg className="home-pv-erd" viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t('home.preview.diagramLabel')}>
      {edges.map((e) => {
        const s = byId.get(e.source);
        const g = byId.get(e.target);
        if (!s || !g) return null;
        return (
          <g key={e.id} className={animated ? 'home-pv-edge is-new' : 'home-pv-edge'}>
            <EdgeShape edge={e} geometry={computeEdgeGeometry(e, s, g, 0, 1, 1)} />
          </g>
        );
      })}
      {nodes.map((n) => (
        <g key={n.id} className={animated ? 'home-pv-node is-new' : 'home-pv-node'}>
          <NodeShape node={n} />
        </g>
      ))}
      {state.picks.map((id, who) => {
        const n = id ? byId.get(id) : undefined;
        if (!n) return null;
        return (
          <rect
            key={`${who}-${n.id}`}
            className="home-pv-pick"
            x={n.x - 5}
            y={n.y - 5}
            width={n.w + 10}
            height={n.h + 10}
            rx="3"
            fill="none"
            stroke={MATES[who].color}
            strokeWidth="1.6"
          />
        );
      })}
    </svg>
  );
}

// ───────────────────────── 관계 모델 편집기 ─────────────────────────

function RelEditor({ state, lines, keys }: { state: HeroState; lines: string[]; keys: Array<[number, string]> }) {
  const t = useT();
  return (
    <div className="home-pv-rel" data-testid="home-pv-relational">
      <div className="home-pv-bar">
        <span className={state.btn ? `home-pv-btn is-${state.btn}` : 'home-pv-btn'}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M4 2.5v5a4 4 0 0 0 8 0v-5M3 14h10" />
          </svg>
          {t('relView.editor.underline')}
        </span>
      </div>
      <div className="home-pv-code">
        {lines.map((line, i) => {
          const chars = Array.from(line);
          const typed = state.typed[i];
          const k = keys.findIndex(([l]) => l === i);
          let body;
          if (k < 0) {
            body = chars.slice(0, typed).join('');
          } else {
            const word = keys[k][1];
            const start = Array.from(line.slice(0, line.indexOf(word))).length;
            const end = start + Array.from(word).length;
            const shown = chars.slice(start, Math.min(typed, end));
            // 끄는 만큼 앞에서부터 칠한다
            const sel = state.sel && state.sel.key === k ? Math.round(shown.length * state.sel.frac) : 0;
            body = (
              <>
                {chars.slice(0, Math.min(typed, start)).join('')}
                {typed > start && (
                  <span className={k < state.marked ? 'home-pv-word is-ul' : 'home-pv-word'} data-mark={k}>
                    {sel > 0 && <span className="is-sel">{shown.slice(0, sel).join('')}</span>}
                    {shown.slice(sel).join('')}
                  </span>
                )}
                {typed > end && chars.slice(end, typed).join('')}
              </>
            );
          }
          return (
            <div key={i} className="home-pv-line" data-line={i}>
              <span className="home-pv-ln">{i + 1}</span>
              <span className="home-pv-text">
                {body}
                {state.caretLine === i && <span className="home-pv-caret" style={{ '--c': MATES[1].color } as CSSProperties} data-name={t(MATES[1].name)} />}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────── IE ─────────────────────────

function IeDiagram({ state }: { state: HeroState }) {
  const t = useT();
  const tables = ieTables(t);
  const g = ieGeometry(tables.map((tb) => ({ cols: tb.cols.map((c) => c.name) })));
  const { w, ys, heights, total, X } = g;
  const cx = Math.round(w / 2);
  // 표와 선은 글을 적은 결과로 생긴다: 한 줄을 다 적으면 그 표가, Foreign Key 줄을 다 적으면 선이 나온다
  const tablesShown = state.lineDone[1] ? 2 : state.lineDone[0] ? 1 : 0;
  const link = state.lineDone[2];
  const menu = state.menu;
  const items = menu ? menuItems(t, menu) : [];
  const box = menu ? g.menu(menu, items, menu[2] === 'null') : null;
  return (
    <svg className="home-pv-ie" viewBox={`-16 -12 ${w + 32} ${total + 24}`} preserveAspectRatio="xMidYMid meet" data-testid="home-pv-ie">
      {link && (
        <g className="home-pv-fade">
          <path className="home-ie-link" d={`M${cx} ${heights[0]}V${ys[1]}`} />
          <path className="home-ie-mark" d={`M${cx - 7} ${heights[0] + 9}H${cx + 7}`} />
          <path className="home-ie-mark" d={`M${cx} ${ys[1] - 14}L${cx - 7} ${ys[1]}M${cx} ${ys[1] - 14}V${ys[1]}M${cx} ${ys[1] - 14}L${cx + 7} ${ys[1]}`} />
        </g>
      )}
      {tables.slice(0, tablesShown).map((tb, ti) => {
        const y0 = ys[ti];
        const h = heights[ti];
        return (
          <g key={ti} className="home-pv-fade" data-table={tb.name}>
            <rect className="home-ie-box" x={0} y={y0} width={w} height={h} rx={4} />
            <path className="home-ie-head" d={`M0 ${y0 + IE.head}V${y0 + 4}a4 4 0 0 1 4 -4H${w - 4}a4 4 0 0 1 4 4V${y0 + IE.head}Z`} />
            <text className="home-ie-name" x={IE.pad + 2} y={y0 + IE.head / 2}>
              {tb.name}
            </text>
            {[X.name, X.type, X.null].map((x) => (
              <line key={x} className="home-ie-grid" x1={x} x2={x} y1={y0 + IE.head} y2={y0 + h} />
            ))}
            <line className="home-ie-line" x1={0} x2={w} y1={y0 + IE.head} y2={y0 + IE.head} />
            {tb.cols.map((c, ci) => {
              const top = y0 + IE.head + ci * IE.row;
              const mid = top + IE.row / 2;
              // PK는 관계 모델 글의 밑줄에서, FK는 Foreign Key 줄에서 나온다. 기본키는 언제나 NOT NULL이다
              const pk = c.key !== undefined && c.key < state.marked;
              const fk = !!c.fk && link;
              const type = state.fills[cellKey([ti, ci, 'type'])];
              const nul = pk ? 'NOT NULL' : state.fills[cellKey([ti, ci, 'null'])];
              const open = menu && menu[0] === ti && menu[1] === ci ? g.cell(menu) : null;
              return (
                <g key={ci} data-column={c.name} data-type={type || undefined}>
                  {ci > 0 && <line className="home-ie-line" x1={0} x2={w} y1={top} y2={top} />}
                  {(pk || fk) && (
                    <text className="home-ie-tag" x={IE.tag / 2} y={mid}>
                      {pk ? 'PK' : 'FK'}
                    </text>
                  )}
                  <text className={pk ? 'home-ie-col is-pk' : 'home-ie-col'} x={X.name + IE.pad} y={mid}>
                    {c.name}
                  </text>
                  {pk && <line className="home-ie-pk" x1={X.name + IE.pad} x2={X.name + IE.pad + approximateLineWidth(c.name, IE.font)} y1={mid + 8} y2={mid + 8} />}
                  {open && <rect className="home-ie-edit" x={open.x + 2} y={open.y + 3} width={open.w - 4} height={open.h - 6} rx={3} />}
                  {type && (
                    <text key={type} className="home-ie-type" x={X.type + IE.pad} y={mid}>
                      {type}
                    </text>
                  )}
                  {nul && (
                    <text className={pk ? 'home-ie-null' : 'home-ie-null is-set'} x={X.null + IE.pad} y={mid}>
                      {nul}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
      {menu && box && (
        <g className="home-pv-menu" data-testid="home-pv-menu">
          <rect className="home-pv-menu-box" x={box.x} y={box.y} width={box.w} height={box.h} rx={6} />
          {items.map((it, i) => {
            const y = box.y + MENU.pad + i * MENU.item;
            const check = menu[2] === 'null' ? 18 : 0;
            return (
              <g key={it}>
                {i === state.hover && <rect className="home-pv-menu-hover" x={box.x + MENU.pad} y={y} width={box.w - MENU.pad * 2} height={MENU.item} rx={4} />}
                {check > 0 && i === 0 && <path className="home-pv-menu-check" d={`M${box.x + 10} ${y + 11}l3 3 6-7`} />}
                <text className={check ? 'home-pv-menu-text' : 'home-pv-menu-text is-mono'} x={box.x + MENU.pad + 6 + check} y={y + MENU.item / 2}>
                  {it}
                </text>
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}

function SqlView({ state }: { state: HeroState }) {
  const t = useT();
  const lines = sqlExample(t).split('\n');
  const tokens = tokenizeSql(lines.slice(0, Math.max(0, state.sqlLines)).join('\n'));
  return (
    <pre className="home-pv-sql" data-testid="home-pv-sql">
      {tokens.map((tk, i) =>
        tk.kind === 'text' || tk.kind === 'punct' ? (
          tk.text
        ) : (
          <span key={i} className={`home-sql-${tk.kind}`}>
            {tk.text}
          </span>
        ),
      )}
    </pre>
  );
}

// ───────────────────────── 화면 틀 ─────────────────────────

type TabIcon = 'erd' | 'rel' | 'ie' | 'sql';
const TAB_ICONS: Record<TabIcon, string> = {
  erd: 'M1.5 6h4v4h-4zM10.5 6h4v4h-4zM5.5 8h5',
  rel: 'M2.5 3h11v10h-11zM2.5 6h11M6 6v7',
  ie: 'M2 2.5h5v4H2zM9 9.5h5v4H9zM4.5 6.5V11.5H9',
  sql: 'M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5',
};

function Tab({ label, icon, active, close, hover }: { label: string; icon: TabIcon; active?: boolean; close?: boolean; hover?: boolean }) {
  return (
    <span className={['home-pv-tab', active ? 'is-active' : '', hover ? 'is-hover' : ''].filter(Boolean).join(' ')} data-tab={icon}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
        <path d={TAB_ICONS[icon]} />
      </svg>
      {label}
      {close && <i aria-hidden="true">×</i>}
    </span>
  );
}

/**
 * 자리 이름(Anchor)을 분할 화면 기준 좌표로 바꾼다. ERD와 IE는 그림 좌표를 SVG 변환으로, 관계 모델과 탭은 요소 위치를 잰다.
 * 아직 그려지지 않은 요소면 null이다(그리는 쪽이 직전 자리를 쓴다).
 */
function makeResolver(root: HTMLElement, t: TFunction): (a: Anchor) => Pt | null {
  const box = root.getBoundingClientRect();
  const viaSvg = (selector: string, x: number, y: number): Pt | null => {
    const svg = root.querySelector<SVGSVGElement>(selector);
    const m = svg?.getScreenCTM?.();
    if (!svg || !m) return null;
    const p = new DOMPoint(x, y).matrixTransform(m);
    return { x: p.x - box.left, y: p.y - box.top };
  };
  const at = (el: Element | null, fx: number, fy: number): Pt | null => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left - box.left + r.width * fx, y: r.top - box.top + r.height * fy };
  };
  const tables = ieTables(t);
  const g = ieGeometry(tables.map((tb) => ({ cols: tb.cols.map((c) => c.name) })));
  return (a) => {
    switch (a.k) {
      case 'erd':
        return viaSvg('.home-pv-erd', a.x, a.y);
      case 'line': {
        const el = root.querySelector(`[data-line="${a.line}"] .home-pv-text`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left - box.left + 3, y: r.top - box.top + 11 };
      }
      case 'word':
        return at(root.querySelector(`[data-mark="${a.key}"]`), a.end ? 1 : 0, 0.75);
      case 'underline':
        return at(root.querySelector('.home-pv-btn'), 0.55, 0.6);
      case 'relRest':
        return at(root.querySelector('.home-pv-rel'), 0.8, 0.9);
      case 'cell': {
        const c = g.cell(a.cell);
        return viaSvg('.home-pv-ie', c.x + c.w * 0.45, c.y + c.h * 0.6);
      }
      case 'item': {
        const m = g.menu(a.cell, menuItems(t, a.cell), a.cell[2] === 'null');
        return viaSvg('.home-pv-ie', m.x + 28, m.y + MENU.pad + a.index * MENU.item + MENU.item * 0.6);
      }
      case 'tab':
        return at(root.querySelector('.home-pv-tab[data-tab="sql"]'), 0.45, 0.62);
    }
  };
}

/**
 * 두 사람의 포인터. 각본(cursorAt)이 시간마다 정한 자리에 그린다. 자리 이름을 좌표로 바꿀 수 없는 순간(요소가 아직 없을 때)은
 * 그 자리의 마지막 좌표를 쓴다. 프레임마다 다시 그리지 않고 요소의 transform만 바꾼다.
 */
function Cursors({ host, script, ms, state }: { host: RefObject<HTMLDivElement | null>; script: Script; ms: number; state: HeroState }) {
  const t = useT();
  const refs = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  const clickRef = useRef<HTMLDivElement>(null);
  const memo = useRef(new Map<string, Pt>());
  useLayoutEffect(() => {
    const root = host.current;
    if (!root) return;
    const raw = makeResolver(root, t);
    // 자리를 아직 한 번도 잴 수 없었던 순간이 있으면 그 프레임에는 포인터를 감춘다(왼쪽 위 구석에 그리지 않는다)
    let missing = false;
    const resolve = (a: Anchor): Pt => {
      const key = JSON.stringify(a);
      const p = raw(a);
      if (p) memo.current.set(key, p);
      const q = p ?? memo.current.get(key);
      if (!q) missing = true;
      return q ?? { x: 0, y: 0 };
    };
    ([0, 1] as const).forEach((who) => {
      const el = refs[who].current;
      if (!el) return;
      missing = false;
      const p = cursorAt(script, who, ms, resolve);
      el.style.visibility = missing ? 'hidden' : 'visible';
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    });
    // 누른 자리에 퍼지는 고리
    const layer = clickRef.current;
    if (layer) {
      layer.replaceChildren(
        ...state.clicks.map((c) => {
          const p = resolve(c.anchor);
          const ring = document.createElement('i');
          ring.className = 'home-pv-ring';
          ring.style.cssText = `left:${p.x}px;top:${p.y}px;border-color:${MATES[c.who].color};opacity:${(1 - c.age).toFixed(2)};transform:scale(${(0.4 + c.age * 0.9).toFixed(2)})`;
          return ring;
        }),
      );
    }
  });
  return (
    <div className="home-pv-cursors" aria-hidden="true">
      <div ref={clickRef} />
      {([0, 1] as const).map((who) => (
        <span key={who} ref={refs[who]} className="home-pv-hcursor">
          <svg width="16" height="16" viewBox="0 0 20 20">
            <path d="M1 1l5.2 14.2 2.3-5.9 5.9-2.3z" fill={MATES[who].color} stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          <span style={{ background: MATES[who].color }}>{t(MATES[who].name)}</span>
        </span>
      ))}
    </div>
  );
}

function Stage({ ms, animated, script, lines, keys }: { ms: number; animated: boolean; script: Script; lines: string[]; keys: Array<[number, string]> }) {
  const t = useT();
  const state = stateAt(script, lines, ms);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className={state.leaving ? 'home-pv-split is-leaving' : 'home-pv-split'} data-tab={state.tab} data-testid="home-pv-split">
      <section className="home-pv-pane is-erd">
        <div className="home-pv-tabs">
          <Tab label={t('relPane.title.erd')} icon="erd" active close />
        </div>
        <div className="home-pv-canvas">
          <div className="home-pv-tools" aria-hidden="true">
            <span className="home-pv-tool is-active">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
                <path d="M5 3l4.6 12 1.9-5 5-1.9z" />
              </svg>
            </span>
            {TOOLS.map((id) => (
              <span key={id} className="home-pv-tool">
                <PresetIcon presetId={id} size={14} />
              </span>
            ))}
          </div>
          <ErdCanvas state={state} animated={animated} />
        </div>
      </section>
      <section className="home-pv-pane is-rel">
        <div className="home-pv-tabs">
          <Tab label={t('relPane.title.relational')} icon="rel" active close />
        </div>
        <RelEditor state={state} lines={lines} keys={keys} />
      </section>
      <section className="home-pv-pane is-ie">
        <div className="home-pv-tabs">
          <Tab label={t('relPane.title.ie')} icon="ie" active={state.tab === 'ie'} close={state.tab === 'ie'} />
          <Tab label={t('relPane.title.sql')} icon="sql" active={state.tab === 'sql'} close={state.tab === 'sql'} hover={state.tabHover} />
        </div>
        <div className="home-pv-head">
          <span>{t('sqlView.dialect')}</span>
          <span className="home-pv-select">MySQL</span>
        </div>
        <div className="home-pv-body">{state.tab === 'ie' ? <IeDiagram state={state} /> : <SqlView state={state} />}</div>
      </section>
      <Cursors host={ref} script={script} ms={ms} state={state} />
    </div>
  );
}

/**
 * 장면 시계. 화면에 보이고 탭이 보일 때만 흐르고, 한 번에 크게 건너뛴 시간(탭을 숨겼다 돌아옴 등)은 버린다.
 * 한 바퀴가 끝나면 0으로 돌아간다(그때는 화면 전체가 흐려져 있다).
 */
function useSceneClock(enabled: boolean, host: RefObject<HTMLElement | null>, loopMs: number): number {
  const [ms, setMs] = useState(0);
  const loopRef = useRef(loopMs);
  loopRef.current = loopMs;
  useEffect(() => {
    const el = host.current;
    if (!enabled || !el) return;
    let visible = false;
    let frame = 0;
    let last = 0;
    let elapsed = 0;
    const tick = (now: number) => {
      const dt = last ? now - last : 0;
      last = now;
      elapsed += dt > 250 ? 16 : dt;
      if (elapsed >= loopRef.current) elapsed = 0;
      const q = Math.floor(elapsed / 33) * 33;
      setMs((prev) => (prev === q ? prev : q));
      frame = requestAnimationFrame(tick);
    };
    const run = () => {
      cancelAnimationFrame(frame);
      last = 0;
      if (visible && document.visibilityState === 'visible') frame = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      run();
    });
    io.observe(el);
    document.addEventListener('visibilitychange', run);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', run);
      cancelAnimationFrame(frame);
    };
  }, [enabled, host]);
  return ms;
}

export function HomePreview() {
  // 움직임을 쓸 수 있는지는 브라우저에서만 알 수 있으므로 처음 한 번만 정한다
  const [animated] = useState(canAnimate);
  const t = useT();
  // 처음 열릴 때 카드가 올라오는 동안 모자이크가 풀린다
  const mosaic = useMosaic<HTMLElement>({ delay: 60, duration: 1400 });
  const { lines, keys } = relationalLines(t);
  const script = useMemo(() => buildScript(lines), [lines.join('\n')]); // eslint-disable-line react-hooks/exhaustive-deps
  // 작업 장면은 모자이크가 다 풀린 뒤에 시작한다. 그 전에는 첫 장면(빈 ERD)에 멈춰 있다
  const ms = useSceneClock(animated && mosaic.done, mosaic.ref, script.loop);
  // 움직임을 쓰지 않으면 SQL 탭을 누르기 직전(IE를 다 채운 때)에 멈춘 장면을 보여 준다
  const at = animated ? ms : script.still;
  return (
    <figure ref={mosaic.ref} className="home-pv" aria-label={t('home.preview.label')}>
      <div className="home-pv-top" aria-hidden="true">
        <span className="home-pv-brand">
          <LogoMark size={16} />
          {APP_NAME}
        </span>
        <span className="home-pv-title">{t('home.preview.title')}</span>
        <span className="home-pv-saved">{t('status.connected.label')}</span>
        <span className="home-pv-mates">
          {MATES.map((m) => (
            <b key={m.name} style={{ background: m.color }}>
              {Array.from(t(m.name))[0]}
            </b>
          ))}
        </span>
        <span className="home-pv-share">{t('topbar.share')}</span>
      </div>
      <Stage ms={at} animated={animated} script={script} lines={lines} keys={keys} />
      {mosaic.overlay}
    </figure>
  );
}
