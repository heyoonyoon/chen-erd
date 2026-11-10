import { describe, expect, it } from 'vitest';
import { canConnect, defaultEdgeProps, edgeCanBeDouble, edgeHasCardinality, specRoles, validateDiagram } from './rules';
import type { ErdEdge, ErdNode, Issue, NodeKind } from './types';

// ───────────────────────── 테스트용 도형 만들기 ─────────────────────────

function node(kind: NodeKind, id: string, text: string, extra: Partial<ErdNode> = {}): ErdNode {
  return { id, kind, x: 0, y: 0, w: 120, h: 50, text, ...extra };
}
const entity = (id: string, text = id, extra: Partial<ErdNode> = {}) => node('entity', id, text, extra);
const weak = (id: string, text = id, extra: Partial<ErdNode> = {}) => node('entity', id, text, { weak: true, ...extra });
const rel = (id: string, text = id, extra: Partial<ErdNode> = {}) => node('relationship', id, text, extra);
const identifying = (id: string, text = id) => node('relationship', id, text, { identifying: true });
const attr = (id: string, text = id, extra: Partial<ErdNode> = {}) => node('attribute', id, text, extra);
const key = (id: string, text = id) => attr(id, text, { keyType: 'key' });
const partialKey = (id: string, text = id) => attr(id, text, { keyType: 'partial' });
const spec = (id: string, extra: Partial<ErdNode> = {}) => node('spec', id, '', { specType: 'd', w: 34, h: 34, ...extra });
const note = (id: string, text = id) => node('note', id, text);

let edgeSeq = 0;
function edge(source: string, target: string, extra: Partial<ErdEdge> = {}): ErdEdge {
  return { id: `e${++edgeSeq}:${source}-${target}`, source, target, double: false, label: '', role: '', ...extra };
}

const ids = (issues: Issue[]) => issues.map((i) => i.id);
const byRule = (issues: Issue[], rule: string) => issues.filter((i) => i.id.startsWith(`${rule}:`));

// ───────────────────────── 수업 예시(올바른 다이어그램) ─────────────────────────

/** TEAM 1 —has— M PLAYER */
function teamPlayer() {
  const nodes = [entity('TEAM'), key('Team_ID'), entity('PLAYER'), key('Player_ID'), attr('Player_name'), rel('has')];
  const edges = [
    edge('Team_ID', 'TEAM'),
    edge('PLAYER', 'Player_ID'),
    edge('Player_name', 'PLAYER'),
    edge('TEAM', 'has', { label: '1' }),
    edge('has', 'PLAYER', { label: 'M' }),
  ];
  return { nodes, edges };
}

/** Order —Contains(식별 관계)— Order_line(약한 엔티티) */
function orderLine() {
  const nodes = [
    entity('Order'),
    key('Order_ID'),
    identifying('Contains'),
    weak('Order_line'),
    partialKey('Line_no'),
    attr('Quantity'),
    attr('Unit_price'),
    attr('Amount', 'Amount', { derived: true }),
  ];
  const edges = [
    edge('Order', 'Order_ID'),
    edge('Order', 'Contains', { label: '1' }),
    edge('Contains', 'Order_line', { label: 'M', double: true }),
    edge('Order_line', 'Line_no'),
    edge('Order_line', 'Quantity'),
    edge('Order_line', 'Unit_price'),
    edge('Order_line', 'Amount'),
  ];
  return { nodes, edges };
}

/** Person → (o) → Student/Alumnus/Employee, 그리고 Employee —Supervises 재귀 관계 */
function personSpecialization() {
  const nodes = [
    entity('Person', 'Person', { x: 200, y: 0 }),
    key('SSN'),
    attr('Name'),
    attr('First_name'),
    attr('Last_name'),
    attr('Phone', 'Phone', { multivalued: true }),
    spec('o', { specType: 'o', x: 243, y: 120 }),
    entity('Student', 'Student', { x: 0, y: 220 }),
    entity('Alumnus', 'Alumnus', { x: 200, y: 220 }),
    entity('Employee', 'Employee', { x: 400, y: 220 }),
    attr('Salary'),
    rel('Supervises'),
    rel('Enrolls'),
    entity('Course'),
    key('Course_no'),
    attr('Grade'),
  ];
  const edges = [
    edge('Person', 'SSN'),
    edge('Person', 'Name'),
    edge('Name', 'First_name'),
    edge('Name', 'Last_name'),
    edge('Person', 'Phone'),
    edge('Person', 'o', { double: true }),
    edge('o', 'Student'),
    edge('o', 'Alumnus'),
    edge('o', 'Employee'),
    edge('Employee', 'Salary'),
    edge('Employee', 'Supervises', { label: '1', role: 'supervisor' }),
    edge('Employee', 'Supervises', { label: 'M', role: 'supervisee' }),
    edge('Student', 'Enrolls', { label: 'M' }),
    edge('Enrolls', 'Course', { label: 'N', double: true }),
    edge('Course', 'Course_no'),
    edge('Enrolls', 'Grade'),
  ];
  return { nodes, edges };
}

function classExample() {
  const parts = [teamPlayer(), orderLine(), personSpecialization()];
  return { nodes: parts.flatMap((p) => p.nodes), edges: parts.flatMap((p) => p.edges), parts };
}

// ───────────────────────── canConnect ─────────────────────────

