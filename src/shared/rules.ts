/**
 * Chen 표기법의 연결 규칙과 다이어그램 검증(순수 함수). [담당: rules 에이전트]
 * 아래 export의 이름과 시그니처는 계약이므로 바꾸지 않는다.
 */
import type { ErdEdge, ErdNode, Issue, NodeKind } from './types';

export interface ConnectCheck {
  ok: boolean;
  /** 연결할 수 없는 이유(한국어). ok면 생략 */
  reason?: string;
}

/** 노드 목록. 배열과 id → 노드 Map 둘 다 받는다. */
export type NodeLookup = readonly ErdNode[] | ReadonlyMap<string, ErdNode>;

// ───────────────────────── 공통 도우미 ─────────────────────────

function toNodeMap(nodes: NodeLookup): ReadonlyMap<string, ErdNode> {
  if (!Array.isArray(nodes)) return nodes as ReadonlyMap<string, ErdNode>;
  const map = new Map<string, ErdNode>();
  for (const n of nodes as readonly ErdNode[]) map.set(n.id, n);
  return map;
}

function isOwnerKind(kind: NodeKind): boolean {
  return kind === 'entity' || kind === 'relationship';
}

function isEntityRelationship(a: NodeKind, b: NodeKind): boolean {
  return (a === 'entity' && b === 'relationship') || (a === 'relationship' && b === 'entity');
}

function isEntitySpec(a: NodeKind, b: NodeKind): boolean {
  return (a === 'entity' && b === 'spec') || (a === 'spec' && b === 'entity');
}

/** 도형 종류만 보고 연결할 수 없는 조합이면 이유를 돌려준다. 가능하면 null. (대칭) */
function kindPairReason(a: NodeKind, b: NodeKind): string | null {
  if (a === 'note' || b === 'note') return '메모는 다른 도형과 선으로 연결할 수 없습니다';
  if (a === 'spec' || b === 'spec') {
    const other = a === 'spec' ? b : a;
    if (other === 'entity') return null;
    if (other === 'spec') return '특수화 원끼리는 연결할 수 없습니다';
    if (other === 'relationship') return '특수화 원은 관계가 아니라 엔티티(슈퍼타입, 서브타입)와 연결합니다';
    return '특수화 원에는 속성을 달 수 없습니다';
  }
  if (a === 'entity' && b === 'entity') return '엔티티끼리는 관계(마름모)를 거쳐 연결합니다';
  if (a === 'relationship' && b === 'relationship') return '관계끼리는 직접 연결할 수 없습니다';
  return null;
}

/** 같은 두 도형 사이에 허용되는 선의 수. 엔티티와 관계 사이만 재귀 관계를 위해 2개. */
function maxEdgesBetween(a: NodeKind, b: NodeKind): number {
  return isEntityRelationship(a, b) ? 2 : 1;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function kindNoun(n: ErdNode): string {
  switch (n.kind) {
    case 'entity':
      return n.weak ? '약한 엔티티' : '엔티티';
    case 'relationship':
      return n.identifying ? '식별 관계' : '관계';
    case 'attribute':
      return '속성';
    case 'spec':
      return '특수화 원';
    case 'note':
      return '메모';
  }
}

function plainName(n: ErdNode): string {
  return n.text.replace(/\s+/g, ' ').trim();
}

/** 메시지에 넣을 도형 이름. 예: 'TEAM' 엔티티, 이름 없는 속성, 특수화 원(d) */
function describe(n: ErdNode): string {
  if (n.kind === 'spec') return `특수화 원(${n.specType ?? 'd'})`;
  const name = plainName(n);
  return name ? `'${name}' ${kindNoun(n)}` : `이름 없는 ${kindNoun(n)}`;
}

/** 받침에 따라 조사를 고른다. 한글로 끝나지 않으면 받침 없는 쪽을 쓴다. */
function josa(word: string, withFinal: string, withoutFinal: string): string {
  const stripped = word.replace(/[^가-힣A-Za-z0-9]+$/, '');
  const code = stripped.charCodeAt(stripped.length - 1);
  const hasFinal = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
  return word + (hasFinal ? withFinal : withoutFinal);
}

function quoteNames(nodes: ErdNode[], limit = 3): string {
  const names = nodes.slice(0, limit).map((n) => `'${plainName(n) || '이름 없음'}'`);
  const rest = nodes.length - limit;
  return names.join(', ') + (rest > 0 ? ` 외 ${rest}개` : '');
}

function centerX(n: ErdNode): number {
  return n.x + n.w / 2;
}
function centerY(n: ErdNode): number {
  return n.y + n.h / 2;
}

// ───────────────────────── 연결 규칙 ─────────────────────────

interface AttributeGroup {
  /** 속성끼리의 선으로 이어진 속성들(복합 속성 한 덩어리) */
  members: Set<string>;
  /** 이 덩어리가 연결된 엔티티/관계와, 그쪽으로 직접 선이 나간 속성 */
  owners: Array<{ owner: ErdNode; via: string }>;
}

function neighborIds(edges: ErdEdge[]): Map<string, string[]> {
  const neighbors = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = neighbors.get(a);
    if (list) list.push(b);
    else neighbors.set(a, [b]);
  };
  for (const e of edges) {
    if (e.source === e.target) continue;
    link(e.source, e.target);
    link(e.target, e.source);
  }
  return neighbors;
}

