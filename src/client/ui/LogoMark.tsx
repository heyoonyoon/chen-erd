/**
 * 로고 표식. 첫 화면의 내비게이션과 방의 상단 바가 함께 쓴다.
 * 도형과 색은 src/shared/logoMark.ts에 있고, 아이콘 파일(public/)도 같은 값으로 만든다.
 */
import { LOGO_BLUE, LOGO_BOX, LOGO_SHAPES } from '../../shared/logoMark';

export function LogoMark({ size = 22, className }: { size?: number; className?: string }) {
  const { stroke, diamond, entity, attribute, links } = LOGO_SHAPES;
  const half = diamond.side / 2;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${LOGO_BOX} ${LOGO_BOX}`}
      fill="none"
      stroke={LOGO_BLUE}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-testid="logo-mark"
    >
      <path d={links} />
      <rect
        x={diamond.cx - half}
        y={diamond.cy - half}
        width={diamond.side}
        height={diamond.side}
        rx={diamond.r}
        transform={`rotate(45 ${diamond.cx} ${diamond.cy})`}
      />
      <rect x={entity.x} y={entity.y} width={entity.w} height={entity.h} rx={entity.r} />
      <ellipse cx={attribute.cx} cy={attribute.cy} rx={attribute.rx} ry={attribute.ry} />
    </svg>
  );
}
