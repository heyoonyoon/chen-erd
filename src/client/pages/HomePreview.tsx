/**
 * 첫 화면의 제품 화면 예시. 실제 도형 렌더러와 도구 아이콘으로 방 화면을 축소해 그린다.
 * 팀원 둘이 다이어그램을 함께 완성해 가는 짧은 장면을 정해진 순서대로 되풀이한다.
 * 장식용이라 조작은 받지 않는다.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { computeEdgeGeometry, diagramBounds, siblingInfo } from '../../shared/geometry';
import type { ErdEdge, ErdNode, PresetId } from '../../shared/types';
import { EdgeShape } from '../canvas/EdgeShape';
import { NodeShape } from '../canvas/NodeShape';
import { PresetIcon } from '../canvas/PresetIcon';
import { useLocale, useT, type MessageKey } from '../i18n';
import { canAnimate } from './motion';

/** 예시 다이어그램의 도형. 자리와 크기는 고정이고 글자는 SAMPLE_TEXT의 사전 키로 현재 언어에 맞춰 넣는다 */
export const NODES: ErdNode[] = [
  { id: 'stu', kind: 'entity', x: 60, y: 150, w: 120, h: 56, text: '' },
  { id: 'sid', kind: 'attribute', x: 6, y: 40, w: 100, h: 46, text: '', keyType: 'key' },
  { id: 'snm', kind: 'attribute', x: 134, y: 40, w: 100, h: 46, text: '' },
  { id: 'take', kind: 'relationship', x: 250, y: 138, w: 130, h: 80, text: '' },
  { id: 'crs', kind: 'entity', x: 450, y: 150, w: 120, h: 56, text: '' },
  { id: 'cid', kind: 'attribute', x: 392, y: 40, w: 112, h: 46, text: '', keyType: 'key' },
  { id: 'crd', kind: 'attribute', x: 530, y: 40, w: 92, h: 46, text: '' },
  { id: 'sp', kind: 'spec', x: 103, y: 258, w: 34, h: 34, text: '', specType: 'd' },
  { id: 'ug', kind: 'entity', x: 6, y: 344, w: 104, h: 50, text: '' },
  { id: 'gr', kind: 'entity', x: 130, y: 344, w: 104, h: 50, text: '' },
  { id: 'open', kind: 'relationship', x: 440, y: 240, w: 140, h: 76, text: '', identifying: true },
  { id: 'sec', kind: 'entity', x: 445, y: 350, w: 130, h: 60, text: '', weak: true },
  { id: 'sno', kind: 'attribute', x: 300, y: 357, w: 104, h: 46, text: '', keyType: 'partial' },
];