/** startId 속성이 속한 복합 속성 덩어리를 구한다. */
function attributeGroup(startId: string, neighbors: Map<string, string[]>, nodeById: ReadonlyMap<string, ErdNode>): AttributeGroup {
  const members = new Set<string>([startId]);
  const owners: AttributeGroup['owners'] = [];
  const queue = [startId];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const otherId of neighbors.get(id) ?? []) {
      const other = nodeById.get(otherId);
      if (!other) continue;
      if (other.kind === 'attribute') {
        if (!members.has(otherId)) {
          members.add(otherId);
          queue.push(otherId);
        }
      } else if (isOwnerKind(other.kind)) {
        owners.push({ owner: other, via: id });
      }
    }
  }
  return { members, owners };
}

/**
 * source와 target을 선으로 이을 수 있는지. edges는 현재 문서의 모든 엣지.
 * 선에는 방향이 없으므로 source와 target을 바꿔도 결과가 같다.
 *
 * nodes(현재 문서의 모든 노드, 배열 또는 id → 노드 Map)를 넘기면 "속성의 소유자는 하나" 규칙까지 검사한다.
 * 엣지에는 노드 id만 있어서, nodes가 없으면 속성이 이미 무엇에 붙어 있는지 알 수 없어 그 규칙은 건너뛴다.
 */
export function canConnect(source: ErdNode, target: ErdNode, edges: ErdEdge[], nodes?: NodeLookup): ConnectCheck {
  if (source.id === target.id) return { ok: false, reason: '자기 자신과는 연결할 수 없습니다' };

  const kindReason = kindPairReason(source.kind, target.kind);
  if (kindReason) return { ok: false, reason: kindReason };

  let existing = 0;
  for (const e of edges) {
    if ((e.source === source.id && e.target === target.id) || (e.source === target.id && e.target === source.id)) existing++;
  }
  if (existing >= maxEdgesBetween(source.kind, target.kind)) {
    return isEntityRelationship(source.kind, target.kind)
      ? { ok: false, reason: '같은 엔티티와 관계 사이에는 선을 2개까지만 그을 수 있습니다' }
      : { ok: false, reason: '두 도형은 이미 연결되어 있습니다' };
  }

  if (nodes && (source.kind === 'attribute' || target.kind === 'attribute')) {
    const nodeById = toNodeMap(nodes);
    const neighbors = neighborIds(edges);
    if (source.kind === 'attribute' && target.kind === 'attribute') {
      const a = attributeGroup(source.id, neighbors, nodeById);
      if (a.members.has(target.id)) {
        return { ok: false, reason: '두 속성은 이미 같은 복합 속성으로 이어져 있습니다' };
      }
      const b = attributeGroup(target.id, neighbors, nodeById);
      if (a.owners.length > 0 && b.owners.length > 0) {
        // 양쪽 다 이미 소유자가 있으면, 이었을 때 한쪽이 상위를 둘 가지게 된다
        return { ok: false, reason: '두 속성이 각각 이미 엔티티나 관계에 속해 있어 복합 속성으로 이을 수 없습니다' };
      }
    } else {
      const attribute = source.kind === 'attribute' ? source : target;
      const group = attributeGroup(attribute.id, neighbors, nodeById);
      if (group.owners.length > 0) {
        const direct = group.owners.find((o) => o.via === attribute.id);
        return direct
          ? { ok: false, reason: `이 속성은 이미 ${describe(direct.owner)}에 연결되어 있어 다른 곳에 또 연결할 수 없습니다` }
          : { ok: false, reason: `이 속성은 ${describe(group.owners[0].owner)}의 복합 속성에 속해 있어 따로 연결할 수 없습니다` };
      }
    }
  }

  return { ok: true };
}

