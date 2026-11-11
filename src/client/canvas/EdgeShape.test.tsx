import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { computeEdgeGeometry } from '../../shared/geometry';
import { STYLE } from '../../shared/types';
import type { ErdEdge, ErdNode } from '../../shared/types';
import { EdgeShape } from './EdgeShape';

const a: ErdNode = { id: 'a', kind: 'entity', x: 0, y: 0, w: 100, h: 60, text: '' };
const b: ErdNode = { id: 'b', kind: 'relationship', x: 300, y: -10, w: 140, h: 80, text: '' };

function render(edge: ErdEdge, flags: { selected?: boolean; hovered?: boolean; highlighted?: boolean } = {}) {
  const geometry = computeEdgeGeometry(edge, a, b);
  return renderToStaticMarkup(<EdgeShape edge={edge} geometry={geometry} {...flags} />);
}
function count(html: string, tag: string): number {
  return html.split(`<${tag}`).length - 1;
}

describe('EdgeShape', () => {
  it('단선: 선 1개와 hit 선을 인라인 속성으로 그린다', () => {
    const html = render({ id: 'e1', source: 'a', target: 'b', double: false, label: '', role: '' });
    expect(html.startsWith('<g data-edge-id="e1">')).toBe(true);
    expect(count(html, 'path')).toBe(2);
    expect(count(html, 'text')).toBe(0);
    expect(html).toContain(`stroke="${STYLE.stroke}"`);
    expect(html).toContain(`stroke-width="${STYLE.strokeWidth}"`);
    expect(html).toContain('stroke-linecap="butt"');
    expect(html).toContain('fill="none"');
    expect(html).toContain('class="edge-hit"');
    expect(html).toContain('stroke="transparent"');
    expect(html).toContain('stroke-width="14"');
    expect(html).toContain('pointer-events="stroke"');
  });

  it('이중선은 선 2개, 글자는 흰 테두리와 함께 그린다', () => {
    const html = render({ id: 'e1', source: 'a', target: 'b', double: true, label: 'N', role: '상사' });
    expect(count(html, 'path')).toBe(3);
    expect(count(html, 'text')).toBe(2);
    expect(html).toContain('>N</text>');
    expect(html).toContain('>상사</text>');
    expect(html).toContain('text-anchor="middle"');
    expect(html).toContain('paint-order="stroke"');
    expect(html).toContain('stroke="#ffffff"');
    expect(html).toContain(`font-size="${STYLE.labelFontSize}"`);
    expect(html).toContain(`font-size="${STYLE.labelFontSize - 2}"`);
    expect(html).toContain('font-family=');
  });

  it('선택하면 선과 글자가 강조색이 된다', () => {
    const html = render({ id: 'e1', source: 'a', target: 'b', double: false, label: '1', role: '' }, { selected: true });
    expect(html).toContain(`stroke="${STYLE.accent}"`);
    expect(html).toContain(`fill="${STYLE.accent}"`);
    expect(html).not.toContain(`stroke="${STYLE.stroke}"`);
  });

  it('꺾은선: 모서리를 각지게 잇고 이중선도 꺾인 두 줄로 그린다', () => {
    const edge: ErdEdge = { id: 'e2', source: 'a', target: 'b', double: true, label: 'N', role: '', sourceSide: 'top', targetSide: 'top', shape: 'elbow' };
    const geometry = computeEdgeGeometry(edge, a, b);
    expect(geometry.points.length).toBeGreaterThan(2);
    const html = renderToStaticMarkup(<EdgeShape edge={edge} geometry={geometry} />);
    expect(count(html, 'path')).toBe(3);
    expect(html).toContain('stroke-linejoin="miter"');
    for (const d of geometry.paths) expect(html).toContain(`d="${d}"`);
    expect(html).toContain(`d="${geometry.hitPath}"`);
    expect(html).not.toContain('NaN');
  });

  it('hovered와 highlighted는 뒤에 반투명 선을 깐다', () => {
    const edge: ErdEdge = { id: 'e1', source: 'a', target: 'b', double: false, label: '', role: '' };
    expect(count(render(edge, { hovered: true }), 'path')).toBe(3);
    expect(count(render(edge, { highlighted: true }), 'path')).toBe(3);
    expect(render(edge, { highlighted: true })).toContain('stroke-opacity="0.45"');
    // 선택된 선에는 hover 표시를 겹치지 않는다
    expect(count(render(edge, { hovered: true, selected: true }), 'path')).toBe(2);
  });
});
