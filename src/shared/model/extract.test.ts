import { describe, expect, it } from 'vitest';
import type { ErdEdge, ErdNode, NodeKind } from '../types';
import { diagramToText, extractBound, extractModel, fanOrderKey } from './extract';
import { parseModel } from './text';

// ───────────────────────── 테스트용 도형 만들기 ─────────────────────────

function node(id: string, kind: NodeKind, text: string, x: number, y: number, props: Partial<ErdNode> = {}): ErdNode {
  const size = kind === 'spec' ? { w: 34, h: 34 } : kind === 'attribute' ? { w: 120, h: 50 } : kind === 'relationship' ? { w: 140, h: 80 } : { w: 140, h: 60 };
  return { id, kind, text, x, y, ...size, ...props };
}
function edge(id: string, source: string, target: string, props: Partial<ErdEdge> = {}): ErdEdge {
  return { id, source, target, double: false, label: '', role: '', ...props };
}

/** 학생 M(전체) 수강 N 과목. 학생에 학번(키)과 이름{성, 이름}, 수강에 성적 */
function enrollment(): { nodes: ErdNode[]; edges: ErdEdge[] } {
  const nodes = [
    node('student', 'entity', '학생', 100, 300),
    node('course', 'entity', '과목', 700, 300),
    node('takes', 'relationship', '수강', 400, 290),
    node('sid', 'attribute', '학번', 0, 150, { keyType: 'key' }),
    node('name', 'attribute', '이름', 200, 150),
    node('last', 'attribute', '성', 120, 30),
    node('first', 'attribute', '이름', 300, 30),
    node('grade', 'attribute', '성적', 410, 150),
  ];
  const edges = [
    edge('e1', 'takes', 'student', { label: 'M', double: true }),
    edge('e2', 'course', 'takes', { label: 'N' }),
    edge('e3', 'student', 'sid'),
    edge('e4', 'name', 'student'),
    edge('e5', 'name', 'last'),
    edge('e6', 'first', 'name'),
    edge('e7', 'takes', 'grade'),
  ];
  return { nodes, edges };
}