describe('canConnect', () => {
  const samples: Record<NodeKind, ErdNode> = {
    entity: entity('E'),
    relationship: rel('R'),
    attribute: attr('A'),
    spec: spec('S'),
    note: note('N'),
  };
  const kinds = Object.keys(samples) as NodeKind[];
  const other = (kind: NodeKind) => ({ ...samples[kind], id: `${samples[kind].id}2` });

  const allowed: Array<[NodeKind, NodeKind]> = [
    ['entity', 'relationship'],
    ['attribute', 'entity'],
    ['attribute', 'relationship'],
    ['attribute', 'attribute'],
    ['entity', 'spec'],
  ];

  it.each(allowed)('%s와 %s는 양방향 모두 연결할 수 있다', (a, b) => {
    expect(canConnect(samples[a], other(b), [])).toEqual({ ok: true });
    expect(canConnect(other(b), samples[a], [])).toEqual({ ok: true });
  });

  const forbidden: Array<[NodeKind, NodeKind, string]> = [
    ['entity', 'entity', '엔티티끼리는 관계(마름모)를 거쳐 연결합니다'],
    ['relationship', 'relationship', '관계끼리는 직접 연결할 수 없습니다'],
    ['spec', 'relationship', '특수화 원은 관계가 아니라 엔티티(슈퍼타입, 서브타입)와 연결합니다'],
    ['spec', 'attribute', '특수화 원에는 속성을 달 수 없습니다'],
    ['spec', 'spec', '특수화 원끼리는 연결할 수 없습니다'],
    ['note', 'entity', '메모는 다른 도형과 선으로 연결할 수 없습니다'],
    ['note', 'relationship', '메모는 다른 도형과 선으로 연결할 수 없습니다'],
    ['note', 'attribute', '메모는 다른 도형과 선으로 연결할 수 없습니다'],
    ['note', 'spec', '메모는 다른 도형과 선으로 연결할 수 없습니다'],
    ['note', 'note', '메모는 다른 도형과 선으로 연결할 수 없습니다'],
  ];

  it.each(forbidden)('%s와 %s는 양방향 모두 연결할 수 없고 이유를 알려 준다', (a, b, reason) => {
    expect(canConnect(samples[a], other(b), [])).toEqual({ ok: false, reason });
    expect(canConnect(other(b), samples[a], [])).toEqual({ ok: false, reason });
  });

  it('모든 종류 조합이 허용 5쌍과 불가 10쌍으로 빠짐없이 나뉜다', () => {
    const pairKey = (a: NodeKind, b: NodeKind) => [a, b].sort().join('+');
    const allowedKeys = new Set(allowed.map(([a, b]) => pairKey(a, b)));
    const forbiddenKeys = new Set(forbidden.map(([a, b]) => pairKey(a, b)));
    expect(allowedKeys.size + forbiddenKeys.size).toBe(15);
    for (const a of kinds) {
      for (const b of kinds) {
        const result = canConnect(samples[a], other(b), []);
        expect(result.ok).toBe(allowedKeys.has(pairKey(a, b)));
        expect(forbiddenKeys.has(pairKey(a, b))).toBe(!result.ok);
      }
    }
  });

  it('자기 자신과는 연결할 수 없다', () => {
    for (const kind of kinds) {
      expect(canConnect(samples[kind], samples[kind], [])).toEqual({ ok: false, reason: '자기 자신과는 연결할 수 없습니다' });
    }
  });

  it('이유는 모두 한 문장이다', () => {
    for (const a of kinds) {
      for (const b of kinds) {
        const { ok, reason } = canConnect(samples[a], other(b), []);
        if (ok) continue;
        expect(reason).toBeTruthy();
        expect(reason).not.toMatch(/[.!?]/);
        expect(reason).toMatch(/니다$/);
      }
    }
  });

  it('같은 쌍 사이에 이미 선이 있으면 방향과 관계없이 막는다', () => {
    const [a, e, s, sub] = [attr('a'), entity('e'), spec('s'), attr('sub')];
    for (const [x, y] of [[a, e], [e, s], [a, sub]] as Array<[ErdNode, ErdNode]>) {
      const edges = [edge(x.id, y.id)];
      expect(canConnect(x, y, edges)).toEqual({ ok: false, reason: '두 도형은 이미 연결되어 있습니다' });
      expect(canConnect(y, x, edges)).toEqual({ ok: false, reason: '두 도형은 이미 연결되어 있습니다' });
    }
  });

  it('엔티티와 관계 사이는 재귀 관계를 위해 2개까지 허용한다', () => {
    const [e, r] = [entity('Employee'), rel('Supervises')];
    const one = [edge('Employee', 'Supervises')];
    expect(canConnect(e, r, one).ok).toBe(true);
    expect(canConnect(r, e, one).ok).toBe(true);
    // 두 번째 선을 반대 방향으로 그렸어도 같은 쌍으로 센다
    const two = [...one, edge('Supervises', 'Employee')];
    const expected = { ok: false, reason: '같은 엔티티와 관계 사이에는 선을 2개까지만 그을 수 있습니다' };
    expect(canConnect(e, r, two)).toEqual(expected);
    expect(canConnect(r, e, two)).toEqual(expected);
  });

  it('다른 쌍의 선은 중복으로 세지 않는다', () => {
    const edges = [edge('E', 'R'), edge('E', 'R'), edge('A', 'E')];
    expect(canConnect(entity('E'), rel('R2'), edges).ok).toBe(true);
    expect(canConnect(attr('A2'), entity('E'), edges).ok).toBe(true);
  });

  describe('속성의 소유자는 하나(nodes를 넘겼을 때)', () => {
    const nodes = [entity('E1'), entity('E2'), rel('R'), attr('A'), attr('B'), attr('C'), attr('D')];
    const get = (id: string) => nodes.find((n) => n.id === id)!;
    const check = (a: string, b: string, edges: ErdEdge[], lookup: ErdNode[] | Map<string, ErdNode> = nodes) => {
      const forward = canConnect(get(a), get(b), edges, lookup);
      const backward = canConnect(get(b), get(a), edges, lookup);
      expect(backward).toEqual(forward);
      return forward;
    };

    it('이미 엔티티에 붙은 속성은 다른 엔티티나 관계에 연결할 수 없다', () => {
      const edges = [edge('A', 'E1')];
      expect(check('A', 'E2', edges)).toEqual({
        ok: false,
        reason: "이 속성은 이미 'E1' 엔티티에 연결되어 있어 다른 곳에 또 연결할 수 없습니다",
      });
      expect(check('A', 'R', edges).ok).toBe(false);
    });

    it('이미 관계에 붙은 속성은 엔티티에 연결할 수 없다', () => {
      const result = check('A', 'E1', [edge('R', 'A')]);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("'R' 관계");
    });

    it('소유자가 있는 속성에 하위 속성을 다는 것은 허용한다', () => {
      const edges = [edge('A', 'E1')];
      expect(check('A', 'B', edges)).toEqual({ ok: true });
      expect(check('A', 'C', [...edges, edge('A', 'B')])).toEqual({ ok: true });
      // 하위 속성의 하위 속성
      expect(check('B', 'C', [...edges, edge('A', 'B')])).toEqual({ ok: true });
    });

    it('아직 어디에도 붙지 않은 속성 묶음은 엔티티에 연결할 수 있다', () => {
      expect(check('A', 'E1', [edge('A', 'B'), edge('A', 'C')])).toEqual({ ok: true });
      expect(check('A', 'E1', [])).toEqual({ ok: true });
    });

    it('복합 속성의 하위 속성은 엔티티나 관계에 따로 연결할 수 없다', () => {
      const edges = [edge('A', 'E1'), edge('A', 'B')];
      expect(check('B', 'E2', edges)).toEqual({
        ok: false,
        reason: "이 속성은 'E1' 엔티티의 복합 속성에 속해 있어 따로 연결할 수 없습니다",
      });
      expect(check('B', 'E1', edges).ok).toBe(false);
      expect(check('B', 'R', edges).ok).toBe(false);
    });

    it('한 속성이 상위 속성을 둘 가지게 되는 연결은 막는다', () => {
      // A와 B가 각각 엔티티에 붙어 있고 C는 A의 하위 속성. C를 B에도 달 수 없다.
      const edges = [edge('A', 'E1'), edge('B', 'E1'), edge('A', 'C')];
      expect(check('B', 'C', edges)).toEqual({
        ok: false,
        reason: '두 속성이 각각 이미 엔티티나 관계에 속해 있어 복합 속성으로 이을 수 없습니다',
      });
      // 서로 다른 엔티티의 속성끼리도 이을 수 없다
      expect(check('A', 'D', [edge('A', 'E1'), edge('D', 'E2')]).ok).toBe(false);
    });

    it('속성끼리 고리가 생기는 연결은 막는다', () => {
      const edges = [edge('A', 'B'), edge('B', 'C')];
      expect(check('A', 'C', edges)).toEqual({ ok: false, reason: '두 속성은 이미 같은 복합 속성으로 이어져 있습니다' });
    });

    it('nodes는 Map으로 넘겨도 된다', () => {
      const map = new Map(nodes.map((n) => [n.id, n]));
      expect(check('A', 'E2', [edge('A', 'E1')], map).ok).toBe(false);
      expect(check('A', 'B', [edge('A', 'E1')], map).ok).toBe(true);
    });

    it('nodes가 없으면 소유자를 알 수 없으므로 이 규칙은 건너뛴다', () => {
      expect(canConnect(get('A'), get('E2'), [edge('A', 'E1')])).toEqual({ ok: true });
    });
  });

  it('도형 종류, 기존 선, 방향을 바꿔 가며 대칭성을 확인한다', () => {
    const flagged: ErdNode[] = [
      entity('e1'), weak('e2'), rel('r1'), identifying('r2'), attr('a1'), key('a2'), attr('a3'), spec('s1'), spec('s2'), note('n1'),
    ];
    const edgeSets: ErdEdge[][] = [
      [],
      [edge('e1', 'r1'), edge('a1', 'e1'), edge('a2', 'a3'), edge('s1', 'e1')],
      [edge('r1', 'e1'), edge('e1', 'r1'), edge('a1', 'r2'), edge('a1', 'a2'), edge('a3', 'e2'), edge('e2', 's2')],
    ];
    for (const edges of edgeSets) {
      for (const a of flagged) {
        for (const b of flagged) {
          expect(canConnect(a, b, edges)).toEqual(canConnect(b, a, edges));
          expect(canConnect(a, b, edges, flagged)).toEqual(canConnect(b, a, edges, flagged));
        }
      }
    }
  });
});

