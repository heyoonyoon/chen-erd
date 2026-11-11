/**
 * 로고 표식의 도형. 마름모(관계) 하나가 위에 있고 그 아래에 둥근 사각형(엔티티)과 타원(속성)이 나란히 놓이며,
 * 마름모의 아래 두 변에서 두 도형의 위쪽으로 짧은 선이 내려온다. 채우지 않고 한 가지 파란색 선으로만 그린다.
 *
 * 화면의 로고(src/client/ui/LogoMark.tsx)와 아이콘 파일을 만드는 스크립트(scripts/og/render.mjs)가 이 값을 함께 쓴다.
 * 스크립트가 Node로 바로 불러오므로 이 파일에는 타입 선언 말고는 실행 시점에 남는 TypeScript 문법을 쓰지 않는다.
 */

/** 로고의 파란색. 화면의 다른 곳은 무채색이고 이 표식만 이 색을 쓴다 */
export const LOGO_BLUE = '#2F6BFF';

/** 도형을 그리는 정사각형 좌표계의 한 변 */
export const LOGO_BOX = 44;

export interface LogoShapes {
  /** 선 굵기 */
  stroke: number;
  /** 마름모. 정사각형을 중심(cx, cy)에서 45도 돌려 그린다 */
  diamond: { cx: number; cy: number; side: number; r: number };
  /** 둥근 사각형 */
  entity: { x: number; y: number; w: number; h: number; r: number };
  /** 타원 */
  attribute: { cx: number; cy: number; rx: number; ry: number };
  /** 마름모와 아래 두 도형을 잇는 선 */
  links: string;
}

/** 기본 모양. 선 굵기는 높이의 1/11이다 */
export const LOGO_SHAPES: LogoShapes = {
  stroke: 4,
  diamond: { cx: 22, cy: 12, side: 14.2, r: 1.6 },
  entity: { x: 2, y: 30, w: 16, h: 12, r: 3 },
  attribute: { cx: 34, cy: 36, rx: 8, ry: 6 },
  links: 'M17 17 10.5 30M27 17 33.5 30',
};

/**
 * 한 변이 32px 이하로 그려질 때 쓰는 모양(브라우저 탭의 파비콘).
 * 선을 더 굵게 긋고, 16px로 그렸을 때 도형의 가장자리가 화소 경계에 놓이도록 좌표를 맞췄다(1px = 2.75).
 * 그래야 16px에서도 세 도형의 안쪽이 메워지지 않는다.
 */
export const LOGO_SHAPES_SMALL: LogoShapes = {
  stroke: 4.8125,
  diamond: { cx: 22, cy: 12.375, side: 14, r: 1.2 },
  entity: { x: 2.40625, y: 29.90625, w: 14.4375, h: 11.6875, r: 2.2 },
  attribute: { cx: 34.375, cy: 35.75, rx: 7.21875, ry: 5.84375 },
  links: 'M17 17.3 9.9 29.9M27 17.3 34.1 29.9',
};

const n = (value: number) => String(Math.round(value * 10000) / 10000);

/** 표식의 도형들을 SVG 글로 돌려준다(바깥 svg 태그는 뺀다). 좌표계는 한 변이 LOGO_BOX인 정사각형이다 */
export function logoMarkMarkup(shapes: LogoShapes = LOGO_SHAPES, color: string = LOGO_BLUE): string {
  const { stroke, diamond, entity, attribute, links } = shapes;
  const half = diamond.side / 2;
  return [
    `<g fill="none" stroke="${color}" stroke-width="${n(stroke)}" stroke-linecap="round" stroke-linejoin="round">`,
    `<path d="${links}"/>`,
    `<rect x="${n(diamond.cx - half)}" y="${n(diamond.cy - half)}" width="${n(diamond.side)}" height="${n(diamond.side)}" rx="${n(diamond.r)}" transform="rotate(45 ${n(diamond.cx)} ${n(diamond.cy)})"/>`,
    `<rect x="${n(entity.x)}" y="${n(entity.y)}" width="${n(entity.w)}" height="${n(entity.h)}" rx="${n(entity.r)}"/>`,
    `<ellipse cx="${n(attribute.cx)}" cy="${n(attribute.cy)}" rx="${n(attribute.rx)}" ry="${n(attribute.ry)}"/>`,
    '</g>',
  ].join('');
}
