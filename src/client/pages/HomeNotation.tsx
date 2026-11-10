/**
 * 지원하는 표기를 실제 도형으로 보여 주는 표. 강의 자료의 표기법 요약처럼 모양과 이름을 나란히 둔다.
 */
import type { ReactNode } from 'react';
import { STYLE, type ErdNode } from '../../shared/types';
import { NodeShape } from '../canvas/NodeShape';

const BOX = { w: 148, h: 72 };

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

interface Item {
  name: string;
  en: string;
  figure: ReactNode;
}

const GROUPS: Array<{ title: string; items: Item[] }> = [
  {
    title: '엔티티',
    items: [
      { name: '엔티티', en: 'Entity type', figure: shape('n-entity', 'entity', 96, 44, '학생') },
      { name: '약한 엔티티', en: 'Weak entity type', figure: shape('n-weak', 'entity', 100, 48, '분반', { weak: true }) },
    ],
  },
  {
    title: '관계',
    items: [
      { name: '관계', en: 'Relationship type', figure: shape('n-rel', 'relationship', 108, 56, '수강') },
      { name: '식별 관계', en: 'Identifying relationship', figure: shape('n-idrel', 'relationship', 116, 62, '개설', { identifying: true }) },
    ],
  },
  {
    title: '속성',
    items: [
      { name: '속성', en: 'Attribute', figure: shape('n-attr', 'attribute', 100, 44, '이름') },
      { name: '식별자', en: 'Identifier', figure: shape('n-key', 'attribute', 100, 44, '학번', { keyType: 'key' }) },
      { name: '부분 키', en: 'Partial key', figure: shape('n-pkey', 'attribute', 108, 44, '분반번호', { keyType: 'partial' }) },
      { name: '다중값 속성', en: 'Multivalued attribute', figure: shape('n-multi', 'attribute', 112, 50, '전화번호', { multivalued: true }) },
      { name: '유도 속성', en: 'Derived attribute', figure: shape('n-derived', 'attribute', 100, 44, '평점', { derived: true }) },
    ],
  },
  {
    title: '선',
    items: [
      { name: '단선', en: 'Partial participation', figure: line(false, '1') },
      { name: '이중선', en: 'Total participation', figure: line(true, 'M') },
    ],
  },
  {
    title: '특수화',
    items: [
      { name: '겹치지 않는 특수화', en: 'Disjoint', figure: shape('n-spec-d', 'spec', 34, 34, '', { specType: 'd' }) },
      { name: '겹칠 수 있는 특수화', en: 'Overlap', figure: shape('n-spec-o', 'spec', 34, 34, '', { specType: 'o' }) },
    ],
  },
];

export function HomeNotation() {
  return (
    <div className="home-sheet">
      {GROUPS.map((g) => (
        <div key={g.title} className="home-sheet-row">
          <h3 className="home-sheet-group">{g.title}</h3>
          <ul className="home-sheet-items">
            {g.items.map((it) => (
              <li key={it.name} className="home-sheet-item">
                <svg viewBox={`0 0 ${BOX.w} ${BOX.h}`} width={BOX.w} height={BOX.h} aria-hidden="true">
                  {it.figure}
                </svg>
                <span className="home-sheet-name">{it.name}</span>
                <span className="home-sheet-en">{it.en}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
