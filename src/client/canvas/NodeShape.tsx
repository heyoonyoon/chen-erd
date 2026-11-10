/**
 * 도형 하나를 그리는 순수 SVG 컴포넌트. [담당: shapes 에이전트]
 * store를 읽지 않고 props만으로 그린다(PNG 내보내기에서 renderToStaticMarkup으로도 쓰인다).
 * CSS 클래스에 기대지 않고 모든 모양을 SVG 속성으로 직접 준다.
 */
import { memo, type ReactNode, type SVGAttributes } from 'react';
import { STYLE, type ErdNode } from '../../shared/types';
import { innerDiamondScale, measureText } from '../text/measure';

export interface NodeShapeProps {
  node: ErdNode;
  /** 내가 선택한 상태(파란 테두리 강조) */
  selected?: boolean;
  hovered?: boolean;
  /** 글자 편집 중이면 글자를 그리지 않는다(위에 입력창이 겹치므로) */
  editing?: boolean;
  /** 검증 패널 등에서 강조 */
  highlighted?: boolean;
}

const HIGHLIGHT_COLOR = '#f59e0b';
const DERIVED_DASH = '6 4';
/** 글자 기준선을 줄 가운데에서 얼마나 내릴지(fontSize 대비). 한글과 영문 대문자가 줄 가운데에 오는 값 */
const BASELINE_SHIFT = 0.35;
/** 밑줄을 기준선에서 얼마나 내릴지(px) */
const UNDERLINE_OFFSET = 3;

type ShapeAttrs = SVGAttributes<SVGElement>;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 노드 종류에 맞는 외곽선 하나를 그린다.
 * inner가 true면 이중 도형의 안쪽 도형(변 사이 간격이 doubleGap)을 그리고, 도형이 너무 작아 그릴 수 없으면 null.
 */
function outline(node: ErdNode, attrs: ShapeAttrs, inner = false): ReactNode {
  const { x, y, w, h } = node;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const gap = inner ? STYLE.doubleGap : 0;

  switch (node.kind) {
    case 'relationship': {
      const k = inner ? innerDiamondScale(w, h, gap) : 1;
      if (k <= 0) return null;
      const a = (w / 2) * k;
      const b = (h / 2) * k;
      const points = `${round(cx)},${round(cy - b)} ${round(cx + a)},${round(cy)} ${round(cx)},${round(cy + b)} ${round(cx - a)},${round(cy)}`;
      return <polygon points={points} strokeLinejoin="miter" {...attrs} />;
    }
    case 'attribute': {
      const rx = w / 2 - gap;
      const ry = h / 2 - gap;
      if (rx <= 0 || ry <= 0) return null;
      return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} {...attrs} />;
    }
    case 'spec': {
      const r = Math.min(w, h) / 2 - gap;
      if (r <= 0) return null;
      return <circle cx={cx} cy={cy} r={r} {...attrs} />;
    }
    default: {
      // entity, note
      if (w - gap * 2 <= 0 || h - gap * 2 <= 0) return null;
      return <rect x={x + gap} y={y + gap} width={w - gap * 2} height={h - gap * 2} {...attrs} />;
    }
  }
}

function isDouble(node: ErdNode): boolean {
  return (
    (node.kind === 'entity' && !!node.weak) ||
    (node.kind === 'relationship' && !!node.identifying) ||
    (node.kind === 'attribute' && !!node.multivalued)
  );
}

const TEXT_STYLE = { userSelect: 'none', WebkitUserSelect: 'none', whiteSpace: 'pre' } as const;

