// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LOGO_BLUE, LOGO_BOX, LOGO_SHAPES, LOGO_SHAPES_SMALL, logoMarkMarkup } from '../../shared/logoMark';
import { Home } from '../pages/Home';
import { LogoMark } from './LogoMark';

afterEach(cleanup);

/** 요소의 도형을 이름과 속성으로 적는다. 속성 순서와 숫자 표기에 흔들리지 않게 숫자는 소수 둘째 자리로 맞춘다 */
function shapesOf(root: Element): string[] {
  return [...root.querySelectorAll('path, rect, ellipse')].map((el) => {
    const attrs = [...el.attributes]
      .map((a) => `${a.name}=${a.value.replace(/-?\d+(\.\d+)?/g, (n) => Number(n).toFixed(2))}`)
      .sort();
    return `${el.tagName.toLowerCase()} ${attrs.join(' ')}`;
  });
}

function parseSvg(markup: string): Element {
  const host = document.createElement('div');
  host.innerHTML = markup;
  return host;
}

describe('LogoMark', () => {
  it('마름모 하나와 그 아래의 둥근 사각형, 타원, 둘을 잇는 선을 채우지 않은 파란 선으로 그린다', () => {
    render(<LogoMark size={22} />);
    const svg = screen.getByTestId('logo-mark');
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${LOGO_BOX} ${LOGO_BOX}`);
    expect(svg.getAttribute('width')).toBe('22');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke')).toBe(LOGO_BLUE);
    expect(LOGO_BLUE).toBe('#2F6BFF');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect([...svg.children].map((el) => el.tagName.toLowerCase())).toEqual(['path', 'rect', 'rect', 'ellipse']);
    // 선 굵기는 표식 높이의 1/11
    expect(LOGO_SHAPES.stroke * 11).toBe(LOGO_BOX);
  });

  it('도형이 좌표계 안에 들어가고 아래 두 도형을 합친 폭이 마름모보다 넓다', () => {
    for (const shapes of [LOGO_SHAPES, LOGO_SHAPES_SMALL]) {
      const { stroke, diamond, entity, attribute } = shapes;
      const half = stroke / 2;
      const reach = (diamond.side / 2) * Math.SQRT2;
      const left = Math.min(entity.x, diamond.cx - reach) - half;
      const right = Math.max(attribute.cx + attribute.rx, diamond.cx + reach) + half;
      const top = diamond.cy - reach - half;
      const bottom = Math.max(entity.y + entity.h, attribute.cy + attribute.ry) + half;
      expect(left).toBeGreaterThanOrEqual(-0.01);
      expect(top).toBeGreaterThanOrEqual(-0.5);
      expect(right).toBeLessThanOrEqual(LOGO_BOX + 0.01);
      expect(bottom).toBeLessThanOrEqual(LOGO_BOX + 0.01);
      expect(attribute.cx + attribute.rx - entity.x).toBeGreaterThan(reach * 2);
      // 사각형과 타원은 겹치지 않고, 타원은 가로로 길다
      expect(attribute.cx - attribute.rx - half).toBeGreaterThan(entity.x + entity.w + half);
      expect(attribute.rx).toBeGreaterThan(attribute.ry);
    }
  });

  it('화면의 로고와 아이콘 파일을 만드는 글이 같은 도형을 그린다', () => {
    render(<LogoMark />);
    expect(shapesOf(screen.getByTestId('logo-mark'))).toEqual(shapesOf(parseSvg(`<svg>${logoMarkMarkup()}</svg>`)));
  });

  it('public/favicon.svg는 작은 크기용 모양으로 만든 그대로다(scripts/og/render.mjs로 다시 만든다)', () => {
    // jsdom 환경에서는 이 파일의 주소가 file: 이 아니라서 저장소 루트(테스트를 실행하는 폴더)를 기준으로 찾는다
    const file = readFileSync(path.resolve(process.cwd(), 'public/favicon.svg'), 'utf8');
    expect(file).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGO_BOX} ${LOGO_BOX}">${logoMarkMarkup(LOGO_SHAPES_SMALL)}</svg>\n`,
    );
    // 탭 바탕이 밝든 어둡든 보이도록 바탕을 깔지 않는다
    expect(file).not.toContain('fill="#');
    expect(LOGO_SHAPES_SMALL.stroke).toBeGreaterThan(LOGO_SHAPES.stroke);
  });

  it('첫 화면의 내비게이션이 제품 이름 앞에 같은 표식을 쓴다', () => {
    const { container } = render(<Home />);
    const brand = container.querySelector('.home-brand')!;
    const mark = brand.querySelector('[data-testid="logo-mark"]')!;
    expect(mark.nextElementSibling!.textContent).toBe('modelll');
    expect(shapesOf(mark)).toEqual(shapesOf(parseSvg(`<svg>${logoMarkMarkup()}</svg>`)));
  });
});
