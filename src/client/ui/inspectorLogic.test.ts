import { describe, expect, it } from 'vitest';
import type { ErdNode } from '../../shared/types';
import {
  alignNodes,
  commonValue,
  distributeNodes,
  edgeNature,
  keyTypeOf,
  nodeLabel,
  normalizeText,
  parseSize,
  presetChangePatch,
  resizePatch,
} from './inspectorLogic';

function box(id: string, x: number, y: number, w: number, h: number) {
  return { id, x, y, w, h };
}
function node(partial: Partial<ErdNode> & Pick<ErdNode, 'kind'>): ErdNode {
  return { id: 'n', x: 0, y: 0, w: 100, h: 50, text: '', ...partial };
}
/** 패치를 적용한 결과(검증용) */
function applied<T extends { id: string }>(nodes: T[], patches: Array<{ id: string; patch: object }>): T[] {
  return nodes.map((n) => ({ ...n, ...(patches.find((p) => p.id === n.id)?.patch ?? {}) }));
}

describe('alignNodes', () => {
  const nodes = [box('a', 0, 0, 100, 40), box('b', 50, 100, 60, 60), box('c', 200, 30, 40, 20)];

  it('왼쪽: 가장 왼쪽 변에 맞추고 이미 맞은 도형은 건드리지 않는다', () => {
    const patches = alignNodes(nodes, 'left');
    expect(patches).toEqual([
      { id: 'b', patch: { x: 0 } },
      { id: 'c', patch: { x: 0 } },
    ]);
  });

  it('오른쪽: 가장 오른쪽 변(240)에 오른쪽 변을 맞춘다', () => {
    const out = applied(nodes, alignNodes(nodes, 'right'));
    expect(out.map((n) => n.x + n.w)).toEqual([240, 240, 240]);
    expect(out.map((n) => n.y)).toEqual([0, 100, 30]);
  });

  it('가로 가운데: 전체 범위의 가운데(120)에 중심을 맞춘다', () => {
    const out = applied(nodes, alignNodes(nodes, 'hcenter'));
    expect(out.map((n) => n.x + n.w / 2)).toEqual([120, 120, 120]);
  });

  it('위, 아래, 세로 가운데', () => {
    expect(applied(nodes, alignNodes(nodes, 'top')).map((n) => n.y)).toEqual([0, 0, 0]);
    expect(applied(nodes, alignNodes(nodes, 'bottom')).map((n) => n.y + n.h)).toEqual([160, 160, 160]);
    expect(applied(nodes, alignNodes(nodes, 'vcenter')).map((n) => n.y + n.h / 2)).toEqual([80, 80, 80]);
    // 세로 맞춤은 x를 건드리지 않는다
    expect(alignNodes(nodes, 'top').every((p) => !('x' in p.patch))).toBe(true);
  });

  it('도형이 하나뿐이거나 이미 맞아 있으면 빈 목록', () => {
    expect(alignNodes([nodes[0]], 'left')).toEqual([]);
    expect(alignNodes([box('a', 10, 0, 10, 10), box('b', 10, 50, 30, 10)], 'left')).toEqual([]);
  });
});

describe('distributeNodes', () => {
  it('가로: 양 끝은 그대로 두고 사이 간격을 같게 한다', () => {
    const nodes = [box('a', 0, 0, 20, 20), box('b', 30, 5, 20, 20), box('c', 180, 9, 20, 20)];
    const patches = distributeNodes(nodes, 'h');
    expect(patches).toEqual([{ id: 'b', patch: { x: 90 } }]);
  });

  it('세로: 크기가 달라도 빈 간격이 같다', () => {
    const nodes = [box('a', 0, 0, 20, 10), box('b', 0, 20, 20, 50), box('c', 0, 200, 20, 40), box('d', 0, 90, 20, 20)];
    const out = applied(nodes, distributeNodes(nodes, 'v')).sort((p, q) => p.y - q.y);
    const gaps = out.slice(1).map((n, i) => n.y - (out[i].y + out[i].h));
    expect(gaps).toEqual([40, 40, 40]);
    expect(out[0].y).toBe(0);
    expect(out[3].y + out[3].h).toBe(240);
  });

  it('입력 순서와 상관없이 위치 순서대로 놓는다', () => {
    const nodes = [box('c', 180, 0, 20, 20), box('a', 0, 0, 20, 20), box('b', 30, 0, 20, 20)];
    expect(distributeNodes(nodes, 'h')).toEqual([{ id: 'b', patch: { x: 90 } }]);
  });

  it('세 개 미만이면 빈 목록', () => {
    expect(distributeNodes([box('a', 0, 0, 10, 10), box('b', 50, 0, 10, 10)], 'h')).toEqual([]);
  });

  it('겹쳐 있어도 전체 범위를 벗어나지 않는다', () => {
    const nodes = [box('a', 0, 0, 100, 10), box('b', 10, 0, 100, 10), box('c', 50, 0, 100, 10)];
    const out = applied(nodes, distributeNodes(nodes, 'h'));
    expect(Math.min(...out.map((n) => n.x))).toBe(0);
    expect(Math.max(...out.map((n) => n.x + n.w))).toBe(150);
    expect(out.map((n) => n.x)).toEqual([0, 25, 50]);
  });
});

