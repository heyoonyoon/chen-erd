import { describe, expect, it } from 'vitest';
import { NODE_PRESETS, PRESET_ORDER, STYLE, type ErdNode, type PresetId } from '../../shared/types';
import { approximateLineWidth, fitNodeSize, growToFit, innerDiamondScale, measureText } from './measure';

function nodeOf(presetId: PresetId, over: Partial<ErdNode> = {}): ErdNode {
  const p = NODE_PRESETS[presetId];
  return { id: 'n1', kind: p.kind, x: 100, y: 200, w: p.w, h: p.h, text: p.defaultText, ...p.props, ...over };
}

const LONG = '아주 길게 적은 이름으로 도형이 커져야 하는 글자입니다';

describe('measureText', () => {
  it('줄 수와 높이를 센다', () => {
    const m = measureText('학생\n수강 신청\nabc');
    expect(m.lines).toEqual(['학생', '수강 신청', 'abc']);
    expect(m.lineWidths).toHaveLength(3);
    expect(m.height).toBe(3 * STYLE.lineHeight);
  });

  it('가장 긴 줄의 너비가 전체 너비다', () => {
    const m = measureText('가\n가나다라\nab');
    expect(m.width).toBe(Math.max(...m.lineWidths));
    expect(m.width).toBe(m.lineWidths[1]);
    expect(m.lineWidths[1]).toBeGreaterThan(m.lineWidths[0]);
  });

  it('DOM이 없으면 한글은 fontSize, 그 외는 fontSize × 0.56으로 어림한다', () => {
    expect(measureText('가나다').width).toBeCloseTo(3 * STYLE.fontSize);
    expect(measureText('abcd').width).toBeCloseTo(4 * STYLE.fontSize * 0.56);
    expect(measureText('가a', 20).width).toBeCloseTo(20 + 20 * 0.56);
    expect(approximateLineWidth('漢字ＡＢ', 10)).toBeCloseTo(40);
  });

  it('빈 글자는 너비 0, 한 줄 높이', () => {
    const m = measureText('');
    expect(m.width).toBe(0);
    expect(m.height).toBe(STYLE.lineHeight);
    expect(m.lines).toEqual(['']);
  });
});

