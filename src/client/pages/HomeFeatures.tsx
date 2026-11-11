/**
 * 첫 화면의 기능 구역. 실시간 공동 편집, 표기법 검증, 내보내기를 제품 화면의 한 토막과 함께 설명하고,
 * 그 아래에 가입이나 보관 기간 같은 이용 안내를 글로만 적는다.
 * 화면 토막은 장식용이라 조작을 받지 않으며 글자는 모두 방 화면이 쓰는 사전 문장을 그대로 쓴다.
 */
import { useId, type ReactNode } from 'react';
import { computeEdgeGeometry, diagramBounds } from '../../shared/geometry';
import type { ErdEdge, ErdNode } from '../../shared/types';
import { EdgeShape } from '../canvas/EdgeShape';
import { NodeShape } from '../canvas/NodeShape';
import { useLocale, useT, type MessageKey } from '../i18n';
import { capitalizeFirst } from '../i18n/format';
import { NamedCursor } from './HomePreview';
import { Reveal } from './motion';

// ───────────── 실시간 공동 편집 ─────────────

const COLLAB_NODES: ErdNode[] = [
  { id: 'stu', kind: 'entity', x: 0, y: 12, w: 120, h: 56, text: '' },
  { id: 'take', kind: 'relationship', x: 178, y: 0, w: 130, h: 80, text: '' },
];
const COLLAB_EDGE: ErdEdge = { id: 'r1', source: 'stu', target: 'take', double: false, label: 'M', role: '' };
const COLLAB_TEXT: Record<string, MessageKey> = { stu: 'home.sample.student', take: 'home.sample.enroll' };
const COLLAB_BOUNDS = diagramBounds(COLLAB_NODES, 0) ?? { x: 0, y: 0, w: 308, h: 80 };
/** 그림 둘레에 두는 여백. 선택 테두리와 포인터 이름표가 들어갈 자리다 */
const COLLAB_VIEW = { x: COLLAB_BOUNDS.x - 24, y: COLLAB_BOUNDS.y - 24, w: COLLAB_BOUNDS.w + 72, h: COLLAB_BOUNDS.h + 84 };

/** 함께 들어와 있는 사람. 첫 화면 예시와 같은 이름과 색을 쓴다 */
const MATES: Array<{ name: MessageKey; color: string }> = [
  { name: 'home.sample.mate1', color: '#E5484D' },
  { name: 'home.sample.mate2', color: '#12A594' },
  { name: 'home.sample.mate3', color: '#8E4EC6' },
];
/** 한 방에 들어올 수 있는 사람 수(서버의 제한과 같은 값) */
const ROOM_CAPACITY = 15;
/** 두 사람이 고른 도형과 포인터의 자리(그림 좌표) */
const PICKS: Array<{ node: string; cursor: { x: number; y: number } }> = [
  { node: 'take', cursor: { x: 286, y: 62 } },
  { node: 'stu', cursor: { x: 64, y: 66 } },
];

