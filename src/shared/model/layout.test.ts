import { describe, expect, it } from 'vitest';
import { rectsIntersect, unionBounds } from '../geometry';
import { specRoles, validateDiagram } from '../rules';
import type { ErdEdge, ErdNode, Rect } from '../types';
import { applyModel } from './apply';
import { extractModel } from './extract';
import { COMPANY, SHOP, SMALL, UNIVERSITY, canonicalModel } from './fixtures';
import { countLineCrossings, layoutFull, layoutIncremental, type LayoutGraph } from './layout';
import { parseModel, printModel } from './text';
import type { Model, ModelAttribute } from './types';

// ───────────────────────── 도우미 ─────────────────────────

function counter(): () => string {
  let n = 0;
  return () => `n${++n}`;
}

function draw(model: Model | string) {
  return applyModel(typeof model === 'string' ? parseModel(model) : model, [], [], '', { newId: counter() });
}

/** 간격 gap 안으로 붙거나 겹친 도형 쌍 */
function overlaps(nodes: ErdNode[], gap: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (rectsIntersect({ x: a.x - gap, y: a.y - gap, w: a.w + gap * 2, h: a.h + gap * 2 }, b)) out.push(`${a.text || a.kind} × ${b.text || b.kind}`);
    }
  }
  return out;
}

function crossings(nodes: ErdNode[], edges: ErdEdge[]): number {
  const rects = new Map<string, Rect>(nodes.map((n) => [n.id, { x: n.x, y: n.y, w: n.w, h: n.h }]));
  return countLineCrossings(rects, edges.map((e): [string, string] => [e.source, e.target]));
}

/** 씨앗이 같으면 같은 수열이 나오는 난수 */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** 검증 오류가 없는 임의의 모델 */
function randomModel(seed: number): Model {
  const rnd = random(seed);
  const int = (n: number) => Math.floor(rnd() * n);
  const entityCount = 1 + int(9);
  const attrs = (prefix: string, max: number, depth = 0): ModelAttribute[] =>
    Array.from({ length: int(max + 1) }, (_, i) => {
      const a: ModelAttribute = { name: `${prefix}${i}` };
      if (i === 0 && depth === 0) a.key = 'key';
      if (rnd() < 0.15) a.multivalued = true;
      if (depth < 2 && rnd() < 0.2) a.parts = attrs(`${prefix}${i}_`, 3, depth + 1);
      if (a.parts && a.parts.length === 0) delete a.parts;
      return a;
    });
  const model: Model = { entities: [], relationships: [], specializations: [], notes: [] };
  for (let i = 0; i < entityCount; i++) model.entities.push({ name: `E${i}`, attributes: attrs(`e${i}a`, 7) });
  const relCount = int(entityCount + 3);
  for (let i = 0; i < relCount; i++) {
    const a = int(entityCount);
    const kind = rnd();
    const names = kind < 0.15 ? [a, a] : kind < 0.3 && entityCount >= 3 ? [a, (a + 1) % entityCount, (a + 2) % entityCount] : [a, int(entityCount)];
    if (names.length === 2 && names[0] === names[1] && kind >= 0.15) names[1] = (names[1] + 1) % entityCount;
    if (new Set(names).size === 1 && names.length === 2 && entityCount === 1 && kind >= 0.15) names[1] = names[0];
    model.relationships.push({
      name: `R${i}`,
      participants: names.map((n, k) => ({ entity: `E${n}`, cardinality: ['1', 'N', 'M'][k % 3], ...(rnd() < 0.3 ? { total: true } : {}), ...(names[0] === names[1] ? { role: `r${k}` } : {}) })),
      attributes: attrs(`r${i}a`, 2, 1),
    });
  }
  if (entityCount >= 4 && rnd() < 0.6) {
    const parent = int(entityCount);
    const children = [1, 2, 3].slice(0, 1 + int(3)).map((d) => `E${(parent + d) % entityCount}`);
    model.specializations.push({ parent: `E${parent}`, kind: rnd() < 0.5 ? 'd' : 'o', ...(rnd() < 0.5 ? { total: true } : {}), children });
  }
  for (let i = 0; i < int(3); i++) model.notes.push(`메모 ${i}`);
  return model;
}

const FIXTURES: Array<[string, string]> = [
  ['UNIVERSITY', UNIVERSITY],
  ['COMPANY', COMPANY],
  ['SMALL', SMALL],
  ['SHOP', SHOP],
];

// ───────────────────────── 전체 배치 ─────────────────────────