describe('fitNodeSize', () => {
  it('기본 글자에서는 모든 프리셋이 기본 크기 그대로다', () => {
    for (const id of PRESET_ORDER) {
      const p = NODE_PRESETS[id];
      expect(fitNodeSize(nodeOf(id), p.defaultText), id).toEqual({ w: p.w, h: p.h });
    }
  });

  it('어떤 글자에서도 프리셋 기본 크기보다 작아지지 않는다', () => {
    for (const id of PRESET_ORDER) {
      const p = NODE_PRESETS[id];
      for (const text of ['', 'a', '이름', LONG, '여러\n줄\n글자\n입니다']) {
        const fit = fitNodeSize(nodeOf(id), text);
        expect(fit.w, `${id} w`).toBeGreaterThanOrEqual(p.w);
        expect(fit.h, `${id} h`).toBeGreaterThanOrEqual(p.h);
      }
    }
  });

  it('긴 글자에서는 커지고 10 단위로 올림한다', () => {
    for (const id of PRESET_ORDER) {
      if (NODE_PRESETS[id].kind === 'spec') continue;
      const p = NODE_PRESETS[id];
      const fit = fitNodeSize(nodeOf(id), LONG);
      expect(fit.w, id).toBeGreaterThan(p.w);
      expect(fit.w % 10, id).toBe(0);
      expect(fit.w, id).toBeGreaterThan(measureText(LONG).width);
    }
  });

  it('줄이 많으면 높이가 커진다', () => {
    const text = '하나\n둘\n셋\n넷\n다섯';
    for (const id of PRESET_ORDER) {
      if (NODE_PRESETS[id].kind === 'spec') continue;
      const fit = fitNodeSize(nodeOf(id), text);
      expect(fit.h, id).toBeGreaterThan(NODE_PRESETS[id].h);
      expect(fit.h % 10, id).toBe(0);
      expect(fit.h, id).toBeGreaterThan(measureText(text).height);
    }
  });

  it('같은 글자에 마름모와 타원은 직사각형보다 넓다', () => {
    const rect = fitNodeSize(nodeOf('entity'), LONG);
    expect(fitNodeSize(nodeOf('relationship'), LONG).w).toBeGreaterThan(rect.w);
    expect(fitNodeSize(nodeOf('attribute'), LONG).w).toBeGreaterThan(rect.w);
  });

  it('이중 도형은 같은 글자의 홑 도형 이상으로 크다', () => {
    const pairs: [PresetId, PresetId][] = [
      ['entity', 'weak-entity'],
      ['relationship', 'identifying-relationship'],
      ['attribute', 'multivalued-attribute'],
    ];
    for (const [single, double] of pairs) {
      const a = fitNodeSize(nodeOf(single), LONG);
      const b = fitNodeSize(nodeOf(double), LONG);
      expect(b.w, double).toBeGreaterThanOrEqual(a.w);
      expect(b.h, double).toBeGreaterThanOrEqual(a.h);
      expect(b.w + b.h, double).toBeGreaterThan(a.w + a.h);
    }
  });

  it('글자 상자가 마름모 안에 들어간다', () => {
    for (const text of [LONG, '수강\n신청', 'WORKS_ON', '가나다라마바사아자차']) {
      const m = measureText(text);
      const plain = fitNodeSize(nodeOf('relationship'), text);
      expect(m.width / plain.w + m.height / plain.h).toBeLessThanOrEqual(1);
      // 이중 마름모는 안쪽 마름모 기준
      const dbl = fitNodeSize(nodeOf('identifying-relationship'), text);
      const k = innerDiamondScale(dbl.w, dbl.h);
      expect(m.width / (dbl.w * k) + m.height / (dbl.h * k)).toBeLessThanOrEqual(1);
    }
  });

  it('글자 상자가 타원 안에 들어간다', () => {
    for (const text of [LONG, '생년\n월일', 'employee_name', '하나\n둘\n셋\n넷']) {
      const m = measureText(text);
      const plain = fitNodeSize(nodeOf('attribute'), text);
      expect((m.width / plain.w) ** 2 + (m.height / plain.h) ** 2).toBeLessThanOrEqual(1);
      const dbl = fitNodeSize(nodeOf('multivalued-attribute'), text);
      const iw = dbl.w - STYLE.doubleGap * 2;
      const ih = dbl.h - STYLE.doubleGap * 2;
      expect((m.width / iw) ** 2 + (m.height / ih) ** 2).toBeLessThanOrEqual(1);
    }
  });

  it('spec은 글자와 상관없이 프리셋 크기다', () => {
    expect(fitNodeSize(nodeOf('spec-d'), LONG)).toEqual({ w: 34, h: 34 });
    expect(fitNodeSize(nodeOf('spec-o'), 'a\nb\nc')).toEqual({ w: 34, h: 34 });
  });
});

describe('growToFit', () => {
  it('넘치지 않으면 null', () => {
    for (const id of PRESET_ORDER) {
      expect(growToFit(nodeOf(id), NODE_PRESETS[id].defaultText), id).toBeNull();
    }
    expect(growToFit(nodeOf('entity', { w: 600, h: 300 }), LONG)).toBeNull();
  });

  it('넘치면 중심을 유지한 채 키운다', () => {
    for (const id of PRESET_ORDER) {
      if (NODE_PRESETS[id].kind === 'spec') continue;
      const node = nodeOf(id);
      const next = growToFit(node, `${LONG}\n둘째 줄\n셋째 줄\n넷째 줄`);
      expect(next, id).not.toBeNull();
      if (!next) continue;
      expect(next.w).toBeGreaterThan(node.w);
      expect(next.h).toBeGreaterThan(node.h);
      expect(next.x + next.w / 2).toBeCloseTo(node.x + node.w / 2);
      expect(next.y + next.h / 2).toBeCloseTo(node.y + node.h / 2);
    }
  });

  it('모자란 축만 키우고 이미 큰 축은 그대로 둔다', () => {
    const node = nodeOf('entity', { w: 140, h: 300 });
    const next = growToFit(node, LONG);
    expect(next).not.toBeNull();
    expect(next!.h).toBe(300);
    expect(next!.y).toBe(node.y);
    expect(next!.w).toBe(fitNodeSize(node, LONG).w);
    expect(next!.x).toBe(node.x - (next!.w - node.w) / 2);

    // 사용자가 줄여 둔 도형은 줄어들지 않고 필요한 만큼만 커진다
    const wide = nodeOf('attribute', { w: 600, h: 50 });
    const tall = growToFit(wide, '하나\n둘\n셋\n넷');
    expect(tall).not.toBeNull();
    expect(tall!.w).toBe(600);
    expect(tall!.x).toBe(wide.x);
    expect(tall!.h).toBeGreaterThan(50);
  });

  it('spec은 키우지 않는다', () => {
    expect(growToFit(nodeOf('spec-d'), LONG)).toBeNull();
  });
});