// ───────────────────────── 선의 기본 속성 ─────────────────────────

describe('defaultEdgeProps', () => {
  it('약한 엔티티와 식별 관계 사이는 이중선이다(방향 무관)', () => {
    expect(defaultEdgeProps(weak('w'), identifying('i'))).toEqual({ double: true, label: '', role: '' });
    expect(defaultEdgeProps(identifying('i'), weak('w'))).toEqual({ double: true, label: '', role: '' });
  });

  it('그 외에는 단선이고 label과 role은 비어 있다', () => {
    const single = { double: false, label: '', role: '' };
    const cases: Array<[ErdNode, ErdNode]> = [
      [entity('e'), rel('r')],
      [entity('e'), identifying('i')],
      [weak('w'), rel('r')],
      [weak('w'), attr('a')],
      [identifying('i'), attr('a')],
      [weak('w'), spec('s')],
      [entity('e'), spec('s')],
      [attr('a'), attr('b')],
    ];
    for (const [a, b] of cases) {
      expect(defaultEdgeProps(a, b)).toEqual(single);
      expect(defaultEdgeProps(b, a)).toEqual(single);
    }
  });
});

describe('edgeHasCardinality, edgeCanBeDouble', () => {
  const samples = [entity('e'), weak('w'), rel('r'), identifying('i'), attr('a'), spec('s'), note('n')];

  it('카디널리티는 엔티티와 관계 사이의 선에만 의미가 있다', () => {
    for (const a of samples) {
      for (const b of samples) {
        const kinds = [a.kind, b.kind].sort().join('+');
        expect(edgeHasCardinality(a, b)).toBe(kinds === 'entity+relationship');
      }
    }
  });

  it('이중선은 엔티티와 관계, 엔티티와 특수화 원 사이에만 의미가 있다', () => {
    for (const a of samples) {
      for (const b of samples) {
        const kinds = [a.kind, b.kind].sort().join('+');
        expect(edgeCanBeDouble(a, b)).toBe(kinds === 'entity+relationship' || kinds === 'entity+spec');
      }
    }
    expect(edgeCanBeDouble(attr('a'), entity('e'))).toBe(false);
    expect(edgeCanBeDouble(attr('a'), rel('r'))).toBe(false);
    expect(edgeCanBeDouble(attr('a'), attr('b'))).toBe(false);
  });
});