describe('전체 배치', () => {
  it('큰 예제는 엔티티 10개 이상, 도형 60개 이상이고 까다로운 모양을 모두 담고 있다', () => {
    const model = parseModel(UNIVERSITY);
    const r = draw(model);
    expect(model.entities.length).toBeGreaterThanOrEqual(10);
    expect(r.nodes.length).toBeGreaterThanOrEqual(60);
    expect(model.relationships.some((x) => x.participants.length === 3)).toBe(true);
    expect(model.relationships.some((x) => x.participants.length === 2 && x.participants[0].entity === x.participants[1].entity)).toBe(true);
    const pairs = model.relationships.map((x) => x.participants.map((p) => p.entity).sort().join('|'));
    expect(new Set(pairs).size).toBeLessThan(pairs.length);
    expect(model.specializations[0].children).toHaveLength(3);
    expect(model.entities.some((e) => e.attributes.some((a) => a.parts?.some((p) => p.parts)))).toBe(true);
  });

  it.each(FIXTURES)('%s: 도형이 서로 겹치지 않고 좌표가 정수다', (_name, text) => {
    const r = draw(text);
    expect(overlaps(r.nodes, 8)).toEqual([]);
    for (const n of r.nodes) {
      expect(Number.isInteger(n.x)).toBe(true);
      expect(Number.isInteger(n.y)).toBe(true);
    }
  });

  it.each(FIXTURES)('%s: 검증 오류가 없고 경고도 없다', (_name, text) => {
    const r = draw(text);
    expect(validateDiagram(r.nodes, r.edges).filter((i) => i.severity === 'error')).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it.each(FIXTURES)('%s: 배치한 그림에서 뽑은 모델이 원래 모델과 같다(속성은 순서까지)', (_name, text) => {
    const model = parseModel(text);
    const r = draw(model);
    const { model: back, skipped } = extractModel(r.nodes, r.edges, model.title);
    expect(skipped).toBe(0);
    expect(canonicalModel(back)).toEqual(canonicalModel(model));
  });

  it.each(FIXTURES)('%s: 선이 관계없는 도형을 지나지 않는다', (_name, text) => {
    const r = draw(text);
    expect(crossings(r.nodes, r.edges)).toBeLessThanOrEqual(1);
  });

  it.each(FIXTURES)('%s: 엔티티와 관계 사이에 카디널리티 글자가 들어갈 자리가 있다', (_name, text) => {
    const r = draw(text);
    const byId = new Map(r.nodes.map((n) => [n.id, n]));
    for (const e of r.edges) {
      const a = byId.get(e.source)!;
      const b = byId.get(e.target)!;
      if (a.kind !== 'relationship' || b.kind !== 'entity') continue;
      const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
      const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
      expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(50);
    }
  });

  it.each(FIXTURES)('%s: 속성이 소유자에서 너무 멀지 않고, 그림이 지나치게 성기지 않다', (_name, text) => {
    const r = draw(text);
    const byId = new Map(r.nodes.map((n) => [n.id, n]));
    for (const e of r.edges) {
      const a = byId.get(e.source)!;
      const b = byId.get(e.target)!;
      if (b.kind !== 'attribute') continue;
      const d = Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2));
      expect(d).toBeLessThan(420);
    }
    const bounds = unionBounds(r.nodes)!;
    const used = r.nodes.reduce((sum, n) => sum + n.w * n.h, 0);
    expect(used / (bounds.w * bounds.h)).toBeGreaterThan(0.1);
  });

  it('같은 입력이면 같은 좌표가 나온다', () => {
    for (const [, text] of FIXTURES) expect(draw(text)).toEqual(draw(text));
  });

  it('특수화 원은 슈퍼타입 아래, 서브타입은 원 아래에 놓인다', () => {
    const r = draw(UNIVERSITY);
    const spec = r.nodes.find((n) => n.kind === 'spec')!;
    const roles = specRoles(spec, r.nodes, r.edges);
    expect(roles.supertype?.text).toBe('직원');
    expect(spec.y).toBeGreaterThan(roles.supertype!.y + roles.supertype!.h);
    for (const sub of roles.subtypes) expect(sub.y).toBeGreaterThan(spec.y + spec.h);
    expect(roles.subtypes.map((n) => n.text)).toEqual(['조교', '행정직원', '계약직']);
  });

  it('전체가 아닌 특수화도 선의 이중선 없이 화면 규칙만으로 슈퍼타입이 맞게 읽힌다', () => {
    const r = draw(`
      entity A { id key }
      entity B
      entity C
      entity D
      entity E
      relationship R (B 1, E N)
      relationship S (A 1, E N)
      specialization A disjoint { B, C }
      specialization B overlap { D }
    `);
    for (const spec of r.nodes.filter((n) => n.kind === 'spec')) {
      const parent = spec.specType === 'd' ? 'A' : 'B';
      expect(specRoles(spec, r.nodes, r.edges).supertype?.text).toBe(parent);
    }
    expect(r.edges.some((e) => e.double)).toBe(false);
    expect(overlaps(r.nodes, 8)).toEqual([]);
  });

  it('외딴 엔티티, 참여자가 없는 관계, 메모만 있어도 겹치지 않게 놓는다', () => {
    const r = draw('entity A { a key, b, c }\nentity B\nentity C { x { y { z } } }\nrelationship R ()\nnote 하나\nnote 둘\nnote "셋\\n넷"');
    expect(r.nodes).toHaveLength(13);
    expect(overlaps(r.nodes, 8)).toEqual([]);
  });

  it('속성이 아주 많은 엔티티와 깊게 겹친 복합 속성도 겹치지 않는다', () => {
    const many = Array.from({ length: 24 }, (_, i) => `a${i}`).join(', ');
    const r = draw(`entity Big { ${many} }\nentity Deep { p { q { r { s { t, u }, v }, w }, x } }\nentity Other { id key }\nrelationship R (Big 1, Deep N) { k1, k2, k3, k4, k5 }\nrelationship S (Big 1, Other N)\nrelationship T (Deep M, Other N)`);
    expect(overlaps(r.nodes, 8)).toEqual([]);
    expect(canonicalModel(extractModel(r.nodes, r.edges).model)).toEqual(canonicalModel(parseModel(printModel(extractModel(r.nodes, r.edges).model))));
  });

  it('임의로 만든 모델 60개: 겹치지 않고, 검증 오류가 없고, 뽑으면 원래 모델이 나온다', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const model = randomModel(seed);
      const r = draw(model);
      expect(overlaps(r.nodes, 8), `seed ${seed}`).toEqual([]);
      expect(validateDiagram(r.nodes, r.edges).filter((i) => i.severity === 'error'), `seed ${seed}`).toEqual([]);
      expect(canonicalModel(extractModel(r.nodes, r.edges).model), `seed ${seed}`).toEqual(canonicalModel(model));
      expect(r.warnings, `seed ${seed}`).toEqual([]);
    }
  });

  it('엔티티가 40개인 모델도 금방 끝난다', () => {
    const lines: string[] = [];
    for (let i = 0; i < 40; i++) lines.push(`entity E${i} { id${i} key, a${i}, b${i}, c${i} }`);
    for (let i = 0; i < 40; i++) lines.push(`relationship R${i} (E${i} 1, E${(i * 7 + 3) % 40} N)`);
    for (let i = 0; i < 15; i++) lines.push(`relationship Q${i} (E${i * 2} M, E${(i * 5 + 1) % 40} N) { since${i} }`);
    const start = Date.now();
    const r = draw(lines.join('\n'));
    expect(Date.now() - start).toBeLessThan(5000);
    expect(r.nodes.length).toBe(40 * 5 + 55 + 15);
    expect(overlaps(r.nodes, 8)).toEqual([]);
  });

  it('건드리지 않는 도형이 있으면 그 옆에 놓는다', () => {
    const graph: LayoutGraph = {
      sizes: new Map([
        ['a', { w: 140, h: 60 }],
        ['b', { w: 140, h: 60 }],
        ['r', { w: 140, h: 80 }],
        ['x', { w: 120, h: 50 }],
      ]),
      entities: [
        { id: 'a', attrs: [{ id: 'x', parts: [] }] },
        { id: 'b', attrs: [] },
      ],
      relationships: [{ id: 'r', participants: ['a', 'b'], attrs: [] }],
      specs: [],
      notes: [],
    };
    const free = layoutFull(graph);
    expect(Math.min(...[...free.values()].map((p) => p.x))).toBe(100);
    expect(Math.min(...[...free.values()].map((p) => p.y))).toBe(100);
    const obstacle = { x: 150, y: 150, w: 300, h: 200 };
    const moved = layoutFull(graph, [obstacle]);
    for (const [id, p] of moved) {
      const s = graph.sizes.get(id)!;
      expect(rectsIntersect({ x: p.x, y: p.y, ...s }, obstacle)).toBe(false);
    }
    // 원래 자리를 주면 그 자리를 왼쪽 위로 삼는다
    const at = layoutFull(graph, [], { x: -500, y: 40 });
    expect(Math.min(...[...at.values()].map((p) => p.x))).toBe(-500);
    expect(Math.min(...[...at.values()].map((p) => p.y))).toBe(40);
  });
});

