/**
 * Chen 표기법의 연결 규칙과 다이어그램 검증(순수 함수). [담당: rules 에이전트]
 * 아래 export의 이름과 시그니처는 계약이므로 바꾸지 않는다.
 * 이유와 설명은 문장이 아니라 메시지(키와 값)로 돌려준다. 화면에 보일 때 클라이언트가 현재 언어로 바꾼다.
 */
import { msg, type ConnectReasonKey, type IssueMessageKey, type Message, type MessageParam, type NodeNounId, type SharedMessage } from './messages';
import type { ErdEdge, ErdNode, Issue, NodeKind } from './types';

export interface ConnectCheck {
  ok: boolean;
  /** 연결할 수 없는 이유. ok면 생략 */
  reason?: SharedMessage;
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
function kindPairReason(a: NodeKind, b: NodeKind): ConnectReasonKey | null {
  if (a === 'note' || b === 'note') return 'connect.note';
  if (a === 'spec' || b === 'spec') {
    const other = a === 'spec' ? b : a;
    if (other === 'entity') return null;
    if (other === 'spec') return 'connect.specSpec';
    if (other === 'relationship') return 'connect.specRelationship';
    return 'connect.specAttribute';
  }
  if (a === 'entity' && b === 'entity') return 'connect.entityEntity';
  if (a === 'relationship' && b === 'relationship') return 'connect.relationshipRelationship';
  return null;
}

/** 같은 두 도형 사이에 허용되는 선의 수. 엔티티와 관계 사이만 재귀 관계를 위해 2개. */
function maxEdgesBetween(a: NodeKind, b: NodeKind): number {
  return isEntityRelationship(a, b) ? 2 : 1;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** 메시지에서 이 도형을 부르는 말의 종류. 특수화 원은 따로 다룬다. */
function nounOf(n: ErdNode): NodeNounId {
  switch (n.kind) {
    case 'entity':
      return n.weak ? 'weakEntity' : 'entity';
    case 'relationship':
      return n.identifying ? 'identifyingRelationship' : 'relationship';
    case 'note':
      return 'note';
    default:
      return 'attribute';
  }
}

function plainName(n: ErdNode): string {
  return n.text.replace(/\s+/g, ' ').trim();
}

/** 메시지에 넣을 도형 이름. 한국어로는 'TEAM' 엔티티, 이름 없는 속성, 특수화 원(d) */
function describe(n: ErdNode): SharedMessage {
  if (n.kind === 'spec') return msg('rules.node.spec', { type: n.specType ?? 'd' });
  const name = plainName(n);
  return name ? msg(`rules.node.${nounOf(n)}.named`, { name }) : msg(`rules.node.${nounOf(n)}.unnamed`);
}

/** 이름을 따옴표로 묶어 나열한다. limit개를 넘으면 나머지는 개수만 적는다. */
function quoteNames(nodes: ErdNode[], limit = 3): MessageParam {
  const names = nodes.slice(0, limit).map((n): SharedMessage => {
    const name = plainName(n);
    return name ? msg('rules.name.quoted', { name }) : msg('rules.name.unnamed');
  });
  const rest = nodes.length - limit;
  return rest > 0 ? msg('rules.names.more', { names, count: rest }) : names;
}

/** 내용이 같은 메시지를 하나만 남긴다(이름과 종류가 같은 도형이 여럿일 때). */
function uniqueMessages(list: SharedMessage[]): SharedMessage[] {
  const seen = new Set<string>();
  return list.filter((m) => {
    const key = JSON.stringify(m);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  if (source.id === target.id) return { ok: false, reason: msg('connect.self') };

  const kindReason = kindPairReason(source.kind, target.kind);
  if (kindReason) return { ok: false, reason: msg(kindReason) };

  let existing = 0;
  for (const e of edges) {
    if ((e.source === source.id && e.target === target.id) || (e.source === target.id && e.target === source.id)) existing++;
  }
  if (existing >= maxEdgesBetween(source.kind, target.kind)) {
    return isEntityRelationship(source.kind, target.kind)
      ? { ok: false, reason: msg('connect.pairLimit') }
      : { ok: false, reason: msg('connect.alreadyConnected') };
  }

  if (nodes && (source.kind === 'attribute' || target.kind === 'attribute')) {
    const nodeById = toNodeMap(nodes);
    const neighbors = neighborIds(edges);
    if (source.kind === 'attribute' && target.kind === 'attribute') {
      const a = attributeGroup(source.id, neighbors, nodeById);
      if (a.members.has(target.id)) {
        return { ok: false, reason: msg('connect.sameComposite') };
      }
      const b = attributeGroup(target.id, neighbors, nodeById);
      if (a.owners.length > 0 && b.owners.length > 0) {
        // 양쪽 다 이미 소유자가 있으면, 이었을 때 한쪽이 상위를 둘 가지게 된다
        return { ok: false, reason: msg('connect.bothOwned') };
      }
    } else {
      const attribute = source.kind === 'attribute' ? source : target;
      const group = attributeGroup(attribute.id, neighbors, nodeById);
      if (group.owners.length > 0) {
        const direct = group.owners.find((o) => o.via === attribute.id);
        return direct
          ? { ok: false, reason: msg('connect.attributeOwned', { owner: describe(direct.owner) }) }
          : { ok: false, reason: msg('connect.attributeInComposite', { owner: describe(group.owners[0].owner) }) };
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
  const error = (id: string, message: Message<IssueMessageKey>, elementIds: string[]) => {
    errors.push({ id, severity: 'error', message, elementIds });
  };
  const warn = (id: string, message: Message<IssueMessageKey>, elementIds: string[]) => {
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
        present ? msg('issue.edgeDangling', { node: describe(present) }) : msg('issue.edgeDanglingBoth'),
        present ? [e.id, present.id] : [e.id],
      );
      continue;
    }
    if (s.id === t.id) {
      error(`edge-self:${e.id}`, msg('issue.edgeSelf', { node: describe(s) }), [e.id, s.id]);
      continue;
    }
    const reason = kindPairReason(s.kind, t.kind);
    if (reason) {
      error(
        `edge-invalid:${e.id}`,
        msg('issue.edgeInvalid', { a: describe(s), b: describe(t), reason: msg(reason) }),
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
      msg(max === 2 ? 'issue.edgeDuplicateRecursive' : 'issue.edgeDuplicate', { a: describe(s), b: describe(t), count: pair.length }),
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
        error(`attribute-unconnected:${start.id}`, msg('issue.attributeUnconnected', { node: describe(start) }), [start.id]);
      } else {
        error(
          `attribute-unowned:${anchor}`,
          msg('issue.attributeUnowned', { names: quoteNames(members) }),
          memberIds,
        );
      }
    } else if (owners.length > 1) {
      const ownerNames = uniqueMessages(owners.map(describe));
      error(
        `attribute-multi-owner:${anchor}`,
        members.length === 1
          ? msg('issue.attributeMultiOwner', { node: describe(start), owners: ownerNames })
          : msg('issue.attributeGroupMultiOwner', { names: quoteNames(members), count: owners.length }),
        memberIds,
      );
    }
    if (attributePairs.size > members.length - 1) {
      error(
        `attribute-cycle:${anchor}`,
        msg('issue.attributeCycle', { names: quoteNames(members) }),
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
        msg('issue.specDegree', { node: describe(spec), count: members.size }),
        [spec.id],
      );
    }
  }

  const entitiesByName = new Map<string, ErdNode[]>();

  for (const node of nodes) {
    const nodeLinks = links.get(node.id)!;
    const label = describe(node);

    if ((node.kind === 'entity' || node.kind === 'relationship' || node.kind === 'attribute') && plainName(node) === '') {
      const noun = nounOf(node) as Exclude<NodeNounId, 'note'>;
      warn(`empty-name:${node.id}`, msg(`issue.emptyName.${noun}`), [node.id]);
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
          error(`weak-no-identifying:${node.id}`, msg('issue.weakNoIdentifying', { node: label }), [node.id]);
        } else if (!identifyingEdges.some((e) => e.double)) {
          // 식별 관계가 여럿이면(약한 엔티티가 다른 약한 엔티티의 소유자인 경우) 그중 하나만 이중선이면 된다
          warn(
            `weak-participation:${node.id}`,
            msg('issue.weakParticipation', { node: label }),
            identifyingEdges.map((e) => e.id),
          );
        }
        if (!hasPartialKey) {
          warn(`weak-no-partial-key:${node.id}`, msg('issue.weakNoPartialKey', { node: label }), [node.id]);
        }
      } else if (!hasKey && !subtypeIds.has(node.id)) {
        warn(`entity-no-key:${node.id}`, msg('issue.entityNoKey', { node: label }), [node.id]);
      }

      if (!connected) {
        warn(`entity-isolated:${node.id}`, msg('issue.entityIsolated', { node: label }), [node.id]);
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
            msg('issue.edgeNoCardinality', { a: describe(other), b: label }),
            [edge.id],
          );
        }
      }
      if (entityEdges < 2) {
        error(
          `relationship-degree:${node.id}`,
          msg('issue.relationshipDegree', { node: label, count: entityEdges }),
          [node.id],
        );
      }
      if (node.identifying && !hasWeak) {
        warn(`identifying-no-weak:${node.id}`, msg('issue.identifyingNoWeak', { node: label }), [node.id]);
      }
    } else if (node.kind === 'attribute') {
      const keyType = node.keyType ?? 'none';
      if (keyType !== 'none' && node.multivalued) {
        const keyWord = msg(keyType === 'key' ? 'rules.keyWord.key' : 'rules.keyWord.partial');
        warn(`attribute-key-conflict:${node.id}`, msg('issue.attributeKeyConflict', { node: label, keyWord }), [node.id]);
      }
    }
  }

  for (const [name, same] of entitiesByName) {
    if (same.length < 2) continue;
    warn(
      `duplicate-entity-name:${name}`,
      msg('issue.duplicateEntityName', { name: plainName(same[0]), count: same.length }),
      same.map((n) => n.id),
    );
  }

  return [...errors, ...warnings];
}
