/**
 * 선택한 도형/선의 속성을 고치는 오른쪽 패널. 선택이 있을 때만 렌더링된다. [담당: inspector 에이전트]
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { deleteSelection } from '../actions';
import { PresetIcon } from '../canvas/PresetIcon';
import { transact, updateEdge, updateEdges, updateNode, updateNodes, type EdgePatch, type NodePatch } from '../collab/docOps';
import { useEdges, useNodeMap, useRoom } from '../collab/hooks';
import { useUi } from '../state/ui';
import { fitNodeSize, growToFit } from '../text/measure';
import { edgeCanBeDouble, edgeHasCardinality } from '../../shared/rules';
import {
  CARDINALITY_OPTIONS,
  MIN_NODE_SIZE,
  NODE_PRESETS,
  PRESET_ORDER,
  SIDES,
  presetOf,
  type EdgeShapeKind,
  type ErdEdge,
  type ErdNode,
  type KeyType,
  type PresetId,
  type Side,
  type SpecType,
} from '../../shared/types';
import {
  alignNodes,
  commonValue,
  distributeNodes,
  edgeNature,
  keyTypeOf,
  nodeLabel,
  normalizeText,
  parseSize,
  presetChangePatch,
  resizePatch,
  resolveEdgeShape,
  type AlignMode,
  type DistributeAxis,
} from './inspectorLogic';
import './Inspector.css';

// ───────────────────────── 공통 부품 ─────────────────────────

interface DraftFieldProps {
  /** 문서에 들어 있는 현재 값 */
  value: string;
  /** 입력을 확정했을 때(내용을 실제로 고친 경우에만 불린다) */
  onCommit: (value: string) => void;
  multiline?: boolean;
  numeric?: boolean;
  min?: number;
  placeholder?: string;
  disabled?: boolean;
  label: string;
  testId?: string;
  className?: string;
}

/**
 * 입력하는 동안에는 내 글자를, 포커스가 없을 때는 문서 값을 보여 주는 입력 칸.
 * blur, Enter(여러 줄은 Cmd/Ctrl+Enter)에서 확정하고 Esc는 취소한다.
 */
