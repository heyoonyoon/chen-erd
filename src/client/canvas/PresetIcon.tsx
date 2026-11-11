/**
 * 프리셋 도형의 작은 아이콘(툴바, 범례, 인스펙터, 홈 화면에서 사용). [담당: shapes 에이전트]
 */
import type { ReactNode } from 'react';
import type { PresetId } from '../../shared/types';

export interface PresetIconProps {
  presetId: PresetId;
  /** 아이콘 한 변의 크기(px). 기본 28 */
  size?: number;
  /** 선 색. 기본 currentColor */
  color?: string;
}

/** viewBox는 0 0 28 28로 고정한다. 가운데는 (14, 14) */
const C = 14;

function diamond(a: number, b: number): string {
  return `${C},${C - b} ${C + a},${C} ${C},${C + b} ${C - a},${C}`;
}

/** 타원 안에 글자를 뜻하는 굵은 막대와 그 아래 밑줄 */
function keyMarks(color: string, dashed: boolean): ReactNode {
  return (
    <>
      <line x1={9.5} y1={12.2} x2={18.5} y2={12.2} strokeWidth={2.2} strokeLinecap="round" />
      <line
        x1={dashed ? 8.6 : 8.5}
        y1={16.6}
        x2={dashed ? 19.6 : 19.5}
        y2={16.6}
        stroke={color}
        strokeWidth={1.3}
        strokeDasharray={dashed ? '2.6 1.6' : undefined}
      />
    </>
  );
}

function specLetter(color: string, letter: 'd' | 'o'): ReactNode {
  return (
    <text
      x={C}
      y={letter === 'o' ? 17.6 : 18.3}
      textAnchor="middle"
      fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
      fontSize={12.5}
      fontWeight={600}
      fill={color}
      stroke="none"
    >
      {letter}
    </text>
  );
}

function shape(presetId: PresetId, color: string): ReactNode {
  switch (presetId) {
    case 'entity':
      return <rect x={3} y={7.5} width={22} height={13} />;
    case 'weak-entity':
      return (
        <>
          <rect x={2} y={5.5} width={24} height={17} strokeWidth={1.3} />
          <rect x={5} y={8.5} width={18} height={11} strokeWidth={1.3} />
        </>
      );
    case 'relationship':
      return <polygon points={diamond(12, 8.5)} />;
    case 'identifying-relationship':
      return (
        <>
          <polygon points={diamond(13, 10.5)} strokeWidth={1.3} />
          <polygon points={diamond(8.2, 6.6)} strokeWidth={1.3} />
        </>
      );
    case 'attribute':
      return <ellipse cx={C} cy={C} rx={11.5} ry={7.5} />;
    case 'key-attribute':
      return (
        <>
          <ellipse cx={C} cy={C} rx={12} ry={8.5} />
          {keyMarks(color, false)}
        </>
      );
    case 'partial-key-attribute':
      return (
        <>
          <ellipse cx={C} cy={C} rx={12} ry={8.5} />
          {keyMarks(color, true)}
        </>
      );
    case 'multivalued-attribute':
      return (
        <>
          <ellipse cx={C} cy={C} rx={12.5} ry={9} strokeWidth={1.3} />
          <ellipse cx={C} cy={C} rx={9.4} ry={5.9} strokeWidth={1.3} />
        </>
      );
    case 'spec-d':
      return (
        <>
          <circle cx={C} cy={C} r={10} />
          {specLetter(color, 'd')}
        </>
      );
    case 'spec-o':
      return (
        <>
          <circle cx={C} cy={C} r={10} />
          {specLetter(color, 'o')}
        </>
      );
    case 'note':
      return (
        <>
          <line x1={5} y1={9} x2={23} y2={9} strokeLinecap="round" />
          <line x1={5} y1={14} x2={23} y2={14} strokeLinecap="round" />
          <line x1={5} y1={19} x2={16} y2={19} strokeLinecap="round" />
        </>
      );
  }
}

/** 글자 없이 모양만 단순하게 그린 <svg>. 키 속성은 타원 안에 밑줄 친 짧은 선, 특수화 원은 d/o 글자를 넣는다. */
export function PresetIcon({ presetId, size = 28, color = 'currentColor' }: PresetIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      stroke={color}
      strokeWidth={1.5}
      strokeLinejoin="round"
      data-preset={presetId}
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, verticalAlign: 'middle' }}
    >
      {shape(presetId, color)}
    </svg>
  );
}
