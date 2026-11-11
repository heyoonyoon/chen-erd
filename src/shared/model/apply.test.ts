import { describe, expect, it } from 'vitest';
import { rectsIntersect } from '../geometry';
import { specRoles, validateDiagram } from '../rules';
import type { ErdEdge, ErdNode, NodeKind } from '../types';
import { applyModel, isEmptyChange } from './apply';
import { diagramToText, extractModel } from './extract';
import { COMPANY, SHOP, SMALL, UNIVERSITY, canonicalModel } from './fixtures';
import { parseModel } from './text';
import type { ApplyResult, DiagramChange } from './types';

// ───────────────────────── 도우미 ─────────────────────────

function counter(prefix = 'n'): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

function node(id: string, kind: NodeKind, text: string, x: number, y: number, props: Partial<ErdNode> = {}): ErdNode {
  const size = kind === 'spec' ? { w: 34, h: 34 } : kind === 'attribute' ? { w: 120, h: 50 } : kind === 'relationship' ? { w: 140, h: 80 } : { w: 140, h: 60 };
  return { id, kind, text, x, y, ...size, ...props };
}
function edge(id: string, source: string, target: string, props: Partial<ErdEdge> = {}): ErdEdge {
  return { id, source, target, double: false, label: '', role: '', ...props };
}

/** 글로 적은 모델을 빈 다이어그램에 그린다 */
function draw(text: string, prefix = 'n'): ApplyResult {
  return applyModel(parseModel(text), [], [], '', { newId: counter(prefix) });
}

/** 지금 다이어그램을 글로 뽑아 edit로 고친 뒤 다시 반영한다 */
function push(nodes: ErdNode[], edges: ErdEdge[], edit: (text: string) => string, opts: { relayout?: boolean } = {}): ApplyResult {
  return applyModel(parseModel(edit(diagramToText(nodes, edges))), nodes, edges, '', { ...opts, newId: counter('x') });
}

/** 변경을 원래 다이어그램에 손으로 적용한다(결과의 nodes, edges와 같아야 한다) */
function applyChange(nodes: ErdNode[], edges: ErdEdge[], change: DiagramChange): { nodes: ErdNode[]; edges: ErdEdge[] } {
  const patch = <T extends { id: string }>(list: T[], patches: Array<{ id: string; patch: object }>, removed: string[], added: T[]): T[] => {
    const gone = new Set(removed);
    const out = list
      .filter((item) => !gone.has(item.id))
      .map((item) => {
        const next = { ...item } as Record<string, unknown>;
        for (const p of patches) {
          if (p.id !== item.id) continue;
          for (const [k, v] of Object.entries(p.patch)) {
            if (v === undefined) delete next[k];
            else next[k] = v;
          }
        }
        return next as T;
      });
    return [...out, ...added];
  };
  return {
    nodes: patch(nodes, change.patchNodes, change.removeNodeIds, change.addNodes),
    edges: patch(edges, change.patchEdges, change.removeEdgeIds, change.addEdges),
  };
}

function overlaps(nodes: ErdNode[], gap = 0): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (rectsIntersect({ x: a.x - gap, y: a.y - gap, w: a.w + gap * 2, h: a.h + gap * 2 }, b)) out.push([a.text || a.id, b.text || b.id]);
    }
  }
  return out;
}

const byId = (nodes: ErdNode[]) => new Map(nodes.map((n) => [n.id, n]));
const named = (nodes: ErdNode[], kind: NodeKind, text: string) => nodes.find((n) => n.kind === kind && n.text === text)!;

const ENROLL = `
entity 학생 { 학번 key, 이름 { 성, 이름 }, 전화번호 multi }
entity 과목 { 과목코드 key, 과목명 }
relationship 수강 (학생 M total, 과목 N) { 성적 }
`;

// ───────────────────────── 테스트 ─────────────────────────

