import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NODE_PRESETS, PRESET_ORDER, STYLE, type ErdNode, type PresetId } from '../../shared/types';
import { presetText } from '../i18n';
import { measureText } from '../text/measure';
import { NodeShape, type NodeShapeProps } from './NodeShape';
import { PresetIcon } from './PresetIcon';

function nodeOf(presetId: PresetId, over: Partial<ErdNode> = {}): ErdNode {
  const p = NODE_PRESETS[presetId];
  return { id: `n-${presetId}`, kind: p.kind, x: 100, y: 200, w: p.w, h: p.h, text: presetText(presetId), ...p.props, ...over };
}

function render(presetId: PresetId, props: Partial<NodeShapeProps> = {}, over: Partial<ErdNode> = {}): string {
  return renderToStaticMarkup(<NodeShape node={nodeOf(presetId, over)} {...props} />);
}

function count(html: string, tag: string): number {
  return html.match(new RegExp(`<${tag}[\\s>]`, 'g'))?.length ?? 0;
}

describe('NodeShape', () => {
  it('모든 프리셋이 data-node-id가 달린 <g>로 그려지고 class를 쓰지 않는다', () => {
    for (const id of PRESET_ORDER) {
      const html = render(id);
      expect(html.startsWith(`<g data-node-id="n-${id}"`), id).toBe(true);
      expect(html, id).not.toContain('class=');
    }
  });

  it('이중 도형은 외곽선이 두 개다', () => {
    expect(count(render('entity'), 'rect')).toBe(1);
    expect(count(render('weak-entity'), 'rect')).toBe(2);
    expect(count(render('relationship'), 'polygon')).toBe(1);
    expect(count(render('identifying-relationship'), 'polygon')).toBe(2);
    expect(count(render('attribute'), 'ellipse')).toBe(1);
    expect(count(render('multivalued-attribute'), 'ellipse')).toBe(2);
  });

  it('약한 엔티티의 안쪽 사각형은 doubleGap만큼 들어간다', () => {
    const html = render('weak-entity');
    const g = STYLE.doubleGap;
    expect(html).toContain(`x="${100 + g}" y="${200 + g}" width="${150 - g * 2}" height="${66 - g * 2}"`);
  });

  it('이미 저장된 유도 속성(derived)은 지금도 점선 테두리로 그린다', () => {
    // 유도 속성은 화면에서 더 만들 수 없지만 예전에 만든 다이어그램에는 남아 있다
    expect(PRESET_ORDER).not.toContain('derived-attribute');
    expect(render('attribute', {}, { derived: true })).toContain('stroke-dasharray');
    expect(render('attribute')).not.toContain('stroke-dasharray');
    // 다른 표시와 함께 있어도 점선은 유지된다
    const multi = render('multivalued-attribute', {}, { derived: true });
    expect(multi).toContain('stroke-dasharray');
    expect(count(multi, 'ellipse')).toBe(2);
  });

  it('키는 줄마다 글자 너비만큼 실선 밑줄, 부분 키는 점선 밑줄을 긋는다', () => {
    const key = render('key-attribute', {}, { text: '학번\n이름' });
    expect(count(key, 'line')).toBe(2);
    expect(key).not.toContain('stroke-dasharray');
    const width = measureText('학번').width;
    expect(key).toContain(`x1="${160 - width / 2}"`);
    expect(key).toContain(`x2="${160 + width / 2}"`);

    const partial = render('partial-key-attribute');
    expect(count(partial, 'line')).toBe(1);
    expect(partial).toContain('stroke-dasharray');
    expect(count(render('attribute'), 'line')).toBe(0);
  });

  it('여러 줄 글자는 줄마다 tspan으로 가운데 정렬한다', () => {
    const html = render('entity', {}, { text: '수강\n신청' });
    expect(count(html, 'tspan')).toBe(2);
    expect(html).toContain('text-anchor="middle"');
    expect(html).toContain('pointer-events="none"');
    expect(html).toContain('user-select:none');
    // 두 줄의 기준선은 도형 중심(y = 230)을 사이에 두고 lineHeight만큼 떨어져 있다
    const ys = [...html.matchAll(/<tspan x="170" y="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(ys).toHaveLength(2);
    expect(ys[1] - ys[0]).toBeCloseTo(STYLE.lineHeight);
    expect((ys[0] + ys[1]) / 2).toBeCloseTo(230 + STYLE.fontSize * 0.35, 1);
  });

  it('편집 중이면 글자와 밑줄을 그리지 않는다', () => {
    const html = render('key-attribute', { editing: true });
    expect(count(html, 'text')).toBe(0);
    expect(count(html, 'line')).toBe(0);
    expect(count(html, 'ellipse')).toBe(1);
  });

  it('spec은 원 안에 specType 글자만 그린다', () => {
    const d = render('spec-d', {}, { text: '무시되는 글자' });
    expect(count(d, 'circle')).toBe(1);
    expect(d).toContain('>d</text>');
    expect(d).not.toContain('무시되는 글자');
    expect(render('spec-o')).toContain('>o</text>');
  });

  it('메모는 투명 사각형을 깔고 선택이나 호버 때만 점선 테두리를 보인다', () => {
    const plain = render('note');
    expect(plain).toContain('fill-opacity="0"');
    expect(plain).toContain('stroke="none"');
    expect(plain).toContain('메모');
    expect(render('note', { selected: true })).toContain(`stroke="${STYLE.accent}"`);
    expect(render('note', { hovered: true })).not.toContain('stroke="none"/>');
  });

  it('선택하면 테두리가 accent 색, 강조하면 뒤에 굵은 외곽이 깔린다', () => {
    expect(render('entity')).toContain(`stroke="${STYLE.stroke}"`);
    expect(render('entity')).toContain(`fill="${STYLE.fill}"`);
    expect(render('entity', { selected: true })).toContain(`stroke="${STYLE.accent}"`);
    const hl = render('relationship', { highlighted: true });
    expect(count(hl, 'polygon')).toBe(2);
    expect(hl.indexOf('stroke-opacity')).toBeLessThan(hl.indexOf(`fill="${STYLE.fill}"`));
    expect(count(render('attribute', { hovered: true }), 'ellipse')).toBe(2);
  });
});

describe('PresetIcon', () => {
  it('12개 프리셋이 모두 서로 다른 아이콘으로 그려진다', () => {
    const seen = new Set<string>();
    for (const id of PRESET_ORDER) {
      const html = renderToStaticMarkup(<PresetIcon presetId={id} />);
      expect(html, id).toContain('viewBox="0 0 28 28"');
      expect(html, id).toContain('width="28"');
      expect(html, id).toContain('stroke="currentColor"');
      seen.add(html.replace(/data-preset="[^"]*"/, ''));
    }
    expect(seen.size).toBe(PRESET_ORDER.length);
  });

  it('size와 color를 받는다', () => {
    const html = renderToStaticMarkup(<PresetIcon presetId="spec-d" size={40} color="#123456" />);
    expect(html).toContain('width="40"');
    expect(html).toContain('height="40"');
    expect(html).toContain('stroke="#123456"');
    expect(html).toContain('>d</text>');
  });
});