/** 도형 id별 글자의 사전 키. 도형 크기가 고정이라 모든 언어에서 도형 안에 들어가는 짧은 낱말을 쓴다 */
export const SAMPLE_TEXT: Record<string, MessageKey> = {
  stu: 'home.sample.student',
  sid: 'home.sample.studentId',
  snm: 'home.sample.name',
  take: 'home.sample.enroll',
  crs: 'home.sample.course',
  cid: 'home.sample.courseCode',
  crd: 'home.sample.credits',
  ug: 'home.sample.undergrad',
  gr: 'home.sample.grad',
  open: 'home.sample.offer',
  sec: 'home.sample.section',
  sno: 'home.sample.sectionNo',
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

const EDGES: ErdEdge[] = [
  edge('a1', 'stu', 'sid'),
  edge('a2', 'stu', 'snm'),
  edge('a3', 'crs', 'cid'),
  edge('a4', 'crs', 'crd'),
  edge('a5', 'sec', 'sno'),
  edge('r1', 'stu', 'take', { label: 'M' }),
  edge('r2', 'take', 'crs', { label: 'N' }),
  edge('r3', 'crs', 'open', { label: '1' }),
  edge('r4', 'open', 'sec', { label: 'N', double: true }),
  edge('s1', 'stu', 'sp', { double: true }),
  edge('s2', 'sp', 'ug'),
  edge('s3', 'sp', 'gr'),
];

/** 예시 화면에 함께 들어와 있는 팀원. 이름은 언어마다 그 언어권에서 흔한 이름으로 바꿔 보여 준다 */
const MATES: Array<{ name: MessageKey; color: string }> = [
  { name: 'home.sample.mate1', color: '#E5484D' },
  { name: 'home.sample.mate2', color: '#12A594' },
  { name: 'home.sample.mate3', color: '#8E4EC6' },
];

const TOOLS: PresetId[] = [
  'entity',
  'weak-entity',
  'relationship',
  'identifying-relationship',
  'attribute',
  'key-attribute',
  'multivalued-attribute',
  'spec-d',
];

/** 이름표가 달린 포인터. 이 제품의 표식이라 첫 화면에서는 여기와 내 프로필에서만 쓴다 */
export function NamedCursor({ name, color, className, style }: { name: string; color: string; className?: string; style?: React.CSSProperties }) {
  return (
    <span className={className ? `home-cursor ${className}` : 'home-cursor'} style={style} aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 20 20">
        <path d="M3 2l5.2 14.2 2.3-5.9 5.9-2.3z" fill={color} stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      <span className="home-cursor-name" style={{ background: color }}>
        {name}
      </span>
    </span>
  );
}

// ───────────────────────── 장면 ─────────────────────────

/** 그림이 차지하는 영역. 장면이 진행되어도 무대 크기가 바뀌지 않도록 완성된 그림 기준으로 고정한다 */
const BOUNDS = diagramBounds(NODES, 28) ?? { x: 0, y: 0, w: 640, h: 400 };

/** 장면이 시작할 때 이미 그려져 있는 도형과 선 */
const INITIAL_IDS = ['stu', 'sid', 'snm', 'crs', 'cid', 'crd', 'a1', 'a2', 'a3', 'a4'];

/** 서연이 마지막에 끌어 옮기는 도형과, 옮기기 전에 놓여 있던 자리(완성된 자리 기준) */
const DRAG_ID = 'gr';
const DRAG_FROM = { x: 24, y: -12 };
const DRAG_MS = 900;

interface Pt {
  x: number;
  y: number;
}

/** 팀원 번호. MATES의 순서와 같다 */
type Who = 0 | 1;

interface Scene {
  /** 지금 보이는 도형과 선의 id */
  shown: ReadonlySet<string>;
  /** 팀원별 포인터 위치(월드 좌표) */
  cursors: readonly [Pt, Pt];
  /** 팀원별로 선택한 도형 */
  picks: readonly [string | null, string | null];
  /** 끌어 옮기기 진행도. 0은 옮기기 전, 1은 다 옮긴 뒤 */
  drag: number;
  dragging: boolean;
  /** 한 바퀴가 끝나 무대를 흐리게 내보내는 중 */
  leaving: boolean;
}

interface Step {
  /** 장면 시작부터의 시각(ms) */
  at: number;
  show?: string[];
  move?: [Who, number, number];
  pick?: [Who, string];
  drag?: 'start' | 'end';
  leave?: true;
}

const FIRST: Scene = {
  shown: new Set(INITIAL_IDS),
  cursors: [
    { x: 262, y: 108 },
    { x: 246, y: 296 },
  ],
  picks: [null, null],
  drag: 0,
  dragging: false,
  leaving: false,
};

/**
 * 장면의 순서. 지민은 가운데와 오른쪽에서 관계와 약한 엔티티를, 서연은 왼쪽 아래에서 특수화를 그린다.
 * 포인터는 600ms에 걸쳐 움직이므로 도형은 포인터가 도착한 뒤에 나타나게 시각을 잡는다.
 */
const SCRIPT: Step[] = [
  { at: 700, move: [0, 314, 194] },
  { at: 1400, show: ['take'], pick: [0, 'take'] },
  { at: 1900, show: ['r1'] },
  { at: 2300, show: ['r2'] },
  { at: 2500, move: [1, 128, 282] },
  { at: 3200, show: ['sp'], pick: [1, 'sp'] },
  { at: 3500, show: ['s1'], move: [0, 536, 292] },
  { at: 3900, move: [1, 80, 378] },
  { at: 4300, show: ['open'], pick: [0, 'open'] },
  { at: 4600, show: ['ug', 's2'], pick: [1, 'ug'] },
  { at: 4800, show: ['r3'] },
  { at: 5100, move: [0, 534, 384] },
  { at: 5300, move: [1, 230, 372] },
  { at: 5900, show: ['sec'], pick: [0, 'sec'] },
  { at: 6000, show: [DRAG_ID, 's3'], pick: [1, DRAG_ID] },
  { at: 6400, show: ['r4'] },
  { at: 6900, move: [0, 382, 386] },
  { at: 7600, show: ['sno'], pick: [0, 'sno'] },
  { at: 8000, show: ['a5'] },
  { at: 8600, drag: 'start' },
  { at: 8600 + DRAG_MS, drag: 'end' },
  { at: 8600 + DRAG_MS + 2500, leave: true },
];
/** 무대가 흐려진 뒤 처음부터 다시 시작하는 시각 */
const LOOP_MS = SCRIPT[SCRIPT.length - 1].at + 500;

function applyStep(scene: Scene, step: Step): Scene {
  const next = { ...scene };
  if (step.show) next.shown = new Set([...scene.shown, ...step.show]);
  if (step.move) {
    const [who, x, y] = step.move;
    next.cursors = who === 0 ? [{ x, y }, scene.cursors[1]] : [scene.cursors[0], { x, y }];
  }
  if (step.pick) {
    const [who, id] = step.pick;
    next.picks = who === 0 ? [id, scene.picks[1]] : [scene.picks[0], id];
  }
  if (step.drag === 'start') next.dragging = true;
  // 화면이 가려져 있던 동안 프레임이 돌지 않았더라도 끝 시각에는 다 옮긴 상태로 맞춘다
  if (step.drag === 'end') next.drag = 1;
  if (step.leave) next.leaving = true;
  return next;
}

/** 움직임을 쓰지 않을 때 보여 주는 완성된 장면 */
const LAST: Scene = { ...SCRIPT.reduce(applyStep, FIRST), dragging: false, leaving: false };

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** 월드 좌표를 무대 크기에 대한 비율로 바꾼다 */
function stagePos(p: Pt): CSSProperties {
  return { left: `${((p.x - BOUNDS.x) / BOUNDS.w) * 100}%`, top: `${((p.y - BOUNDS.y) / BOUNDS.h) * 100}%` };
}

/** 장면 한 바퀴. 끝나면 onDone을 불러 바깥에서 새로 마운트하게 한다(나타나는 효과가 처음부터 다시 돈다) */
function Stage({ animated, entering, onDone }: { animated: boolean; entering: boolean; onDone: () => void }) {
  const t = useT();
  const [scene, setScene] = useState<Scene>(animated ? FIRST : LAST);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (!animated) return;
    let frame = 0;
    const startDrag = () => {
      const began = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, Math.max(0, (now - began) / DRAG_MS));
        setScene((s) => (s.drag >= 1 ? s : { ...s, drag: progress }));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    const timers = SCRIPT.map((step) =>
      window.setTimeout(() => {
        setScene((s) => applyStep(s, step));
        if (step.drag === 'start') startDrag();
      }, step.at),
    );
    timers.push(window.setTimeout(() => doneRef.current(), LOOP_MS));
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      cancelAnimationFrame(frame);
    };
  }, [animated]);

  const eased = easeInOut(scene.drag);
  const offset = { x: DRAG_FROM.x * (1 - eased), y: DRAG_FROM.y * (1 - eased) };
  const nodes = NODES.filter((n) => scene.shown.has(n.id)).map((n) => {
    const key = SAMPLE_TEXT[n.id];
    const text = key ? t(key) : n.text;
    return n.id === DRAG_ID && scene.drag < 1 ? { ...n, text, x: n.x + offset.x, y: n.y + offset.y } : { ...n, text };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = EDGES.filter((e) => scene.shown.has(e.id));
  const siblings = siblingInfo(edges);
  /** 장면 도중에 생긴 것만 나타나는 효과를 준다 */
  const fresh = (base: string, id: string) => (animated && !FIRST.shown.has(id) ? `${base} is-new` : base);
  const stageClass = ['home-pv-stage', animated ? 'is-live' : '', scene.leaving ? 'is-leaving' : entering ? 'is-entering' : ''].filter(Boolean).join(' ');
  // 끌어 옮기는 사람의 포인터는 도형과 함께 움직인다
  const held = scene.picks[1] === DRAG_ID;
  const cursors: Pt[] = [
    scene.cursors[0],
    held ? { x: scene.cursors[1].x + offset.x - DRAG_FROM.x, y: scene.cursors[1].y + offset.y - DRAG_FROM.y } : scene.cursors[1],
  ];

  return (
    <div className={stageClass}>
      <svg viewBox={`${BOUNDS.x} ${BOUNDS.y} ${BOUNDS.w} ${BOUNDS.h}`} role="img" aria-label={t('home.preview.diagramLabel')}>
        {edges.map((e) => {
          const s = byId.get(e.source);
          const t = byId.get(e.target);
          if (!s || !t) return null;
          const sib = siblings.get(e.id) ?? { index: 0, count: 1, pair: 1 };
          return (
            <g key={e.id} className={fresh('home-pv-edge', e.id)}>
              <EdgeShape edge={e} geometry={computeEdgeGeometry(e, s, t, sib.index, sib.count, sib.pair)} />
            </g>
          );
        })}
        {nodes.map((n) => (
          <g key={n.id} className={fresh('home-pv-node', n.id)}>
            <NodeShape node={n} />
          </g>
        ))}
        {/* 팀원이 선택한 도형 */}
        {scene.picks.map((id, who) => {
          const n = id ? byId.get(id) : undefined;
          if (!n) return null;
          return (
            <rect
              key={`${who}-${n.id}`}
              className={animated ? 'home-pv-pick is-new' : 'home-pv-pick'}
              x={n.x - 5}
              y={n.y - 5}
              width={n.w + 10}
              height={n.h + 10}
              rx="3"
              fill="none"
              stroke={MATES[who].color}
              strokeWidth="1.6"
              pointerEvents="none"
            />
          );
        })}
      </svg>
      {cursors.map((p, who) => (
        <NamedCursor
          key={MATES[who].name}
          name={t(MATES[who].name)}
          color={MATES[who].color}
          className={who === 1 && (scene.dragging || scene.drag > 0) ? 'is-dragging' : undefined}
          style={stagePos(p)}
        />
      ))}
    </div>
  );
}

export function HomePreview() {
  // 움직임을 쓸 수 있는지는 브라우저에서만 알 수 있으므로 처음 한 번만 정한다
  const [animated] = useState(canAnimate);
  const [round, setRound] = useState(0);
  const t = useT();
  const locale = useLocale();
  // 언어가 바뀌면 장면을 처음부터 다시 시작한다(글자가 바뀐 도형이 장면 중간에 섞이지 않게)
  const lastLocale = useRef(locale);
  const restarted = lastLocale.current !== locale;
  useEffect(() => {
    lastLocale.current = locale;
  }, [locale]);
  return (
    <figure className="home-pv" aria-label={t('home.preview.label')}>
      <div className="home-pv-top" aria-hidden="true">
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
      <div className="home-pv-body">
        <div className="home-pv-tools" aria-hidden="true">
          <span className="home-pv-tool is-active">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
              <path d="M5 3l4.6 12 1.9-5 5-1.9z" />
            </svg>
          </span>
          {TOOLS.map((id) => (
            <span key={id} className="home-pv-tool">
              <PresetIcon presetId={id} size={18} />
            </span>
          ))}
        </div>
        <div className="home-pv-canvas">
          <Stage key={`${locale}:${round}`} animated={animated} entering={round > 0 || restarted} onDone={() => setRound((n) => n + 1)} />
        </div>
      </div>
    </figure>
  );
}