/** 새로 잇는 선의 기본 속성(예: 약한 엔티티와 식별 관계 사이는 이중선) */
export function defaultEdgeProps(source: ErdNode, target: ErdNode): Pick<ErdEdge, 'double' | 'label' | 'role'> {
  const entity = source.kind === 'entity' ? source : target.kind === 'entity' ? target : null;
  const relationship = source.kind === 'relationship' ? source : target.kind === 'relationship' ? target : null;
  // 약한 엔티티는 식별 관계에 항상 전체 참여한다
  const double = Boolean(entity?.weak && relationship?.identifying);
  return { double, label: '', role: '' };
}

/** 이 엣지에 카디널리티(1/M/N)를 적는 것이 의미가 있는지(엔티티와 관계 사이의 선) */
export function edgeHasCardinality(source: ErdNode, target: ErdNode): boolean {
  return isEntityRelationship(source.kind, target.kind);
}

/** 이 엣지에 이중선이 의미가 있는지(참여 제약 또는 슈퍼타입과 특수화 원 사이) */
export function edgeCanBeDouble(source: ErdNode, target: ErdNode): boolean {
  return isEntityRelationship(source.kind, target.kind) || isEntitySpec(source.kind, target.kind);
}

// ───────────────────────── 특수화의 슈퍼타입/서브타입 ─────────────────────────

export interface SpecRoles {
  /** 연결된 엔티티가 없으면 null */
  supertype: ErdNode | null;
  /** 왼쪽에서 오른쪽 순서 */
  subtypes: ErdNode[];
}

interface SpecMember {
  node: ErdNode;
  /** 원과 이 엔티티 사이에 이중선이 있는지 */
  double: boolean;
}

function pickSpecRoles(spec: ErdNode, members: SpecMember[]): SpecRoles {
  if (members.length === 0) return { supertype: null, subtypes: [] };
  const specX = centerX(spec);
  const specY = centerY(spec);
  const byId = (a: ErdNode, b: ErdNode) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const entities = members.map((m) => m.node);

  let supertype: ErdNode;
  const doubles = members.filter((m) => m.double);
  if (doubles.length === 1) {
    supertype = doubles[0].node;
  } else {
    const above = entities.filter((n) => centerY(n) < specY);
    if (above.length > 0) {
      const dist = (n: ErdNode) => Math.hypot(centerX(n) - specX, centerY(n) - specY);
      supertype = above.sort((a, b) => dist(a) - dist(b) || byId(a, b))[0];
    } else {
      supertype = [...entities].sort((a, b) => centerY(a) - centerY(b) || byId(a, b))[0];
    }
  }
  const subtypes = entities.filter((n) => n.id !== supertype.id).sort((a, b) => centerX(a) - centerX(b) || byId(a, b));
  return { supertype, subtypes };
}

/**
 * 특수화 원에 연결된 엔티티 중 슈퍼타입 하나와 서브타입들을 가린다.
 * 선에 방향이 없으므로 다음 순서로 정한다.
 *   1. 이중선(전체 특수화)으로 연결된 엔티티가 정확히 하나면 그것이 슈퍼타입
 *   2. 아니면 중심이 원보다 위에 있는 엔티티 중 원에 가장 가까운 것
 *   3. 그것도 없으면 가장 위에 있는 것
 */