describe('applyModel: 새로 그리기', () => {
  it('빈 다이어그램에 모델을 그리면 모두 추가로 나온다', () => {
    const r = draw(ENROLL);
    expect(r.change.addNodes).toHaveLength(11);
    expect(r.change.addEdges).toHaveLength(10);
    expect(r.change.patchNodes).toEqual([]);
    expect(r.change.removeNodeIds).toEqual([]);
    expect(r.summary).toEqual({ added: 21, updated: 0, removed: 0 });
    expect(r.nodes).toEqual(r.change.addNodes);
    expect(r.edges).toEqual(r.change.addEdges);
    expect(r.warnings).toEqual([]);
    expect(isEmptyChange(r.change)).toBe(false);
  });

  it('새 도형은 프리셋보다 작지 않고 플래그는 켜진 것만 들어간다', () => {
    const r = draw('weak entity 아주아주아주아주긴엔티티이름입니다 { 이름 partial, 태그 multi, 값 }\nentity A\nidentifying relationship R (A 1, 아주아주아주아주긴엔티티이름입니다 N total)');
    const weak = named(r.nodes, 'entity', '아주아주아주아주긴엔티티이름입니다');
    expect(weak.weak).toBe(true);
    expect(weak.w).toBeGreaterThan(150);
    expect(weak.h).toBe(66);
    expect(named(r.nodes, 'entity', 'A')).toMatchObject({ w: 140, h: 60 });
    expect('weak' in named(r.nodes, 'entity', 'A')).toBe(false);
    expect(named(r.nodes, 'attribute', '이름').keyType).toBe('partial');
    expect(named(r.nodes, 'attribute', '태그')).toMatchObject({ multivalued: true, w: 130, h: 56 });
    expect(Object.keys(named(r.nodes, 'attribute', '값')).sort()).toEqual(['h', 'id', 'kind', 'text', 'w', 'x', 'y']);
    expect(named(r.nodes, 'relationship', 'R')).toMatchObject({ identifying: true, w: 156, h: 92 });
  });

  it('관계의 선은 관계에서 엔티티로 가고 카디널리티, 이중선, 역할을 담는다', () => {
    const r = draw('entity 직원\nrelationship 관리 (직원 1 as 상사, 직원 N total as 부하)');
    const rel = named(r.nodes, 'relationship', '관리');
    const emp = named(r.nodes, 'entity', '직원');
    expect(r.edges.map((e) => ({ s: e.source, t: e.target, label: e.label, double: e.double, role: e.role }))).toEqual([
      { s: rel.id, t: emp.id, label: '1', double: false, role: '상사' },
      { s: rel.id, t: emp.id, label: 'N', double: true, role: '부하' },
    ]);
  });

  it('특수화는 슈퍼타입 쪽 선만 이중선이 될 수 있고, 화면 규칙으로도 슈퍼타입이 맞게 읽힌다', () => {
    for (const total of ['', ' total']) {
      const r = draw(`entity 직원\nentity 비서\nentity 기술자\nentity 임원\nspecialization 직원 overlap${total} { 비서, 기술자, 임원 }`);
      const spec = r.nodes.find((n) => n.kind === 'spec')!;
      expect(spec.specType).toBe('o');
      const parent = named(r.nodes, 'entity', '직원');
      const doubles = r.edges.filter((e) => e.double);
      expect(doubles.map((e) => e.target)).toEqual(total ? [parent.id] : []);
      const roles = specRoles(spec, r.nodes, r.edges);
      expect(roles.supertype?.id).toBe(parent.id);
      // 서브타입은 모델에 적힌 순서대로 왼쪽부터 놓인다
      expect(roles.subtypes.map((n) => n.text)).toEqual(['비서', '기술자', '임원']);
      expect(r.warnings).toEqual([]);
    }
  });

  it('제목은 모델에 있고 지금과 다를 때만 바꾼다', () => {
    const model = parseModel('title 새제목\nentity A');
    expect(applyModel(model, [], [], '옛제목').change.title).toBe('새제목');
    expect(applyModel(model, [], [], '새제목').change.title).toBeUndefined();
    expect(applyModel(parseModel('entity A'), [], [], '옛제목').change.title).toBeUndefined();
    expect(applyModel(parseModel('title ""'), [], [], '옛제목').change.title).toBe('');
    const onlyTitle = applyModel(parseModel('title 새제목'), [], [], '옛제목');
    expect(isEmptyChange(onlyTitle.change)).toBe(false);
    expect(onlyTitle.summary).toEqual({ added: 0, updated: 0, removed: 0 });
  });

  it('newId를 주지 않으면 겹치지 않는 id를 만든다', () => {
    const r = applyModel(parseModel(ENROLL), [], [], '');
    const ids = [...r.nodes.map((n) => n.id), ...r.edges.map((e) => e.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length === 10)).toBe(true);
  });

  it('newId가 이미 쓰는 id를 내면 건너뛴다', () => {
    const drawn = draw('entity A { x }');
    const r = applyModel(parseModel('entity A { x, y }\nentity B'), drawn.nodes, drawn.edges, '', { newId: counter('n') });
    const ids = [...r.nodes.map((n) => n.id), ...r.edges.map((e) => e.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.nodes.slice(0, 2)).toEqual(drawn.nodes);
    expect(() => applyModel(parseModel('entity A { x, y }'), drawn.nodes, drawn.edges, '', { newId: () => 'n1' })).toThrow(/already in use/);
  });

  it('선언되지 않은 엔티티를 가리키는 손으로 만든 모델은 그 부분만 빼고 경고한다', () => {
    const r = applyModel(
      {
        entities: [{ name: 'A', attributes: [] }, { name: 'A', attributes: [] }],
        relationships: [{ name: 'R', participants: [{ entity: 'A', cardinality: '1' }, { entity: 'Z', cardinality: 'N' }], attributes: [] }],
        specializations: [{ parent: 'Q', kind: 'd', children: ['A'] }, { parent: 'A', kind: 'd', children: ['Z', 'A'] }],
        notes: [],
      },
      [],
      [],
      '',
      { newId: counter() },
    );
    expect(r.nodes.map((n) => n.kind).sort()).toEqual(['entity', 'relationship', 'spec']);
    expect(r.edges).toHaveLength(2);
    expect(r.warnings).toHaveLength(4);
  });
});

describe('applyModel: 뽑은 글을 그대로 다시 넣기', () => {
  it('자동 배치한 그림에서 뽑은 글을 다시 넣으면 바뀌는 것이 없다', () => {
    for (const text of [UNIVERSITY, COMPANY, SMALL, SHOP, ENROLL]) {
      const drawn = draw(text);
      const again = push(drawn.nodes, drawn.edges, (t) => t);
      expect(again.change).toEqual({ addNodes: [], patchNodes: [], removeNodeIds: [], addEdges: [], patchEdges: [], removeEdgeIds: [] });
      expect(isEmptyChange(again.change)).toBe(true);
      expect(again.summary).toEqual({ added: 0, updated: 0, removed: 0 });
      expect(again.nodes).toEqual(drawn.nodes);
      expect(again.edges).toEqual(drawn.edges);
    }
  });

  it('사람이 그린 어수선한 그림에서도 바뀌는 것이 없다', () => {
    const nodes = [
      node('e1', 'entity', '직원', 300, 300, { w: 173, h: 61.5 }),
      node('e2', 'entity', '직원', 900, 300),
      node('e3', 'entity', '', 300, 700, { weak: true }),
      node('e4', 'entity', '부서 이름\n둘째 줄', 900, 700, { weak: false }),
      node('r1', 'relationship', '관리', 310, 80),
      node('r2', 'relationship', '관리', 600, 500, { identifying: true }),
      node('r3', 'relationship', '', 650, 710),
      node('a1', 'attribute', '사번', 100, 200, { keyType: 'key' }),
      node('a2', 'attribute', '사번', 100, 300, { keyType: 'none', derived: true }),
      node('a3', 'attribute', '이름', 100, 400, { multivalued: true, keyType: 'partial' }),
      node('a4', 'attribute', '성', -50, 450),
      node('a5', 'attribute', '', -50, 350),
      node('a6', 'attribute', '기간', 800, 500),
      node('a7', 'attribute', '외톨이', 1200, 100),
      node('a8', 'attribute', '묶음', 1200, 200),
      node('s1', 'spec', '', 370, 520, { specType: 'd' }),
      node('s2', 'spec', '', 1300, 600),
      node('t1', 'note', '메모', 0, 0),
      node('t2', 'note', '메모', 0, 900),
      node('t3', 'note', '', 300, 900),
    ];
    const edges = [
      edge('p1', 'r1', 'e1', { label: '1', role: '상사', sourceSide: 'left', targetSide: 'top', shape: 'elbow' }),
      edge('p2', 'e1', 'r1', { label: 'N', role: '부하', double: true }),
      edge('p3', 'r2', 'e1', { label: ' ' }),
      edge('p4', 'e4', 'r2', { label: '(0,N)', double: true }),
      edge('p5', 'r3', 'e3'),
      edge('p6', 'r3', 'e4'),
      edge('p7', 'r3', 'e2'),
      edge('p8', 'r2', 'e2'),
      edge('q1', 'e1', 'a1'),
      edge('q2', 'a2', 'e1'),
      edge('q3', 'e1', 'a3'),
      edge('q4', 'a3', 'a4'),
      edge('q5', 'a5', 'a3'),
      edge('q6', 'r2', 'a6'),
      edge('q7', 'a7', 'a8'),
      edge('q8', 'a6', 'e4'),
      edge('s1a', 's1', 'e1'),
      edge('s1b', 'e3', 's1'),
      edge('bad1', 'e1', 'e4'),
      edge('bad2', 't1', 'e1'),
      edge('bad3', 'r1', 'r2'),
      edge('bad4', 's1', 'r1'),
      edge('bad5', 'missing', 'e1'),
    ];
    const text = diagramToText(nodes, edges, '제목');
    expect(text).toContain('shapes are not shown here');
    const r = applyModel(parseModel(text), nodes, edges, '제목', { newId: counter('x') });
    expect(r.change).toEqual({ addNodes: [], patchNodes: [], removeNodeIds: [], addEdges: [], patchEdges: [], removeEdgeIds: [] });
    expect(r.nodes).toEqual(nodes);
    expect(r.edges).toEqual(edges);
    expect(r.warnings).toEqual([]);
    // 배열 순서가 달라도 같다
    const reversed = applyModel(parseModel(text), [...nodes].reverse(), [...edges].reverse(), '제목', { newId: counter('x') });
    expect(isEmptyChange(reversed.change)).toBe(true);
  });

  it('change를 원래 다이어그램에 적용한 것과 돌려준 nodes, edges가 같다', () => {
    const drawn = draw(UNIVERSITY);
    const r = push(drawn.nodes, drawn.edges, (t) =>
      t
        .replace('전화번호 multi', '연락처 key')
        .replace('entity 공지', 'entity 게시글')
        .replace('relationship 수혜 (학생 N, 장학금 M)', 'relationship 수혜 (학생 1 total, 장학금 M) { 학기 }\nentity 기숙사 { 동 key }\nrelationship 입주 (학생 N, 기숙사 1)')
        .replace('note "초안: 학사팀 검토 필요"', ''),
    );
    const manual = applyChange(drawn.nodes, drawn.edges, r.change);
    expect(manual.nodes).toEqual(r.nodes);
    expect(manual.edges).toEqual(r.edges);
    expect(r.summary).toEqual({
      added: r.change.addNodes.length + r.change.addEdges.length,
      updated: r.change.patchNodes.length + r.change.patchEdges.length,
      removed: r.change.removeNodeIds.length + r.change.removeEdgeIds.length,
    });
  });
});

describe('applyModel: 고치기', () => {
  it('엔티티 이름만 바꾸면 같은 도형의 글자만 바뀐다', () => {
    const drawn = draw(ENROLL);
    const student = named(drawn.nodes, 'entity', '학생');
    const r = push(drawn.nodes, drawn.edges, (t) => t.replaceAll('학생', '수강생'));
    expect(r.change).toEqual({ addNodes: [], patchNodes: [{ id: student.id, patch: { text: '수강생' } }], removeNodeIds: [], addEdges: [], patchEdges: [], removeEdgeIds: [] });
    expect(r.summary).toEqual({ added: 0, updated: 1, removed: 0 });
  });

  it('속성이 절반 넘게 달라진 엔티티는 다른 엔티티로 본다', () => {
    const drawn = draw(ENROLL);
    const student = named(drawn.nodes, 'entity', '학생');
    const r = push(drawn.nodes, drawn.edges, () => 'entity 교수 { 교수번호 key, 연구실, 이름 }\nentity 과목 { 과목코드 key, 과목명 }');
    expect(r.change.removeNodeIds).toContain(student.id);
    expect(r.change.addNodes.map((n) => n.text)).toContain('교수');
    // 과목은 그대로 남는다
    const course = named(drawn.nodes, 'entity', '과목');
    expect(byId(r.nodes).get(course.id)).toEqual(course);
  });

  it('속성 이름 바꾸기, 추가, 삭제를 같은 소유자 안에서 맞춘다', () => {
    const drawn = draw(ENROLL);
    const phone = named(drawn.nodes, 'attribute', '전화번호');
    const sid = named(drawn.nodes, 'attribute', '학번');
    const last = named(drawn.nodes, 'attribute', '성');
    const r = push(drawn.nodes, drawn.edges, (t) => t.replace('전화번호 multi', '연락처').replace('이름 { 성, 이름 }', '이름 { 이름, 중간이름 }'));
    const after = byId(r.nodes);
    // 전화번호 → 연락처: 같은 도형, 다중값 꺼짐
    expect(r.change.patchNodes).toContainEqual({ id: phone.id, patch: { text: '연락처', multivalued: undefined } });
    expect('multivalued' in after.get(phone.id)!).toBe(false);
    // 성 → 중간이름: 남은 것끼리 짝지어 자리를 물려받는다(글자가 길어져 중심을 두고 커질 수 있다)
    expect(after.get(last.id)!.text).toBe('중간이름');
    expect(after.get(last.id)!.x + after.get(last.id)!.w / 2).toBe(last.x + last.w / 2);
    expect(after.get(sid.id)).toEqual(sid);
    expect(r.change.addNodes).toEqual([]);
    expect(r.change.removeNodeIds).toEqual([]);
  });

  it('속성을 지우면 하위 속성과 선까지 지운다', () => {
    const drawn = draw(ENROLL);
    const r = push(drawn.nodes, drawn.edges, (t) => t.replace('  이름 { 성, 이름 }\n', ''));
    expect(r.change.removeNodeIds).toHaveLength(3);
    expect(r.change.removeEdgeIds).toHaveLength(3);
    expect(r.edges.every((e) => byId(r.nodes).has(e.source) && byId(r.nodes).has(e.target))).toBe(true);
    expect(r.summary).toEqual({ added: 0, updated: 0, removed: 6 });
  });

  it('플래그는 달라진 것만 고치고, 끄는 플래그는 undefined로 지운다', () => {
    const drawn = draw('weak entity A { x partial, y multi, z }\nentity B { k key }\nidentifying relationship R (B 1, A N total)');
    const a = named(drawn.nodes, 'entity', 'A');
    const rel = named(drawn.nodes, 'relationship', 'R');
    const x = named(drawn.nodes, 'attribute', 'x');
    const y = named(drawn.nodes, 'attribute', 'y');
    const z = named(drawn.nodes, 'attribute', 'z');
    const r = push(drawn.nodes, drawn.edges, () => 'entity A { x key, y, z multi }\nentity B { k key }\nrelationship R (B 1, A N total)');
    const patches = new Map(r.change.patchNodes.map((p) => [p.id, p.patch]));
    expect(patches.get(a.id)).toEqual({ weak: undefined });
    expect(patches.get(rel.id)).toEqual({ identifying: undefined });
    expect(patches.get(x.id)).toEqual({ keyType: 'key' });
    expect(patches.get(y.id)).toEqual({ multivalued: undefined });
    expect(patches.get(z.id)).toMatchObject({ multivalued: true });
    expect(r.change.patchNodes).toHaveLength(5);
    // 반대로 다시 켠다
    const back = push(r.nodes, r.edges, () => 'weak entity A { x partial, y multi, z }\nentity B { k key }\nidentifying relationship R (B 1, A N total)');
    const backPatches = new Map(back.change.patchNodes.map((p) => [p.id, p.patch]));
    expect(backPatches.get(a.id)).toMatchObject({ weak: true });
    expect(backPatches.get(rel.id)).toMatchObject({ identifying: true });
    expect(backPatches.get(x.id)).toEqual({ keyType: 'partial' });
    expect(backPatches.get(z.id)).toEqual({ multivalued: undefined });
  });

  it("derived와 저장된 keyType 'none'은 건드리지 않는다", () => {
    const nodes = [node('e', 'entity', 'A', 300, 300), node('x', 'attribute', '나이', 300, 100, { derived: true, keyType: 'none' })];
    const edges = [edge('l', 'e', 'x')];
    const same = applyModel(parseModel('entity A { 나이 }'), nodes, edges, '');
    expect(isEmptyChange(same.change)).toBe(true);
    const renamed = applyModel(parseModel('entity A { 만나이 multi }'), nodes, edges, '');
    expect(renamed.change.patchNodes).toHaveLength(1);
    expect(renamed.change.patchNodes[0].patch).toMatchObject({ text: '만나이', multivalued: true });
    expect('derived' in renamed.change.patchNodes[0].patch).toBe(false);
    expect('keyType' in renamed.change.patchNodes[0].patch).toBe(false);
    expect(renamed.nodes[1].derived).toBe(true);
  });

  it('글자가 길어져 넘치면 중심을 두고 키우고, 들어가면 크기를 그대로 둔다', () => {
    const nodes = [node('e', 'entity', 'A', 300, 300, { w: 300, h: 100 }), node('f', 'entity', 'B', 300, 600), node('x', 'attribute', 'x', 300, 100), node('y', 'attribute', 'y', 300, 800)];
    const edges = [edge('ex', 'e', 'x'), edge('fy', 'f', 'y')];
    const fits = applyModel(parseModel('entity 조금긴이름 { x }\nentity B { y }'), nodes, edges, '');
    expect(fits.change.patchNodes).toEqual([{ id: 'e', patch: { text: '조금긴이름' } }]);
    const grows = applyModel(parseModel('entity A { x }\nentity 아주아주아주아주아주아주아주긴이름 { y }'), nodes, edges, '');
    const patch = grows.change.patchNodes[0].patch;
    expect(grows.change.patchNodes[0].id).toBe('f');
    expect(patch.w!).toBeGreaterThan(140);
    expect(patch.x! + patch.w! / 2).toBe(300 + 70);
    expect(patch.h).toBeUndefined();
  });

  it('참여 선은 엔티티와 역할 이름으로 짝지어 값만 고치고, 붙는 면과 모양은 그대로 둔다', () => {
    const nodes = [node('emp', 'entity', '직원', 100, 300), node('dep', 'entity', '부서', 700, 300), node('mgr', 'relationship', '관리', 100, 80), node('wf', 'relationship', '근무', 400, 290)];
    const edges = [
      edge('a', 'mgr', 'emp', { label: '1', role: '상사', sourceSide: 'left', targetSide: 'left', shape: 'elbow' }),
      edge('b', 'emp', 'mgr', { label: 'N', role: '부하' }),
      edge('c', 'wf', 'emp', { label: 'N', sourceSide: 'left' }),
      edge('d', 'wf', 'dep', { label: '1' }),
    ];
    const r = applyModel(parseModel('entity 직원\nentity 부서\nrelationship 관리 (직원 M as 부하, 직원 1 total as 상사)\nrelationship 근무 (부서 1 total as 소속, 직원 N)'), nodes, edges, '');
    expect(r.change.patchEdges).toEqual([
      { id: 'b', patch: { label: 'M' } },
      { id: 'a', patch: { double: true } },
      { id: 'd', patch: { double: true, role: '소속' } },
    ]);
    expect(r.change.addEdges).toEqual([]);
    expect(r.change.removeEdgeIds).toEqual([]);
    expect(r.edges.find((e) => e.id === 'a')).toMatchObject({ sourceSide: 'left', targetSide: 'left', shape: 'elbow', double: true });
  });

  it('관계의 참여 엔티티가 바뀌면 그 선만 갈아 끼운다', () => {
    const drawn = draw('entity A\nentity B\nentity C\nrelationship R (A 1, B N)');
    const rel = named(drawn.nodes, 'relationship', 'R');
    const toB = drawn.edges.find((e) => e.target === named(drawn.nodes, 'entity', 'B').id)!;
    const r = push(drawn.nodes, drawn.edges, (t) => t.replace('B N', 'C M'));
    expect(r.change.removeEdgeIds).toEqual([toB.id]);
    expect(r.change.addEdges).toEqual([{ id: 'x1', source: rel.id, target: named(drawn.nodes, 'entity', 'C').id, double: false, label: 'M', role: '' }]);
    expect(r.change.patchNodes).toEqual([]);
  });

  it('이름이 같은 관계가 여럿이면 참여 엔티티가 같은 것끼리 짝짓고, 이름만 바뀐 관계도 자리를 지킨다', () => {
    const drawn = draw('entity A\nentity B\nentity C\nrelationship has (A 1, B N)\nrelationship has (B 1, C N)\nrelationship owns (A 1, C N)');
    const before = extractModel(drawn.nodes, drawn.edges).model;
    const hasBC = drawn.nodes.filter((n) => n.text === 'has').find((n) => drawn.edges.some((e) => e.source === n.id && e.target === named(drawn.nodes, 'entity', 'C').id))!;
    const owns = named(drawn.nodes, 'relationship', 'owns');
    // 순서를 뒤집고 하나는 이름을 바꾼다
    const r = applyModel(parseModel('entity A\nentity B\nentity C\nrelationship possesses (C N, A 1)\nrelationship has (B 1, C N) { since }\nrelationship has (A 1, B N)'), drawn.nodes, drawn.edges, '', { newId: counter('x') });
    expect(r.change.removeNodeIds).toEqual([]);
    expect(r.change.addNodes.map((n) => n.text)).toEqual(['since']);
    expect(r.change.patchNodes).toEqual([{ id: owns.id, patch: { text: 'possesses' } }]);
    expect(r.change.addEdges.map((e) => e.source)).toEqual([hasBC.id]);
    expect(before.relationships).toHaveLength(3);
  });

  it('도형을 지우면 모델 밖의 선까지 포함해 붙어 있던 선을 모두 지운다', () => {
    const nodes = [node('a', 'entity', 'A', 0, 0), node('b', 'entity', 'B', 400, 0), node('memo', 'note', '메모', 0, 300), node('r', 'relationship', 'R', 200, 0)];
    const edges = [edge('ab', 'a', 'b'), edge('am', 'memo', 'a'), edge('ra', 'r', 'a'), edge('rb', 'r', 'b'), edge('bm', 'b', 'memo')];
    const r = applyModel(parseModel('entity B\nrelationship R (B)\nnote 메모'), nodes, edges, '');
    expect(r.change.removeNodeIds).toEqual(['a']);
    expect(r.change.removeEdgeIds.sort()).toEqual(['ab', 'am', 'ra']);
    expect(r.edges.map((e) => e.id).sort()).toEqual(['bm', 'rb']);
    expect(r.summary).toEqual({ added: 0, updated: 0, removed: 4 });
  });

  it('모델에 담기지 않은 도형은 건드리지 않는다', () => {
    const nodes = [node('a', 'entity', 'A', 0, 0), node('lonely', 'attribute', '외톨이', 0, 300), node('g', 'attribute', '묶음', 200, 300), node('circle', 'spec', '', 500, 300)];
    const edges = [edge('lg', 'lonely', 'g')];
    const r = applyModel(parseModel(''), nodes, edges, '');
    expect(r.change.removeNodeIds).toEqual(['a']);
    expect(r.nodes).toEqual(nodes.slice(1));
    expect(r.edges).toEqual(edges);
  });

  it('메모는 글자로 짝짓고, 남은 것은 차례로 글자만 바꾼다', () => {
    const size = { w: 160, h: 50 };
    const nodes = [node('m1', 'note', '첫째', 0, 0, size), node('m2', 'note', '둘째', 0, 100, size), node('m3', 'note', '셋째', 0, 200, size)];
    const r = applyModel(parseModel('note 둘째\nnote 고친글'), nodes, [], '');
    expect(r.change.patchNodes).toEqual([{ id: 'm1', patch: { text: '고친글' } }]);
    expect(r.change.removeNodeIds).toEqual(['m3']);
    expect(r.change.addNodes).toEqual([]);
  });

  it('특수화의 종류, 전체 여부, 서브타입을 고친다', () => {
    const drawn = draw('entity P\nentity A\nentity B\nentity C\nspecialization P disjoint { A, B }');
    const spec = drawn.nodes.find((n) => n.kind === 'spec')!;
    const parentEdge = drawn.edges.find((e) => e.target === named(drawn.nodes, 'entity', 'P').id)!;
    const toA = drawn.edges.find((e) => e.target === named(drawn.nodes, 'entity', 'A').id)!;
    const r = push(drawn.nodes, drawn.edges, (t) => t.replace('specialization P disjoint { A, B }', 'specialization P overlap total { B, C }'));
    expect(r.change.patchNodes).toEqual([{ id: spec.id, patch: { specType: 'o' } }]);
    expect(r.change.patchEdges).toEqual([{ id: parentEdge.id, patch: { double: true } }]);
    expect(r.change.removeEdgeIds).toEqual([toA.id]);
    expect(r.change.addEdges).toEqual([{ id: 'x1', source: spec.id, target: named(drawn.nodes, 'entity', 'C').id, double: false, label: '', role: '' }]);
    expect(specRoles(byId(r.nodes).get(spec.id)!, r.nodes, r.edges).supertype?.text).toBe('P');
  });

  it('서브타입 쪽 선이 이중선이면 단선으로 맞춘다', () => {
    const nodes = [node('p', 'entity', 'P', 300, 100), node('a', 'entity', 'A', 100, 400), node('b', 'entity', 'B', 500, 400), node('s', 'spec', '', 353, 250)];
    const edges = [edge('sp', 's', 'p', { double: true }), edge('sa', 's', 'a', { double: true }), edge('sb', 's', 'b')];
    const text = diagramToText(nodes, edges);
    expect(text).toContain('specialization P disjoint total { A, B }');
    const r = applyModel(parseModel(text), nodes, edges, '');
    expect(r.change.patchEdges).toEqual([{ id: 'sa', patch: { double: false } }]);
    expect(isEmptyChange(applyModel(parseModel(text), r.nodes, r.edges, '').change)).toBe(true);
  });

  it('슈퍼타입이 틀리게 읽히면 원을 슈퍼타입 아래로 옮기고, 그래도 안 되면 경고한다', () => {
    // 원이 P보다 위에 있어 화면 규칙으로는 A가 슈퍼타입으로 읽히는 그림에, P를 슈퍼타입으로 둔 새 특수화를 넣는다
    const nodes = [node('p', 'entity', 'P', 300, 500), node('a', 'entity', 'A', 300, 100), node('b', 'entity', 'B', 700, 500)];
    const r = applyModel(parseModel('entity P\nentity A\nentity B\nspecialization P disjoint { A, B }'), nodes, [], '', { newId: counter('x') });
    const spec = r.nodes.find((n) => n.kind === 'spec')!;
    expect(specRoles(spec, r.nodes, r.edges).supertype?.id).toBe('p');
    expect(r.warnings).toEqual([]);
    // 기존 도형은 움직이지 않는다
    expect(r.nodes.slice(0, 3)).toEqual(nodes);
  });
});

describe('applyModel: 배치 방식', () => {
  it('남는 도형이 있으면 기존 도형은 움직이지 않고 새 도형만 겹치지 않게 놓는다', () => {
    const drawn = draw(UNIVERSITY);
    const r = push(drawn.nodes, drawn.edges, (t) =>
      `${t.replace('학점', '학점\n  개설학기\n  비고 { 메모1, 메모2 }').replace('relationship 수혜 (학생 N, 장학금 M)', 'relationship 수혜 (학생 N, 장학금 M) { 지급일 }')}
entity 기숙사 { 동 key, 호실 key, 정원 }
entity 사감 { 이름 }
entity 외톨이 { 값 }
entity 대학원조교
relationship 입주 (학생 N, 기숙사 1) { 입주일 }
relationship 관리 (사감 1, 기숙사 N)
relationship 멘토 (학생 1 as 멘토, 학생 N as 멘티)
specialization 조교 overlap { 대학원조교 }
note 새메모`,
    );
    const before = byId(drawn.nodes);
    for (const n of r.nodes) if (before.has(n.id)) expect(n).toEqual(before.get(n.id));
    expect(r.change.patchNodes).toEqual([]);
    expect(r.change.addNodes.length).toBeGreaterThan(15);
    expect(overlaps(r.nodes, 6)).toEqual([]);
    expect(r.nodes.every((n) => Number.isInteger(n.x) && Number.isInteger(n.y))).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(validateDiagram(r.nodes, r.edges).filter((i) => i.severity === 'error')).toEqual([]);
    // 새 서브타입은 원 아래에 놓여 슈퍼타입이 맞게 읽힌다
    const newSpec = r.change.addNodes.find((n) => n.kind === 'spec')!;
    expect(specRoles(newSpec, r.nodes, r.edges).supertype?.text).toBe('조교');
    // 뽑아 보면 고친 모델과 같다
    const text = diagramToText(r.nodes, r.edges);
    expect(text).toContain('멘토');
    expect(isEmptyChange(push(r.nodes, r.edges, (t) => t).change)).toBe(true);
  });

  it('새 속성은 소유자 가까이에 놓인다', () => {
    const drawn = draw(ENROLL);
    const r = push(drawn.nodes, drawn.edges, (t) => t.replace('과목명', '과목명\n  학점\n  개설학과'));
    const course = named(r.nodes, 'entity', '과목');
    for (const a of r.change.addNodes) {
      const d = Math.hypot(a.x + a.w / 2 - (course.x + course.w / 2), a.y + a.h / 2 - (course.y + course.h / 2));
      expect(d).toBeLessThan(320);
    }
    expect(overlaps(r.nodes, 6)).toEqual([]);
  });

  it('relayout이면 전체를 다시 배치하고, 한 번 더 하면 바뀌는 것이 없다', () => {
    const nodes = [
      node('a', 'entity', 'A', 0, 0),
      node('b', 'entity', 'B', 20, 10),
      node('r', 'relationship', 'R', 10, 5),
      node('x', 'attribute', 'x', 5, 5, { keyType: 'key' }),
      node('lonely', 'attribute', '외톨이', 30, 30),
    ];
    const edges = [edge('ra', 'r', 'a', { label: '1', sourceSide: 'left', targetSide: 'right', shape: 'elbow' }), edge('rb', 'r', 'b', { label: 'N' }), edge('ax', 'a', 'x')];
    const text = diagramToText(nodes, edges);
    expect(isEmptyChange(applyModel(parseModel(text), nodes, edges, '').change)).toBe(true);
    const r = applyModel(parseModel(text), nodes, edges, '', { relayout: true });
    expect(r.change.addNodes).toEqual([]);
    expect(r.change.patchNodes.map((p) => p.id).sort()).toEqual(['a', 'b', 'r', 'x']);
    expect(overlaps(r.nodes, 6)).toEqual([]);
    // 건드리지 않는 도형은 그대로이고 새 배치와 겹치지 않는다
    expect(r.nodes.find((n) => n.id === 'lonely')).toEqual(nodes[4]);
    // 붙는 면은 지우고 모양은 남긴다
    expect(r.change.patchEdges).toEqual([{ id: 'ra', patch: { sourceSide: undefined, targetSide: undefined } }]);
    expect(r.edges.find((e) => e.id === 'ra')).toEqual({ id: 'ra', source: 'r', target: 'a', double: false, label: '1', role: '', shape: 'elbow' });
    const again = applyModel(parseModel(text), r.nodes, r.edges, '', { relayout: true });
    expect(isEmptyChange(again.change)).toBe(true);
  });

  it('남는 관리 대상 도형이 없으면 전체 배치를 하고, 건드리지 않는 도형과 겹치지 않게 놓는다', () => {
    const nodes = [node('lonely', 'attribute', '외톨이', 100, 100), node('circle', 'spec', '', 600, 500), node('old', 'entity', '옛것', 300, 300)];
    const r = applyModel(parseModel(COMPANY), nodes, [], '', { newId: counter('x') });
    expect(r.change.removeNodeIds).toEqual(['old']);
    expect(r.nodes.slice(0, 2)).toEqual(nodes.slice(0, 2));
    expect(overlaps(r.nodes, 6)).toEqual([]);
    expect(canonicalModel(extractModel(r.nodes, r.edges).model)).toEqual(canonicalModel(parseModel(COMPANY.replace('title COMPANY', ''))));
  });

  it('같은 입력이면 같은 결과가 나온다', () => {
    const a = draw(UNIVERSITY);
    const b = draw(UNIVERSITY);
    expect(a).toEqual(b);
    const edit = (t: string) => `${t}\nentity 기숙사 { 동 key }\nrelationship 입주 (학생 N, 기숙사 1)`;
    expect(push(a.nodes, a.edges, edit)).toEqual(push(b.nodes, b.edges, edit));
  });
});