/** 여러 줄 글자를 도형 정중앙에 그린다. 속성의 키 표시는 줄마다 글자 너비만큼 밑줄을 직접 긋는다. */
function label(node: ErdNode): ReactNode {
  if (node.text === '') return null;
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  const metrics = measureText(node.text);
  const top = cy - metrics.height / 2;
  const baseline = (i: number) => round(top + i * STYLE.lineHeight + STYLE.lineHeight / 2 + STYLE.fontSize * BASELINE_SHIFT);
  const underline = node.kind === 'attribute' && (node.keyType === 'key' || node.keyType === 'partial') ? node.keyType : null;

  return (
    <>
      <text
        x={cx}
        textAnchor="middle"
        fontFamily={STYLE.fontFamily}
        fontSize={STYLE.fontSize}
        fill={STYLE.stroke}
        stroke="none"
        pointerEvents="none"
        style={TEXT_STYLE}
      >
        {metrics.lines.map((line, i) =>
          line === '' ? null : (
            <tspan key={i} x={cx} y={baseline(i)}>
              {line}
            </tspan>
          ),
        )}
      </text>
      {underline &&
        metrics.lines.map((line, i) => {
          const width = metrics.lineWidths[i];
          if (line.trim() === '' || width <= 0) return null;
          const y = baseline(i) + UNDERLINE_OFFSET;
          return (
            <line
              key={i}
              x1={round(cx - width / 2)}
              y1={y}
              x2={round(cx + width / 2)}
              y2={y}
              stroke={STYLE.stroke}
              strokeWidth={1.2}
              strokeDasharray={underline === 'partial' ? '4 3' : undefined}
              pointerEvents="none"
            />
          );
        })}
    </>
  );
}

/** 특수화 원 안의 d/o 글자 */
function specLetter(node: ErdNode): ReactNode {
  const letter = node.specType ?? 'd';
  const fontSize = Math.max(10, Math.round(Math.min(node.w, node.h) * 0.42));
  // 소문자 o는 d보다 키가 작아 같은 기준선에서는 아래로 처져 보인다.
  const shift = letter === 'o' ? 0.27 : 0.33;
  return (
    <text
      x={node.x + node.w / 2}
      y={round(node.y + node.h / 2 + fontSize * shift)}
      textAnchor="middle"
      fontFamily={STYLE.fontFamily}
      fontSize={fontSize}
      fill={STYLE.stroke}
      stroke="none"
      pointerEvents="none"
      style={TEXT_STYLE}
    >
      {letter}
    </text>
  );
}

function NodeShapeImpl({ node, selected = false, hovered = false, editing = false, highlighted = false }: NodeShapeProps) {
  const halo = highlighted
    ? outline(node, {
        fill: 'none',
        stroke: HIGHLIGHT_COLOR,
        strokeOpacity: 0.45,
        strokeWidth: 9,
        strokeLinejoin: 'round',
        pointerEvents: 'none',
      })
    : null;

  if (node.kind === 'note') {
    // 메모는 테두리가 없다. 클릭 판정용 투명 사각형을 깔고 선택/호버 때만 옅은 점선 테두리를 보인다.
    const showBorder = selected || hovered;
    return (
      <g data-node-id={node.id} data-node-kind={node.kind}>
        {halo}
        <rect
          x={node.x}
          y={node.y}
          width={node.w}
          height={node.h}
          rx={3}
          fill={STYLE.fill}
          fillOpacity={0}
          stroke={showBorder ? (selected ? STYLE.accent : '#8b95a1') : 'none'}
          strokeOpacity={selected ? 0.75 : 0.6}
          strokeWidth={1}
          strokeDasharray="4 3"
          pointerEvents="all"
        />
        {!editing && label(node)}
      </g>
    );
  }

  const stroke = selected ? STYLE.accent : STYLE.stroke;
  const strokeWidth = selected ? STYLE.strokeWidth + 0.5 : STYLE.strokeWidth;
  const dash = node.kind === 'attribute' && node.derived ? DERIVED_DASH : undefined;

  return (
    <g data-node-id={node.id} data-node-kind={node.kind}>
      {halo}
      {hovered && !selected
        ? outline(node, {
            fill: 'none',
            stroke: STYLE.accent,
            strokeOpacity: 0.22,
            strokeWidth: 5,
            strokeLinejoin: 'round',
            pointerEvents: 'none',
          })
        : null}
      {outline(node, { fill: STYLE.fill, stroke, strokeWidth, strokeDasharray: dash })}
      {isDouble(node) ? outline(node, { fill: 'none', stroke, strokeWidth, strokeDasharray: dash, pointerEvents: 'none' }, true) : null}
      {node.kind === 'spec' ? specLetter(node) : !editing && label(node)}
    </g>
  );
}

/** 월드 좌표 기준 <g>를 돌려준다. 최상위 <g>에는 data-node-id={node.id}를 단다. */
export const NodeShape = memo(NodeShapeImpl);
NodeShape.displayName = 'NodeShape';
