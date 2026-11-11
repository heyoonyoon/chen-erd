/**
 * 첫 화면의 AI 구역. AI에게 한 요청이 글로 쓴 모델을 거쳐 다이어그램이 되는 예시 그림과,
 * AI를 연결하는 세 가지 방법(터미널을 쓰는 AI, 로컬 MCP 서버, 원격 MCP 서버)을 복사할 수 있는 카드로 보여 준다.
 */
import { useId, useState, type CSSProperties } from 'react';
import { computeEdgeGeometry, diagramBounds, siblingInfo } from '../../shared/geometry';
import type { ErdEdge, ErdNode } from '../../shared/types';
import { LOCAL_MCP_COMMAND, copyText, remoteMcpUrl } from '../ai';
import { EdgeShape } from '../canvas/EdgeShape';
import { NodeShape } from '../canvas/NodeShape';
import { useT, type MessageKey, type TFunction } from '../i18n';
import { toast } from '../ui/toast';
import { Reveal, canAnimate, useInView } from './motion';

/**
 * 예시 다이어그램의 도형. 아래 MODEL_TEXT가 적는 순서와 같은 순서로 두어, 글이 적힌 순서대로 도형이 나타나게 한다.
 * 도형 크기가 고정이라 글자는 모든 언어에서 폭 안에 들어가는 짧은 낱말을 쓴다(Home.test.tsx가 확인한다).
 */
export const AI_NODES: ErdNode[] = [
  { id: 'stu', kind: 'entity', x: 46, y: 140, w: 120, h: 56, text: '' },
  { id: 'sid', kind: 'attribute', x: 0, y: 24, w: 100, h: 46, text: '', keyType: 'key' },
  { id: 'snm', kind: 'attribute', x: 112, y: 24, w: 100, h: 46, text: '' },
  { id: 'tel', kind: 'attribute', x: 50, y: 252, w: 112, h: 50, text: '', multivalued: true },
  { id: 'crs', kind: 'entity', x: 436, y: 140, w: 120, h: 56, text: '' },
  { id: 'cid', kind: 'attribute', x: 378, y: 24, w: 112, h: 46, text: '', keyType: 'key' },
  { id: 'crd', kind: 'attribute', x: 502, y: 24, w: 92, h: 46, text: '' },
  { id: 'take', kind: 'relationship', x: 236, y: 128, w: 130, h: 80, text: '' },
  { id: 'grd', kind: 'attribute', x: 253, y: 24, w: 96, h: 46, text: '' },
];

