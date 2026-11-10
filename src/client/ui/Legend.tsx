/**
 * 수업 표기법 안내 패널. [담당: toolbar 에이전트]
 */
import type { ReactNode } from 'react';
import { NODE_PRESETS, type PresetId } from '../../shared/types';
import { PresetIcon } from '../canvas/PresetIcon';
import { ui } from '../state/ui';
import './Legend.css';

interface LegendRow {
  key: string;
  icon: ReactNode;
  name: string;
  nameEn: string;
  description: string;
}

interface LegendSection {
  title: string;
  rows: LegendRow[];
}

/** 프리셋 도형 한 줄. 이름은 프리셋의 것을 쓰되 필요하면 바꿔 적는다. */
function presetRow(id: PresetId, description: string, name?: string): LegendRow {
  const preset = NODE_PRESETS[id];
  return {
    key: id,
    icon: <PresetIcon presetId={id} size={30} />,
    name: name ?? preset.label,
    nameEn: preset.labelEn,
    description,
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
    title: '엔티티',
    rows: [
      presetRow('entity', '직사각형. 독립적으로 존재하는 개체', '엔티티 타입'),
      presetRow('weak-entity', '이중 직사각형. 식별 관계의 소유 엔티티에 의존'),
    ],
  },
  {
    title: '관계',
    rows: [
      presetRow('relationship', '마름모. 엔티티 사이의 연관', '관계 타입'),
      presetRow('identifying-relationship', '이중 마름모. 약한 엔티티를 소유 엔티티와 연결'),
    ],
  },
  {
    title: '속성',
    rows: [
      presetRow('attribute', '타원. 엔티티나 관계가 갖는 성질'),
      presetRow('key-attribute', '이름에 밑줄. 개체를 유일하게 구분'),
      presetRow('partial-key-attribute', '이름에 점선 밑줄. 약한 엔티티의 부분 식별자'),
      presetRow('multivalued-attribute', '이중 타원. 값을 여러 개 가질 수 있음'),
      presetRow('derived-attribute', '점선 타원. 다른 값에서 계산되는 값'),
      {
        key: 'composite',
        icon: <CompositeGlyph />,
        name: '복합 속성',
        nameEn: 'Composite attribute',
        description: '속성에 하위 속성을 선으로 연결',
      },
    ],
  },
  {
    title: '선',
    rows: [
      {
        key: 'single',
        icon: <ParticipationGlyph />,
        name: '단선',
        nameEn: 'Partial participation',
        description: '부분 참여. 일부 개체만 관계에 참여',
      },
      {
        key: 'double',
        icon: <ParticipationGlyph double />,
        name: '이중선',
        nameEn: 'Total participation',
        description: '전체 참여. 모든 개체가 관계에 참여',
      },
      {
        key: 'cardinality',
        icon: <CardinalityGlyph />,
        name: '카디널리티',
        nameEn: 'Cardinality',
        description: '선 옆에 1, M, N을 적어 대응 수를 표시',
      },
    ],
  },
  {
    title: '특수화',
    rows: [
      presetRow('spec-d', '원 안의 d(disjoint). 서브타입이 겹치지 않음'),
      presetRow('spec-o', '원 안의 o(overlap). 서브타입이 겹칠 수 있음'),
      {
        key: 'spec-total',
        icon: <SpecLineGlyph double />,
        name: '전체 특수화',
        nameEn: 'Total specialization',
        description: '슈퍼타입과 원 사이가 이중선',
      },
      {
        key: 'spec-partial',
        icon: <SpecLineGlyph />,
        name: '부분 특수화',
        nameEn: 'Partial specialization',
        description: '슈퍼타입과 원 사이가 단선',
      },
    ],
  },
];

export function Legend() {
  return (
    <aside className="legend panel" data-testid="legend" aria-label="표기법 안내">
      <header className="legend-head">
        <h2 className="legend-title">표기법 안내</h2>
        <button
          type="button"
          className="btn btn-ghost btn-icon legend-close"
          data-testid="legend-close"
          aria-label="닫기"
          onClick={() => ui().togglePanel('legend', false)}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="legend-body">
        {LEGEND_SECTIONS.map((section) => (
          <section key={section.title} className="legend-section">
            <h3 className="legend-section-title">{section.title}</h3>
            <ul className="legend-list">
              {section.rows.map((row) => (
                <li key={row.key} className="legend-row">
                  <span className="legend-icon">{row.icon}</span>
                  <span className="legend-text">
                    <span className="legend-name">{row.name}</span>
                    <span className="legend-en">{row.nameEn}</span>
                    <span className="legend-desc">{row.description}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="legend-foot">Chen 표기법 기준</p>
      </div>
    </aside>
  );
}