function DraftField({ value, onCommit, multiline, numeric, min, placeholder, disabled, label, testId, className }: DraftFieldProps) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const state = useRef({ draft: value, dirty: false, cancelled: false, focused: false, onCommit });
  state.current.onCommit = onCommit;

  const flush = () => {
    const s = state.current;
    if (s.focused && s.dirty && !s.cancelled) {
      s.dirty = false;
      s.onCommit(s.draft);
    }
  };
  // 포커스가 있는 채로 패널이 사라지면(캔버스의 다른 곳을 눌러 선택이 바뀐 경우) 그때 확정한다
  useEffect(() => () => flush(), []);

  const onFocus = () => {
    const s = state.current;
    s.focused = true;
    s.dirty = false;
    s.cancelled = false;
    s.draft = value;
    setDraft(value);
    setFocused(true);
  };
  const onBlur = () => {
    flush();
    state.current.focused = false;
    setFocused(false);
  };
  const onChange = (next: string) => {
    state.current.draft = next;
    state.current.dirty = true;
    setDraft(next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    // 입력 칸의 키가 전역 단축키로 새지 않게 한다
    e.stopPropagation();
    // 한글 조합 중의 Enter, Esc는 조합기에 맡긴다
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      state.current.cancelled = true;
      e.currentTarget.blur();
    } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  const shown = focused ? draft : value;
  const common = {
    className: `input inspector-input${className ? ` ${className}` : ''}`,
    value: shown,
    placeholder,
    disabled,
    'aria-label': label,
    'data-testid': testId,
    onFocus,
    onBlur,
    onKeyDown,
    onKeyUp: (e: KeyboardEvent) => e.stopPropagation(),
  };
  if (multiline) {
    const rows = Math.min(6, Math.max(2, shown.split('\n').length));
    return <textarea {...common} rows={rows} spellCheck={false} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <input
      {...common}
      type={numeric ? 'number' : 'text'}
      min={min}
      step={numeric ? 1 : undefined}
      inputMode={numeric ? 'numeric' : undefined}
      autoComplete="off"
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

interface SegOption<T extends string> {
  value: T;
  label: string;
  title?: string;
  /** 있으면 글자 대신 아이콘을 그리고, label은 title과 aria-label로 쓴다 */
  icon?: ReactNode;
  disabled?: boolean;
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  testId,
}: {
  options: SegOption<T>[];
  /** 섞여 있으면 null(아무것도 강조하지 않는다) */
  value: T | null;
  onChange: (value: T) => void;
  label: string;
  testId?: string;
}) {
  return (
    <div className="segmented inspector-segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? 'is-active' : undefined}
          aria-pressed={o.value === value}
          title={o.title ?? (o.icon ? o.label : undefined)}
          aria-label={o.icon ? o.label : undefined}
          disabled={o.disabled}
          data-testid={testId ? `${testId}-${o.value || 'none'}` : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.icon ?? o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label,
  checked,
  mixed,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  /** 여러 개 선택에서 값이 섞여 있을 때 */
  mixed?: boolean;
  onChange: (next: boolean) => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={mixed ? 'mixed' : checked}
      className={`inspector-toggle${checked ? ' is-on' : ''}${mixed ? ' is-mixed' : ''}`}
      data-testid={testId}
      onClick={() => onChange(!checked)}
    >
      <span>{label}</span>
      <span className="inspector-switch" aria-hidden="true" />
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="inspector-section">
      <h3 className="inspector-section-title">{title}</h3>
      {children}
    </section>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="inspector-hint">{children}</p>;
}

const KEY_OPTIONS: SegOption<KeyType>[] = [
  { value: 'none', label: '없음' },
  { value: 'key', label: '식별자', title: '글자에 밑줄' },
  { value: 'partial', label: '부분 키', title: '글자에 점선 밑줄' },
];

const SPEC_OPTIONS: SegOption<SpecType>[] = [
  { value: 'd', label: 'd', title: 'disjoint: 서브타입이 서로 겹치지 않습니다' },
  { value: 'o', label: 'o', title: 'overlap: 서브타입이 겹칠 수 있습니다' },
];

type LineType = 'single' | 'double';

/** 플래그를 끌 때는 false를 넣지 않고 키를 지운다 */
const flag = (on: boolean): true | undefined => (on ? true : undefined);

// ───────────────────────── 노드 하나 ─────────────────────────

function NodeSection({ node }: { node: ErdNode }) {
  const room = useRoom();
  const id = node.id;
  const current = presetOf(node);

  /** 최신 값을 다시 읽어서 고친다(입력 확정 직후 연달아 눌러도 옛 값으로 계산하지 않도록) */
  const patchNode = (make: (cur: ErdNode) => NodePatch | null) => {
    const cur = room.nodes.get(id);
    if (!cur) return;
    const patch = make(cur);
    if (patch) updateNode(room.doc, id, patch);
  };

  const changePreset = (presetId: PresetId) =>
    patchNode((cur) => {
      if (presetOf(cur) === presetId) return null;
      const preset = NODE_PRESETS[presetId];
      const size = fitNodeSize({ kind: preset.kind, ...preset.props }, preset.kind === 'spec' ? '' : cur.text);
      return presetChangePatch(cur, presetId, size);
    });

  const commitText = (raw: string) => {
    const cur = room.nodes.get(id);
    if (!cur) return;
    const text = normalizeText(raw);
    if (text === cur.text) return;
    const grow = growToFit(cur, text);
    transact(room.doc, () => updateNode(room.doc, id, { text, ...(grow ?? {}) }));
  };

  const commitSize = (key: 'w' | 'h', raw: string) => {
    const v = parseSize(raw);
    if (v === null) return;
    patchNode((cur) => resizePatch(cur, key === 'w' ? { w: v } : { h: v }));
  };

  const fitToText = () =>
    patchNode((cur) => {
      const size = fitNodeSize(cur, cur.kind === 'spec' ? '' : cur.text);
      if (size.w === cur.w && size.h === cur.h) return null;
      return {
        x: Math.round(cur.x + cur.w / 2 - size.w / 2),
        y: Math.round(cur.y + cur.h / 2 - size.h / 2),
        w: size.w,
        h: size.h,
      };
    });

  return (
    <>
      <Section title="종류">
        <div className="inspector-presets" role="group" aria-label="도형 종류">
          {PRESET_ORDER.map((pid) => (
            <button
              key={pid}
              type="button"
              className={`inspector-preset${pid === current ? ' is-active' : ''}`}
              title={NODE_PRESETS[pid].label}
              aria-label={NODE_PRESETS[pid].label}
              aria-pressed={pid === current}
              data-testid={`inspector-preset-${pid}`}
              onClick={() => changePreset(pid)}
            >
              <PresetIcon presetId={pid} size={24} />
            </button>
          ))}
        </div>
        <p className="inspector-preset-name">
          {NODE_PRESETS[current].label}
          <span className="muted"> {NODE_PRESETS[current].labelEn}</span>
        </p>
      </Section>

      {node.kind === 'spec' ? (
        <Section title="특수화 종류">
          <Segmented
            label="특수화 종류"
            testId="inspector-spec"
            options={SPEC_OPTIONS}
            value={node.specType === 'o' ? 'o' : 'd'}
            onChange={(v) => patchNode(() => ({ specType: v }))}
          />
          <Hint>d는 서브타입이 겹치지 않는 특수화, o는 겹칠 수 있는 특수화입니다.</Hint>
        </Section>
      ) : (
        <Section title="글자">
          <DraftField multiline label="글자" testId="inspector-text" className="inspector-textarea" value={node.text} onCommit={commitText} />
        </Section>
      )}

      {node.kind === 'entity' && (
        <Section title="옵션">
          <Toggle label="약한 엔티티" testId="inspector-weak" checked={Boolean(node.weak)} onChange={(on) => patchNode(() => ({ weak: flag(on) }))} />
        </Section>
      )}
      {node.kind === 'relationship' && (
        <Section title="옵션">
          <Toggle
            label="식별 관계"
            testId="inspector-identifying"
            checked={Boolean(node.identifying)}
            onChange={(on) => patchNode(() => ({ identifying: flag(on) }))}
          />
        </Section>
      )}
      {node.kind === 'attribute' && (
        <Section title="옵션">
          <div className="inspector-row">
            <span className="inspector-row-label">식별자 표시</span>
            <Segmented
              label="식별자 표시"
              testId="inspector-key"
              options={KEY_OPTIONS}
              value={keyTypeOf(node)}
              onChange={(v) => patchNode(() => ({ keyType: v === 'none' ? undefined : v }))}
            />
          </div>
          <Toggle
            label="다중값"
            testId="inspector-multivalued"
            checked={Boolean(node.multivalued)}
            onChange={(on) => patchNode(() => ({ multivalued: flag(on) }))}
          />
          <Toggle label="유도" testId="inspector-derived" checked={Boolean(node.derived)} onChange={(on) => patchNode(() => ({ derived: flag(on) }))} />
        </Section>
      )}

      {node.kind !== 'spec' && (
        <Section title="크기">
          <div className="inspector-size">
            <label className="inspector-size-field">
              <span>너비</span>
              <DraftField numeric min={MIN_NODE_SIZE.w} label="너비" testId="inspector-width" value={String(node.w)} onCommit={(v) => commitSize('w', v)} />
            </label>
            <label className="inspector-size-field">
              <span>높이</span>
              <DraftField numeric min={MIN_NODE_SIZE.h} label="높이" testId="inspector-height" value={String(node.h)} onCommit={(v) => commitSize('h', v)} />
            </label>
          </div>
          <button type="button" className="btn inspector-wide" data-testid="inspector-fit" onClick={fitToText}>
            글자에 맞추기
          </button>
        </Section>
      )}
    </>
  );
}

// ───────────────────────── 엣지(하나 또는 같은 성격 여러 개) ─────────────────────────

function cardinalityOptions(enabled: boolean, hasLabel: boolean): SegOption<string>[] {
  return CARDINALITY_OPTIONS.map((c) => ({
    value: c,
    label: c === '' ? '없음' : c,
    // 적을 수 없는 선이라도 이미 적힌 글자를 지울 수는 있게 '없음'은 살려 둔다
    disabled: !enabled && !(c === '' && hasLabel),
  }));
}

function lineOptions(enabled: boolean, hasDouble: boolean): SegOption<LineType>[] {
  return [
    { value: 'single', label: '단선', disabled: !enabled && !hasDouble },
    { value: 'double', label: '이중선', disabled: !enabled },
  ];
}

function EdgeFields({ edges, nodeMap }: { edges: ErdEdge[]; nodeMap: Map<string, ErdNode> }) {
  const room = useRoom();
  const ends = edges.map((e) => [nodeMap.get(e.source), nodeMap.get(e.target)] as const);
  const nature = commonValue(ends.map(([s, t]) => edgeNature(s, t)));
  const single = edges.length === 1;

  const hasCardinality = ends.every(([s, t]) => Boolean(s && t && edgeHasCardinality(s, t)));
  const canBeDouble = ends.every(([s, t]) => Boolean(s && t && edgeCanBeDouble(s, t)));
  const label = commonValue(edges.map((e) => e.label));
  const double = commonValue(edges.map((e) => e.double));
  const hasLabel = edges.some((e) => e.label !== '');
  const hasDouble = edges.some((e) => e.double);
  const role = single ? edges[0].role : '';

  const patchAll = (patch: EdgePatch) => {
    if (single) updateEdge(room.doc, edges[0].id, patch);
    else updateEdges(room.doc, edges.map((e) => ({ id: e.id, patch })));
  };

  return (
    <>
      <Section title="카디널리티">
        <div className="inspector-cardinality">
          <Segmented
            label="카디널리티"
            testId="inspector-cardinality"
            options={cardinalityOptions(hasCardinality, hasLabel)}
            value={label}
            onChange={(v) => patchAll({ label: v })}
          />
          <DraftField
            label="카디널리티 직접 입력"
            testId="inspector-cardinality-input"
            placeholder={label === null ? '여러 값' : '예: 0..1'}
            disabled={!hasCardinality}
            value={label ?? ''}
            onCommit={(v) => patchAll({ label: v.trim() })}
          />
        </div>
        {!hasCardinality && <Hint>엔티티와 관계 사이의 선에만 적습니다.</Hint>}
      </Section>

      <Section title="선 종류">
        <Segmented
          label="선 종류"
          testId="inspector-line"
          options={lineOptions(canBeDouble, hasDouble)}
          value={double === null ? null : double ? 'double' : 'single'}
          onChange={(v) => patchAll({ double: v === 'double' })}
        />
        {!canBeDouble ? (
          <Hint>이 선은 이중선으로 그리지 않습니다.</Hint>
        ) : nature === 'entity-relationship' ? (
          <Hint>이중선은 전체 참여를 뜻합니다.</Hint>
        ) : nature === 'entity-spec' ? (
          <Hint>이중선은 전체 특수화를 뜻합니다.</Hint>
        ) : null}
      </Section>

      {single && (nature === 'entity-relationship' || role !== '') && (
        <Section title="역할 이름">
          <DraftField label="역할 이름" testId="inspector-role" placeholder="예: 상사, 부하" value={role} onCommit={(v) => patchAll({ role: v.trim() })} />
        </Section>
      )}
    </>
  );
}

// ───────────────────────── 선이 붙는 위치와 모양 ─────────────────────────

const SIDE_LABELS: Record<Side, string> = { top: '위', right: '오른쪽', bottom: '아래', left: '왼쪽' };
/** 아이콘에서 붙는 점을 찍는 자리(16x16 안의 사각형 변 가운데) */
const SIDE_DOTS: Record<Side, [number, number]> = { top: [8, 4], right: [12, 8], bottom: [8, 12], left: [4, 8] };

/** 도형을 뜻하는 사각형과 선이 붙는 변의 점 */
function SideIcon({ side }: { side: Side }) {
  const [cx, cy] = SIDE_DOTS[side];
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x={4} y={4} width={8} height={8} stroke="currentColor" strokeWidth={1.2} opacity={0.5} />
      <circle cx={cx} cy={cy} r={2.5} fill="currentColor" />
    </svg>
  );
}

type SideChoice = Side | 'auto';
const SIDE_OPTIONS: SegOption<SideChoice>[] = [
  { value: 'auto', label: '자동', title: '가까운 쪽에 알아서 붙입니다' },
  ...SIDES.map((side) => ({ value: side, label: SIDE_LABELS[side], icon: <SideIcon side={side} /> })),
];

type ShapeChoice = EdgeShapeKind | 'auto';
const SHAPE_OPTIONS: SegOption<ShapeChoice>[] = [
  { value: 'auto', label: '자동' },
  { value: 'straight', label: '직선' },
  { value: 'elbow', label: '꺾은선' },
];
const SHAPE_LABELS: Record<EdgeShapeKind, string> = { straight: '직선', elbow: '꺾은선' };

/** 선 하나의 양 끝이 도형의 어느 쪽에 붙는지 */
function EdgeAnchorSection({ edge, nodeMap }: { edge: ErdEdge; nodeMap: Map<string, ErdNode> }) {
  const room = useRoom();
  const source = nodeMap.get(edge.source);
  const target = nodeMap.get(edge.target);
  const side = (choice: SideChoice): Side | undefined => (choice === 'auto' ? undefined : choice);
  const isDefault = !edge.sourceSide && !edge.targetSide && !edge.shape;
  return (
    <Section title="붙는 위치">
      <div className="inspector-row">
        <span className="inspector-row-label inspector-ellipsis" title={nodeLabel(source)}>
          {nodeLabel(source)}
        </span>
        <Segmented
          label={`${nodeLabel(source)}에 붙는 위치`}
          testId="inspector-source-side"
          options={SIDE_OPTIONS}
          value={edge.sourceSide ?? 'auto'}
          onChange={(v) => updateEdge(room.doc, edge.id, { sourceSide: side(v) })}
        />
      </div>
      <div className="inspector-row">
        <span className="inspector-row-label inspector-ellipsis" title={nodeLabel(target)}>
          {nodeLabel(target)}
        </span>
        <Segmented
          label={`${nodeLabel(target)}에 붙는 위치`}
          testId="inspector-target-side"
          options={SIDE_OPTIONS}
          value={edge.targetSide ?? 'auto'}
          onChange={(v) => updateEdge(room.doc, edge.id, { targetSide: side(v) })}
        />
      </div>
      {(source?.kind === 'relationship' || target?.kind === 'relationship') && <Hint>마름모는 고른 방향의 꼭짓점에 붙습니다.</Hint>}
      <button
        type="button"
        className="btn btn-ghost inspector-reset"
        title="양쪽 붙는 위치와 선 모양을 자동으로 되돌립니다"
        data-testid="inspector-anchor-reset"
        disabled={isDefault}
        onClick={() => updateEdge(room.doc, edge.id, { sourceSide: undefined, targetSide: undefined, shape: undefined })}
      >
        붙는 위치 초기화
      </button>
    </Section>
  );
}

/** 선 모양(하나 또는 여러 개 한꺼번에) */
function EdgeShapeSection({ edges, nodeMap }: { edges: ErdEdge[]; nodeMap: Map<string, ErdNode> }) {
  const room = useRoom();
  const choice = commonValue(edges.map((e): ShapeChoice => e.shape ?? 'auto'));
  const drawn = commonValue(edges.map((e) => resolveEdgeShape(e, nodeMap.get(e.source), nodeMap.get(e.target))));
  const change = (v: ShapeChoice) => {
    const shape = v === 'auto' ? undefined : v;
    updateEdges(room.doc, edges.map((e) => ({ id: e.id, patch: { shape } })));
  };
  return (
    <Section title="선 모양">
      <Segmented label="선 모양" testId="inspector-shape" options={SHAPE_OPTIONS} value={choice} onChange={change} />
      {choice === 'auto' && (
        <p className="inspector-hint" data-testid="inspector-shape-hint">
          {drawn ? `지금은 ${SHAPE_LABELS[drawn]}으로 그립니다.` : '지금은 선마다 다른 모양으로 그립니다.'}
        </p>
      )}
    </Section>
  );
}

// ───────────────────────── 여러 개 선택 ─────────────────────────

type AlignIconName = AlignMode | 'dist-h' | 'dist-v';

/** 정렬 아이콘의 모양: 기준선(x1, y1, x2, y2)과 막대(x, y, w, h) */
const ALIGN_ICONS: Record<AlignIconName, { lines: number[][]; bars: number[][] }> = {
  left: { lines: [[2.5, 2, 2.5, 14]], bars: [[5, 3.5, 8.5, 3.5], [5, 9, 5, 3.5]] },
  hcenter: { lines: [[8, 2, 8, 14]], bars: [[3, 3.5, 10, 3.5], [5, 9, 6, 3.5]] },
  right: { lines: [[13.5, 2, 13.5, 14]], bars: [[2.5, 3.5, 8.5, 3.5], [6, 9, 5, 3.5]] },
  top: { lines: [[2, 2.5, 14, 2.5]], bars: [[3.5, 5, 3.5, 8.5], [9, 5, 3.5, 5]] },
  vcenter: { lines: [[2, 8, 14, 8]], bars: [[3.5, 3, 3.5, 10], [9, 5, 3.5, 6]] },
  bottom: { lines: [[2, 13.5, 14, 13.5]], bars: [[3.5, 2.5, 3.5, 8.5], [9, 6, 3.5, 5]] },
  'dist-h': { lines: [[2.5, 2, 2.5, 14], [13.5, 2, 13.5, 14]], bars: [[6, 4, 4, 8]] },
  'dist-v': { lines: [[2, 2.5, 14, 2.5], [2, 13.5, 14, 13.5]], bars: [[4, 6, 8, 4]] },
};

function AlignIcon({ name }: { name: AlignIconName }) {
  const { lines, bars } = ALIGN_ICONS[name];
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
      {lines.map(([x1, y1, x2, y2], i) => (
        <line key={`l${i}`} x1={x1} y1={y1} x2={x2} y2={y2} />
      ))}
      {bars.map(([x, y, w, h], i) => (
        <rect key={`b${i}`} x={x} y={y} width={w} height={h} rx={0.8} fill="currentColor" stroke="none" />
      ))}
    </svg>
  );
}

const ALIGN_BUTTONS: Array<{ mode: AlignMode; title: string }> = [
  { mode: 'left', title: '왼쪽 맞춤' },
  { mode: 'hcenter', title: '가로 가운데 맞춤' },
  { mode: 'right', title: '오른쪽 맞춤' },
  { mode: 'top', title: '위쪽 맞춤' },
  { mode: 'vcenter', title: '세로 가운데 맞춤' },
  { mode: 'bottom', title: '아래쪽 맞춤' },
];

const DISTRIBUTE_BUTTONS: Array<{ axis: DistributeAxis; title: string; text: string }> = [
  { axis: 'h', title: '가로 간격 균등', text: '가로 간격' },
  { axis: 'v', title: '세로 간격 균등', text: '세로 간격' },
];

function AlignSection({ nodeIds }: { nodeIds: string[] }) {
  const room = useRoom();
  /** 누르는 순간의 위치로 계산한다 */
  const currentNodes = () => nodeIds.map((id) => room.nodes.get(id)).filter((n): n is ErdNode => Boolean(n));
  const apply = (patches: Array<{ id: string; patch: NodePatch }>) => {
    if (patches.length > 0) updateNodes(room.doc, patches);
  };
  return (
    <Section title="정렬">
      <div className="inspector-align">
        {ALIGN_BUTTONS.map((b) => (
          <button
            key={b.mode}
            type="button"
            className="btn btn-ghost btn-icon"
            title={b.title}
            aria-label={b.title}
            data-testid={`inspector-align-${b.mode}`}
            onClick={() => apply(alignNodes(currentNodes(), b.mode))}
          >
            <AlignIcon name={b.mode} />
          </button>
        ))}
      </div>
      {nodeIds.length >= 3 && (
        <div className="inspector-align">
          {DISTRIBUTE_BUTTONS.map((b) => (
            <button
              key={b.axis}
              type="button"
              className="btn btn-ghost inspector-distribute"
              title={b.title}
              aria-label={b.title}
              data-testid={`inspector-distribute-${b.axis}`}
              onClick={() => apply(distributeNodes(currentNodes(), b.axis))}
            >
              <AlignIcon name={b.axis === 'h' ? 'dist-h' : 'dist-v'} />
              <span>{b.text}</span>
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}

function AttributeBatch({ nodes }: { nodes: ErdNode[] }) {
  const room = useRoom();
  const patchAll = (patch: NodePatch) => updateNodes(room.doc, nodes.map((n) => ({ id: n.id, patch })));
  const multivalued = nodes.filter((n) => n.multivalued).length;
  const derived = nodes.filter((n) => n.derived).length;
  const total = nodes.length;
  // 하나라도 꺼져 있으면 모두 켜고, 모두 켜져 있을 때만 끈다
  return (
    <Section title="속성 옵션">
      <div className="inspector-row">
        <span className="inspector-row-label">식별자 표시</span>
        <Segmented
          label="식별자 표시"
          testId="inspector-key"
          options={KEY_OPTIONS}
          value={commonValue(nodes.map(keyTypeOf))}
          onChange={(v) => patchAll({ keyType: v === 'none' ? undefined : v })}
        />
      </div>
      <Toggle
        label="다중값"
        testId="inspector-multivalued"
        checked={multivalued === total}
        mixed={multivalued > 0 && multivalued < total}
        onChange={() => patchAll({ multivalued: flag(multivalued < total) })}
      />
      <Toggle
        label="유도"
        testId="inspector-derived"
        checked={derived === total}
        mixed={derived > 0 && derived < total}
        onChange={() => patchAll({ derived: flag(derived < total) })}
      />
    </Section>
  );
}

// ───────────────────────── 패널 ─────────────────────────

export function Inspector() {
  const room = useRoom();
  const selection = useUi((s) => s.selection);
  const nodeMap = useNodeMap();
  const edges = useEdges();
  const edgeMap = useMemo(() => new Map(edges.map((e) => [e.id, e])), [edges]);

  const selNodes: ErdNode[] = [];
  const selEdges: ErdEdge[] = [];
  for (const id of selection) {
    const n = nodeMap.get(id);
    if (n) selNodes.push(n);
    else {
      const e = edgeMap.get(id);
      if (e) selEdges.push(e);
    }
  }
  const count = selNodes.length + selEdges.length;
  if (count === 0) return null;

  // 마우스로 누른 버튼에 포커스가 남으면 이어서 누른 Enter, Space가 그 버튼을 다시 누르게 된다
  const releaseButtonFocus = (e: MouseEvent<HTMLElement>) => {
    if (e.detail === 0) return; // 키보드로 누른 경우는 포커스를 유지한다
    const button = (e.target as HTMLElement).closest('button');
    if (button && document.activeElement === button) button.blur();
  };

  let title: string;
  let body: ReactNode;
  if (count === 1 && selNodes.length === 1) {
    const node = selNodes[0];
    title = '도형';
    body = <NodeSection key={node.id} node={node} />;
  } else if (count === 1) {
    const edge = selEdges[0];
    const name = `${nodeLabel(nodeMap.get(edge.source))} — ${nodeLabel(nodeMap.get(edge.target))}`;
    title = '선';
    body = (
      <div key={edge.id} className="inspector-keyed">
        <p className="inspector-edge-name" title={name} data-testid="inspector-edge-name">
          {name}
        </p>
        <EdgeFields edges={selEdges} nodeMap={nodeMap} />
        <EdgeAnchorSection edge={edge} nodeMap={nodeMap} />
        <EdgeShapeSection edges={selEdges} nodeMap={nodeMap} />
      </div>
    );
  } else {
    const sameNature =
      selEdges.length > 0 && commonValue(selEdges.map((e) => edgeNature(nodeMap.get(e.source), nodeMap.get(e.target)))) !== null;
    const allAttributes = selNodes.length > 0 && selNodes.every((n) => n.kind === 'attribute');
    title = '여러 개 선택';
    body = (
      <div key={selection.join(',')} className="inspector-keyed">
        <p className="inspector-summary" data-testid="inspector-summary">
          도형 {selNodes.length}개, 선 {selEdges.length}개
        </p>
        {selNodes.length >= 2 && <AlignSection nodeIds={selNodes.map((n) => n.id)} />}
        {allAttributes && <AttributeBatch nodes={selNodes} />}
        {sameNature && <EdgeFields edges={selEdges} nodeMap={nodeMap} />}
        {selEdges.length > 0 && <EdgeShapeSection edges={selEdges} nodeMap={nodeMap} />}
      </div>
    );
  }

  return (
    <aside className="panel inspector" data-testid="inspector" aria-label="속성" onClick={releaseButtonFocus}>
      <h2 className="panel-title inspector-title">{title}</h2>
      <div className="inspector-body">{body}</div>
      <div className="inspector-footer">
        <button type="button" className="btn inspector-delete" data-testid="inspector-delete" onClick={() => deleteSelection(room)}>
          삭제
        </button>
      </div>
    </aside>
  );
}