// ───────────────────────── specRoles ─────────────────────────

describe('specRoles', () => {
  const circle = spec('c', { x: 200, y: 200 }); // 중심 (217, 217)
  const at = (id: string, x: number, y: number) => entity(id, id, { x, y, w: 100, h: 40 });

  it('이중선으로 연결된 엔티티가 정확히 하나면 위치와 관계없이 슈퍼타입이다', () => {
    const nodes = [circle, at('top', 170, 0), at('left', 0, 400), at('right', 400, 400)];
    const edges = [edge('top', 'c'), edge('c', 'left', { double: true }), edge('right', 'c')];
    const roles = specRoles(circle, nodes, edges);
    expect(roles.supertype?.id).toBe('left');
    expect(roles.subtypes.map((n) => n.id)).toEqual(['top', 'right']);
  });

  it('이중선이 없으면 원보다 위에 있는 엔티티 중 가장 가까운 것이 슈퍼타입이다', () => {
    const nodes = [circle, at('far', 170, -300), at('near', 170, 100), at('below', 170, 230)];
    const edges = [edge('far', 'c'), edge('near', 'c'), edge('below', 'c')];
    const roles = specRoles(circle, nodes, edges);
    expect(roles.supertype?.id).toBe('near');
    expect(roles.subtypes.map((n) => n.id).sort()).toEqual(['below', 'far']);
  });

  it('이중선이 둘 이상이어도 위치로 정한다', () => {
    const nodes = [circle, at('up', 170, 50), at('down1', 0, 400), at('down2', 400, 400)];
    const edges = [edge('up', 'c'), edge('down1', 'c', { double: true }), edge('down2', 'c', { double: true })];
    expect(specRoles(circle, nodes, edges).supertype?.id).toBe('up');
  });

  it('위에 있는 엔티티가 없으면 가장 위에 있는 것이 슈퍼타입이다', () => {
    const nodes = [circle, at('a', 0, 400), at('b', 200, 300), at('c2', 400, 500)];
    const edges = [edge('a', 'c'), edge('b', 'c'), edge('c2', 'c')];
    const roles = specRoles(circle, nodes, edges);
    expect(roles.supertype?.id).toBe('b');
    expect(roles.subtypes.map((n) => n.id)).toEqual(['a', 'c2']);
  });

  it('서브타입은 왼쪽에서 오른쪽 순서로 준다', () => {
    const nodes = [circle, at('sup', 170, 0), at('z', 0, 400), at('m', 200, 400), at('a', 400, 400)];
    const edges = [edge('a', 'c'), edge('m', 'c'), edge('sup', 'c'), edge('z', 'c')];
    expect(specRoles(circle, nodes, edges).subtypes.map((n) => n.id)).toEqual(['z', 'm', 'a']);
  });

  it('연결된 엔티티가 없으면 슈퍼타입이 null이다', () => {
    expect(specRoles(circle, [circle, at('x', 0, 0)], [])).toEqual({ supertype: null, subtypes: [] });
  });

  it('엔티티가 아닌 도형과 다른 원의 선은 무시하고, 같은 엔티티의 겹친 선은 한 번만 센다', () => {
    const other = spec('c9', { x: 600, y: 200 });
    const nodes = [circle, other, at('sup', 170, 0), at('sub', 170, 400), at('elsewhere', 600, 0), attr('stray')];
    const edges = [edge('sup', 'c'), edge('sup', 'c'), edge('sub', 'c'), edge('elsewhere', 'c9'), edge('stray', 'c'), edge('c', 'ghost')];
    const roles = specRoles(circle, nodes, edges);
    expect(roles.supertype?.id).toBe('sup');
    expect(roles.subtypes.map((n) => n.id)).toEqual(['sub']);
  });

  it('선의 방향과 노드/엣지 순서가 달라도 결과가 같다', () => {
    const nodes = [circle, at('p', 170, 0), at('s1', 0, 400), at('s2', 400, 400)];
    const edges = [edge('p', 'c'), edge('s1', 'c'), edge('s2', 'c')];
    const flipped = edges.map((e) => ({ ...e, source: e.target, target: e.source })).reverse();
    const a = specRoles(circle, nodes, edges);
    const b = specRoles(circle, new Map([...nodes].reverse().map((n) => [n.id, n])), flipped);
    expect(b.supertype?.id).toBe(a.supertype?.id);
    expect(b.subtypes.map((n) => n.id)).toEqual(a.subtypes.map((n) => n.id));
  });
});

// ───────────────────────── validateDiagram ─────────────────────────