// ───────────────────────── 부분 배치 ─────────────────────────

describe('부분 배치', () => {
  it('임의의 그림에 임의의 모델을 덧붙여도 기존 도형은 그대로이고 새 도형은 겹치지 않는다', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const base = draw(randomModel(seed));
      const extra = randomModel(seed + 1000);
      // 두 모델을 합친다: 이름이 겹치지 않게 뒤쪽 모델의 이름을 바꾸고, 기존 엔티티와 잇는 관계를 하나 넣는다
      const rename = (name: string) => name.replace(/^E/, 'X');
      const first = extractModel(base.nodes, base.edges).model;
      const merged: Model = {
        entities: [...first.entities.map((e) => ({ ...e, attributes: [...e.attributes, { name: 'added' }, { name: 'added2', parts: [{ name: 'p1' }, { name: 'p2' }] }] })), ...extra.entities.map((e) => ({ ...e, name: rename(e.name) }))],
        relationships: [
          ...first.relationships,
          ...extra.relationships.map((r) => ({ ...r, name: `X${r.name}`, participants: r.participants.map((p) => ({ ...p, entity: rename(p.entity) })) })),
          { name: 'bridge', participants: [{ entity: first.entities[0].name, cardinality: '1' }, { entity: 'X0', cardinality: 'N' }], attributes: [{ name: 'since' }] },
        ],
        specializations: [...first.specializations, ...extra.specializations.map((s) => ({ ...s, parent: rename(s.parent), children: s.children.map(rename) }))],
        notes: [...first.notes, '덧붙인 메모'],
      };
      const r = applyModel(merged, base.nodes, base.edges, '', { newId: counter() });
      const before = new Map(base.nodes.map((n) => [n.id, n]));
      for (const n of r.nodes) if (before.has(n.id)) expect(n, `seed ${seed}`).toEqual(before.get(n.id));
      expect(overlaps(r.nodes, 6), `seed ${seed}`).toEqual([]);
      expect(r.nodes.every((n) => Number.isInteger(n.x) && Number.isInteger(n.y))).toBe(true);
      expect(r.warnings, `seed ${seed}`).toEqual([]);
      expect(canonicalModel(extractModel(r.nodes, r.edges).model, { sortAttributes: true }), `seed ${seed}`).toEqual(canonicalModel(merged, { sortAttributes: true }));
    }
  });

  it('관련된 엔티티 가까이에 놓고, 관련이 없으면 그림 오른쪽에 놓는다', () => {
    const base = draw(COMPANY);
    const bounds = unionBounds(base.nodes)!;
    const text = `${printModel(extractModel(base.nodes, base.edges).model)}\nentity SKILL { Name key }\nentity LAPTOP { Serial key }\nrelationship HAS (PROJECT M, SKILL N)`;
    const r = applyModel(parseModel(text), base.nodes, base.edges, '', { newId: counter() });
    const find = (name: string) => r.nodes.find((n) => n.kind !== 'attribute' && n.text === name)!;
    const project = find('PROJECT');
    const skill = find('SKILL');
    const has = find('HAS');
    expect(Math.hypot(skill.x - project.x, skill.y - project.y)).toBeLessThan(700);
    // 관계는 두 엔티티 사이에 놓인다
    expect(Math.hypot(has.x + has.w / 2 - (skill.x + skill.w / 2 + project.x + project.w / 2) / 2, has.y + has.h / 2 - (skill.y + skill.h / 2 + project.y + project.h / 2) / 2)).toBeLessThan(200);
    expect(find('LAPTOP').x).toBeGreaterThan(bounds.x + bounds.w);
    expect(overlaps(r.nodes, 6)).toEqual([]);
  });

  it('놓인 도형이 하나도 없으면 처음 자리에서 시작한다', () => {
    const graph: LayoutGraph = {
      sizes: new Map([
        ['a', { w: 140, h: 60 }],
        ['n', { w: 160, h: 50 }],
      ]),
      entities: [{ id: 'a', attrs: [] }],
      relationships: [],
      specs: [],
      notes: ['n'],
    };
    const p = layoutIncremental(graph, new Map());
    expect(p.get('a')).toEqual({ x: 100, y: 100 });
    expect(p.get('n')!.y).toBeGreaterThan(160);
  });
});