/** 도형 id별 글자의 사전 키 */
export const AI_TEXT: Record<string, MessageKey> = {
  stu: 'home.sample.student',
  sid: 'home.sample.studentId',
  snm: 'home.sample.name',
  tel: 'home.sample.phone',
  crs: 'home.sample.course',
  cid: 'home.sample.courseCode',
  crd: 'home.sample.credits',
  take: 'home.sample.enroll',
  grd: 'home.sample.grade',
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

const AI_EDGES: ErdEdge[] = [
  edge('a1', 'stu', 'sid'),
  edge('a2', 'stu', 'snm'),
  edge('a3', 'stu', 'tel'),
  edge('a4', 'crs', 'cid'),
  edge('a5', 'crs', 'crd'),
  edge('r1', 'stu', 'take', { label: 'M', double: true }),
  edge('r2', 'take', 'crs', { label: 'N' }),
  edge('a6', 'take', 'grd'),
];

const BOUNDS = diagramBounds(AI_NODES, 16) ?? { x: 0, y: 0, w: 600, h: 320 };

/** 예시 명령에 적는 방 코드. 실제 방이 아니라 모양만 보여 준다 */
const SAMPLE_ROOM = 'k7m2p9xq4d';

/** 모델 글에서 이름을 적는 법. 띄어쓰기나 기호가 있으면 큰따옴표로 감싼다(src/cli/syntax.ts의 규칙) */
export function modelName(text: string): string {
  return /[\s{}(),"#]/.test(text) ? `"${text.replace(/(["\\])/g, '\\$1')}"` : text;
}

/** 글 한 토막. 두 번째 값이 true면 형식이 정한 낱말(entity, key 등)이다 */
type Segment = [text: string, keyword?: boolean];

/** 예시 다이어그램을 글로 쓴 모델. 이름은 현재 언어의 낱말로 넣는다 */
export function modelLines(t: TFunction): Segment[][] {
  const n = (id: string) => modelName(t(AI_TEXT[id]));
  return [
    [['entity', true], [` ${n('stu')} {`]],
    [[`  ${n('sid')} `], ['key', true]],
    [[`  ${n('snm')}`]],
    [[`  ${n('tel')} `], ['multi', true]],
    [['}']],
    [['entity', true], [` ${n('crs')} { ${n('cid')} `], ['key', true], [`, ${n('crd')} }`]],
    [['relationship', true], [` ${n('take')} (${n('stu')} M `], ['total', true], [`, ${n('crs')} N) { ${n('grd')} }`]],
  ];
}

const order = (i: number) => ({ '--i': i }) as CSSProperties;

/** 요청, 글로 쓴 모델, 다이어그램을 왼쪽에서 오른쪽으로 놓은 그림. 화면에 들어오면 글이 적힌 순서대로 도형이 나타난다 */
function AiFigure() {
  const t = useT();
  // 움직임을 쓸 수 있는지는 브라우저에서만 알 수 있으므로 처음 한 번만 정한다
  const [armed] = useState(canAnimate);
  const [ref, inView] = useInView<HTMLElement>();
  const lines = modelLines(t);
  const nodes = AI_NODES.map((n) => ({ ...n, text: t(AI_TEXT[n.id]) }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const indexOf = new Map(nodes.map((n, i) => [n.id, i]));
  const siblings = siblingInfo(AI_EDGES);
  const names = ['home-ai-fig', armed ? 'is-armed' : '', armed && inView ? 'is-in' : ''].filter(Boolean).join(' ');

  return (
    <figure ref={ref} className={names} aria-label={t('home.ai.figureLabel')} data-testid="ai-figure">
      <div className="home-ai-term">
        <div className="home-ai-term-bar" aria-hidden="true">
          <i />
          <i />
          <i />
          <span>{t('home.ai.assistant')}</span>
        </div>
        <div className="home-ai-term-body">
          <p className="home-ai-line home-ai-ask" style={order(0)}>
            <span aria-hidden="true">&gt;</span>
            <span>{t('home.ai.request')}</span>
          </p>
          <pre className="home-ai-model" data-testid="ai-model-text">
            {lines.map((segments, i) => (
              <span key={i} className="home-ai-line" style={order(i + 1)}>
                {segments.map(([text, keyword], k) => (keyword ? <b key={k}>{text}</b> : text))}
                {'\n'}
              </span>
            ))}
          </pre>
          <p className="home-ai-line home-ai-run" style={order(lines.length + 1)}>
            <span aria-hidden="true">$</span>
            <span>npx -y modelll push {SAMPLE_ROOM} model.mdl</span>
          </p>
        </div>
      </div>

      <div className="home-ai-arrow" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12h15M13.5 6.5 19 12l-5.5 5.5" />
        </svg>
      </div>

      <div className="home-ai-view">
        <div className="home-ai-view-bar" aria-hidden="true">
          <span className="home-ai-view-title">{t('home.preview.title')}</span>
          <span className="home-pv-saved">{t('status.connected.label')}</span>
        </div>
        <div className="home-ai-canvas">
          <svg viewBox={`${BOUNDS.x} ${BOUNDS.y} ${BOUNDS.w} ${BOUNDS.h}`} role="img" aria-label={t('home.ai.diagramLabel')}>
            {AI_EDGES.map((e) => {
              const source = byId.get(e.source);
              const target = byId.get(e.target);
              if (!source || !target) return null;
              const sib = siblings.get(e.id) ?? { index: 0, count: 1, pair: 1 };
              // 선은 양 끝 도형이 모두 놓인 뒤에 나타난다
              const at = Math.max(indexOf.get(e.source) ?? 0, indexOf.get(e.target) ?? 0);
              return (
                <g key={e.id} className="home-ai-edge" style={order(at)}>
                  <EdgeShape edge={e} geometry={computeEdgeGeometry(e, source, target, sib.index, sib.count, sib.pair)} />
                </g>
              );
            })}
            {nodes.map((n, i) => (
              <g key={n.id} className="home-ai-node" style={order(i)}>
                <NodeShape node={n} />
              </g>
            ))}
          </svg>
        </div>
      </div>
    </figure>
  );
}

/** 복사할 글 한 토막과 복사 버튼. 복사 결과는 화면 아래의 알림으로 알린다 */
function Snippet(props: { text: string; copyLabel: string; doneKey: MessageKey; testId: string }) {
  const t = useT();
  const copy = async () => {
    if (await copyText(props.text)) toast(t(props.doneKey));
    else toast(t('toast.clipboardFailed'), 'error');
  };
  return (
    <div className="home-snippet">
      <code className="home-snippet-text" data-testid={`${props.testId}-text`}>
        {props.text}
      </code>
      <button
        type="button"
        className="home-snippet-copy"
        data-testid={`${props.testId}-copy`}
        aria-label={props.copyLabel}
        title={props.copyLabel}
        onClick={copy}
      >
        {t('common.copy')}
      </button>
    </div>
  );
}

export function HomeAi() {
  const t = useT();
  const titleId = useId();
  const waysId = useId();
  return (
    <section className="home-band home-ai" aria-labelledby={titleId} data-testid="home-ai">
      <Reveal>
        <h2 id={titleId} className="home-h2">
          {t('home.ai.title')}
        </h2>
        <p className="home-band-lead">{t('home.ai.body')}</p>
      </Reveal>

      <AiFigure />

      <Reveal>
        <h3 id={waysId} className="home-section-title home-ways-title">
          {t('home.ai.ways')}
        </h3>
      </Reveal>
      <div className="home-ways" role="group" aria-labelledby={waysId}>
        <Reveal className="home-way" data-testid="home-way-cli">
          <h4 className="home-way-title">{t('ai.cli.title')}</h4>
          <p className="home-way-body">{t('ai.cli.descHome')}</p>
          <Snippet text={t('ai.cli.promptHome')} copyLabel={t('ai.cli.copy')} doneKey="toast.clipboardCopied" testId="home-cli" />
        </Reveal>
        <Reveal className="home-way" delay={80} data-testid="home-way-local">
          <h4 className="home-way-title">{t('ai.local.title')}</h4>
          <p className="home-way-body">{t('ai.local.desc')}</p>
          <Snippet text={LOCAL_MCP_COMMAND} copyLabel={t('ai.local.copy')} doneKey="toast.commandCopied" testId="home-local" />
        </Reveal>
        <Reveal className="home-way" delay={160} data-testid="home-way-remote">
          <h4 className="home-way-title">{t('ai.remote.title')}</h4>
          <p className="home-way-body">{t('ai.remote.desc')}</p>
          <Snippet text={remoteMcpUrl()} copyLabel={t('ai.remote.copy')} doneKey="toast.urlCopied" testId="home-remote" />
        </Reveal>
      </div>
    </section>
  );
}