describe('presetChangePatch', () => {
  it('종류 전용 플래그를 지우고 프리셋 플래그만 남긴다', () => {
    const n = node({ kind: 'attribute', keyType: 'key', multivalued: true, derived: true, text: '학번', x: 100, y: 100, w: 120, h: 50 });
    const patch = presetChangePatch(n, 'weak-entity', { w: 150, h: 66 });
    expect(patch).toMatchObject({ kind: 'entity', weak: true, w: 150, h: 66 });
    for (const key of ['identifying', 'multivalued', 'derived', 'keyType', 'specType'] as const) {
      expect(key in patch).toBe(true);
      expect(patch[key]).toBeUndefined();
    }
    expect('text' in patch).toBe(false);
  });

  it('중심을 유지한다', () => {
    const n = node({ kind: 'entity', x: 100, y: 100, w: 140, h: 60 });
    const patch = presetChangePatch(n, 'relationship', { w: 160, h: 90 });
    expect(patch.x! + patch.w! / 2).toBe(170);
    expect(patch.y! + patch.h! / 2).toBe(130);
  });

  it('특수화 원은 specType을 넣는다', () => {
    const patch = presetChangePatch(node({ kind: 'entity', weak: true }), 'spec-o', { w: 34, h: 34 });
    expect(patch).toMatchObject({ kind: 'spec', specType: 'o' });
    expect(patch.weak).toBeUndefined();
  });
});

describe('resizePatch', () => {
  const n = { x: 100, y: 100, w: 100, h: 50 };

  it('중심을 유지한 채 너비만 바꾼다', () => {
    expect(resizePatch(n, { w: 200 })).toEqual({ x: 50, y: 100, w: 200, h: 50 });
  });
  it('최소 크기 아래로 내려가지 않는다', () => {
    expect(resizePatch(n, { w: 1, h: 1 })).toMatchObject({ w: 40, h: 28 });
  });
  it('바뀌는 것이 없으면 null', () => {
    expect(resizePatch(n, { w: 100 })).toBeNull();
    expect(resizePatch(n, {})).toBeNull();
    expect(resizePatch(n, { w: Number.NaN })).toBeNull();
  });
  it('지나치게 큰 값은 잘라 낸다', () => {
    expect(resizePatch(n, { h: 1e9 })?.h).toBe(4000);
  });
});

describe('작은 도우미', () => {
  it('parseSize', () => {
    expect(parseSize(' 120 ')).toBe(120);
    expect(parseSize('')).toBeNull();
    expect(parseSize('abc')).toBeNull();
  });

  it('normalizeText', () => {
    expect(normalizeText('가\r\n나\n\n ')).toBe('가\n나');
    expect(normalizeText('  앞 공백')).toBe('  앞 공백');
  });

  it('nodeLabel: 글자가 비면 종류 이름', () => {
    expect(nodeLabel(node({ kind: 'entity', text: '학생' }))).toBe('학생');
    expect(nodeLabel(node({ kind: 'entity', text: '수강\n과목' }))).toBe('수강 과목');
    expect(nodeLabel(node({ kind: 'entity', weak: true, text: ' ' }))).toBe('약한 엔티티');
    expect(nodeLabel(node({ kind: 'spec', specType: 'o', text: '무시' }))).toBe('특수화 o');
    expect(nodeLabel(undefined)).toBe('(없는 도형)');
  });

  it('edgeNature', () => {
    const e = node({ kind: 'entity' });
    const r = node({ kind: 'relationship' });
    const s = node({ kind: 'spec' });
    const a = node({ kind: 'attribute' });
    expect(edgeNature(e, r)).toBe('entity-relationship');
    expect(edgeNature(r, e)).toBe('entity-relationship');
    expect(edgeNature(s, e)).toBe('entity-spec');
    expect(edgeNature(e, a)).toBe('other');
    expect(edgeNature(e, e)).toBe('other');
    expect(edgeNature(e, undefined)).toBe('other');
  });

  it('commonValue', () => {
    expect(commonValue(['1', '1'])).toBe('1');
    expect(commonValue(['1', 'N'])).toBeNull();
    expect(commonValue([false, false])).toBe(false);
    expect(commonValue([])).toBeNull();
  });

  it('keyTypeOf', () => {
    expect(keyTypeOf({})).toBe('none');
    expect(keyTypeOf({ keyType: 'partial' })).toBe('partial');
  });
});