export function specRoles(spec: ErdNode, nodes: NodeLookup, edges: ErdEdge[]): SpecRoles {
  const nodeById = toNodeMap(nodes);
  const members = new Map<string, SpecMember>();
  for (const e of edges) {
    const otherId = e.source === spec.id ? e.target : e.target === spec.id ? e.source : null;
    if (otherId === null || otherId === spec.id) continue;
    const other = nodeById.get(otherId);
    if (!other || other.kind !== 'entity') continue;
    const member = members.get(otherId);
    if (member) member.double = member.double || e.double;
    else members.set(otherId, { node: other, double: e.double });
  }
  return pickSpecRoles(spec, [...members.values()]);
}

// ───────────────────────── 다이어그램 검증 ─────────────────────────

interface Link {
  edge: ErdEdge;
  other: ErdNode;
}

interface AttributeComponent {
  members: ErdNode[];
  hasKey: boolean;
  hasPartialKey: boolean;
}

/** 다이어그램 전체를 검사해 수업 표기법에 어긋나거나 빠진 부분을 알려 준다. 오류가 먼저, 경고가 뒤에 온다. */
export function validateDiagram(nodes: ErdNode[], edges: ErdEdge[]): Issue[] {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const error = (id: string, message: string, elementIds: string[]) => {
    errors.push({ id, severity: 'error', message, elementIds });
  };
  const warn = (id: string, message: string, elementIds: string[]) => {
    warnings.push({ id, severity: 'warning', message, elementIds });
  };

  // 인접 목록은 여기서 한 번만 만든다. 표기법상 성립하지 않는 선은 오류로 알리고 목록에는 넣지 않는다.
  const nodeById = new Map<string, ErdNode>();
  const links = new Map<string, Link[]>();
  for (const n of nodes) {
    nodeById.set(n.id, n);
    links.set(n.id, []);
  }
  const edgesByPair = new Map<string, ErdEdge[]>();
  for (const e of edges) {
    const s = nodeById.get(e.source);
    const t = nodeById.get(e.target);
    if (!s || !t) {
      const present = s ?? t;
      error(
        `edge-dangling:${e.id}`,
        present ? `${describe(present)}에서 나온 선의 반대쪽 끝에 도형이 없습니다` : '양 끝에 도형이 없는 선이 있습니다',
        present ? [e.id, present.id] : [e.id],
      );
      continue;
    }
    if (s.id === t.id) {
      error(`edge-self:${e.id}`, `${josa(describe(s), '이', '가')} 자기 자신과 선으로 이어져 있습니다`, [e.id, s.id]);
      continue;
    }
    const reason = kindPairReason(s.kind, t.kind);
    if (reason) {
      error(
        `edge-invalid:${e.id}`,
        `${josa(describe(s), '과', '와')} ${josa(describe(t), '이', '가')} 선으로 이어져 있습니다. ${reason}`,
        [e.id, s.id, t.id],
      );
      continue;
    }
    links.get(s.id)!.push({ edge: e, other: t });
    links.get(t.id)!.push({ edge: e, other: s });
    const key = pairKey(s.id, t.id);
    const pair = edgesByPair.get(key);
    if (pair) pair.push(e);
    else edgesByPair.set(key, [e]);
  }

  // 같은 두 도형 사이에 겹친 선(두 사람이 동시에 그리면 생길 수 있다)
  for (const [key, pair] of edgesByPair) {
    if (pair.length < 2) continue;
    const s = nodeById.get(pair[0].source)!;
    const t = nodeById.get(pair[0].target)!;
    const max = maxEdgesBetween(s.kind, t.kind);
    if (pair.length <= max) continue;
    error(
      `edge-duplicate:${key}`,
      `${josa(describe(s), '과', '와')} ${describe(t)} 사이에 선이 ${pair.length}개 있습니다. ${max === 2 ? '재귀 관계라도 2개까지만 그립니다' : '하나만 남기고 지워야 합니다'}`,
      pair.map((e) => e.id),
    );
  }

  // 복합 속성 덩어리(속성끼리 이어진 묶음)마다 소유자와 키를 한 번에 구한다
  const componentOf = new Map<string, AttributeComponent>();
  for (const start of nodes) {
    if (start.kind !== 'attribute' || componentOf.has(start.id)) continue;
    const component: AttributeComponent = { members: [start], hasKey: false, hasPartialKey: false };
    componentOf.set(start.id, component);
    const ownerLinks = new Set<string>();
    const owners: ErdNode[] = [];
    const attributePairs = new Set<string>();
    for (let i = 0; i < component.members.length; i++) {
      const attr = component.members[i];
      if (attr.keyType === 'key') component.hasKey = true;
      if (attr.keyType === 'partial') component.hasPartialKey = true;
      for (const { other } of links.get(attr.id)!) {
        if (other.kind === 'attribute') {
          attributePairs.add(pairKey(attr.id, other.id));
          if (!componentOf.has(other.id)) {
            componentOf.set(other.id, component);
            component.members.push(other);
          }
        } else if (isOwnerKind(other.kind)) {
          const key = `${attr.id}|${other.id}`;
          if (!ownerLinks.has(key)) {
            ownerLinks.add(key);
            owners.push(other);
          }
        }
      }
    }

    const members = component.members;
    const memberIds = members.map((m) => m.id);
    const anchor = memberIds.reduce((a, b) => (a < b ? a : b));
    if (owners.length === 0) {
      if (members.length === 1) {
        error(`attribute-unconnected:${start.id}`, `${josa(describe(start), '이', '가')} 어디에도 연결되어 있지 않습니다`, [start.id]);
      } else {
        error(
          `attribute-unowned:${anchor}`,
          `${quoteNames(members)} 속성이 서로만 이어져 있고 엔티티나 관계에는 연결되어 있지 않습니다`,
          memberIds,
        );
      }
    } else if (owners.length > 1) {
      const ownerNames = [...new Set(owners.map(describe))].join(', ');
      error(
        `attribute-multi-owner:${anchor}`,
        members.length === 1
          ? `${josa(describe(start), '이', '가')} 여러 곳(${ownerNames})에 연결되어 있습니다. 속성은 엔티티나 관계 하나에만 속해야 합니다`
          : `서로 이어진 ${quoteNames(members)} 속성이 엔티티나 관계에 선 ${owners.length}개로 연결되어 있습니다. 복합 속성은 맨 위 속성 하나만 연결합니다`,
        memberIds,
      );
    }
    if (attributePairs.size > members.length - 1) {
      error(
        `attribute-cycle:${anchor}`,
        `${quoteNames(members)} 속성이 고리 모양으로 이어져 있습니다. 하위 속성은 상위 속성 하나에만 연결합니다`,
        memberIds,
      );
    }
  }

  // 특수화마다 슈퍼타입과 서브타입을 가린다(서브타입은 키를 물려받는다)
  const subtypeIds = new Set<string>();
  for (const spec of nodes) {
    if (spec.kind !== 'spec') continue;
    const members = new Map<string, SpecMember>();
    for (const { edge, other } of links.get(spec.id)!) {
      const member = members.get(other.id);
      if (member) member.double = member.double || edge.double;
      else members.set(other.id, { node: other, double: edge.double });
    }
    const roles = pickSpecRoles(spec, [...members.values()]);
    for (const sub of roles.subtypes) subtypeIds.add(sub.id);
    if (members.size < 2) {
      error(
        `spec-degree:${spec.id}`,
        `${describe(spec)}에는 슈퍼타입과 서브타입을 합쳐 엔티티가 2개 이상 연결되어야 합니다(현재 ${members.size}개)`,
        [spec.id],
      );
    }
  }

  const entitiesByName = new Map<string, ErdNode[]>();

  for (const node of nodes) {
    const nodeLinks = links.get(node.id)!;
    const label = describe(node);

    if ((node.kind === 'entity' || node.kind === 'relationship' || node.kind === 'attribute') && plainName(node) === '') {
      warn(`empty-name:${node.id}`, `이름이 비어 있는 ${josa(kindNoun(node), '이', '가')} 있습니다`, [node.id]);
    }

    if (node.kind === 'entity') {
      const name = plainName(node).toLowerCase();
      if (name) {
        const same = entitiesByName.get(name);
        if (same) same.push(node);
        else entitiesByName.set(name, [node]);
      }

      let connected = false;
      let hasKey = false;
      let hasPartialKey = false;
      const identifyingEdges: ErdEdge[] = [];
      for (const { edge, other } of nodeLinks) {
        if (other.kind === 'relationship') {
          connected = true;
          if (other.identifying) identifyingEdges.push(edge);
        } else if (other.kind === 'spec') {
          connected = true;
        } else if (other.kind === 'attribute') {
          const component = componentOf.get(other.id)!;
          hasKey = hasKey || component.hasKey;
          hasPartialKey = hasPartialKey || component.hasPartialKey;
        }
      }

      if (node.weak) {
        if (identifyingEdges.length === 0) {
          error(`weak-no-identifying:${node.id}`, `${josa(label, '이', '가')} 식별 관계(이중 마름모)에 연결되어 있지 않습니다`, [node.id]);
        } else if (!identifyingEdges.some((e) => e.double)) {
          // 식별 관계가 여럿이면(약한 엔티티가 다른 약한 엔티티의 소유자인 경우) 그중 하나만 이중선이면 된다
          warn(
            `weak-participation:${node.id}`,
            `${josa(label, '과', '와')} 식별 관계 사이의 선이 이중선이 아닙니다. 약한 엔티티는 식별 관계에 전체 참여합니다`,
            identifyingEdges.map((e) => e.id),
          );
        }
        if (!hasPartialKey) {
          warn(`weak-no-partial-key:${node.id}`, `${label}에 부분 키(점선 밑줄 속성)가 없습니다`, [node.id]);
        }
      } else if (!hasKey && !subtypeIds.has(node.id)) {
        warn(`entity-no-key:${node.id}`, `${label}에 식별자(키 속성)가 없습니다`, [node.id]);
      }

      if (!connected) {
        warn(`entity-isolated:${node.id}`, `${josa(label, '이', '가')} 어떤 관계나 특수화에도 연결되어 있지 않습니다`, [node.id]);
      }
    } else if (node.kind === 'relationship') {
      let entityEdges = 0;
      let hasWeak = false;
      for (const { edge, other } of nodeLinks) {
        if (other.kind !== 'entity') continue;
        entityEdges++;
        if (other.weak) hasWeak = true;
        if (edge.label.trim() === '') {
          warn(
            `edge-no-cardinality:${edge.id}`,
            `${josa(describe(other), '과', '와')} ${label} 사이의 선에 카디널리티(1, M, N)가 없습니다`,
            [edge.id],
          );
        }
      }
      if (entityEdges < 2) {
        error(
          `relationship-degree:${node.id}`,
          `${josa(label, '은', '는')} 엔티티와 선 2개 이상으로 이어져야 합니다(현재 ${entityEdges}개)`,
          [node.id],
        );
      }
      if (node.identifying && !hasWeak) {
        warn(`identifying-no-weak:${node.id}`, `${label}에 약한 엔티티(이중 직사각형)가 연결되어 있지 않습니다`, [node.id]);
      }
    } else if (node.kind === 'attribute') {
      const keyType = node.keyType ?? 'none';
      if (keyType !== 'none' && (node.multivalued || node.derived)) {
        const keyWord = keyType === 'key' ? '식별자(키)' : '부분 키';
        const flags = [node.multivalued ? '다중값' : '', node.derived ? '유도' : ''].filter(Boolean).join(', ');
        warn(
          `attribute-key-conflict:${node.id}`,
          `${josa(label, '이', '가')} ${keyWord}이면서 ${flags} 속성으로 표시되어 있습니다. 키는 단일값 저장 속성이어야 합니다`,
          [node.id],
        );
      }
    }
  }

  for (const [name, same] of entitiesByName) {
    if (same.length < 2) continue;
    warn(
      `duplicate-entity-name:${name}`,
      `'${plainName(same[0])}' 이름의 엔티티가 ${same.length}개 있습니다`,
      same.map((n) => n.id),
    );
  }

  return [...errors, ...warnings];
}