describe('validateDiagram: 수업 예시', () => {
  it('TEAM 1 —has— M PLAYER는 문제가 없다', () => {
    const { nodes, edges } = teamPlayer();
    expect(validateDiagram(nodes, edges)).toEqual([]);
  });

  it('Order —Contains(식별 관계)— Order_line(약한 엔티티)는 문제가 없다', () => {
    const { nodes, edges } = orderLine();
    expect(validateDiagram(nodes, edges)).toEqual([]);
  });

  it('Person → (o) → Student/Alumnus/Employee와 Employee —Supervises 재귀 관계는 문제가 없다', () => {
    const { nodes, edges } = personSpecialization();
    expect(validateDiagram(nodes, edges)).toEqual([]);
  });

  it('세 예시를 한 다이어그램에 모아도 문제가 0개다', () => {
    const { nodes, edges } = classExample();
    expect(validateDiagram(nodes, edges)).toEqual([]);
  });

  it('수업 예시의 모든 선은 canConnect를 통과하는 순서로 그릴 수 있다', () => {
    const { nodes, edges } = classExample();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const drawn: ErdEdge[] = [];
    for (const e of edges) {
      const [s, t] = [byId.get(e.source)!, byId.get(e.target)!];
      expect(canConnect(s, t, drawn, nodes), `${e.source} - ${e.target}`).toEqual({ ok: true });
      expect(canConnect(t, s, drawn, byId)).toEqual({ ok: true });
      drawn.push(e);
    }
  });

  it('빈 다이어그램은 문제가 없다', () => {
    expect(validateDiagram([], [])).toEqual([]);
  });

  it('메모는 검사하지 않는다', () => {
    expect(validateDiagram([note('n', ''), note('n2', '설명')], [])).toEqual([]);
  });
});

describe('validateDiagram: error', () => {
  it('어디에도 연결되지 않은 속성', () => {
    const base = teamPlayer();
    const issues = validateDiagram([...base.nodes, attr('lonely', 'Age')], base.edges);
    expect(issues).toEqual([
      { id: 'attribute-unconnected:lonely', severity: 'error', message: "'Age' 속성이 어디에도 연결되어 있지 않습니다", elementIds: ['lonely'] },
    ]);
  });

  it('서로만 이어지고 엔티티나 관계에 붙지 않은 속성 묶음', () => {
    const base = teamPlayer();
    const issues = validateDiagram([...base.nodes, attr('n1', 'Name'), attr('n2', 'First')], [...base.edges, edge('n1', 'n2')]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ id: 'attribute-unowned:n1', severity: 'error', elementIds: ['n1', 'n2'] });
    expect(issues[0].message).toBe("'Name', 'First' 속성이 서로만 이어져 있고 엔티티나 관계에는 연결되어 있지 않습니다");
  });

  it('관계에 연결된 엔티티 선이 2개 미만', () => {
    const one = validateDiagram([entity('E'), key('K'), rel('R', 'works')], [edge('E', 'K'), edge('E', 'R', { label: '1' })]);
    expect(one).toEqual([
      {
        id: 'relationship-degree:R',
        severity: 'error',
        message: "'works' 관계는 엔티티와 선 2개 이상으로 이어져야 합니다(현재 1개)",
        elementIds: ['R'],
      },
    ]);
    const none = validateDiagram([rel('R', 'works'), attr('since')], [edge('R', 'since')]);
    expect(byRule(none, 'relationship-degree')[0].message).toContain('현재 0개');
  });

  it('재귀 관계는 같은 엔티티와 선 2개로 이어지므로 오류가 아니다', () => {
    const nodes = [entity('Employee'), key('Emp_ID'), rel('Supervises')];
    const edges = [edge('Employee', 'Emp_ID'), edge('Employee', 'Supervises', { label: '1' }), edge('Supervises', 'Employee', { label: 'M' })];
    expect(validateDiagram(nodes, edges)).toEqual([]);
  });

  it('약한 엔티티가 식별 관계에 연결되지 않음', () => {
    // 일반 관계에만 연결된 약한 엔티티
    const nodes = [entity('Order'), key('Order_ID'), rel('Contains'), weak('Order_line'), partialKey('Line_no')];
    const edges = [
      edge('Order', 'Order_ID'),
      edge('Order', 'Contains', { label: '1' }),
      edge('Contains', 'Order_line', { label: 'M', double: true }),
      edge('Order_line', 'Line_no'),
    ];
    expect(validateDiagram(nodes, edges)).toEqual([
      {
        id: 'weak-no-identifying:Order_line',
        severity: 'error',
        message: "'Order_line' 약한 엔티티가 식별 관계(이중 마름모)에 연결되어 있지 않습니다",
        elementIds: ['Order_line'],
      },
    ]);
  });

  it('특수화 원에 연결된 엔티티가 2개 미만', () => {
    const lone = validateDiagram([spec('s')], []);
    expect(lone).toEqual([
      {
        id: 'spec-degree:s',
        severity: 'error',
        message: '특수화 원(d)에는 슈퍼타입과 서브타입을 합쳐 엔티티가 2개 이상 연결되어야 합니다(현재 0개)',
        elementIds: ['s'],
      },
    ]);
    // 같은 엔티티에 선이 두 개여도 엔티티는 하나로 센다
    const single = validateDiagram([entity('P'), key('K'), spec('s')], [edge('P', 'K'), edge('P', 's')]);
    expect(ids(single)).toEqual(['spec-degree:s']);
    expect(single[0].message).toContain('현재 1개');
  });

  it('양 끝 노드가 없는 선', () => {
    const base = teamPlayer();
    const half: ErdEdge = { id: 'half', source: 'TEAM', target: 'gone', double: false, label: '', role: '' };
    const none: ErdEdge = { id: 'none', source: 'gone1', target: 'gone2', double: false, label: '', role: '' };
    expect(validateDiagram(base.nodes, [...base.edges, half, none])).toEqual([
      { id: 'edge-dangling:half', severity: 'error', message: "'TEAM' 엔티티에서 나온 선의 반대쪽 끝에 도형이 없습니다", elementIds: ['half', 'TEAM'] },
      { id: 'edge-dangling:none', severity: 'error', message: '양 끝에 도형이 없는 선이 있습니다', elementIds: ['none'] },
    ]);
  });

  it('끝이 없는 선은 연결로 치지 않는다', () => {
    const issues = validateDiagram([attr('a')], [{ id: 'x', source: 'a', target: 'gone', double: false, label: '', role: '' }]);
    expect(ids(issues)).toEqual(['edge-dangling:x', 'attribute-unconnected:a']);
  });

  it('표기법상 이을 수 없는 도형끼리 이어진 선(가져온 파일 등)', () => {
    const base = teamPlayer();
    const bad = edge('TEAM', 'PLAYER');
    const issues = validateDiagram(base.nodes, [...base.edges, bad]);
    expect(issues).toEqual([
      {
        id: `edge-invalid:${bad.id}`,
        severity: 'error',
        message: "'TEAM' 엔티티와 'PLAYER' 엔티티가 선으로 이어져 있습니다. 엔티티끼리는 관계(마름모)를 거쳐 연결합니다",
        elementIds: [bad.id, 'TEAM', 'PLAYER'],
      },
    ]);
    const loop = edge('TEAM', 'TEAM');
    expect(ids(validateDiagram(base.nodes, [...base.edges, loop]))).toEqual([`edge-self:${loop.id}`]);
  });

  it('같은 쌍 사이에 겹친 선', () => {
    const base = teamPlayer();
    const dupAttr = validateDiagram(base.nodes, [...base.edges, edge('TEAM', 'Team_ID')]);
    expect(ids(dupAttr)).toEqual(['edge-duplicate:TEAM|Team_ID']);
    expect(dupAttr[0].elementIds).toHaveLength(2);

    const twoToRel = validateDiagram(base.nodes, [...base.edges, edge('TEAM', 'has', { label: '1' })]);
    expect(byRule(twoToRel, 'edge-duplicate')).toEqual([]);
    const threeToRel = validateDiagram(base.nodes, [...base.edges, edge('TEAM', 'has', { label: '1' }), edge('has', 'TEAM', { label: '1' })]);
    expect(ids(threeToRel)).toEqual(['edge-duplicate:TEAM|has']);
    expect(threeToRel[0].message).toContain('3개');
  });

  it('둘 이상의 엔티티나 관계에 연결된 속성', () => {
    const base = teamPlayer();
    const direct = validateDiagram(base.nodes, [...base.edges, edge('Player_name', 'TEAM')]);
    expect(ids(direct)).toEqual(['attribute-multi-owner:Player_name']);
    expect(direct[0].message).toContain("'PLAYER' 엔티티, 'TEAM' 엔티티");

    // 복합 속성의 하위 속성이 다른 곳에도 붙은 경우
    const viaChild = validateDiagram([...base.nodes, attr('First')], [...base.edges, edge('Player_name', 'First'), edge('First', 'has')]);
    expect(ids(viaChild)).toEqual(['attribute-multi-owner:First']);
    expect(viaChild[0].elementIds.sort()).toEqual(['First', 'Player_name']);
  });

  it('고리 모양으로 이어진 속성', () => {
    const base = teamPlayer();
    const nodes = [...base.nodes, attr('x'), attr('y')];
    const edges = [...base.edges, edge('Player_name', 'x'), edge('x', 'y'), edge('y', 'Player_name')];
    expect(ids(validateDiagram(nodes, edges))).toEqual(['attribute-cycle:Player_name']);
  });
});

