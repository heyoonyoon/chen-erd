/**
 * 지원하는 표기를 실제 도형으로 보여 주는 표. 강의 자료의 표기법 요약처럼 모양과 이름을 나란히 둔다.
 * 화면에 들어오면 줄마다 도형의 선이 그려지듯 나타난다.
 */
import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { STYLE, type ErdNode } from '../../shared/types';
import { NodeShape } from '../canvas/NodeShape';
import { useLocale, useT, type MessageKey, type TFunction } from '../i18n';
import { canAnimate, useInView } from './motion';

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
  /** 이름의 사전 키 */
  name: MessageKey;
  /** 영어 용어. 영어 화면에서는 이름과 겹치므로 보여 주지 않는다 */
  en: string;
  figure: ReactNode;
}

interface Group {
  id: string;
  title: MessageKey;
  items: Item[];
}

/** 표의 내용. 도형 안의 예시 글자도 현재 언어로 넣는다(도형이 작아서 짧은 낱말을 쓴다) */
function buildGroups(t: TFunction): Group[] {
  return [
    {
      id: 'entity',
      title: 'legend.section.entity',
      items: [
        { name: 'preset.entity.label', en: 'Entity type', figure: shape('n-entity', 'entity', 96, 44, t('home.sample.student')) },
        { name: 'preset.weak-entity.label', en: 'Weak entity type', figure: shape('n-weak', 'entity', 100, 48, t('home.sample.section'), { weak: true }) },
      ],
    },
    {
      id: 'relationship',
      title: 'legend.section.relationship',
      items: [
        { name: 'preset.relationship.label', en: 'Relationship type', figure: shape('n-rel', 'relationship', 108, 56, t('home.sample.enroll')) },
        {
          name: 'preset.identifying-relationship.label',
          en: 'Identifying relationship',
          figure: shape('n-idrel', 'relationship', 116, 62, t('home.sample.offer'), { identifying: true }),
        },
      ],
    },
    {
      id: 'attribute',
      title: 'legend.section.attribute',
      items: [
        { name: 'preset.attribute.label', en: 'Attribute', figure: shape('n-attr', 'attribute', 100, 44, t('home.sample.name')) },
        { name: 'term.key', en: 'Identifier', figure: shape('n-key', 'attribute', 100, 44, t('home.sample.studentId'), { keyType: 'key' }) },
        { name: 'term.partialKey', en: 'Partial key', figure: shape('n-pkey', 'attribute', 108, 44, t('home.sample.sectionNo'), { keyType: 'partial' }) },
        {
          name: 'preset.multivalued-attribute.label',
          en: 'Multivalued attribute',
          figure: shape('n-multi', 'attribute', 112, 50, t('home.sample.phone'), { multivalued: true }),
        },
      ],
    },
    {
      id: 'line',
      title: 'legend.section.line',
      items: [
        { name: 'term.singleLine', en: 'Partial participation', figure: line(false, '1') },
        { name: 'term.doubleLine', en: 'Total participation', figure: line(true, 'M') },
      ],
    },
    {
      id: 'spec',
      title: 'legend.section.spec',
      items: [
        { name: 'home.notation.disjoint', en: 'Disjoint', figure: shape('n-spec-d', 'spec', 34, 34, '', { specType: 'd' }) },
        { name: 'home.notation.overlap', en: 'Overlap', figure: shape('n-spec-o', 'spec', 34, 34, '', { specType: 'o' }) },
      ],
    },
  ];
}

/** 선을 그리는 시간과 도형 사이, 겹선 사이의 시차(ms). Home.css의 값과 같아야 한다 */
const DRAW_MS = 700;
const ITEM_GAP_MS = 110;
const OUTLINE_GAP_MS = 140;
/** 그리기가 끝난 뒤 정리하기까지 두는 여유(ms) */
const SETTLE_MS = 300;

/**
 * 표의 한 줄. 처음에는 완성된 그림이고, 움직임을 쓸 수 있으면 그리기 전에 선을 감춰 두었다가(armed)
 * 화면에 들어올 때 그린 뒤 감추는 데 쓴 값을 걷어 낸다(done).
 */
function SheetRow({ group }: { group: Group }) {
  const t = useT();
  const locale = useLocale();
  const [ref, inView] = useInView<HTMLDivElement>();
  const [phase, setPhase] = useState<'still' | 'armed' | 'done'>('still');

  // 선마다 길이를 재서 CSS가 그 길이만큼 선을 감췄다가 풀 수 있게 한다. 첫 칠 전에 끝내야 완성된 그림이 번쩍이지 않는다
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row || !canAnimate()) return;
    let measured = false;
    for (const svg of row.querySelectorAll<SVGSVGElement>('.home-sheet-item > svg')) {
      const strokes = svg.querySelectorAll<SVGGeometryElement>('rect, polygon, ellipse, circle, line');
      strokes.forEach((el, k) => {
        if (typeof el.getTotalLength !== 'function') return;
        el.style.setProperty('--len', String(Math.ceil(el.getTotalLength()) + 1));
        el.style.setProperty('--k', String(k));
        // 점선은 선 길이로 감추면 점선 무늬가 사라지므로 따로 표시해 두고 왼쪽부터 드러낸다
        if (el.hasAttribute('stroke-dasharray')) el.classList.add('is-dashed');
        measured = true;
      });
    }
    if (measured) setPhase('armed');
  }, [ref]);

  // 다 그린 뒤에는 감추는 데 쓴 값을 걷어 낸다. 선 길이로 감춘 채로 두면 닫힌 도형의 시작 모서리가 덜 채워진다
  useEffect(() => {
    if (phase !== 'armed' || !inView) return;
    const total = (group.items.length - 1) * ITEM_GAP_MS + OUTLINE_GAP_MS + DRAW_MS + SETTLE_MS;
    const timer = window.setTimeout(() => setPhase('done'), total);
    return () => window.clearTimeout(timer);
  }, [phase, inView, group.items.length]);

  const names = ['home-sheet-row', phase === 'armed' ? 'is-armed' : '', phase === 'armed' && inView ? 'is-in' : ''].filter(Boolean).join(' ');
  return (
    <div ref={ref} className={names}>
      <h3 className="home-sheet-group">{t(group.title)}</h3>
      <ul className="home-sheet-items">
        {group.items.map((it, i) => (
          <li key={it.name} className="home-sheet-item" style={{ '--i': i } as CSSProperties}>
            <svg viewBox={`0 0 ${BOX.w} ${BOX.h}`} width={BOX.w} height={BOX.h} aria-hidden="true">
              {it.figure}
            </svg>
            <span className="home-sheet-name">{t(it.name)}</span>
            {locale !== 'en' && <span className="home-sheet-en">{it.en}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HomeNotation() {
  const t = useT();
  // 줄과 칸의 key는 언어와 상관없는 값이라 언어를 바꿔도 줄이 새로 만들어지지 않고 글자만 바뀐다(그리기 효과가 다시 돌지 않는다)
  const groups = useMemo(() => buildGroups(t), [t]);
  return (
    <div className="home-sheet">
      {groups.map((g) => (
        <SheetRow key={g.id} group={g} />
      ))}
    </div>
  );
}
