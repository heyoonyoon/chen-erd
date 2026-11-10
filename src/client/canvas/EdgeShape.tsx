/**
 * 연결선 하나를 그리는 순수 SVG 컴포넌트. [담당: geometry 에이전트]
 * store를 읽지 않고 props만으로 그린다.
 * PNG/SVG 내보내기에서 문자열로 직렬화되므로 스타일은 CSS가 아니라 SVG 속성으로만 준다.
 */
import { memo } from 'react';
import type { EdgeGeometry } from '../../shared/geometry';
import { STYLE } from '../../shared/types';
import type { ErdEdge } from '../../shared/types';

export interface EdgeShapeProps {
  edge: ErdEdge;
  geometry: EdgeGeometry;
  selected?: boolean;
  hovered?: boolean;
  highlighted?: boolean;
}

const HIT_WIDTH = 14;
const HIGHLIGHT_COLOR = '#f59e0b';
const ROLE_FONT_SIZE = STYLE.labelFontSize - 2;

/**
 * 역할 이름이 선의 옆쪽에 놓이면 선에서 멀어지는 방향으로 글자가 뻗게 한다.
 * 카디널리티 글자에서 역할 이름으로 가는 방향이 곧 선에서 멀어지는 방향이다.
 */
function roleAnchor(geometry: EdgeGeometry): 'start' | 'middle' | 'end' {
  const dx = geometry.rolePos.x - geometry.labelPos.x;
  const dy = geometry.rolePos.y - geometry.labelPos.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || Math.abs(dx) < len * 0.3) return 'middle';
  return dx > 0 ? 'start' : 'end';
}

function EdgeShapeImpl({ edge, geometry, selected, hovered, highlighted }: EdgeShapeProps) {
  const color = selected ? STYLE.accent : STYLE.stroke;
  return (
    <g data-edge-id={edge.id}>
      {highlighted && (
        <path
          d={geometry.hitPath}
          fill="none"
          stroke={HIGHLIGHT_COLOR}
          strokeOpacity={0.45}
          strokeWidth={10}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      )}
      {hovered && !selected && (
        <path
          d={geometry.hitPath}
          fill="none"
          stroke={STYLE.accent}
          strokeOpacity={0.25}
          strokeWidth={STYLE.doubleGap + STYLE.strokeWidth + 3}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      )}
      {geometry.paths.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={STYLE.strokeWidth}
          strokeLinecap="butt"
          strokeLinejoin="miter"
          pointerEvents="none"
        />
      ))}
      <path
        className="edge-hit"
        d={geometry.hitPath}
        fill="none"
        stroke="transparent"
        strokeWidth={HIT_WIDTH}
        strokeLinecap="butt"
        strokeLinejoin="round"
        pointerEvents="stroke"
      />
      {edge.label && (
        <text
          x={geometry.labelPos.x}
          y={geometry.labelPos.y}
          dy="0.35em"
          textAnchor="middle"
          fontFamily={STYLE.fontFamily}
          fontSize={STYLE.labelFontSize}
          fill={color}
          stroke="#ffffff"
          strokeWidth={4}
          strokeLinejoin="round"
          paintOrder="stroke"
          style={{ userSelect: 'none' }}
        >
          {edge.label}
        </text>
      )}
      {edge.role && (
        <text
          x={geometry.rolePos.x}
          y={geometry.rolePos.y}
          dy="0.35em"
          textAnchor={roleAnchor(geometry)}
          fontFamily={STYLE.fontFamily}
          fontSize={ROLE_FONT_SIZE}
          fill={color}
          stroke="#ffffff"
          strokeWidth={4}
          strokeLinejoin="round"
          paintOrder="stroke"
          style={{ userSelect: 'none' }}
        >
          {edge.role}
        </text>
      )}
    </g>
  );
}

function samePoint(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}

/** geometry는 렌더마다 새 객체로 계산되어 오므로 내용으로 비교해 다시 그리기를 줄인다 */
function sameProps(a: EdgeShapeProps, b: EdgeShapeProps): boolean {
  if (!!a.selected !== !!b.selected || !!a.hovered !== !!b.hovered || !!a.highlighted !== !!b.highlighted) {
    return false;
  }
  if (a.edge !== b.edge) {
    if (a.edge.id !== b.edge.id || a.edge.label !== b.edge.label || a.edge.role !== b.edge.role) return false;
  }
  const g = a.geometry;
  const h = b.geometry;
  if (g === h) return true;
  return (
    g.hitPath === h.hitPath &&
    g.paths.length === h.paths.length &&
    g.paths.every((d, i) => d === h.paths[i]) &&
    samePoint(g.mid, h.mid) &&
    samePoint(g.labelPos, h.labelPos) &&
    samePoint(g.rolePos, h.rolePos)
  );
}

/**
 * 최상위 <g>에는 data-edge-id={edge.id}를 단다.
 * 클릭하기 쉽도록 투명하고 굵은 hit 선(stroke-width 14, class="edge-hit")을 함께 그린다.
 */
export const EdgeShape = memo(EdgeShapeImpl, sameProps);