describe('validateDiagram: warning', () => {
  it('이름이 빈 도형(spec, note 제외)', () => {
    const nodes = [
      entity('E', '  '),
      key('K', ''),
      rel('R', '\n'),
      entity('F'),
      key('FK'),
      spec('s'),
      entity('G'),
      note('n', ''),
    ];
    const edges = [
      edge('E', 'K'),
      edge('E', 'R', { label: '1' }),
      edge('R', 'F', { label: 'N' }),
      edge('F', 'FK'),
      edge('F', 's', { double: true }),
      edge('s', 'G'),
      edge('s', 'E'),
    ];
    const issues = validateDiagram(nodes, edges);
    expect(issues.map((i) => [i.id, i.severity, i.message])).toEqual([
      ['empty-name:E', 'warning', '이름이 비어 있는 엔티티가 있습니다'],
      ['empty-name:K', 'warning', '이름이 비어 있는 속성이 있습니다'],
      ['empty-name:R', 'warning', '이름이 비어 있는 관계가 있습니다'],
    ]);
  });

  it('같은 이름의 엔티티가 둘 이상(대소문자와 앞뒤 공백 무시)', () => {
    const a = teamPlayer();
    const nodes = [...a.nodes, entity('TEAM2', ' team '), key('T2K'), rel('owns')];
    const edges = [...a.edges, edge('TEAM2', 'T2K'), edge('TEAM2', 'owns', { label: '1' }), edge('owns', 'PLAYER', { label: 'N' })];
    expect(validateDiagram(nodes, edges)).toEqual([
      { id: 'duplicate-entity-name:team', severity: 'warning', message: "'TEAM' 이름의 엔티티가 2개 있습니다", elementIds: ['TEAM', 'TEAM2'] },
    ]);
  });

  it('이름이 빈 엔티티끼리는 같은 이름으로 치지 않는다', () => {
    const issues = validateDiagram([entity('a', ''), entity('b', '')], []);
    expect(byRule(issues, 'duplicate-entity-name')).toEqual([]);
  });

  it('일반 엔티티에 식별자(키 속성)가 없음', () => {
    const base = teamPlayer();
    const edges = base.edges.filter((e) => e.target !== 'Player_ID');
    const nodes = base.nodes.filter((n) => n.id !== 'Player_ID');
    expect(validateDiagram(nodes, edges)).toEqual([
      { id: 'entity-no-key:PLAYER', severity: 'warning', message: "'PLAYER' 엔티티에 식별자(키 속성)가 없습니다", elementIds: ['PLAYER'] },
    ]);
  });

  it('부분 키만 있는 일반 엔티티는 식별자가 없는 것으로 본다', () => {
    const base = teamPlayer();
    const nodes = base.nodes.map((n) => (n.id === 'Player_ID' ? { ...n, keyType: 'partial' as const } : n));
    expect(ids(validateDiagram(nodes, base.edges))).toEqual(['entity-no-key:PLAYER']);
  });

  it('복합 속성 안의 식별자도 엔티티의 식별자로 인정한다', () => {
    const base = teamPlayer();
    const nodes = [...base.nodes.filter((n) => n.id !== 'Player_ID'), attr('Full_ID'), key('Part')];
    const edges = [...base.edges.filter((e) => e.target !== 'Player_ID'), edge('PLAYER', 'Full_ID'), edge('Full_ID', 'Part')];
    expect(validateDiagram(nodes, edges)).toEqual([]);
  });

  it('서브타입 엔티티는 슈퍼타입의 키를 물려받으므로 식별자가 없어도 경고하지 않는다', () => {
    const { nodes, edges } = personSpecialization();
    const issues = validateDiagram(nodes, edges);
    expect(byRule(issues, 'entity-no-key')).toEqual([]);
    // 슈퍼타입은 식별자가 있어야 한다
    const withoutKey = validateDiagram(
      nodes.filter((n) => n.id !== 'SSN'),
      edges.filter((e) => e.target !== 'SSN'),
    );
    expect(ids(withoutKey)).toEqual(['entity-no-key:Person']);
  });

  it('슈퍼타입 판정이 위치에 따라 바뀌면 식별자 경고 대상도 바뀐다', () => {
    // 이중선 없이 Student가 원 위로 올라가면 Student가 슈퍼타입이 된다
    const { nodes, edges } = personSpecialization();
    const moved = nodes.map((n) => (n.id === 'Student' ? { ...n, y: 60, x: 230 } : n));
    const single = edges.map((e) => (e.target === 'o' ? { ...e, double: false } : e));
    expect(ids(validateDiagram(moved, single))).toEqual(['entity-no-key:Student']);
  });

  it('약한 엔티티는 식별자 대신 부분 키가 없으면 경고한다', () => {
    const base = orderLine();
    const nodes = base.nodes.filter((n) => n.id !== 'Line_no');
    const edges = base.edges.filter((e) => e.target !== 'Line_no');
    expect(validateDiagram(nodes, edges)).toEqual([
      {
        id: 'weak-no-partial-key:Order_line',
        severity: 'warning',
        message: "'Order_line' 약한 엔티티에 부분 키(점선 밑줄 속성)가 없습니다",
        elementIds: ['Order_line'],
      },
    ]);
  });

  it('엔티티와 관계 사이 선에 카디널리티가 없음', () => {
    const base = teamPlayer();
    const edges = base.edges.map((e) => (e.source === 'has' ? { ...e, label: ' ' } : e));
    const target = edges.find((e) => e.source === 'has')!;
    expect(validateDiagram(base.nodes, edges)).toEqual([
      {
        id: `edge-no-cardinality:${target.id}`,
        severity: 'warning',
        message: "'PLAYER' 엔티티와 'has' 관계 사이의 선에 카디널리티(1, M, N)가 없습니다",
        elementIds: [target.id],
      },
    ]);
  });

  it('속성 선과 특수화 선에는 카디널리티를 요구하지 않는다', () => {
    const { nodes, edges } = personSpecialization();
    expect(byRule(validateDiagram(nodes, edges), 'edge-no-cardinality')).toEqual([]);
  });

  it('직접 입력한 카디널리티도 인정한다', () => {
    const base = teamPlayer();
    const edges = base.edges.map((e) => (e.label === 'M' ? { ...e, label: '0..*' } : e));
    expect(validateDiagram(base.nodes, edges)).toEqual([]);
  });

  it('약한 엔티티와 식별 관계 사이가 이중선이 아님', () => {
    const base = orderLine();
    const edges = base.edges.map((e) => (e.target === 'Order_line' ? { ...e, double: false } : e));
    const target = edges.find((e) => e.target === 'Order_line')!;
    expect(validateDiagram(base.nodes, edges)).toEqual([
      {
        id: 'weak-participation:Order_line',
        severity: 'warning',
        message: "'Order_line' 약한 엔티티와 식별 관계 사이의 선이 이중선이 아닙니다. 약한 엔티티는 식별 관계에 전체 참여합니다",
        elementIds: [target.id],
      },
    ]);
  });

  it('약한 엔티티가 다른 약한 엔티티의 소유자일 때는 자기 식별 관계 쪽만 이중선이면 된다', () => {
    const base = orderLine();
    const nodes = [...base.nodes, identifying('Ships'), weak('Shipment'), partialKey('Ship_no')];
    const edges = [
      ...base.edges,
      edge('Order_line', 'Ships', { label: '1' }),
      edge('Ships', 'Shipment', { label: 'M', double: true }),
      edge('Shipment', 'Ship_no'),
    ];
    expect(validateDiagram(nodes, edges)).toEqual([]);
  });

  it('식별 관계에 약한 엔티티가 연결되지 않음', () => {
    const base = teamPlayer();
    const nodes = base.nodes.map((n) => (n.id === 'has' ? { ...n, identifying: true } : n));
    expect(validateDiagram(nodes, base.edges)).toEqual([
      {
        id: 'identifying-no-weak:has',
        severity: 'warning',
        message: "'has' 식별 관계에 약한 엔티티(이중 직사각형)가 연결되어 있지 않습니다",
        elementIds: ['has'],
      },
    ]);
  });

  it('어떤 관계나 특수화에도 연결되지 않은 고립된 엔티티', () => {
    const base = teamPlayer();
    const issues = validateDiagram([...base.nodes, entity('COACH'), key('Coach_ID')], [...base.edges, edge('COACH', 'Coach_ID')]);
    expect(issues).toEqual([
      {
        id: 'entity-isolated:COACH',
        severity: 'warning',
        message: "'COACH' 엔티티가 어떤 관계나 특수화에도 연결되어 있지 않습니다",
        elementIds: ['COACH'],
      },
    ]);
  });

  it('특수화에만 연결된 엔티티는 고립된 것이 아니다', () => {
    const { nodes, edges } = personSpecialization();
    expect(byRule(validateDiagram(nodes, edges), 'entity-isolated')).toEqual([]);
  });

  it('키이면서 다중값이거나 유도인 속성', () => {
    const base = teamPlayer();
    const multi = validateDiagram(
      base.nodes.map((n) => (n.id === 'Team_ID' ? { ...n, multivalued: true } : n)),
      base.edges,
    );
    expect(multi).toEqual([
      {
        id: 'attribute-key-conflict:Team_ID',
        severity: 'warning',
        message: "'Team_ID' 속성이 식별자(키)이면서 다중값 속성으로 표시되어 있습니다. 키는 단일값 저장 속성이어야 합니다",
        elementIds: ['Team_ID'],
      },
    ]);
    const derived = validateDiagram(
      base.nodes.map((n) => (n.id === 'Team_ID' ? { ...n, derived: true } : n)),
      base.edges,
    );
    expect(derived[0].message).toContain('유도 속성으로');

    const order = orderLine();
    const partial = validateDiagram(
      order.nodes.map((n) => (n.id === 'Line_no' ? { ...n, derived: true, multivalued: true } : n)),
      order.edges,
    );
    expect(ids(partial)).toEqual(['attribute-key-conflict:Line_no']);
    expect(partial[0].message).toContain('부분 키이면서 다중값, 유도 속성으로');
  });

  it("keyType이 'none'이거나 없는 다중값, 유도 속성은 경고하지 않는다", () => {
    const base = teamPlayer();
    const nodes = base.nodes.map((n) => (n.id === 'Player_name' ? { ...n, keyType: 'none' as const, multivalued: true, derived: true } : n));
    expect(validateDiagram(nodes, base.edges)).toEqual([]);
  });
});