function CollabVisual() {
  const t = useT();
  const nodes = COLLAB_NODES.map((n) => ({ ...n, text: t(COLLAB_TEXT[n.id]) }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const view = COLLAB_VIEW;
  return (
    <div className="home-fx-collab">
      <span className="home-fx-mates">
        {MATES.map((m) => (
          <b key={m.name} style={{ background: m.color }}>
            {Array.from(t(m.name))[0]}
          </b>
        ))}
        <b className="home-fx-more">+{ROOM_CAPACITY - MATES.length}</b>
      </span>
      <div className="home-fx-stage">
        <svg viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}>
          <EdgeShape edge={COLLAB_EDGE} geometry={computeEdgeGeometry(COLLAB_EDGE, nodes[0], nodes[1], 0, 1, 1)} />
          {nodes.map((n) => (
            <NodeShape key={n.id} node={n} />
          ))}
          {PICKS.map((p, who) => {
            const n = byId.get(p.node);
            if (!n) return null;
            return <rect key={p.node} x={n.x - 5} y={n.y - 5} width={n.w + 10} height={n.h + 10} rx="3" fill="none" stroke={MATES[who].color} strokeWidth="1.6" />;
          })}
        </svg>
        {PICKS.map((p, who) => (
          <NamedCursor
            key={p.node}
            name={t(MATES[who].name)}
            color={MATES[who].color}
            style={{ left: `${((p.cursor.x - view.x) / view.w) * 100}%`, top: `${((p.cursor.y - view.y) / view.h) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}

// ───────────── 표기법 검증 ─────────────

function IssueIcon({ error }: { error: boolean }) {
  return error ? (
    <svg className="home-fx-issue-icon is-error" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M8 4.2v4.6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.4" r="1" fill="#fff" />
    </svg>
  ) : (
    <svg className="home-fx-issue-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.6 15 14H1L8 1.6Z" fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 6.2v3.6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="12" r="0.9" fill="#fff" />
    </svg>
  );
}

/** 검증 패널의 한 토막. 방 화면의 검증 패널이 실제로 보여 주는 문장을 예시 이름으로 만든다 */
function ValidationVisual() {
  const t = useT();
  const locale = useLocale();
  const entity = (name: MessageKey) => t('rules.node.entity.named', { name: t(name) });
  const issues: Array<{ id: string; error: boolean; text: string }> = [
    { id: 'weak', error: true, text: t('issue.weakNoIdentifying', { node: t('rules.node.weakEntity.named', { name: t('home.sample.section') }) }) },
    { id: 'key', error: false, text: t('issue.entityNoKey', { node: entity('home.sample.course') }) },
    {
      id: 'cardinality',
      error: false,
      text: t('issue.edgeNoCardinality', { a: entity('home.sample.student'), b: t('rules.node.relationship.named', { name: t('home.sample.enroll') }) }),
    },
  ];
  const errors = issues.filter((i) => i.error).length;
  return (
    <div className="home-fx-panel home-fx-issues">
      <div className="home-fx-panel-head">
        <span className="home-fx-panel-title">{t('issues.title')}</span>
        <span className="home-fx-count">
          <IssueIcon error />
          {t('count.errors', { count: errors })}
        </span>
        <span className="home-fx-count">
          <IssueIcon error={false} />
          {t('count.warnings', { count: issues.length - errors })}
        </span>
      </div>
      <ul className="home-fx-list">
        {issues.map((issue) => (
          <li key={issue.id} className="home-fx-issue">
            <IssueIcon error={issue.error} />
            <span>{capitalizeFirst(issue.text, locale)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ───────────── 내보내기 ─────────────

function MenuIcon({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** 내보내기 메뉴의 한 토막. 방 화면의 메뉴와 같은 항목과 아이콘이다 */
const EXPORTS: Array<{ label: MessageKey; hint?: MessageKey; icon: ReactNode }> = [
  {
    label: 'export.savePng',
    icon: (
      <MenuIcon>
        <rect x="2.25" y="3" width="11.5" height="10" rx="1.25" />
        <circle cx="5.6" cy="6.2" r="1" />
        <path d="m2.5 11.5 3-3 2.25 2.25L9.75 8.75l3.75 3.75" />
      </MenuIcon>
    ),
  },
  {
    label: 'export.copyPng',
    hint: 'export.copyPngHint',
    icon: (
      <MenuIcon>
        <rect x="5.5" y="5.5" width="8" height="8" rx="1.25" />
        <path d="M10.5 5.5V3.75A1.25 1.25 0 0 0 9.25 2.5h-5.5A1.25 1.25 0 0 0 2.5 3.75v5.5A1.25 1.25 0 0 0 3.75 10.5H5.5" />
      </MenuIcon>
    ),
  },
  {
    label: 'export.saveSvg',
    icon: (
      <MenuIcon>
        <path d="M3.75 10.75c0-4 3-7 7-7" />
        <rect x="2.25" y="10.75" width="3" height="3" />
        <rect x="10.75" y="2.25" width="3" height="3" />
      </MenuIcon>
    ),
  },
  {
    label: 'export.saveJson',
    icon: (
      <MenuIcon>
        <path d="M4 2.5h5l3 3v8H4Z" />
        <path d="M9 2.5v3h3" />
        <path d="M8 7.75v3.5M6.5 9.9 8 11.4l1.5-1.5" />
      </MenuIcon>
    ),
  },
];

function ExportVisual() {
  const t = useT();
  return (
    <ul className="home-fx-panel home-fx-menu">
      {EXPORTS.map((item) => (
        <li key={item.label} className="home-fx-menu-item">
          {item.icon}
          <span className="home-fx-menu-text">{t(item.label)}</span>
          {item.hint && <span className="home-fx-menu-hint">{t(item.hint)}</span>}
        </li>
      ))}
    </ul>
  );
}

// ───────────── 구역 ─────────────

const FEATURES: Array<{ id: string; title: MessageKey; body: MessageKey; visual: ReactNode }> = [
  { id: 'collab', title: 'home.feature.collab.title', body: 'home.feature.collab.body', visual: <CollabVisual /> },
  { id: 'validation', title: 'home.feature.validation.title', body: 'home.feature.validation.body', visual: <ValidationVisual /> },
  { id: 'export', title: 'home.feature.export.title', body: 'home.feature.export.body', visual: <ExportVisual /> },
];

const FACTS: Array<{ id: string; title: MessageKey; body: MessageKey }> = [
  { id: 'signup', title: 'home.fact.signup.title', body: 'home.fact.signup.body' },
  { id: 'link', title: 'home.fact.link.title', body: 'home.fact.link.body' },
  { id: 'languages', title: 'home.fact.languages.title', body: 'home.fact.languages.body' },
  { id: 'expiry', title: 'home.fact.expiry.title', body: 'home.fact.expiry.body' },
];

export function HomeFeatures() {
  const t = useT();
  const titleId = useId();
  const factsId = useId();
  return (
    <>
      <section className="home-band home-features" aria-labelledby={titleId} data-testid="home-features">
        <Reveal>
          <h2 id={titleId} className="home-h2">
            {t('home.features.title')}
          </h2>
          <p className="home-band-lead">{t('home.features.sub')}</p>
        </Reveal>
        <div className="home-feature-grid">
          {FEATURES.map((f, i) => (
            <Reveal key={f.id} className="home-feature" delay={i * 80} data-testid={`home-feature-${f.id}`}>
              <div className="home-feature-visual" aria-hidden="true">
                {f.visual}
              </div>
              <div className="home-feature-text">
                <h3 className="home-feature-title">{t(f.title)}</h3>
                <p className="home-feature-body">{t(f.body)}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="home-facts-band" aria-labelledby={factsId} data-testid="home-facts">
        <Reveal>
          <h2 id={factsId} className="home-section-title">
            {t('home.facts.label')}
          </h2>
        </Reveal>
        <div className="home-facts">
          {FACTS.map((f, i) => (
            <Reveal key={f.id} className="home-fact" delay={i * 80}>
              <h3 className="home-fact-title">{t(f.title)}</h3>
              <p className="home-fact-body">{t(f.body)}</p>
            </Reveal>
          ))}
        </div>
      </section>
    </>
  );
}