function shuffled<T>(list: T[], seed: number): T[] {
  const out = [...list];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe('extractModel', () => {
  it('엔티티, 관계, 속성 나무를 뽑는다', () => {
    const { nodes, edges } = enrollment();
    const { model, skipped } = extractModel(nodes, edges, '수강신청');
    expect(skipped).toBe(0);
    expect(model).toEqual(
      parseModel(`
        title 수강신청
        entity 학생 { 학번 key, 이름 { 성, 이름 } }
        entity 과목
        relationship 수강 (학생 M total, 과목 N) { 성적 }
      `),
    );
  });

  it('제목을 주지 않거나 비어 있으면 모델에 넣지 않는다', () => {
    const { nodes, edges } = enrollment();
    expect(extractModel(nodes, edges).model.title).toBeUndefined();
    expect(extractModel(nodes, edges, '').model.title).toBeUndefined();
  });

  it('배열의 순서가 달라도 같은 글이 나온다', () => {
    const { nodes, edges } = enrollment();
    const text = diagramToText(nodes, edges);
    for (let seed = 1; seed <= 5; seed++) {
      expect(diagramToText(shuffled(nodes, seed), shuffled(edges, seed + 10))).toBe(text);
    }
  });

  it('엔티티와 관계와 메모는 읽는 순서(y, x, id)로 나온다', () => {
    const nodes = [
      node('n3', 'entity', 'C', 500, 100),
      node('n1', 'entity', 'B', 100, 200),
      node('n2', 'entity', 'A', 100, 100),
      node('n5', 'entity', 'D', 100, 100),
      node('m2', 'note', '둘째', 0, 900),
      node('m1', 'note', '첫째', 0, 800),
    ];
    const { model } = extractModel(nodes, []);
    expect(model.entities.map((e) => e.name)).toEqual(['A', 'D', 'C', 'B']);
    expect(model.notes).toEqual(['첫째', '둘째']);
  });

  it('속성은 소유자 서쪽에서 시작해 시계 방향으로 나온다', () => {
    const nodes = [
      node('e', 'entity', 'E', 300, 300),
      node('south', 'attribute', '남', 310, 500),
      node('east', 'attribute', '동', 600, 305),
      node('north', 'attribute', '북', 310, 100),
      node('west', 'attribute', '서', 0, 305),
      node('nw', 'attribute', '북서', 100, 150),
    ];
    const edges = nodes.slice(1).map((n, i) => edge(`e${i}`, 'e', n.id));
    expect(extractModel(nodes, edges).model.entities[0].attributes.map((a) => a.name)).toEqual(['서', '북서', '북', '동', '남']);
    expect(fanOrderKey(-100, 0.5)).toBe(fanOrderKey(-100, -0.5));
    expect(fanOrderKey(-100, -5)).toBeLessThan(fanOrderKey(0, -100));
    expect(fanOrderKey(-100, 5)).toBeGreaterThan(fanOrderKey(0, 100));
  });

  it('선의 카디널리티, 이중선, 역할 이름을 참여자에 담고 재귀 관계는 같은 엔티티가 두 번 나온다', () => {
    const nodes = [node('emp', 'entity', '직원', 100, 300), node('mgr', 'relationship', '관리', 100, 100, { identifying: true })];
    const edges = [edge('a', 'mgr', 'emp', { label: '1', role: '상사' }), edge('b', 'emp', 'mgr', { label: 'N', role: '부하', double: true })];
    expect(extractModel(nodes, edges).model.relationships).toEqual([
      {
        name: '관리',
        identifying: true,
        participants: [
          { entity: '직원', cardinality: '1', role: '상사' },
          { entity: '직원', cardinality: 'N', total: true, role: '부하' },
        ],
        attributes: [],
      },
    ]);
  });

  it('특수화는 이중선이 하나면 그쪽이 슈퍼타입이고, 없으면 원 위의 가까운 엔티티다', () => {
    const nodes = [
      node('p', 'entity', '직원', 300, 100, { weak: true }),
      node('c1', 'entity', '비서', 100, 400),
      node('c2', 'entity', '기술자', 500, 400),
      node('s', 'spec', '', 353, 250, { specType: 'o' }),
    ];
    const plain = [edge('e1', 's', 'p'), edge('e2', 's', 'c2'), edge('e3', 'c1', 's')];
    expect(extractModel(nodes, plain).model.specializations).toEqual([{ parent: '직원', kind: 'o', children: ['비서', '기술자'] }]);
    expect(extractModel(nodes, plain).model.entities[0]).toEqual({ name: '직원', weak: true, attributes: [] });
    const total = [edge('e1', 's', 'p', { double: true }), edge('e2', 's', 'c2'), edge('e3', 'c1', 's')];
    expect(extractModel(nodes, total).model.specializations[0].total).toBe(true);
    // 아래쪽 엔티티에 이중선이 있으면 그쪽이 슈퍼타입이다
    const flipped = [edge('e1', 's', 'p'), edge('e2', 's', 'c2', { double: true }), edge('e3', 'c1', 's')];
    expect(extractModel(nodes, flipped).model.specializations).toEqual([{ parent: '기술자', kind: 'o', total: true, children: ['비서', '직원'] }]);
  });

  it('모델에 담지 못하는 도형과 선은 빼고 센다', () => {
    const { nodes, edges } = enrollment();
    const extra = [
      ...nodes,
      node('lonely', 'attribute', '외톨이', 900, 900),
      node('g1', 'attribute', '묶음1', 900, 700),
      node('g2', 'attribute', '묶음2', 1100, 700),
      node('circle', 'spec', '', 900, 500),
      node('memo', 'note', '메모', 0, 900),
    ];
    const extraEdges = [...edges, edge('x1', 'g1', 'g2'), edge('x2', 'student', 'course'), edge('x3', 'memo', 'student'), edge('x4', 'ghost', 'student')];
    const bound = extractBound(extra, extraEdges);
    // 외톨이, 묶음 둘, 빈 원 + 엔티티끼리의 선, 메모에 붙은 선(끝이 없는 선은 세지 않는다)
    expect(bound.skipped).toBe(6);
    expect(bound.model).toEqual({ ...extractModel(nodes, edges).model, notes: ['메모'] });
    for (const id of ['lonely', 'g1', 'g2', 'circle']) expect(bound.managedNodeIds.has(id)).toBe(false);
    for (const id of ['x1', 'x2', 'x3', 'x4']) expect(bound.managedEdgeIds.has(id)).toBe(false);
  });

  it('이름이 같은 엔티티는 읽는 순서로 처음 것만 모델에 넣는다', () => {
    const nodes = [node('a1', 'entity', 'A', 0, 0), node('a2', 'entity', 'A', 0, 300), node('x', 'attribute', 'x', 200, 300), node('r', 'relationship', 'R', 300, 0)];
    const edges = [edge('e1', 'a2', 'x'), edge('e2', 'r', 'a1'), edge('e3', 'r', 'a2')];
    const { model, skipped } = extractModel(nodes, edges);
    expect(model.entities).toEqual([{ name: 'A', attributes: [] }]);
    expect(model.relationships[0].participants).toEqual([{ entity: 'A', cardinality: '' }]);
    expect(skipped).toBe(2);
  });

  it('속성끼리 고리를 이루거나 소유자가 둘이어도 한 번씩만 나온다', () => {
    const nodes = [
      node('a', 'entity', 'A', 0, 300),
      node('b', 'entity', 'B', 800, 300),
      node('p', 'attribute', 'p', 200, 100),
      node('q', 'attribute', 'q', 400, 100),
      node('r', 'attribute', 'r', 300, 0),
    ];
    const edges = [edge('e1', 'a', 'p'), edge('e2', 'p', 'q'), edge('e3', 'q', 'r'), edge('e4', 'r', 'p'), edge('e5', 'b', 'q'), edge('e6', 'a', 'p')];
    const bound = extractBound(nodes, edges);
    const names: string[] = [];
    const walk = (list: typeof bound.entities[number]['attributes']) => {
      for (const attr of list) {
        names.push(attr.model.name);
        walk(attr.parts);
      }
    };
    for (const e of bound.entities) walk(e.attributes);
    expect(names.sort()).toEqual(['p', 'q', 'r']);
    // A가 p를, B가 q를 가진다. r은 둘 중 하나의 하위이고, 고리를 닫는 선들과 겹친 선은 빠진다
    expect(bound.model.entities.map((e) => e.attributes.map((x) => x.name))).toEqual([['p'], ['q']]);
    expect(bound.skipped).toBe(3);
  });

  it('같은 두 도형 사이의 선은 허용 개수까지만 본다', () => {
    const nodes = [node('a', 'entity', 'A', 0, 300), node('r', 'relationship', 'R', 300, 300)];
    const edges = [edge('e1', 'r', 'a', { label: '1' }), edge('e2', 'r', 'a', { label: '2' }), edge('e3', 'r', 'a', { label: '3' })];
    const { model, skipped } = extractModel(nodes, edges);
    expect(model.relationships[0].participants.map((p) => p.cardinality)).toEqual(['1', '2']);
    expect(skipped).toBe(1);
  });

  it('derived 플래그는 모델에 나타나지 않는다', () => {
    const nodes = [node('a', 'entity', 'A', 0, 300), node('x', 'attribute', '나이', 0, 100, { derived: true, keyType: 'none' })];
    expect(extractModel(nodes, [edge('e', 'a', 'x')]).model.entities[0].attributes).toEqual([{ name: '나이' }]);
  });
});

describe('diagramToText', () => {
  it('빠진 도형이 있으면 끝에 주석 한 줄을 붙인다', () => {
    const { nodes, edges } = enrollment();
    expect(diagramToText(nodes, edges)).not.toContain('#');
    const one = diagramToText([...nodes, node('lonely', 'attribute', '외톨이', 900, 900)], edges);
    expect(one.endsWith('\n# 1 shape is not shown here (e.g. unconnected attributes); push leaves them untouched\n')).toBe(true);
    const two = diagramToText([...nodes, node('l1', 'attribute', 'a', 900, 900), node('l2', 'spec', '', 900, 700)], edges);
    expect(two).toContain('# 2 shapes are not shown here');
    // 주석이 붙어도 다시 읽을 수 있다
    expect(parseModel(two)).toEqual(extractModel(nodes, edges).model);
    expect(diagramToText([node('l1', 'attribute', 'a', 0, 0)], [])).toBe('# 1 shape is not shown here (e.g. unconnected attributes); push leaves them untouched\n');
  });

  it('빈 다이어그램은 빈 글이다', () => {
    expect(diagramToText([], [])).toBe('');
  });
});