describe('validateDiagram: 결과 형식', () => {
  const messy = () => {
    const nodes = [entity('E', ''), weak('W'), rel('R'), identifying('I'), attr('A', 'A', { keyType: 'key', derived: true }), spec('S'), entity('E2', 'X'), entity('E3', 'x')];
    const edges = [edge('E', 'R'), edge('W', 'R'), edge('E', 'I'), edge('ghost', 'E'), edge('E2', 'E3')];
    return { nodes, edges };
  };

  it('오류가 경고보다 먼저 온다', () => {
    const { nodes, edges } = messy();
    const severities = validateDiagram(nodes, edges).map((i) => i.severity);
    expect(severities).toContain('error');
    expect(severities).toContain('warning');
    expect(severities.lastIndexOf('error')).toBeLessThan(severities.indexOf('warning'));
  });

  it('id는 겹치지 않고, 노드/엣지 순서나 위치와 무관한 규칙 이름 + 요소 id 형식이다', () => {
    const { nodes, edges } = messy();
    const first = validateDiagram(nodes, edges);
    expect(new Set(ids(first)).size).toBe(first.length);
    for (const issue of first) expect(issue.id).toMatch(/^[a-z-]+:.+$/);
    const again = validateDiagram([...nodes].reverse(), [...edges].reverse());
    expect(ids(again).sort()).toEqual(ids(first).sort());
  });

  it('메시지는 한국어 합니다체이고 elementIds는 실제로 있는 요소만 가리킨다', () => {
    const { nodes, edges } = messy();
    const known = new Set([...nodes.map((n) => n.id), ...edges.map((e) => e.id)]);
    for (const issue of validateDiagram(nodes, edges)) {
      expect(issue.message).toMatch(/니다(\(현재 \d+개\))?$/);
      expect(issue.elementIds.length).toBeGreaterThan(0);
      for (const id of issue.elementIds) expect(known.has(id)).toBe(true);
    }
  });

  it('입력 배열을 바꾸지 않는다', () => {
    const { nodes, edges } = classExample();
    const snapshot = JSON.stringify({ nodes, edges });
    validateDiagram(nodes, edges);
    expect(JSON.stringify({ nodes, edges })).toBe(snapshot);
  });

  it('노드 500개 이상에서도 빠르다', () => {
    const nodes: ErdNode[] = [];
    const edges: ErdEdge[] = [];
    for (let i = 0; i < 120; i++) {
      nodes.push(entity(`E${i}`), key(`K${i}`), attr(`A${i}`), attr(`B${i}`), rel(`R${i}`));
      edges.push(edge(`E${i}`, `K${i}`), edge(`E${i}`, `A${i}`), edge(`A${i}`, `B${i}`), edge(`E${i}`, `R${i}`, { label: '1' }));
      if (i > 0) edges.push(edge(`R${i - 1}`, `E${i}`, { label: 'N' }));
    }
    edges.push(edge('R119', 'E0', { label: 'N' }));
    expect(nodes.length).toBe(600);
    expect(validateDiagram(nodes, edges)).toEqual([]);

    // 다른 작업과 같이 돌아도 흔들리지 않도록 여러 번 중 가장 빠른 값을 본다
    let best = Infinity;
    for (let run = 0; run < 5; run++) {
      const started = performance.now();
      validateDiagram(nodes, edges);
      best = Math.min(best, performance.now() - started);
    }
    expect(best).toBeLessThan(30);
  });
});
