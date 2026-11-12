/**
 * 수업 표기법 안내 패널. [담당: toolbar 에이전트]
 */
import type { ReactNode } from 'react';
import { NODE_PRESETS, type PresetId } from '../../shared/types';
import { PresetIcon } from '../canvas/PresetIcon';
import { useLocale, useT, type MessageKey } from '../i18n';
import { ui } from '../state/ui';
import './Legend.css';

/** 이름과 설명은 사전 키로 두고 그릴 때 현재 언어로 바꾼다 */
interface LegendRow {
  key: string;
  icon: ReactNode;
  name: MessageKey;
  /** 영어 이름(수업 용어). 영어 화면에서는 이름과 겹치므로 보여 주지 않는다 */
  nameEn: string;
  description: MessageKey;
}

interface LegendSection {
  id: string;
  title: MessageKey;
  rows: LegendRow[];
}

/** 표기법 안내에 나오는 프리셋(메모는 표기법이 아니라서 뺀다) */
type LegendPresetId = Exclude<PresetId, 'note'>;

/** 프리셋 도형 한 줄. 이름은 프리셋의 것을 쓰되 필요하면 바꿔 적는다. */
function presetRow(id: LegendPresetId, name?: MessageKey): LegendRow {
  return {
    key: id,
    icon: <PresetIcon presetId={id} size={30} />,
    name: name ?? `preset.${id}.label`,
    nameEn: NODE_PRESETS[id].labelEn,
    description: `legend.${id}.desc`,
  };
}

const GLYPH_PROPS = {
  width: 32,
  height: 32,
  viewBox: '0 0 32 32',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

/** 복합 속성: 속성 타원에 하위 속성 타원 둘이 이어진 모양 */
function CompositeGlyph() {
  return (
    <svg {...GLYPH_PROPS}>
      <ellipse cx="9.5" cy="16" rx="7.5" ry="4.5" />
      <ellipse cx="25" cy="7.5" rx="5.5" ry="3.5" />
      <ellipse cx="25" cy="24.5" rx="5.5" ry="3.5" />
      <path d="M15 12.9l5.3-3.5M15 19.1l5.3 3.5" />
    </svg>
  );
}

/** 엔티티와 관계를 잇는 선. double이면 평행한 두 줄 */
function ParticipationGlyph({ double }: { double?: boolean }) {
  return (
    <svg {...GLYPH_PROPS}>
      <rect x="1.5" y="11" width="9" height="10" />
      <path d="M20 16l5.5-5 5.5 5-5.5 5z" />
      {double ? <path d="M10.5 13.8h11.9M10.5 18.2h11.9" /> : <path d="M10.5 16H20" />}
    </svg>
  );
}

/** 선 옆에 적는 1, N */
function CardinalityGlyph() {
  return (
    <svg {...GLYPH_PROPS}>
      <path d="M3 21h26" />
      <g fill="currentColor" stroke="none" fontSize="10" fontWeight="600" textAnchor="middle">
        <text x="7.5" y="16">1</text>
        <text x="24.5" y="16">N</text>
      </g>
    </svg>
  );
}

/** 슈퍼타입 사각형과 특수화 원 사이의 선. double이면 전체 특수화 */
function SpecLineGlyph({ double }: { double?: boolean }) {
  return (
    <svg {...GLYPH_PROPS}>
      <rect x="8" y="2" width="16" height="8" />
      <circle cx="16" cy="24.5" r="5.5" />
      {double ? <path d="M13.2 10v9.8M18.8 10v9.8" /> : <path d="M16 10v9" />}
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M3 3l8 8M11 3l-8 8" />
    </svg>
  );
}

export const LEGEND_SECTIONS: LegendSection[] = [
  {
    id: 'entity',
    title: 'legend.section.entity',
    rows: [presetRow('entity', 'legend.entity.name'), presetRow('weak-entity')],
  },
  {
    id: 'relationship',
    title: 'legend.section.relationship',
    rows: [presetRow('relationship', 'legend.relationship.name'), presetRow('identifying-relationship')],
  },
  {
    id: 'attribute',
    title: 'legend.section.attribute',
    rows: [
      presetRow('attribute'),
      presetRow('key-attribute'),
      presetRow('partial-key-attribute'),
      presetRow('multivalued-attribute'),
      {
        key: 'composite',
        icon: <CompositeGlyph />,
        name: 'legend.composite.name',
        nameEn: 'Composite attribute',
        description: 'legend.composite.desc',
      },
    ],
  },
  {
    id: 'line',
    title: 'legend.section.line',
    rows: [
      {
        key: 'single',
        icon: <ParticipationGlyph />,
        name: 'term.singleLine',
        nameEn: 'Partial participation',
        description: 'legend.single.desc',
      },
      {
        key: 'double',
        icon: <ParticipationGlyph double />,
        name: 'term.doubleLine',
        nameEn: 'Total participation',
        description: 'legend.double.desc',
      },
      {
        key: 'cardinality',
        icon: <CardinalityGlyph />,
        name: 'term.cardinality',
        nameEn: 'Cardinality',
        description: 'legend.cardinality.desc',
      },
    ],
  },
  {
    id: 'spec',
    title: 'legend.section.spec',
    rows: [
      presetRow('spec-d'),
      presetRow('spec-o'),
      {
        key: 'spec-total',
        icon: <SpecLineGlyph double />,
        name: 'legend.specTotal.name',
        nameEn: 'Total specialization',
        description: 'legend.specTotal.desc',
      },
      {
        key: 'spec-partial',
        icon: <SpecLineGlyph />,
        name: 'legend.specPartial.name',
        nameEn: 'Partial specialization',
        description: 'legend.specPartial.desc',
      },
    ],
  },
];

/** 표기법 안내의 본문(구역 목록과 끝맺음). 도움말 창의 표기법 탭도 이것을 쓴다 */
export function LegendSections() {
  const t = useT();
  const locale = useLocale();
  return (
    <>
      {LEGEND_SECTIONS.map((section) => (
        <section key={section.id} className="legend-section">
          <h3 className="legend-section-title">{t(section.title)}</h3>
          <ul className="legend-list">
            {section.rows.map((row) => (
              <li key={row.key} className="legend-row">
                <span className="legend-icon">{row.icon}</span>
                <span className="legend-text">
                  <span className="legend-name">{t(row.name)}</span>
                  {locale !== 'en' && <span className="legend-en">{row.nameEn}</span>}
                  <span className="legend-desc">{t(row.description)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="legend-foot">{t('legend.foot')}</p>
    </>
  );
}

export function Legend() {
  const t = useT();
  return (
    <aside className="legend panel" data-testid="legend" aria-label={t('legend.title')}>
      <header className="legend-head">
        <h2 className="legend-title">{t('legend.title')}</h2>
        <button
          type="button"
          className="btn btn-ghost btn-icon legend-close"
          data-testid="legend-close"
          aria-label={t('common.close')}
          title={t('common.close')}
          onClick={() => ui().togglePanel('legend', false)}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="legend-body">
        <LegendSections />
      </div>
    </aside>
  );
}
